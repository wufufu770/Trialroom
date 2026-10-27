// R3 安全残余修复 · state 上限/追问冷却/通知脱敏/备份可重入/过期通知清理
process.env.TRIALROOM_DEV = "1";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting, getDb } from "../platform/db.mjs";
import * as rooms from "../platform/rooms.mjs";
import { aiFollowUp } from "../platform/interviewer.mjs";
import * as auth from "../platform/auth-alipay.mjs";
import * as svc from "../platform/payment/service.mjs";

function fresh() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('uA')").run();
  return db;
}

test("R1 OAuth state:软上限 10000 拒绝新 start(503);过期项 set 时惰性清扫", () => {
  process.env.ALIPAY_APP_ID = "2026R3TEST";
  process.env.ALIPAY_APP_PRIVATE_KEY = "test-key";
  process.env.ALIPAY_PUBLIC_KEY = "test-pub";
  try {
    auth.pendingStates.clear();
    // 直接向内部结构注入满额未过期 state(避免 10001 次 start 的 O(n²) 清扫成本)
    const now = Date.now();
    for (let i = 0; i < auth.PENDING_STATES_MAX; i++) {
      auth.pendingStates.set(`state_${i}`, now + 60_000);
    }
    assert.throws(() => auth.buildAuthStartUrl("https://app.example/cb"), (e) => e.status === 503);
    // 全部置为已过期 → 下一次 start 前惰性清扫腾出额度,恢复正常
    for (const [k, v] of auth.pendingStates) auth.pendingStates.set(k, now - 1);
    const start = auth.buildAuthStartUrl("https://app.example/cb");
    assert.equal(start.state.length, 32);
    assert.ok(auth.pendingStates.size < auth.PENDING_STATES_MAX, "过期项已被清扫");
    assert.equal(auth.consumeState(start.state), true);
  } finally {
    auth.pendingStates.clear();
    for (const k of ["ALIPAY_APP_ID", "ALIPAY_APP_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"]) delete process.env[k];
  }
});

test("R2 aiFollowUp:per-room 冷却连续两次第二次 429;他房不受影响;候选人回答先剥离不可见字符", async () => {
  fresh();
  delete process.env.TRIALROOM_LLM_API_KEY; // 无 key → 模板降级路径,结果确定
  const r1 = rooms.createRoom({ hostUserId: "uA" });
  const first = await aiFollowUp({ roomId: r1.room_id, userId: "uA" });
  assert.equal(first.source, "template");
  const second = await aiFollowUp({ roomId: r1.room_id, userId: "uA" });
  assert.equal(second.error?.status, 429);
  assert.equal(second.error?.code, "COOLDOWN");
  assert.equal(second.error?.message, "追问过于频繁");
  // 冷却是 per-room:另一房间立即可追问;注入零宽/双向字符的回答清洗后才拼 prompt
  const r2 = rooms.createRoom({ hostUserId: "uA" });
  const seat = getDb().prepare("SELECT id FROM room_seats WHERE room_id = ? AND is_host = 1").get(r2.room_id);
  getDb().prepare(`INSERT INTO room_messages (id, room_id, seat_id, turn_index, role, content)
    VALUES ('m_r3sec', ?, ?, 1, 'candidate', ?)`)
    .run(r2.room_id, seat.id, "AB\u200bCD 方案落地了\u202e限流\u200b与重试");
  const fu = await aiFollowUp({ roomId: r2.room_id, userId: "uA" });
  assert.equal(fu.source, "template");
  assert.ok(fu.content.includes("ABCD"), "零宽字符剥离后关键词连续(实际:" + JSON.stringify(fu.content) + ")");
  assert.ok(!/[\u200b-\u200f\u202a-\u202e\u2060]/.test(fu.content), "追问输出不含不可见字符");
});

test("R5 recordNotification:买家字段落库前脱敏(JSON 与表单两种形态)", () => {
  fresh();
  svc.recordNotification({
    provider: "alipay_web", verifyOk: true,
    rawBody: JSON.stringify({ trade_status: "TRADE_SUCCESS", buyer_id: "2088123456789",
      buyer_logon_id: "user****@alipay.com", seller_id: "2088998877665" }),
  });
  const row = getDb().prepare("SELECT raw_body FROM payment_notifications ORDER BY rowid DESC LIMIT 1").get();
  assert.ok(row.raw_body.includes('"buyer_id":"2088***"'), row.raw_body);
  assert.ok(row.raw_body.includes('"buyer_logon_id":"user***"'), row.raw_body);
  assert.ok(row.raw_body.includes('"seller_id":"2088***"'), row.raw_body);
  assert.ok(!row.raw_body.includes("2088123456789") && !row.raw_body.includes("2088998877665"));
  assert.ok(!row.raw_body.includes("@alipay.com"), "登录号域名部分也不得残留");
  // 表单/查询串形态(支付宝 notify 的实际传输形态)
  svc.recordNotification({ provider: "alipay_web", verifyOk: false,
    rawBody: "buyer_id=2088123456789&trade_status=TRADE_SUCCESS&seller_id=2088998877665" });
  const row2 = getDb().prepare("SELECT raw_body FROM payment_notifications ORDER BY rowid DESC LIMIT 1").get();
  assert.ok(row2.raw_body.startsWith("buyer_id=2088***&"), row2.raw_body);
  assert.ok(row2.raw_body.includes("seller_id=2088***"), row2.raw_body);
  assert.ok(!row2.raw_body.includes("2088123456789"));
});

test("R5 pruneOldNotifications:默认 180 天窗口,旧通知删除、新通知保留", () => {
  const db = fresh();
  const ins = db.prepare(`INSERT INTO payment_notifications (id, provider, raw_body, verify_ok, created_at)
    VALUES (?, 'alipay_web', '{}', 1, ?)`);
  ins.run("pnt_r3_old", "2000-01-01T00:00:00Z");
  ins.run("pnt_r3_new", new Date().toISOString());
  const n = svc.pruneOldNotifications(); // 默认 180 天
  assert.equal(n, 1);
  assert.ok(!db.prepare("SELECT 1 FROM payment_notifications WHERE id = 'pnt_r3_old'").get());
  assert.ok(db.prepare("SELECT 1 FROM payment_notifications WHERE id = 'pnt_r3_new'").get());
});

test("R4 backupNow:同日两次调用都成功(先删旧快照再 VACUUM,可重入)", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('u1')").run();
  const { backupNow } = await import("../platform/backup.mjs");
  const r1 = backupNow();
  const r2 = backupNow(); // 同日第二次:旧实现会因目标文件已存在而抛错
  assert.equal(r1.file, r2.file, "同日目标一致");
  assert.ok(fs.existsSync(r2.file));
  const snap = new Database(r2.file);
  assert.equal(snap.prepare("SELECT COUNT(*) c FROM users").get().c, 1);
  snap.close();
  fs.rmSync(r2.file, { force: true }); // 清理,不污染 data/backups
});
