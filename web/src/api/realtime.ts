// GLM-Realtime 实时语音面试 API 客户端(服务端中继,/api/platform/realtime/*)。
// SSE 收流用 fetch + ReadableStream 手解析 —— EventSource 不能带 Authorization 头,
// 而平台令牌必须在头里(platform token class)。

import { getPlatformToken } from "./platform";

const BASE = "/api/platform/realtime";

export interface RealtimeSessionInfo {
  session_id: string;
  /** true = 服务端 mock 回显模式(无 key 联调) */
  mock: boolean;
}

export interface RealtimeSseEvent {
  type: string;
  /** mock/整段文本帧 */
  text?: string;
  /** 增量文本帧 */
  delta?: string;
  message?: string;
  [k: string]: unknown;
}

function authHeaders(): Record<string, string> {
  const token = getPlatformToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status }) as Error & { status: number };
}

/** 创建实时会话。503 = 服务端未配 key 且非 mock(调用方显示引导态,不当错误炸)。 */
export async function createRealtimeSession(position?: string): Promise<RealtimeSessionInfo> {
  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ position }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw httpError(json?.message ?? `实时会话创建失败(${res.status})`, res.status);
  return { session_id: json.session_id, mock: Boolean(json.mock) };
}

/**
 * 发 user 帧并以 SSE 收上游事件流(读到 response.done / 连接关闭为止)。
 * onEvent 逐帧回调;AbortSignal 供组件卸载中断。
 */
export async function streamRealtimeMessage(
  sessionId: string,
  payload: { type: "text"; text: string } | { type: "audio_commit" },
  onEvent: (e: RealtimeSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", ...authHeaders() },
    body: JSON.stringify(payload),
    signal,
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !ct.includes("text/event-stream")) {
    const json = await res.json().catch(() => null);
    throw httpError(json?.message ?? `实时消息失败(${res.status})`, res.status);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const emitFrame = (frame: string) => {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try { onEvent(JSON.parse(line.slice(6)) as RealtimeSseEvent); } catch { /* 半包/坏帧跳过 */ }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        emitFrame(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

/** 音频分片追加(base64)。事件不在此应答回来,由后续 audio_commit 的 SSE 流回。 */
export async function appendRealtimeAudio(sessionId: string, b64: string): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ type: "audio", b64 }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw httpError(json?.message ?? `音频分片发送失败(${res.status})`, res.status);
}

/** 结束会话(卸载/关闭面板时调用;失败静默,服务端 30 分钟空闲兜底回收)。 */
export async function endRealtimeSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  } catch { /* 网络失败静默:服务端空闲回收兜底 */ }
}
