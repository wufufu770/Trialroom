// 平台支付路由(挂载于 /api/platform;通知回调挂根作用域 /pay/alipay/notify)。
import express from "express";
import { PRODUCTS, createOrder, getOrder, markPaid, refundOrder, recordNotification, paidUserStats } from "../payment/service.mjs";
import { isConfigured, buildPagePayForm, verifyNotify } from "../payment/alipay.mjs";
import { platformAuth } from "../auth.mjs";
import { getDb } from "../db.mjs";

export const router = express.Router();

router.get("/products", (req, res) => {
  res.json({ ok: true, provider: isConfigured() ? "alipay_web" : "mock", products: Object.values(PRODUCTS) });
});

router.post("/orders", platformAuth, (req, res) => {
  const { product_code, idempotency_key } = req.body ?? {};
  const provider = isConfigured() ? "alipay_web" : "mock";
  try {
    const order = createOrder({ userId: req.user.id, productCode: product_code, idempotencyKey: idempotency_key, provider });
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

// 测试通道:仅 mock 态可用;自动打内控标(报表排除)+ 事件留痕。
router.post("/orders/:orderNo/mock-pay", platformAuth, (req, res) => {
  if (isConfigured()) return res.status(409).json({ ok: false, message: "已配置真实支付,测试通道关闭(首单后 24h 纪律)" });
  const o = getOrder(req.params.orderNo);
  if (!o || o.user_id !== req.user.id) return res.status(404).json({ ok: false, message: "订单不存在" });
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
    const params = typeof req.body === "object" && req.body !== null ? req.body : {};
    recordNotification({ provider: "alipay_web", rawBody: req.rawBody ?? JSON.stringify(params), verifyOk: false, parsed: null });
    const order = getOrder(params.out_trade_no);
    if (!order) return res.type("text").send("failure"); // 不泄露存在性,统一 failure
    const v = verifyNotify(params, order);
    if (!v.ok) {
      recordNotification({ provider: "alipay_web", rawBody: "", verifyOk: false, parsed: { reason: v.reason } });
      return res.type("text").send("failure");
    }
    markPaid(order.order_no, {
      tradeNo: v.trade_no,
      buyerAccountHash: v.buyer_id ? `alipay:${v.buyer_id}` : null,
    });
    res.type("text").send("success"); // 支付宝要求字面 "success"
  }];
}
