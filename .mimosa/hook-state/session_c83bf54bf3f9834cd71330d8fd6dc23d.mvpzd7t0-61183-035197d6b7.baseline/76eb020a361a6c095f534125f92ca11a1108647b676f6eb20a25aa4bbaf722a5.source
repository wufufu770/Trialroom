// P5 · 支付协议与订单/权益服务测试(真实 RSA2048 密钥对往返)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting } from "../platform/db.mjs";
import * as alipay from "../platform/payment/alipay.mjs";
import * as svc from "../platform/payment/service.mjs";

// 每个用例独立内存库
function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('u1')").run();
  return db;
}

// ── RSA2 协议往返 ──────────────────────────────────────────────────────────
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = (k) => k.export({ type: "spki", format: "pem" }); // 公钥
const priv = (k) => k.export({ type: "pkcs8", format: "pem" });

function withAlipayKeys(fn) {
  const saved = {};
  for (const k of ["ALIPAY_APP_ID", "ALIPAY_APP_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_NOTIFY_URL"]) {
    saved[k] = process.env[k];
  }
  process.env.ALIPAY_APP_ID = "2026000000000000";
  process.env.ALIPAY_APP_PRIVATE_KEY = priv(privateKey).replace(/\n/g, "\\n"); // 控制台裸形态
  process.env.ALIPAY_PUBLIC_KEY = pem(publicKey).replace(/\n/g, "\\n");
  process.env.ALIPAY_NOTIFY_URL = "https://trialroom.example/pay/alipay/notify";
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  } }
}

test("isConfigured:仅当三要素齐备", () => {
  assert.equal(alipay.isConfigured(), false);
  withAlipayKeys(() => assert.equal(alipay.isConfigured(), true));
});

test("canonicalString:排除 sign/sign_type/空值,key ASCII 升序", () => {
  assert.equal(
    alipay.canonicalString({ b: "2", a: "1", sign: "x", sign_type: "RSA2", empty: "" }),
    "a=1&b=2",
  );
});

test("buildPagePayForm:签名可被支付宝公钥验回;金额格式两位小数", () => {
  withAlipayKeys(() => {
    const { params, formHtml, action } = alipay.buildPagePayForm({
      outTradeNo: "TRTEST1", amountFen: 390, subject: "单次模拟面试",
    });
    assert.equal(action, alipay.SANDBOX_GATEWAY);
    assert.ok(params.sign);
    assert.equal(params.sign_type, "RSA2");
    const verifier = crypto.createVerify("RSA-SHA256")
      .update(alipay.canonicalString(params), "utf8");
    assert.equal(verifier.verify(pem(publicKey), params.sign, "base64"), true, "签名必须能被支付宝公钥验回");
    assert.ok(formHtml.includes("alipay.trade.page.pay"));
    const biz = JSON.parse(params.biz_content);
    assert.equal(biz.total_amount, "3.90");
    assert.equal(biz.product_code, "FAST_INSTANT_TRADE_PAY");
  });
});

test("金额边界:[0.01, 100000000] 元,越界抛错", () => {
  withAlipayKeys(() => {
    assert.ok(alipay.buildPagePayForm({ outTradeNo: "T1", amountFen: 1, subject: "s" }));
    assert.ok(alipay.buildPagePayForm({ outTradeNo: "T2", amountFen: 10000000000, subject: "s" }));
    assert.throws(() => alipay.buildPagePayForm({ outTradeNo: "T3", amountFen: 0, subject: "s" }));
    assert.throws(() => alipay.buildPagePayForm({ outTradeNo: "T4", amountFen: 10000000001, subject: "s" }));
  });
});

test("verifyNotify:正确签名通过;篡改金额/签名/单号分别拒绝", () => {
  withAlipayKeys(() => {
    const order = { order_no: "TRN1", amount_fen: 390 };
    const base = {
      app_id: "2026000000000000", out_trade_no: "TRN1", trade_no: "2026ALIPAY123",
      trade_status: "TRADE_SUCCESS", total_amount: "3.90", buyer_id: "2088001",
      notify_id: "N1", notify_type: "trade_status_sync",
    };
    const signed = { ...base, sign: alipay.rsa2Sign(base), sign_type: "RSA2" };
    const v = alipay.verifyNotify(signed, order);
    assert.equal(v.ok, true);
    assert.equal(v.trade_no, "2026ALIPAY123");
    assert.equal(v.buyer_id, "2088001");

    // 篡改金额:签名覆盖金额,直接篡改必先 SIGN_INVALID(安全正确)
    const tamperedAmount = { ...signed, total_amount: "0.90" };
    assert.equal(alipay.verifyNotify(tamperedAmount, order).reason, "SIGN_INVALID");
    // 金额不符:用正确签名但金额与我方订单不一致(如回调错单)→ AMOUNT_MISMATCH
    const wrongAmount = { ...base, total_amount: "0.90" };
    wrongAmount.sign = alipay.rsa2Sign(wrongAmount);
    assert.equal(alipay.verifyNotify({ ...wrongAmount, sign_type: "RSA2" }, order).reason, "AMOUNT_MISMATCH");
    const tamperedSign = { ...signed, sign: signed.sign.slice(0, -8) + "AAAAAAAA" };
    assert.equal(alipay.verifyNotify(tamperedSign, order).reason, "SIGN_INVALID");
    // 单号不符:正确签名但非本单 → OUT_TRADE_NO_MISMATCH
    const otherOrder = { ...base, out_trade_no: "TROTHER" };
    otherOrder.sign = alipay.rsa2Sign(otherOrder);
    assert.equal(alipay.verifyNotify({ ...otherOrder, sign_type: "RSA2" }, order).reason, "OUT_TRADE_NO_MISMATCH");
    const pending = { ...base, trade_status: "WAIT_BUYER_PAY" };
    pending.sign = alipay.rsa2Sign(pending);
    assert.equal(alipay.verifyNotify({ ...pending, sign: pending.sign, sign_type: "RSA2" }, order).reason.startsWith("STATUS_"), true);
  });
});

