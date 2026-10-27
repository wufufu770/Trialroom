// P7 · 平台支付链路 HTTP 端到端(mock 轨):dev-token → 下单 → mock 支付 → 统计 → 权益消耗
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting } from "../platform/db.mjs";
import { mountPlatform } from "../platform/index.mjs";
import { consumeEntitlement } from "../platform/payment/service.mjs";

process.env.TRIALROOM_ADMIN_TOKEN = "admin-token-for-e2e";
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
  return { status: res.status, json: await res.json().catch(() => null), text: res.status === 200 ? undefined : await res.text().catch(() => "") };
};

test("全链路:引导用户 → 商品 → 幂等下单 → mock 支付 → 内控标 → 管理统计 → 消耗", async () => {
  // 1. 开发用户引导(仅 mock/开发态;生产禁用)
  const dev = await call("POST", "/api/platform/orders"); // 无 token 先被拒
  assert.equal(dev.status, 401);
  const bootstrap = db.prepare("SELECT 1").get(); // 引导用户走 createDevUser(不经路由,生产态禁用路由)
  const { createDevUser } = await import("../platform/auth.mjs");
  const devUser = createDevUser("e2e-user");
  assert.ok(devUser.token.startsWith("pt_"));

  // 2. 商品目录(公开)
  const products = await call("GET", "/api/platform/products");
  assert.equal(products.status, 200);
  assert.equal(products.json.provider, "mock");
  assert.ok(products.json.products.some((p) => p.code === "first_order_001"));

  // 3. 幂等下单
  const o1 = await call("POST", "/api/platform/orders", { token: devUser.token, body: { product_code: "pack5_1990", idempotency_key: "e2e-1" } });
  assert.equal(o1.status, 200);
  const o2 = await call("POST", "/api/platform/orders", { token: devUser.token, body: { product_code: "pack5_1990", idempotency_key: "e2e-1" } });
  assert.equal(o2.json.order_no, o1.json.order_no);
  assert.equal(o2.json.pay_url.includes(o1.json.order_no), true);

  // 4. 订单可见性:别人的订单 404(不泄露存在性)
  const otherView = await call("GET", `/api/platform/orders/${o1.json.order_no}`, { token: "pt_someone_else" });
  assert.equal(otherView.status, 401); // 伪 token 先死在鉴权
  db.prepare("INSERT INTO users (id) VALUES ('u_stranger')").run();
  db.prepare(`INSERT INTO api_tokens (token_hash, user_id, name) VALUES (?, 'u_stranger', 'x')`).run(
    (await import("../platform/db.mjs")).sha256Hex("pt_stranger"),);
  const stranger = await call("GET", `/api/platform/orders/${o1.json.order_no}`, { token: "pt_stranger" });
  assert.equal(stranger.status, 404);

  // 5. mock 支付 → paid + 内控标
  const pay = await call("POST", `/api/platform/orders/${o1.json.order_no}/mock-pay`, { token: devUser.token });
  assert.equal(pay.status, 200);
  assert.equal(pay.json.order.status, "paid");

  // 6. 管理统计(固定 admin token)
  const stats = await call("GET", "/api/platform/stats/paid", { token: "admin-token-for-e2e" });
  assert.equal(stats.status, 200);
  assert.equal(stats.json.stats.order_count, 0, "mock 单打了内控标,统计口径必须排除");

  // 7. 权益消耗(5 次包)
  for (let i = 0; i < 5; i++) assert.ok(consumeEntitlement(devUser.user_id, "attempt_pack"));
  assert.equal(consumeEntitlement(devUser.user_id, "attempt_pack"), null);
});

test("MCP 与平台 token class 物理隔离:平台 token 打 /mcp 必须 401", async () => {
  const { createDevUser } = await import("../platform/auth.mjs");
  const devUser = createDevUser("e2e-user2");
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${devUser.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal(res.status, 401, "api_tokens 不得通过 mcp 鉴权(X-1 令牌混淆防护)");
});
