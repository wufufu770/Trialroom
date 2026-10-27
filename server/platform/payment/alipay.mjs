// 支付宝「网页应用收款」协议实现(电脑网站支付 alipay.trade.page.pay + 异步通知验签)。
// 依据:官方接入指南(线上取证);11-final-plan §5.2(total_amount ∈ [0.01,100000000] 元)
//
// 密钥全部走环境变量,永不落库/落日志:
//   ALIPAY_APP_ID        应用 APPID(开放平台)
//   ALIPAY_APP_PRIVATE_KEY  应用私钥(PEM 或裸 base64,RSA2048)
//   ALIPAY_PUBLIC_KEY    支付宝公钥(验签用,非应用公钥)
//   ALIPAY_GATEWAY       网关;默认沙箱 https://openapi.alipaydev.com/gateway.do
//   ALIPAY_NOTIFY_URL / ALIPAY_RETURN_URL  异步/同步回调
//
// 协议纪律:
//   * 签名:RSA2(SHA256withRSA),待串 = 按 key ASCII 升序的 k=v& 串,排除 sign/sign_type/空值
//   * 验签:异步通知对**全部通知参数**(除 sign/sign_type)验签,任何篡改 → false
//   * 金额以元字符串(total_amount)传输,落库用分,边界 [0.01, 100000000]
import crypto from "node:crypto";

export const SANDBOX_GATEWAY = "https://openapi.alipaydev.com/gateway.do";
export const PROD_GATEWAY = "https://openapi.alipay.com/gateway.do";
export const AMOUNT_YUAN_MIN = 0.01;
export const AMOUNT_YUAN_MAX = 100000000;

export function isConfigured() {
  return Boolean(process.env.ALIPAY_APP_ID && process.env.ALIPAY_APP_PRIVATE_KEY && process.env.ALIPAY_PUBLIC_KEY);
}
export function gateway() {
  return process.env.ALIPAY_GATEWAY ?? SANDBOX_GATEWAY;
}

function normalizePem(key, type) {
  if (key.includes("-----BEGIN")) return key.replace(/\\n/g, "\n");
  // 裸 base64(开放平台控制台默认展示形态)补 PEM 头尾
  const body = key.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}
const privateKey = () => normalizePem(process.env.ALIPAY_APP_PRIVATE_KEY, "PRIVATE KEY");
const alipayPublicKey = () => normalizePem(process.env.ALIPAY_PUBLIC_KEY, "PUBLIC KEY");

/** 待签名串:key ASCII 升序,排除 sign/sign_type 与空值。 */
export function canonicalString(params) {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "" && params[k] != null)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

export function rsa2Sign(params) {
  const data = canonicalString(params);
  return crypto.createSign("RSA-SHA256").update(data, "utf8").sign(privateKey(), "base64");
}

export function rsa2Verify(params) {
  const sign = params.sign;
  if (!sign) return false;
  const data = canonicalString(params);
  return crypto.createVerify("RSA-SHA256").update(data, "utf8").verify(alipayPublicKey(), sign, "base64");
}

function fenToYuan(fen) {
  if (!Number.isInteger(fen) || fen < 1 || fen > AMOUNT_YUAN_MAX * 100) {
    throw new Error(`金额越界(分):${fen} —— 物理范围 [1, ${AMOUNT_YUAN_MAX * 100}]`);
  }
  return (fen / 100).toFixed(2);
}

/**
 * 构造 alipay.trade.page.pay 的自提交表单(网页应用收款主链路)。
 * 返回 {formHtml, params, action};前端直接 document.write / 插入并提交。
 */
export function buildPagePayForm({ outTradeNo, amountFen, subject, body = "" }) {
  const biz = {
    out_trade_no: outTradeNo,
    product_code: "FAST_INSTANT_TRADE_PAY",
    total_amount: fenToYuan(amountFen),
    subject: subject.slice(0, 256),
  };
  if (body) biz.body = body.slice(0, 400);
  const params = {
    app_id: process.env.ALIPAY_APP_ID,
    method: "alipay.trade.page.pay",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    version: "1.0",
    notify_url: process.env.ALIPAY_NOTIFY_URL,
    return_url: process.env.ALIPAY_RETURN_URL,
    biz_content: JSON.stringify(biz),
  };
  Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);
  params.sign = rsa2Sign(params);
  const action = gateway();
  const inputs = Object.entries(params).map(([k, v]) =>
    `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, "&quot;")}"/>`).join("");
  const formHtml = `<form id="alipaysubmit" name="alipaysubmit" action="${action}?charset=utf-8" method="POST">${inputs}<input type="submit" value="pay" style="display:none"/></form><script>document.forms.alipaysubmit.submit();</script>`;
  return { formHtml, params, action };
}

/**
 * 验证异步通知:验签 + 金额/单号一致性 + 状态白名单。
 * 返回 {ok, trade_status, out_trade_no, trade_no, total_amount};失败 ok=false。
 */
export function verifyNotify(rawParams, expectedOrder) {
  const p = { ...rawParams };
  if (!rsa2Verify(p)) return { ok: false, reason: "SIGN_INVALID" };
  // 归属核验(审查 P2-4):合法签名必须来自本应用 —— 防商户名下其他应用/沙箱
  // 网关的同签名通知被用来给我方订单入账
  if (process.env.ALIPAY_APP_ID && p.app_id !== process.env.ALIPAY_APP_ID) {
    return { ok: false, reason: "APP_ID_MISMATCH" };
  }
  const statusWhitelist = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);
  if (!statusWhitelist.has(p.trade_status)) return { ok: false, reason: `STATUS_${p.trade_status}` };
  if (p.out_trade_no !== expectedOrder.order_no) return { ok: false, reason: "OUT_TRADE_NO_MISMATCH" };
  const paidYuan = Number(p.total_amount);
  if (!Number.isFinite(paidYuan) || Math.round(paidYuan * 100) !== expectedOrder.amount_fen) {
    return { ok: false, reason: "AMOUNT_MISMATCH" };
  }
  return {
    ok: true, trade_status: p.trade_status, out_trade_no: p.out_trade_no,
    trade_no: p.trade_no, total_amount: p.total_amount, buyer_id: p.buyer_id,
    gmt_create: p.gmt_create, gmt_payment: p.gmt_payment,
  };
}