// ── 订单/权益服务 ─────────────────────────────────────────────────────────
test("下单幂等:同 idempotency_key 恒返回同一单", () => {
  const db = freshDb();
  const a = svc.createOrder({ userId: "u1", productCode: "pack5_1990", idempotencyKey: "k1" });
  const b = svc.createOrder({ userId: "u1", productCode: "pack5_1990", idempotencyKey: "k1" });
  assert.equal(a.order_no, b.order_no);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM orders").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM order_events").get().c, 1);
});

test("首单档位每人限一次(paid 后再买 409)", () => {
  const db = freshDb();
  const o = svc.createOrder({ userId: "u1", productCode: "first_order_001" });
  svc.markPaid(o.order_no, { buyerAccountHash: "alipay:2088x" });
  assert.throws(() => svc.createOrder({ userId: "u1", productCode: "first_order_001" }),
    /限一次/);
});

test("markPaid:单事务授予权益 + 事件链 + 首单埋点;重放安全", () => {
  const db = freshDb();
  const o = svc.createOrder({ userId: "u1", productCode: "first_order_001" });
  const { order, granted } = svc.markPaid(o.order_no, { tradeNo: "T1", buyerAccountHash: "alipay:b1" });
  assert.equal(granted, true);
  assert.equal(order.status, "paid");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entitlements").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM order_events WHERE event='paid'").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM funnel_events WHERE event='first_pay'").get().c, 1);
  const again = svc.markPaid(o.order_no, {});
  assert.equal(again.granted, false, "通知重放不得二次授予");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entitlements").get().c, 1);
});

test("退款:¥3.9 可退且权益作废;¥0.01 首单拒退(走补发不产生退款流水)", () => {
  const db = freshDb();
  const o1 = svc.createOrder({ userId: "u1", productCode: "single_390" });
  svc.markPaid(o1.order_no, {});
  const r = svc.refundOrder(o1.order_no);
  assert.equal(r.status, "refunded");
  assert.equal(db.prepare("SELECT status FROM entitlements WHERE order_no=?").get(o1.order_no).status, "refunded");
  const o2 = svc.createOrder({ userId: "u1", productCode: "first_order_001" });
  svc.markPaid(o2.order_no, {});
  assert.throws(() => svc.refundOrder(o2.order_no), /不开放退款/);
});

test("消耗权益:5 次包恰耗尽;台账逐笔;耗尽后 null", () => {
  const db = freshDb();
  const o = svc.createOrder({ userId: "u1", productCode: "pack5_1990" });
  svc.markPaid(o.order_no, {});
  for (let i = 0; i < 5; i++) {
    const e = svc.consumeEntitlement("u1", "attempt_pack");
    assert.ok(e, `第 ${i + 1} 次应可用`);
  }
  assert.equal(svc.consumeEntitlement("u1", "attempt_pack"), null);
  assert.equal(db.prepare("SELECT status FROM entitlements WHERE order_no=?").get(o.order_no).status, "exhausted");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entitlement_ledger WHERE reason='consume'").get().c, 5);
});

test("多口径统计:内控单排除;退款/0.01/审核通过口径并列", () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id) VALUES ('u2')").run();
  // 真实付费用户 u2:0.01 首单 + 3.9 单
  const o1 = svc.createOrder({ userId: "u2", productCode: "first_order_001" });
  svc.markPaid(o1.order_no, { buyerAccountHash: "alipay:real" });
  const o2 = svc.createOrder({ userId: "u2", productCode: "single_390" });
  svc.markPaid(o2.order_no, { buyerAccountHash: "alipay:real" });
  // 团队自测单 u1:打内控标
  const oi = svc.createOrder({ userId: "u1", productCode: "single_390", internal: true });
  svc.markPaid(oi.order_no, { buyerAccountHash: "alipay:internal" });
  db.prepare("UPDATE orders SET is_internal_verification = 1 WHERE order_no = ?").run(oi.order_no);

  const s = svc.paidUserStats();
  assert.equal(s.order_count, 2, "内控单不计入");
  assert.equal(s.dedup_account, 1, "u2 两单同一买家账号");
  assert.equal(s.dedup_account_excl_001, 1, "排除 0.01 后仍有 3.9 单");
  // A4 口径:审核通过时间在支付之前 → 计入;在未来 → 不计入(窗口起算语义)
  svc.backfillReviewPassedAt("2026-01-01T00:00:00Z");
  const s2 = svc.paidUserStats();
  assert.equal(s2.dedup_account_after_review, 1, "审核通过早于支付 → 计入");
  svc.backfillReviewPassedAt("2099-01-01T00:00:00Z");
  const s3 = svc.paidUserStats();
  assert.equal(s3.dedup_account_after_review, 0, "审核通过晚于支付 → 不计入");
});
