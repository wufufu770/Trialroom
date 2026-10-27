// P8a · 房间 REST + 埋点行为测试
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting } from "../platform/db.mjs";
import { mountPlatform } from "../platform/index.mjs";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
applyMigrations(db);
setDbForTesting(db);

const app = express();
app.use(express.json());
mountPlatform(app);
let srv, base;
before(async () => { srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`; });
after(() => srv.close());

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test("房间全流程:创建(房号只回一次)→列表无房号→入座→详情/消息→发言", async () => {
  const { createDevUser } = await import("../platform/auth.mjs");
  const host = createDevUser("host");
  const guest = createDevUser("guest");
  const ht = host.token, gt = guest.token;

  const created = await call("POST", "/api/platform/rooms", { token: ht, body: { industry: "backend", position: "Go 后端" } });
  assert.equal(created.status, 200);
  assert.ok(created.json.room_id.startsWith("rm_"));
  assert.match(created.json.room_code, /^\d{6}$/);
  const code = created.json.room_code, rid = created.json.room_id;

  // 列表与详情永不回显房号
  const mine = await call("GET", "/api/platform/rooms", { token: ht });
  assert.ok(!JSON.stringify(mine.json).includes(code), "列表不得含房号");
  const detail = await call("GET", `/api/platform/rooms/${rid}`, { token: ht });
  assert.ok(!JSON.stringify(detail.json).includes(code));
  assert.equal(detail.json.is_host, true);

  // 陌生人看房 → 404(与不存在同响应)
  const outsider = createDevUser("outsider");
  const o1 = await call("GET", `/api/platform/rooms/${rid}`, { token: outsider.token });
  const o2 = await call("GET", "/api/platform/rooms/rm_nope0000000000000000aa", { token: outsider.token });
  assert.equal(o1.status, 404); assert.equal(o2.status, 404);
  assert.equal(o1.json.message, o2.json.message);

  // 入座 + 发言 + 拉取
  const joined = await call("POST", "/api/platform/rooms/join", { token: gt, body: { room_code: code } });
  assert.equal(joined.status, 200);
  assert.equal(joined.json.seat_no, 2);
  const rejoin = await call("POST", "/api/platform/rooms/join", { token: gt, body: { room_code: code } });
  assert.equal(rejoin.json.already_seated, true);
  const msg = await call("POST", `/api/platform/rooms/${rid}/messages`, { token: gt, body: { content: "我的回答要点是…" } });
  assert.equal(msg.status, 200);
  const list = await call("GET", `/api/platform/rooms/${rid}/messages`, { token: ht });
  assert.equal(list.json.messages.length, 1);
  assert.equal(list.json.messages[0].role, "candidate");
  // room_join 埋点已随入座落库
  assert.equal(db.prepare("SELECT COUNT(*) c FROM funnel_events WHERE event='room_join'").get().c, 1);
});

test("dev-token:生产态 403;开发态返回一次性令牌", async () => {
  const r = await call("POST", "/api/platform/auth/dev-token", { body: { display_name: "x" } });
  assert.equal(r.status, 200);
  assert.ok(r.json.token.startsWith("pt_"));
});

test("/track:匿名埋点白名单 + 拒绝未知事件", async () => {
  const ok = await fetch(`${base}/track`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "landing_uv", session_ticket: "st_abc" }) });
  assert.equal(ok.status, 202);
  const bad = await fetch(`${base}/track`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "evil_event" }) });
  assert.equal(bad.status, 400);
});
