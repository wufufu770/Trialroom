// 支付宝 OAuth 网页授权登录(P0#3 最小可行)。
// 流程:GET /auth/alipay/start → 302 公共授权页 → 回调 ?auth_code →
//       alipay.system.oauth.token 换 user_id → 按 alipay_user_hash 归并/建用户 →
//       签发平台 api_tokens(30 天)。
// 未配三要素 → 503(生产登录不可用,必须先配钥)。
import crypto from "node:crypto";
import { gatewayCall, isConfigured } from "./payment/alipay.mjs";
import { getDb, genId, sha256Hex, nowIso } from "./db.mjs";
import { issueToken } from "./auth.mjs";

const AUTH_PAGE = "https://openauth.alipay.com/oauth2/publicAppAuthorize.htm";
export const STATE_TTL_MS = 10 * 60_000; // state 有效期(10 分钟,一次性)
export const PENDING_STATES_MAX = 10_000; // 软上限:防未消费 state 无界累积(内存/R1 审查)
// 导出仅供测试/运维观测注入;业务代码不得直接读写
export const pendingStates = new Map(); // state -> exp(ms)

export function buildAuthStartUrl(redirectUri) {
  if (!isConfigured()) throw Object.assign(new Error("支付宝三要素未配置,OAuth 登录不可用"), { status: 503 });
  // 惰性清扫:set 前顺手清掉已过期项,兜住长期运行下的内存累积
  const now = Date.now();
  for (const [k, exp] of pendingStates) if (exp <= now) pendingStates.delete(k);
  if (pendingStates.size >= PENDING_STATES_MAX) {
    throw Object.assign(new Error("OAuth 状态表已达上限,请稍后重试"), { status: 503 });
  }
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, now + STATE_TTL_MS);
  const u = new URL(AUTH_PAGE);
  u.searchParams.set("app_id", process.env.ALIPAY_APP_ID);
  u.searchParams.set("scope", "auth_user");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return { url: u.toString(), state };
}

export function consumeState(state) {
  const exp = pendingStates.get(String(state ?? ""));
  pendingStates.delete(String(state ?? ""));
  return Boolean(exp && exp > Date.now());
}

/** 用 auth_code 换支付宝 user_id 并归并/建平台用户,签发平台令牌。 */
export async function loginWithAuthCode(authCode, { displayName = "" } = {}) {
  if (!isConfigured()) throw Object.assign(new Error("支付宝三要素未配置"), { status: 503 });
  const biz = await gatewayCall("alipay.system.oauth.token", {
    grant_type: "authorization_code", code: String(authCode).slice(0, 128),
  });
  const alipayUserId = biz.user_id;
  if (!alipayUserId) throw Object.assign(new Error("授权响应缺 user_id"), { status: 502 });
  const db = getDb();
  const hash = `alipay:${alipayUserId}`; // 与订单 buyer_account_hash 同构(A1 口径归并)
  let user = db.prepare("SELECT * FROM users WHERE alipay_user_hash = ?").get(hash);
  if (!user) {
    user = { id: genId("u") };
    db.prepare("INSERT INTO users (id, display_name, alipay_user_hash) VALUES (?, ?, ?)")
      .run(user.id, String(displayName).slice(0, 32) || `支付宝用户${alipayUserId.slice(-4)}`, hash);
  }
  const t = issueToken(user.id, { name: "alipay-oauth", ttlDays: 30 });
  return { user_id: user.id, token: t.token, expires_at: t.expires_at, bound_alipay: hash };
}
