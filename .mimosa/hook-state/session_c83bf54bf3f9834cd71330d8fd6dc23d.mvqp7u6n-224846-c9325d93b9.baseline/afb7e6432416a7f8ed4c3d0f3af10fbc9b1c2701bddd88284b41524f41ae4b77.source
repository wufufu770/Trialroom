// P0#1 / P1#8 · 面试扣次闭环 + 房间生命周期
process.env.TRIALROOM_DEV = "1";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting, getDb } from "../platform/db.mjs";
import * as svc from "../platform/payment/service.mjs";
import * as rooms from "../platform/rooms.mjs";
import { startAttempt, finishAttempt, myAttempts, closeRoom, leaveRoom } from "../platform/attempts.mjs";

function fresh() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('uA')").run();
  db.prepare("INSERT INTO users (id) VALUES ('uB')").run();
  return db;
}
const buy = (u, code) => {
  const o = svc.createOrder({ userId: u, productCode: code });
  svc.markPaid(o.order_no, { buyerAccountHash: `alipay:${u}` });
};

test("扣次闭环:无权益 402 → 买 5 次包 → 5 次开跑 → 第 6 次 402 → 收卷写三条件", () => {
  fresh();
  assert.throws(() => startAttempt({ userId: "uA" }), (e) => e.status === 402);
  buy("uA", "pack5_1990");
  let last;
  for (let i = 0; i < 5; i++) last = startAttempt({ userId: "uA", position: "Go 后端", difficulty: "hard" });
  assert.ok(last.attempt_id.startsWith("att_"));
  assert.equal(last.entitlement.quota_left, 0);
  assert.throws(() => startAttempt({ userId: "uA" }), (e) => e.status === 402, "耗尽后 402");
  const fin = finishAttempt({
    attemptId: last.attempt_id, userId: "uA", scoreAfter: 72, baseline: 65,
    dimsBefore: { logic: 3, problem_solving: 3, technical_depth: 2 },
    dimsAfter: { logic: 4, problem_solving: 3, technical_depth: 3 },
    recheckDeltas: [0, 0, 1, 0], recheckGrounded: true,
  });
  assert.deepEqual(fin.qualification, { cond1: true, cond2: true, cond3: true, passed: true });
  // 重复收卷幂等
  const again = finishAttempt({ attemptId: last.attempt_id, userId: "uA", scoreAfter: 0, baseline: 0, dimsBefore: {}, dimsAfter: {} });
  assert.equal(again.already_finished, true);
  // 我的尝试列表带判定(DESC:最新在前,已收卷的是第 5 次 → list[0])
  const list = myAttempts("uA");
  assert.equal(list.length, 5);
  assert.ok(list[0].qualification.includes('"passed":true'));
});

test("时间卡:期内无限次,过期 402", () => {
  fresh();
  buy("uA", "monthly_2990");
  startAttempt({ userId: "uA" }); startAttempt({ userId: "uA" });
  getDb().prepare("UPDATE entitlements SET valid_until='2000-01-01T00:00:00Z' WHERE kind='time_pass'").run();
  assert.throws(() => startAttempt({ userId: "uA" }), (e) => e.status === 402);
});

test("尝试越权:他人收卷 404;挂房间可选", () => {
  fresh();
  buy("uA", "pack5_1990"); // 两次开跑需要 2 次额度
  const a = startAttempt({ userId: "uA" });
  assert.throws(() => finishAttempt({ attemptId: a.attempt_id, userId: "uB" }), /尝试不存在/);
  const r = rooms.createRoom({ hostUserId: "uA" });
  const a2 = startAttempt({ userId: "uA", roomCode: r.room_code });
  const row = getDb().prepare("SELECT room_id FROM interview_attempts WHERE id = ?").get(a2.attempt_id);
  assert.equal(row.room_id, r.room_id);
});

test("生命周期:房主关房后入座 404;离座再入保号;非房主关房 404", () => {
  fresh();
  const r = rooms.createRoom({ hostUserId: "uA" });
  rooms.joinRoom({ userId: "uB", roomCode: r.room_code });
  assert.equal(closeRoom({ roomId: r.room_id, userId: "uB" }).error?.status, 404, "非房主关房同 404");
  assert.ok(closeRoom({ roomId: r.room_id, userId: "uA" }).closed);
  assert.notEqual(rooms.joinRoom({ userId: "uB", roomCode: r.room_code }).error, undefined, "关房后入座拒绝");
  const r2 = rooms.createRoom({ hostUserId: "uA" });
  const j = rooms.joinRoom({ userId: "uB", roomCode: r2.room_code });
  assert.ok(leaveRoom({ roomId: r2.room_id, userId: "uB" }).left);
  const back = rooms.joinRoom({ userId: "uB", roomCode: r2.room_code });
  assert.equal(back.seat_no, j.seat_no, "离座复活保号");
});
