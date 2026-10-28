// 实时语音面试面板(GLM-Realtime,服务端中继)。
// 数据通路:MediaRecorder 每 3s 一片 → base64 → POST audio 分片;
// 停止录音/发送文本时 audio_commit/text 帧 → fetch-SSE 收上游事件流渲染气泡。
// 注意:浏览器 MediaRecorder 只给 webm/ogg 容器,GLM-Realtime 文档入格式为 wav/pcm16 ——
// 真实 key 联调若上游拒收,需在采集侧加 AudioWorklet/ScriptProcessor 转 pcm16(骨架
// 阶段直传分片,mock 回显链路已可全流程测试)。
//
// 降级完整:未配 key(503)显示配置引导,不算错误;mock 会话打回显标记。
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Radio, Send, X } from "lucide-react";
import { cn } from "@/shared";
import {
  appendRealtimeAudio, createRealtimeSession, endRealtimeSession,
  streamRealtimeMessage, type RealtimeSseEvent,
} from "@/api/realtime";

interface Bubble { role: "user" | "assistant"; content: string }
type Phase = "idle" | "creating" | "ready" | "needs-key" | "error";

const CHUNK_MS = 3000;

/** ArrayBuffer → base64(分块 btoa,避免大分片 String.fromCharCode 栈溢出) */
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

