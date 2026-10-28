// GLM-Realtime 传输层(智谱实时语音,docs.bigmodel.cn/cn/asyncapi/realtime)。
// 为什么需要服务端中继:浏览器 WebSocket 不能带 Authorization 头,而 GLM-Realtime
// 的鉴权是 `Authorization: Bearer <key>` —— 因此浏览器只连我们,我们用 Node 全局
// WebSocket(undici 实现,Node 22+ 自带)带 key 连上游。
//
// key 到位即用:默认 baseUrl/model 即官方端点;未配 key 时由 session.mjs 决定走
// mock(本地 echo,联调用)或 503(明确提示),本模块不掺和政策。
//
// 出网纪律(与 interviewer.mjs assertSafeHost 同款思路,收紧为仅 wss):
// 仅允许 wss://,拒绝环回/私网/保留地址 —— 防 env 被改成内网地址后服务端
// 拿着 key 去连内网端点(SSRF 面)。

export const DEFAULT_REALTIME_URL = "wss://open.bigmodel.cn/api/paas/v4/realtime";
export const DEFAULT_REALTIME_MODEL = "glm-realtime";

/** 是否已配置真实上游 key(调用时读 env,便于测试翻转)。 */
export function isRealtimeConfigured() {
  return Boolean(process.env.TRIALROOM_REALTIME_API_KEY);
}

/** 本地联调 mock 开关(TRIALROOM_REALTIME_MOCK=1)。 */
export function isMockEnabled() {
  return process.env.TRIALROOM_REALTIME_MOCK === "1";
}

/** 出网主机校验:仅 wss://,拒绝环回/私网/保留(与 interviewer.mjs 同款正则集)。 */
export function assertSafeRealtimeUrl(urlStr) {
  const u = new URL(urlStr);
  if (u.protocol !== "wss:") throw new Error("GLM-Realtime 仅允许 wss:// 地址");
  const h = u.hostname;
  if (h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || h.endsWith(".internal")) {
    throw new Error("GLM-Realtime 地址指向内网/保留地址,已拒绝");
  }
}

const evtId = () => `evt_${crypto.randomUUID()}`;

/**
 * 真实上游 provider。connectRealtime 建连后先发 session.update(指令=服务端
 * 拼好的 systemPrompt,浏览器侧永远没有注入面),返回:
 *   send(text)          —— 用户文本帧(conversation.item.create + response.create)
 *   sendAudioBase64(b64)—— 音频分片追加(input_audio_buffer.append)
 *   commitAudio()       —— 提交缓冲并触发应答(commit + response.create)
 *   close()
 * 上游事件经 onEvent(evt对象) 回调;连接意外断开时回放 {type:"connection.closed"}。
 */
export function createRealtimeProvider({ apiKey, baseUrl, model } = {}) {
  const key = apiKey ?? process.env.TRIALROOM_REALTIME_API_KEY ?? null;
  const url = baseUrl ?? process.env.TRIALROOM_REALTIME_BASE_URL ?? DEFAULT_REALTIME_URL;
  const mdl = model ?? process.env.TRIALROOM_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;

  return {
    mock: false,
    async connectRealtime({ onEvent = () => {}, systemPrompt = "" } = {}) {
      if (!key) {
        throw Object.assign(
          new Error("GLM-Realtime 未配置 API Key(服务端设置 TRIALROOM_REALTIME_API_KEY)"),
          { status: 503, code: "NOT_CONFIGURED" },
        );
      }
      assertSafeRealtimeUrl(url);
      // undici 的 WebSocket 支持第二参 WebSocketInit(含 headers);个别运行时只收
      // 协议数组时降级裸连(上游会以 error 事件拒绝,不会静默错连)。
      let ws;
      try {
        ws = new WebSocket(url, { headers: { authorization: `Bearer ${key}` } });
      } catch {
        ws = new WebSocket(url);
      }
      await new Promise((resolve, reject) => {
        const fail = (msg) => { tidy(); reject(new Error(`GLM-Realtime 连接失败:${msg}`)); };
        const onOpen = () => { tidy(); resolve(); };
        const onError = (e) => fail(e?.message ?? e?.type ?? "unknown");
        const onClose = (e) => fail(`code=${e?.code ?? "?"}`);
        const tidy = () => {
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("error", onError);
          ws.removeEventListener("close", onClose);
        };
        ws.addEventListener("open", onOpen, { once: true });
        ws.addEventListener("error", onError, { once: true });
        ws.addEventListener("close", onClose, { once: true });
      });
      // 会话配置:指令(instructions)= 服务端模板拼接的 systemPrompt;音频入
      // wav/出 pcm 24k(server_vad 让上游自动断句应答)。
      const sendJson = (obj) => ws.send(JSON.stringify(obj));
      sendJson({
        event_id: evtId(),
        type: "session.update",
        session: {
          model: mdl,
          instructions: systemPrompt,
          input_audio_format: "wav",
          output_audio_format: "pcm",
          voice: "tongtong",
          turn_detection: { type: "server_vad" },
          modalities: ["text", "audio"],
        },
      });
      ws.addEventListener("message", (ev) => {
        try {
          const text = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
          onEvent(JSON.parse(text));
        } catch { /* 非 JSON 帧丢弃:上游心跳/二进制不致命 */ }
      });
      ws.addEventListener("close", () => onEvent({ type: "connection.closed" }));
      return {
        mock: false,
        send(text) {
          sendJson({
            event_id: evtId(),
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: String(text) }] },
          });
          sendJson({ event_id: evtId(), type: "response.create" });
        },
        sendAudioBase64(b64) {
          sendJson({ event_id: evtId(), type: "input_audio_buffer.append", audio: String(b64) });
        },
        commitAudio() {
          sendJson({ event_id: evtId(), type: "input_audio_buffer.commit" });
          sendJson({ event_id: evtId(), type: "response.create" });
        },
        close() { try { ws.close(); } catch { /* 已断开 */ } },
      };
    },
  };
}

/**
 * Mock provider:本地 echo,无任何出网。语义 —— 文本帧回
 *   {type:"response.text", text:"(mock)"+原文}
 * 音频分片只累计字节数,commitAudio 时回 {type:"response.text", text:"(mock audio NB)"}。
 * 两者都跟一个 {type:"response.done"} 收尾帧,供 SSE 层/前端按统一节奏收流。
 */
export function createMockRealtimeProvider() {
  return {
    mock: true,
    async connectRealtime({ onEvent = () => {} } = {}) {
      let audioBytes = 0;
      const emit = (evt) => queueMicrotask(() => onEvent(evt));
      return {
        mock: true,
        send(text) {
          emit({ type: "response.text", text: `(mock)${String(text)}` });
          emit({ type: "response.done", response: { status: "completed" } });
        },
        sendAudioBase64(b64) { audioBytes += Math.floor(String(b64).length * 3 / 4); },
        commitAudio() {
          emit({ type: "response.text", text: `(mock audio ${audioBytes}B)` });
          emit({ type: "response.done", response: { status: "completed" } });
          audioBytes = 0;
        },
        close() { /* 无连接 */ },
      };
    },
  };
}
