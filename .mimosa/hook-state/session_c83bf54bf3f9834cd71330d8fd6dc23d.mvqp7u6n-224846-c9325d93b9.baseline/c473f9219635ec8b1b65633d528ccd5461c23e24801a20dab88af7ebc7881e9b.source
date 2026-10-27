// 平台层 API 客户端(独立于基座 envelope 客户端:平台路由返回 {ok, ...})
// 平台令牌与基座令牌是两个 token class,分键存储。

const BASE = "/api/platform";
export const PLATFORM_TOKEN_KEY = "trialroom:platform_token";
export const PLATFORM_USER_KEY = "trialroom:platform_user";
// 邀请返利:落地页 ?inv= 落此键,收银台下单时附带(服务端校验存在性 + 非自邀)
export const INVITE_BY_KEY = "trialroom:inv";

export interface PlatformProduct {
  code: string; name: string; amount_fen: number;
  kind: "attempt_pack" | "time_pass" | "room_share"; quota: number | null; days: number | null; first_only?: boolean;
}
export interface PlatformOrder {
  order_no: string; product_code: string; product_name: string;
  amount_fen: number; status: string; provider: string; paid_at: string | null; created_at: string;
  is_internal_verification?: number;
}
export interface PlatformRoom {
  room_id: string; status: string; industry: string | null; position: string | null;
  created_at: string; is_host: number; seat_no: number;
}

export function getPlatformToken(): string | null {
  return localStorage.getItem(PLATFORM_TOKEN_KEY);
}
export function setPlatformToken(t: string) {
  localStorage.setItem(PLATFORM_TOKEN_KEY, t);
}
export function getPlatformUserId(): string | null {
  return localStorage.getItem(PLATFORM_USER_KEY);
}
export function setPlatformUserId(id: string) {
  localStorage.setItem(PLATFORM_USER_KEY, id);
}
/** 被邀请链路:落地页 ?inv= 存入,收银台下单附带。 */
export function getInviteBy(): string | null {
  return localStorage.getItem(INVITE_BY_KEY);
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getPlatformToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    // ★2:把 HTTP 状态挂在错误对象上(402=无权益 → 上层弹购买引导;其余错误静默降级)
    const err = new Error(json?.message ?? `请求失败(${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export const platformApi = {
  products: () => call<{ provider: string; products: PlatformProduct[] }>("GET", "/products"),
  devToken: (displayName: string) => call<{ token: string; user_id: string }>("POST", "/auth/dev-token", { display_name: displayName }),
  createOrder: (product_code: string, idempotency_key?: string, invited_by?: string | null) =>
    call<{ order_no: string; amount_fen: number; provider: string; pay_form?: string; pay_url?: string }>("POST", "/orders", { product_code, idempotency_key, invited_by: invited_by ?? undefined }),
  order: (orderNo: string) => call<{ order: PlatformOrder }>("GET", `/orders/${orderNo}`),
  mockPay: (orderNo: string) => call<{ order: PlatformOrder }>("POST", `/orders/${orderNo}/mock-pay`),
  adminOrders: (limit = 50) => call<{ orders: PlatformOrder[] }>("GET", `/admin/orders?limit=${limit}`),
  paidStats: () => call<{ stats: Record<string, number> }>("GET", "/stats/paid"),
  createRoom: (industry?: string, position?: string) =>
    call<{ room_id: string; room_code: string }>("POST", "/rooms", { industry, position }),
  myRooms: () => call<{ rooms: PlatformRoom[] }>("GET", "/rooms"),
  joinRoom: (room_code: string) => call<{ room_id: string; seat_no: number }>("POST", "/rooms/join", { room_code }),
  roomDetail: (roomId: string) => call<{ room: any; seats: any[]; your_seat_no: number; is_host: boolean }>("GET", `/rooms/${roomId}`),
  messages: (roomId: string, after = 0) => call<{ messages: any[] }>("GET", `/rooms/${roomId}/messages?after=${after}`),
  postMessage: (roomId: string, content: string) => call<{ turn_index: number }>("POST", `/rooms/${roomId}/messages`, { content }),
  aiTurn: (roomId: string) => call<{ turn_index: number; content: string; source: string }>("POST", `/rooms/${roomId}/ai-turn`),
  closeRoom: (roomId: string) => call<{ closed: boolean }>("POST", `/rooms/${roomId}/close`),
  leaveRoom: (roomId: string) => call<{ left: boolean }>("POST", `/rooms/${roomId}/leave`),
  startAttempt: (payload: { room_code?: string; position?: string; difficulty?: string }) =>
    call<{ attempt_id: string; entitlement: { kind: string; quota_left: number | null } }>("POST", "/attempts", payload),
  finishAttempt: (id: string, payload: Record<string, unknown>) => call<{ qualification: any }>("POST", `/attempts/${id}/finish`, payload),
  myAttempts: () => call<{ attempts: any[] }>("GET", "/attempts"),
  // 商业化 #7:剩余额度 + 时间卡最近到期(未登录平台时 401,由调用方静默降级)
  quota: () => call<{ quota_left: number; time_pass_nearest_expiry: string | null }>("GET", "/attempts/quota"),
  // 商业化 #2:岗位就绪度认证卡(服务端产 SVG,前端只做 base64 img,禁 dangerouslySetInnerHTML)
  readyCard: () => call<{ svg: string; ready: boolean; pass_rate: number; passed: number; sample: number }>("GET", "/ready-card"),
  // 商业化 #3:MCP 令牌自助(明文只在创建响应出现一次)
  mcpTokens: {
    create: (name: string, scopes: string[]) =>
      call<{ token: string; token_id: string; name: string; scopes: string[]; expires_at: string }>("POST", "/mcp-tokens", { name, scopes }),
    list: () => call<{ tokens: { token_id: string; name: string; scopes: string[]; expires_at: string | null; revoked_at: string | null; created_at: string }[] }>("GET", "/mcp-tokens"),
    revoke: (tokenId: string) => call<{ token_id: string; revoked_at: string }>("POST", `/mcp-tokens/${encodeURIComponent(tokenId)}/revoke`),
  },
  // 分享卡:?inv= 让被邀请方落地页把邀请人落 localStorage(返利归因链路)
  shareCardUrl: (code: string, inv?: string | null) =>
    `/share/${code}.svg${inv ? `?inv=${encodeURIComponent(inv)}` : ""}`,
};

/** 匿名埋点(不走平台令牌)。session_ticket 一次生成,贯穿落地页→练习。 */
export function track(event: string, extra: Record<string, unknown> = {}) {
  const KEY = "trialroom:session_ticket";
  let ticket = sessionStorage.getItem(KEY);
  if (!ticket) {
    ticket = `st_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(KEY, ticket);
  }
  return fetch("/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, session_ticket: ticket, ...extra }),
  }).catch(() => { /* 埋点失败不打扰用户 */ });
}

export const fenToYuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
