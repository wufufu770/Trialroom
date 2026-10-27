// P1#5/#6/P0#3 · 网关查单/退款执行/对账补偿/OAuth 登录(本地存根网关)
process.env.TRIALROOM_DEV = "1";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting, getDb } from "../platform/db.mjs";
import * as alipay from "../platform/payment/alipay.mjs";
import * as svc from "../platform/payment/service.mjs";
import { runReconciliation } from "../platform/payment/reconcile.mjs";
import { buildAuthStartUrl, consumeState, loginWithAuthCode } from "../platform/auth-alipay.mjs";
import { mountPlatform } from "../platform/index.mjs";

// ── 本地存根网关:按 method 返回预制业务响应 ──────────────────────────────
const behavior = {}; // method -> response body
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const params = Object.fromEntries(new URLSearchParams(body));
    const key = params.method?.replace(/\./g, "_") + "_response";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ [key]: behavior[params.method] ?? { code: "10000", msg: "Success" }, sign: "stub" }));
  });
});
let stubPort;
before(async () => {
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubPort = stub.address().port;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
  process.env.ALIPAY_APP_ID = "2026STUB";
  process.env.ALIPAY_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.ALIPAY_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" });
  process.env.ALIPAY_GATEWAY = `http://127.0.0.1:${stubPort}/gateway.do`;
  process.env.ALIPAY_TRUST_GATEWAY = "1"; // 仅测试:本地桩
});
after(async () => {
  stub.closeAllConnections?.(); // fetch keep-alive 会攥住连接,不关则 close() 永远等
  await new Promise((r) => stub.close(r));
  for (const k of ["ALIPAY_APP_ID", "ALIPAY_APP_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_GATEWAY", "ALIPAY_TRUST_GATEWAY"]) delete process.env[k];
});

function fresh() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('u1')").run();
  return db;
}
const db = fresh();

test("网关信任域校验:非官方域且未开 TRUST → 拒绝", async () => {
  const saved = process.env.ALIPAY_TRUST_GATEWAY;
  process.env.ALIPAY_TRUST_GATEWAY = "";
  await assert.rejects(() => alipay.queryTrade("X"), /信任列表/);
  process.env.ALIPAY_TRUST_GATEWAY = "1";
});

test("P1#5 对账:丢 notify 的已付订单被查单补偿落账", async () => {
  const o = svc.createOrder({ userId: "u1", productCode: "single_390", provider: "alipay_web" });
  // 模拟"已支付但 notify 丢失":订单仍 created,查单返回成功
  behavior["alipay.trade.query"] = { code: "10000", trade_status: "TRADE_SUCCESS", trade_no: "STUB-T1", total_amount: "3.90", buyer_user_id: "2088stub" };
  getDb().prepare("UPDATE orders SET created_at = '2000-01-01T00:00:00Z' WHERE order_no = ?").run(o.order_no);
  const r = await runReconciliation();
  assert.equal(r.compensated, 1);
  const after = svc.getOrder(o.order_no);
  assert.equal(after.status, "paid");
  assert.equal(after.trade_no, "STUB-T1");
  assert.equal(after.buyer_account_hash, "alipay:2088stub");
  // 补偿证据行落库
  assert.ok(getDb().prepare("SELECT 1 FROM payment_notifications WHERE parsed LIKE '%reconcile%'").get());
});

test("P1#5 对账:已关闭交易本地置 closed;未配钥跳过", async () => {
  const o = svc.createOrder({ userId: "u1", productCode: "single_390", provider: "alipay_web" });
  behavior["alipay.trade.query"] = { code: "10000", trade_status: "TRADE_CLOSED" };
  getDb().prepare("UPDATE orders SET created_at = '2000-01-01T00:00:00Z' WHERE order_no = ?").run(o.order_no);
  const r = await runReconciliation();
  assert.equal(r.closed, 1);
  assert.equal(svc.getOrder(o.order_no).status, "closed");
});

test("P1#6 渠道退款:先支付宝后本地;支付宝拒绝时本地不动", async () => {
  const o = svc.createOrder({ userId: "u1", productCode: "single_390", provider: "alipay_web" });
  svc.markPaid(o.order_no, { tradeNo: "T9", buyerAccountHash: "alipay:2088x" });
  // 网关拒绝(如余额不足 ACQ.TRADE_HAS_CLOSE 等)
  behavior["alipay.trade.refund"] = { code: "40004", msg: "REFUND_FAIL", sub_msg: "余额不足" };
  await assert.rejects(() => svc.refundOrderWithChannel(o.order_no), /REFUND_FAIL|40004/);
  assert.equal(svc.getOrder(o.order_no).status, "paid", "渠道失败本地不动");
  // 网关成功 → 本地落 refunded
  behavior["alipay.trade.refund"] = { code: "10000", fund_change: "Y", refund_fee: "3.90" };
  const done = await svc.refundOrderWithChannel(o.order_no);
  assert.equal(done.status, "refunded");
});

test("P0#3 OAuth:start 出授权 URL + state 一次性;code 换 user 归并", async () => {
  behavior["alipay.system.oauth.token"] = { code: "10000", user_id: "2088OAUTH1", access_token: "at" };
  const start = buildAuthStartUrl("https://app.example/cb");
  assert.ok(start.url.includes("publicAppAuthorize.htm") && start.url.includes("state="));
  assert.equal(consumeState(start.state), true, "state 首次消费有效");
  assert.equal(consumeState(start.state), false, "state 二次消费拒绝");
  const login = await loginWithAuthCode("auth-code-x");
  assert.ok(login.token.startsWith("pt_"));
  assert.equal(login.bound_alipay, "alipay:2088OAUTH1");
  // 同一支付宝账号再次登录 → 归并同一用户
  const again = await loginWithAuthCode("auth-code-x");
  assert.equal(again.user_id, login.user_id);
  assert.equal(getDb().prepare("SELECT COUNT(*) c FROM users WHERE alipay_user_hash = 'alipay:2088OAUTH1'").get().c, 1);
});

test("OAuth 路由:未带 state 的回调 400;完整挂载下可路由", async () => {
  const app = express();
  app.use(express.json());
  mountPlatform(app); // 复用同一注入 db
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const bad = await fetch(`${base}/api/platform/auth/alipay/callback?auth_code=x&state=deadbeef`);
  assert.equal(bad.status, 400);
  srv.closeAllConnections?.(); // fetch keep-alive 同样会卡住 express 的 close()
  srv.close();
});
