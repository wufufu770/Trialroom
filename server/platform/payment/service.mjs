// 订单/权益服务 —— 幂等下单、证据链落库、权益唯一真相源。
// 依据:11-final-plan §3.10(幂等三段:原子占位→执行→写结果)/§5.3(证据链工程)
//
// 定价表(PC-15,与设计文档 §7.1.3 逐字一致;材料/定价页/SKU 三处必须同步):
//   ¥0.01 首单 / ¥3.9 单次 / ¥19.9×5次 / ¥49.9×20次 / ¥29.9×30天 / ¥9.9 房间共享
import crypto from "node:crypto";
import { getDb, genId, nowIso } from "../db.mjs";

export const PRODUCTS = Object.freeze({
  first_order_001: { code: "first_order_001", name: "首单体验 ¥0.01", amount_fen: 1,   kind: "attempt_pack", quota: 1, days: null, first_only: true },
  single_390:      { code: "single_390",      name: "单次模拟面试 ¥3.9", amount_fen: 390,  kind: "attempt_pack", quota: 1, days: null },
  pack5_1990:      { code: "pack5_1990",      name: "5 次包 ¥19.9",     amount_fen: 1990, kind: "attempt_pack", quota: 5, days: null },
  pack20_4990:     { code: "pack20_4990",     name: "20 次包 ¥49.9",    amount_fen: 4990, kind: "attempt_pack", quota: 20, days: null },
  monthly_2990:    { code: "monthly_2990",    name: "30 天不限次 ¥29.9", amount_fen: 2990, kind: "time_pass",  quota: null, days: 30 },
  room_share_990:  { code: "room_share_990",  name: "房间共享 ¥9.9",    amount_fen: 990,  kind: "room_share",  quota: 1, days: null },
});

const event = (db, orderNo, ev, payload = {}) =>
  db.prepare("INSERT INTO order_events (id, order_no, event, payload) VALUES (?, ?, ?, ?)")
    .run(genId("oev"), orderNo, ev, JSON.stringify(payload));

/**
 * 幂等下单:同 (user, operation=create_order, client_key) 恒返回同一单。
 * 原子占位由 orders.idempotency_key UNIQUE 兜底 —— 冲突即读回原单。
 */
export function createOrder({ userId, productCode, idempotencyKey = null, provider = "mock", source = "self_built", internal = false }) {
  const db = getDb();
  const product = PRODUCTS[productCode];
  if (!product) throw Object.assign(new Error(`未知商品 ${productCode}`), { status: 400 });
  if (product.first_only) {
    const prior = db.prepare(
      "SELECT 1 FROM orders WHERE user_id = ? AND product_code = ? AND status = 'paid'").get(userId, productCode);
    if (prior) throw Object.assign(new Error("首单档位每人限一次"), { status: 409 });
  }
  const orderNo = `TR${Date.now().toString(36)}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  const idem = idempotencyKey ? `web:${userId}:create_order:${idempotencyKey}` : null;
  try {
    db.prepare(`INSERT INTO orders (order_no, user_id, product_code, product_name, amount_fen,
      provider, source, idempotency_key, is_internal_verification)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orderNo, userId, product.code, product.name, product.amount_fen, provider, source, idem, internal ? 1 : 0);
  } catch (e) {
    if (String(e.message).includes("UNIQUE") && idem) {
      const prior = db.prepare("SELECT * FROM orders WHERE idempotency_key = ?").get(idem);
      // 同 key 不同商品/用户是客户端串单错误,不得静默返回旧单(审查 P2-6)
      if (prior && (prior.product_code !== productCode || prior.user_id !== userId)) {
        throw Object.assign(new Error("idempotency key 已绑定其他商品/用户"), { status: 409 });
      }
      return prior;
    }
    throw e;
  }
  event(db, orderNo, "created", { product_code: product.code, amount_fen: product.amount_fen, provider });
  return db.prepare("SELECT * FROM orders WHERE order_no = ?").get(orderNo);
}

