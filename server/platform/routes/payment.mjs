// 平台支付路由(挂载于 /api/platform;通知回调挂根作用域 /pay/alipay/notify)。
import express from "express";
import { PRODUCTS, createOrder, getOrder, markPaid, refundOrder, recordNotification, paidUserStats } from "../payment/service.mjs";
import { isConfigured, buildPagePayForm, verifyNotify } from "../payment/alipay.mjs";
import { platformAuth, requireScope } from "../auth.mjs";
import { getDb } from "../db.mjs";

export const router = express.Router();

router.get("/products", (req, res) => {
  res.json({ ok: true, provider: isConfigured() ? "alipay_web" : "mock", products: Object.values(PRODUCTS) });
});

router.post("/orders", platformAuth, requireScope("platform:write"), (req, res) => {
  const { product_code, idempotency_key, invited_by } = req.body ?? {};
  const provider = isConfigured() ? "alipay_web" : "mock";
  try {
    // invited_by(邀请返利):createOrder 内校验"邀请人存在 + 不得是自己"(400/409)
    const order = createOrder({ userId: req.user.id, productCode: product_code, idempotencyKey: idempotency_key, provider, invitedBy: invited_by ?? null });
    if (provider === "alipay_web") {
      const { formHtml } = buildPagePayForm({
        outTradeNo: order.order_no, amountFen: order.amount_fen, subject: order.product_name,
      });
      return res.json({ ok: true, order_no: order.order_no, amount_fen: order.amount_fen, provider, pay_form: formHtml });
    }
    res.json({ ok: true, order_no: order.order_no, amount_fen: order.amount_fen, provider,
      pay_url: `/api/platform/orders/${order.order_no}/mock-pay` });
  } catch (e) {
    res.status(e.status ?? 500).json({ ok: false, code: "ORDER_FAILED", message: e.message });
  }
});

router.get("/orders/:orderNo", platformAuth, (req, res) => {
  const o = getOrder(req.params.orderNo);
  if (!o || (o.user_id !== req.user.id && req.user.role !== "admin")) {
    return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "订单不存在" }); // 404 非 403:不泄露存在性
  }
  res.json({ ok: true, order: o });
});

// 测试通道:仅 mock 态可用;仅接受 mock provider 的 created/pending 订单
// (审查 P1-2:真实通道订单不得在"未配钥窗口"被 mock 结算)
router.post("/orders/:orderNo/mock-pay", platformAuth, requireScope("platform:write"), (req, res) => {
  if (isConfigured()) return res.status(409).json({ ok: false, message: "已配置真实支付,测试通道关闭(首单后 24h 纪律)" });
  const o = getOrder(req.params.orderNo);
  if (!o || o.user_id !== req.user.id) return res.status(404).json({ ok: false, message: "订单不存在" });
  if (o.provider !== "mock" || !["created", "pending"].includes(o.status)) {
    return res.status(409).json({ ok: false, message: `订单 provider=${o.provider} status=${o.status},不可走测试通道` });
  }
  const { order } = markPaid(o.order_no, {
    buyerAccountHash: `mock:${req.user.id}`,
    tradeNo: `MOCK${Date.now()}`,
  });
  recordNotification({ provider: "mock", rawBody: JSON.stringify({ out_trade_no: o.order_no, mock: true }), verifyOk: true,
    parsed: { internal: true } });
  getDb().prepare("UPDATE orders SET is_internal_verification = 1 WHERE order_no = ?").run(o.order_no);
  res.json({ ok: true, order, note: "mock 支付已入账并打内控标(is_internal_verification=1,统计口径排除)" });
});

// 管理端:多口径统计 + 审核通过时间回填(A4)
router.get("/stats/paid", platformAuth, (req, res) => {
  if (req.user.role !== "admin") return res.status(404).json({ ok: false, message: "not found" });
  res.json({ ok: true, stats: paidUserStats() });
});

// ── 异步通知(挂根作用域,见 mountPlatform;签名即鉴权) ─────────────────────
export function notifyHandler(rawBodyParser) {
  return [rawBodyParser, (req, res) => {
    const failure = (note) => res.type("text").send("failure");
    // 未配钥窗口直接拒绝(审查 P2-7:normalizePem(undefined) 会抛 500)
    if (!isConfigured()) return failure();
    const params = typeof req.body === "object" && req.body !== null ? req.body : {};
    // 重复表单键解析为数组:一律拒绝(审查 P2-8,任何数组值都是异常流量)
    if (Object.values(params).some((v) => Array.isArray(v))) {
      recordNotification({ provider: "alipay_web", rawBody: req.rawBody ?? "", verifyOk: false, parsed: { reason: "ARRAY_PARAM" } });
      return failure();
    }
    const order = getOrder(params.out_trade_no);
    if (!order) {
      recordNotification({ provider: "alipay_web", rawBody: req.rawBody ?? "", verifyOk: false, parsed: { reason: "ORDER_NOT_FOUND" } });
      return failure(); // 不泄露存在性,统一 failure
    }
    const v = verifyNotify(params, order);
    if (!v.ok) {
      recordNotification({ provider: "alipay_web", rawBody: req.rawBody ?? "", verifyOk: false, parsed: { reason: v.reason } });
      return failure();
    }
    // 验签成功也留档(审查 P2-5:争议回放需要 verify_ok=1 的证据行)
    recordNotification({ provider: "alipay_web", rawBody: req.rawBody ?? "", verifyOk: true, parsed: v });
    markPaid(order.order_no, {
      tradeNo: v.trade_no,
      buyerAccountHash: v.buyer_id ? `alipay:${v.buyer_id}` : null,
    });
    res.type("text").send("success"); // 支付宝要求字面 "success"
  }];
}

// 管理端:订单审计(P1#9;platform:admin 专属,非 admin 同 404 不泄露)
router.get("/admin/orders", platformAuth, requireScope("platform:admin"), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const status = req.query.status;
  const rows = status
    ? getDb().prepare("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(String(status), limit)
    : getDb().prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json({ ok: true, orders: rows });
});
