// 平台层 API 客户端(独立于基座 envelope 客户端:平台路由返回 {ok, ...})
// 平台令牌与基座令牌是两个 token class,分键存储。

const BASE = "/api/platform";
export const PLATFORM_TOKEN_KEY = "trialroom:platform_token";

export interface PlatformProduct {
  code: string; name: string; amount_fen: number;
  kind: "attempt_pack" | "time_pass" | "room_share"; quota: number | null; days: number | null; first_only?: boolean;
}
export interface PlatformOrder {
  order_no: string; product_code: string; product_name: string;
  amount_fen: number; status: string; provider: string; paid_at: string | null; created_at: string;
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
    throw new Error(json?.message ?? `请求失败(${res.status})`);
  }
  return json as T;
}

export const platformApi = {
  products: () => call<{ provider: string; products: PlatformProduct[] }>("GET", "/products"),
  devToken: (displayName: string) => call<{ token: string; user_id: string }>("POST", "/auth/dev-token", { display_name: displayName }),
  createOrder: (product_code: string, idempotency_key?: string) =>
    call<{ order_no: string; amount_fen: number; provider: string; pay_form?: string; pay_url?: string }>("POST", "/orders", { product_code, idempotency_key }),
  order: (orderNo: string) => call<{ order: PlatformOrder }>("GET", `/orders/${orderNo}`),
  mockPay: (orderNo: string) => call<{ order: PlatformOrder }>("POST", `/orders/${orderNo}/mock-pay`),
  createRoom: (industry?: string, position?: string) =>
    call<{ room_id: string; room_code: string }>("POST", "/rooms", { industry, position }),
  myRooms: () => call<{ rooms: PlatformRoom[] }>("GET", "/rooms"),
  joinRoom: (room_code: string) => call<{ room_id: string; seat_no: number }>("POST", "/rooms/join", { room_code }),
  roomDetail: (roomId: string) => call<{ room: any; seats: any[]; your_seat_no: number; is_host: boolean }>("GET", `/rooms/${roomId}`),
  messages: (roomId: string, after = 0) => call<{ messages: any[] }>("GET", `/rooms/${roomId}/messages?after=${after}`),
  postMessage: (roomId: string, content: string) => call<{ turn_index: number }>("POST", `/rooms/${roomId}/messages`, { content }),
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