export function getOrder(orderNo) {
  return getDb().prepare("SELECT * FROM orders WHERE order_no = ?").get(orderNo);
}

/**
 * 支付成功落账(单事务):订单置 paid + 事件 + 授予权益 + 首单埋点。
 * 幂等:已 paid 直接返回(通知重放安全)。买方标识冗余落库(A1 口径)。
 */
export function markPaid(orderNo, { tradeNo = null, buyerAccountHash = null, buyerRealnameDigest = null } = {}) {
  const db = getDb();
  const order = getOrder(orderNo);
  if (!order) throw Object.assign(new Error("订单不存在"), { status: 404 });
  if (order.status === "paid" || order.status === "refunded") return { order, granted: false };
  const product = PRODUCTS[order.product_code];
  const until = product.days
    ? new Date(Date.now() + product.days * 86400_000).toISOString()
    : null;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE orders SET status='paid', trade_no=?, paid_at=?, buyer_account_hash=?,
      buyer_realname_digest=? WHERE order_no=? AND status IN ('created','pending')`)
      .run(tradeNo, nowIso(), buyerAccountHash, buyerRealnameDigest, orderNo);
    if (db.prepare("SELECT changes() AS c").get().c === 0) return; // 并发重放,由幂等返回
    // 首单唯一性的支付期复查:idx_first_order_paid 部分唯一索引是原子兜底,
    // 此处显式拦截给出可解释错误(审查 P0-1:多张未付首单顺序结清的绕过路径)
    if (product.first_only) {
      const dup = db.prepare(`SELECT order_no FROM orders
        WHERE user_id = ? AND product_code = 'first_order_001' AND status = 'paid' AND order_no != ?
        LIMIT 1`).get(order.user_id, orderNo);
      if (dup) {
        throw Object.assign(new Error("首单档位每人限一次(存在已支付首单)"), { status: 409 });
      }
    }
    event(db, orderNo, "paid", { trade_no: tradeNo, amount_fen: order.amount_fen });
    const entId = genId("ent");
    db.prepare(`INSERT INTO entitlements (id, user_id, order_no, kind, quota_total, valid_until)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(entId, order.user_id, orderNo, product.kind, product.quota ?? 0, until);
    db.prepare("INSERT INTO entitlement_ledger (id, entitlement_id, delta, reason, ref) VALUES (?, ?, ?, 'grant', ?)")
      .run(genId("elf"), entId, product.quota ?? 1, orderNo);
    // 内控单不产生 first_pay 埋点(审查 F5:mock 自测污染漏斗)
    if (order.product_code === "first_order_001" && !order.is_internal_verification) {
      db.prepare("INSERT INTO funnel_events (id, event, user_hash) VALUES (?, 'first_pay', ?)")
        .run(genId("fev"), buyerAccountHash ?? order.user_id);
    }
  });
  try {
    tx();
  } catch (e) {
    // 部分唯一索引 idx_first_order_paid 的原子拒绝也归一为 409(审查 P0-1)
    if (product.first_only && String(e.message).includes("UNIQUE")) {
      throw Object.assign(new Error("首单档位每人限一次(唯一索引拒绝)"), { status: 409 });
    }
    throw e;
  }
  return { order: getOrder(orderNo), granted: true };
}

/**
 * 渠道退款(P1#6):真实单先执行支付宝侧,成功才落本地;失败抛错且本地不动。
 * mock 轨/未配钥 → 直接本地流转(对账与测试语义)。
 */
export async function refundOrderWithChannel(orderNo, amountFen) {
  const alipay = await import("./alipay.mjs");
  const order0 = getOrder(orderNo);
  if (order0 && order0.provider === "alipay_web" && alipay.isConfigured()) {
    await alipay.refundTrade({
      outTradeNo: orderNo, refundAmountFen: amountFen ?? order0.amount_fen,
      refundNo: `RF${orderNo}`, reason: "trialroom 用户退款",
    });
  }
  return refundOrder(orderNo, amountFen);
}

/**
 * 退款(本地状态):订单置 refunded + 权益作废 + 台账。
 * 仅 ¥3.9 及以上(¥0.01 失败走补发,不产生退款流水 —— §5.9.3)。
 */