export function RealtimeVoicePanel({ position, onClose }: { position?: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [isMock, setIsMock] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState(""); // 流式中的助手气泡文本
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false); // 有进行中的 SSE 流

  const sessionIdRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // draft 的 ref 镜像:finalize 需要读"当前值再清空",不能在 setState updater 里
  // 再调 setState(React StrictMode 双调 updater 会重复入列气泡)
  const draftRef = useRef("");

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [bubbles, draft]);

  const setDraftText = useCallback((t: string) => {
    draftRef.current = t;
    setDraft(t);
  }, []);

  const finalizeDraft = useCallback(() => {
    const d = draftRef.current;
    draftRef.current = "";
    setDraft("");
    if (d.trim()) setBubbles((bs) => [...bs, { role: "assistant", content: d }]);
  }, []);

  /** SSE 事件 → 气泡(response.text 整段/delta 增量/done 收尾/error 提示) */
  const handleEvent = useCallback((evt: RealtimeSseEvent) => {
    if (evt.type === "response.text" && typeof evt.text === "string") {
      setDraftText(evt.text);
    } else if (evt.type === "response.text.delta" && typeof evt.delta === "string") {
      setDraftText(draftRef.current + evt.delta);
    } else if (evt.type === "response.done" || evt.type === "connection.closed") {
      finalizeDraft();
    } else if (evt.type === "error") {
      setErrorMsg(String(evt.message ?? "上游返回错误"));
    }
  }, [finalizeDraft, setDraftText]);

  const start = useCallback(async () => {
    setPhase("creating");
    setErrorMsg("");
    try {
      const s = await createRealtimeSession(position);
      sessionIdRef.current = s.session_id;
      setIsMock(s.mock);
      setPhase("ready");
    } catch (e: any) {
      if (e?.status === 503) setPhase("needs-key");
      else { setPhase("error"); setErrorMsg(String(e?.message ?? e)); }
    }
  }, [position]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    setRecording(false);
  }, []);

  // 卸载:停录音、断流、结束会话
  useEffect(() => {
    return () => {
      try { recorderRef.current?.state === "recording" && recorderRef.current.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      abortRef.current?.abort();
      if (sessionIdRef.current) void endRealtimeSession(sessionIdRef.current);
    };
  }, []);

  /** 停止录音后提交音频缓冲并收应答 */
  const commitAudio = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || busy) return;
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamRealtimeMessage(sid, { type: "audio_commit" }, handleEvent, ac.signal);
    } catch (e: any) {
      if (e?.name !== "AbortError") setErrorMsg(String(e?.message ?? e));
    } finally {
      abortRef.current = null;
      setBusy(false);
      finalizeDraft();
    }
  }, [busy, handleEvent, finalizeDraft]);

  const toggleRecording = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    if (recording) {
      stopRecording();
      void commitAudio();
      return;
    }
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find((m) => MediaRecorder.isTypeSupported?.(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      // 每 3s 一片:分片即发,避免整段录完才上传(实时性)
      rec.ondataavailable = (ev) => {
        if (ev.data.size === 0) return;
        const sidNow = sessionIdRef.current;
        if (!sidNow) return;
        ev.data.arrayBuffer()
          .then((buf) => appendRealtimeAudio(sidNow, bufToBase64(buf)))
          .catch((e) => setErrorMsg(String(e?.message ?? e)));
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      rec.start(CHUNK_MS);
      setRecording(true);
    } catch (e: any) {
      setErrorMsg(`麦克风不可用:${String(e?.message ?? e)}`);
    }
  }, [recording, stopRecording, commitAudio]);

  const sendText = useCallback(async () => {
    const sid = sessionIdRef.current;
    const content = text.trim();
    if (!sid || !content || busy) return;
    setText("");
    setBubbles((bs) => [...bs, { role: "user", content }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamRealtimeMessage(sid, { type: "text", text: content }, handleEvent, ac.signal);
    } catch (e: any) {
      if (e?.name !== "AbortError") setErrorMsg(String(e?.message ?? e));
    } finally {
      abortRef.current = null;
      setBusy(false);
      finalizeDraft();
    }
  }, [text, busy, handleEvent, finalizeDraft]);

  // ── 引导态:未配 key,不是错误,给配置说明 ─────────────────────────────
  if (phase === "needs-key") {
    return (
      <div className="border-b border-ide-border bg-ide-bg-alt px-3 py-2 text-xs">
        <div className="flex items-start gap-2">
          <Radio size={13} className="mt-0.5 shrink-0 text-ide-accent" />
          <div className="flex-1 leading-relaxed text-ide-fg-muted">
            <span className="text-ide-fg">实时语音面试尚未启用。</span>
            服务端需配置智谱 GLM-Realtime:在 <code className="bg-ide-bg-active px-1">.env</code> 设置{" "}
            <code className="bg-ide-bg-active px-1">TRIALROOM_REALTIME_API_KEY</code>
            (模型 <code className="bg-ide-bg-active px-1">TRIALROOM_REALTIME_MODEL</code>,默认 glm-realtime)后重启;
            本地联调可设 <code className="bg-ide-bg-active px-1">TRIALROOM_REALTIME_MOCK=1</code> 用回显模式体验全链路。
          </div>
          <button onClick={onClose} aria-label="关闭" className="flex min-h-6 min-w-6 shrink-0 items-center justify-center text-ide-fg-muted hover:text-ide-fg">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-h-80 flex-col border-b border-ide-border bg-ide-bg-alt">
      {/* 头部:标题 + mock 标记 + 关闭 */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-ide-border px-3 text-xs">
        <Radio size={12} className={cn(recording ? "animate-pulse text-ide-danger" : "text-ide-accent")} />
        <span className="font-semibold text-ide-fg">实时语音面试</span>
        {isMock && <span className="bg-ide-bg-active px-1.5 py-0.5 text-[10px] text-ide-fg-muted">mock 回显</span>}
        {recording && <span className="text-[10px] text-ide-danger">录音中(每 3s 上传一片)</span>}
        <button onClick={onClose} aria-label="关闭实时语音面板"
          className="ml-auto flex min-h-6 min-w-6 shrink-0 items-center justify-center text-ide-fg-muted hover:text-ide-fg">
          <X size={14} />
        </button>
      </div>

      {phase !== "ready" ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-ide-fg-muted">
          {phase === "creating" ? (
            <><Loader2 size={12} className="animate-spin" /> 正在创建实时会话…</>
          ) : phase === "error" ? (
            <><span className="text-ide-danger">{errorMsg || "会话创建失败"}</span>
              <button onClick={start} className="ml-2 underline hover:text-ide-fg">重试</button></>
          ) : (
            <span>基于智谱 GLM-Realtime 的实时语音面试:语音/文字提问,AI 面试官实时应答。</span>
          )}
          {phase !== "creating" && phase !== "error" && (
            <button onClick={start}
              className="ml-auto flex min-h-6 shrink-0 items-center gap-1 bg-ide-accent px-2 text-[11px] text-ide-accent-fg hover:bg-ide-accent-hover">
              <Mic size={11} /> 开始会话
            </button>
          )}
        </div>
      ) : (
        <>
          {/* 对话气泡流 */}
          <div ref={scrollRef} className="min-h-16 flex-1 overflow-y-auto px-3 py-2">
            {bubbles.length === 0 && !draft && (
              <div className="text-[11px] text-ide-fg-muted">点击麦克风开始说话,或直接输入文字提问。</div>
            )}
            <div className="flex flex-col gap-2">
              {bubbles.map((b, i) => (
                <div key={i} className={cn("flex w-full", b.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded px-2 py-1 text-[11px] leading-relaxed",
                    b.role === "user" ? "bg-ide-accent/20 text-ide-fg" : "bg-ide-bg-active text-ide-fg",
                  )}>{b.content}</div>
                </div>
              ))}
              {draft && (
                <div className="flex w-full justify-start">
                  <div className="max-w-[85%] rounded bg-ide-bg-active px-2 py-1 text-[11px] leading-relaxed text-ide-fg">
                    {draft}<span className="prompt-cursor text-ide-accent">█</span>
                  </div>
                </div>
              )}
              {busy && !draft && (
                <div className="flex items-center gap-2 text-[11px] text-ide-fg-muted">
                  <Loader2 size={11} className="animate-spin" /> 等待面试官应答…
                </div>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-1 px-3 py-1 text-[11px] text-ide-danger" role="alert">
              <span className="flex-1 truncate">{errorMsg}</span>
              <button onClick={() => setErrorMsg("")} className="hover:underline">忽略</button>
            </div>
          )}

          {/* 输入区:文本 + 麦克风 */}
          <div className="flex shrink-0 items-center gap-1.5 border-t border-ide-border px-3 py-1.5">
            <button
              onClick={toggleRecording}
              title={recording ? "停止录音并提交" : "开始录音(每 3s 一片)"}
              className={cn(
                "flex min-h-6 min-w-6 shrink-0 items-center justify-center",
                recording ? "bg-ide-danger/20 text-ide-danger hover:bg-ide-danger/30" : "text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg",
              )}>
              {recording ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void sendText(); }}
              placeholder="输入文字提问…"
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent px-1 py-1 text-xs text-ide-fg outline-none placeholder:text-ide-fg-muted"
            />
            <button
              onClick={() => void sendText()}
              disabled={!text.trim() || busy}
              aria-label="发送"
              className="flex min-h-6 min-w-6 shrink-0 items-center justify-center text-ide-fg-muted hover:text-ide-fg disabled:opacity-40">
              <Send size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default RealtimeVoicePanel;