export function refundOrder(orderNo, amountFen) {
  const db = getDb();
  const order = getOrder(orderNo);
  if (!order) throw Object.assign(new Error("订单不存在"), { status: 404 });
  if (order.amount_fen < 390) throw Object.assign(new Error("¥0.01 首单不开放退款(按补发处理)"), { status: 409 });
  if (order.status !== "paid") throw Object.assign(new Error(`订单状态 ${order.status} 不可退款`), { status: 409 });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE orders SET status='refunded', refund_state='done', refunded_at=?, refund_amount_fen=? WHERE order_no=?`)
      .run(nowIso(), amountFen ?? order.amount_fen, orderNo);
    event(db, orderNo, "refunded", { amount_fen: amountFen ?? order.amount_fen });
    const ents = db.prepare("SELECT id FROM entitlements WHERE order_no = ?").all(orderNo);
    for (const e of ents) {
      db.prepare("UPDATE entitlements SET status='refunded' WHERE id = ?").run(e.id);
      db.prepare("INSERT INTO entitlement_ledger (id, entitlement_id, delta, reason) VALUES (?, ?, 0, 'refund')")
        .run(genId("elf"), e.id);
    }
  });
  tx();
  return getOrder(orderNo);
}

/** 消耗一次权益(次卡扣额度;时间卡校验有效期)。失败返回 null(前端引导购买)。 */
export function consumeEntitlement(userId, kind = "attempt_pack") {
  const db = getDb();
  const now = nowIso();
  const ent = db.prepare(`SELECT * FROM entitlements
    WHERE user_id = ? AND kind = ? AND status = 'active'
      AND (valid_until IS NULL OR valid_until > ?)
      AND (quota_total = 0 OR quota_used < quota_total)
    ORDER BY granted_at ASC LIMIT 1`).get(userId, kind, now);
  if (!ent) return null;
  if (ent.quota_total > 0) {
    const tx = db.transaction(() => {
      db.prepare("UPDATE entitlements SET quota_used = quota_used + 1 WHERE id = ? AND quota_used < quota_total").run(ent.id);
      if (db.prepare("SELECT changes() AS c").get().c === 1) {
        db.prepare("INSERT INTO entitlement_ledger (id, entitlement_id, delta, reason) VALUES (?, ?, -1, 'consume')")
          .run(genId("elf"), ent.id);
        if (ent.quota_used + 1 >= ent.quota_total) {
          db.prepare("UPDATE entitlements SET status = 'exhausted' WHERE id = ?").run(ent.id);
        }
      }
    });
    tx();
  }
  return db.prepare("SELECT * FROM entitlements WHERE id = ?").get(ent.id);
}

export function recordNotification({ provider, rawBody, verifyOk, parsed = null }) {
  getDb().prepare(`INSERT INTO payment_notifications (id, provider, raw_body, verify_ok, parsed)
    VALUES (?, ?, ?, ?, ?)`).run(genId("pnt"), provider, String(rawBody).slice(0, 16384), verifyOk ? 1 : 0,
    parsed ? JSON.stringify(parsed) : null);
}

/** 多口径统计(A1-A4 对冲读出端;订单级回填审核通过时间)。 */
export function paidUserStats() {
  return getDb().prepare("SELECT * FROM v_paid_user_stats").get();
}

/**
 * 回填作品审核通过时间(A4 口径)。无条件覆盖:官方口径未定期间可能多次修正,
 * orders.review_passed_at 是派生字段(从作品级事件回填),以最后一次为准。
 */
export function backfillReviewPassedAt(iso) {
  const db = getDb();
  db.prepare(`INSERT INTO review_pass_log (id, work_slug, review_passed_at) VALUES ('rpl_trialroom', 'trialroom', ?)
    ON CONFLICT(work_slug) DO UPDATE SET review_passed_at = excluded.review_passed_at`).run(iso);
  db.prepare("UPDATE orders SET review_passed_at = ?").run(iso);
}
