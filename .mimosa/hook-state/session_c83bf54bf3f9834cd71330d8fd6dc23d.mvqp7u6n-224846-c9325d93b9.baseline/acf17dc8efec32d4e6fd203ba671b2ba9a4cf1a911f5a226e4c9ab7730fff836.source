// 房间对话视图(P2#13 集成):进入房间后开聊的唯一界面。
// 挂载即拉详情 + 全量消息,此后每 3s 增量轮询(after=lastTurn);
// lastTurn 存 ref 防闭包陈旧,卸载清理 timer。
// 面试官消息可能是真题 JSON({title,question}),try 解析,失败按纯文本。
import { useCallback, useEffect, useRef, useState } from "react";
import { platformApi } from "@/api/platform";

interface RoomMsg { turn_index: number; role: string; content: string; created_at: string }
interface RoomDetail { room: any; seats: any[]; your_seat_no: number; is_host: boolean }

/** 面试官消息内容 try 解析真题 JSON;非 JSON 或缺字段返回 null 按纯文本渲染 */
function parseQuestion(content: string): { title?: string; question?: string } | null {
  try {
    const j = JSON.parse(content);
    if (j && typeof j === "object" && !Array.isArray(j) && (j.title || j.question)) return j;
  } catch { /* 非 JSON */ }
  return null;
}

export function RoomChatView({ roomId, isHost, onExit }: { roomId: string; isHost: boolean; onExit: () => void }) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [msgs, setMsgs] = useState<RoomMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCooldown, setAiCooldown] = useState(0);
  const lastTurn = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 增量轮询:只依赖 roomId,内部用 ref + 函数式 setState,无陈旧闭包
  const poll = useCallback(async () => {
    try {
      const r = await platformApi.messages(roomId, lastTurn.current);
      const fresh: RoomMsg[] = r.messages ?? [];
      if (fresh.length > 0) {
        lastTurn.current = Math.max(lastTurn.current, fresh[fresh.length - 1].turn_index);
        setMsgs(prev => {
          const seen = new Set(prev.map(m => m.turn_index));
          return [...prev, ...fresh.filter(m => !seen.has(m.turn_index))]
            .sort((a, b) => a.turn_index - b.turn_index);
        });
      }
    } catch { /* 轮询失败静默,下个周期重试 */ }
  }, [roomId]);

  useEffect(() => {
    let alive = true;
    platformApi.roomDetail(roomId)
      .then(d => { if (alive) setDetail(d); })
      .catch(e => { if (alive) setNotice(e.message); });
    poll(); // 挂载即全量(lastTurn.current 初始为 0)
    const timer = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [roomId, poll]);

  // 新消息到底部
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  // AI 追问 3s 冷却倒计时
  useEffect(() => {
    if (aiCooldown <= 0) return;
    const t = setTimeout(() => setAiCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [aiCooldown]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setNotice("");
    try {
      await platformApi.postMessage(roomId, text);
      setDraft("");
      await poll(); // 发送后立即拉一次,不等下个周期
    } catch (e: any) { setNotice(e.message); }
    finally { setSending(false); }
  };

  const askAi = async () => {
    if (aiBusy || aiCooldown > 0) return;
    setAiBusy(true); setNotice("");
    try {
      await platformApi.aiTurn(roomId);
      await poll();
    } catch (e: any) { setNotice(e.message || "追问失败,请稍后再试"); }
    finally { setAiBusy(false); setAiCooldown(3); }
  };

  const closeRoom = async () => {
    if (!window.confirm("确认关闭房间?关闭后所有人将无法继续发言,不可恢复。")) return;
    try {
      await platformApi.closeRoom(roomId);
      onExit();
    } catch (e: any) { setNotice(e.message); }
  };

  const aiDisabled = aiBusy || aiCooldown > 0;

  return (
    <div className="flex h-[68vh] flex-col border border-ide-border font-mono text-sm">
      {/* 顶部栏:房间短码 · 在座人数 · 离开 / 关房 */}
      <div className="flex items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3 py-2 text-xs">
        <div className="truncate text-ide-fg-muted">
          <span className="text-ide-accent">room</span> {roomId.slice(0, 12)}…
          　·　{detail ? `${detail.seats.length} 人在座(你坐 ${detail.your_seat_no} 号)` : "读取座位…"}
          {isHost && <span className="ml-2 text-ide-accent">[房主]</span>}
        </div>
        <div className="flex shrink-0 gap-2">
          {isHost && (
            <button onClick={closeRoom}
              className="border border-ide-danger px-2 py-0.5 text-ide-danger hover:bg-ide-danger hover:text-ide-bg">
              关闭房间
            </button>
          )}
          <button onClick={onExit}
            className="border border-ide-border px-2 py-0.5 hover:border-ide-accent hover:text-ide-accent">
            离开
          </button>
        </div>
      </div>
      {notice && <div className="border-b border-ide-warning bg-ide-warning/10 px-3 py-1.5 text-xs text-ide-warning">{notice}</div>}

      {/* 消息流 */}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-xs leading-relaxed">
        {msgs.length === 0 && <div className="py-8 text-center text-ide-fg-muted">暂无消息。等待面试官开场,或先做一段自我介绍。</div>}
        {msgs.map(m => {
          if (m.role === "system") {
            return <div key={m.turn_index} className="text-center text-ide-fg-muted">— {m.content} —</div>;
          }
          if (m.role === "interviewer") {
            const q = parseQuestion(m.content);
            return (
              <div key={m.turn_index} className="max-w-[85%] border border-ide-success/40 bg-ide-success/5 p-2">
                {q?.title && <div className="mb-1 text-ide-success">【{q.title}】</div>}
                <div className="whitespace-pre-wrap text-ide-fg">{q?.question ?? m.content}</div>
              </div>
            );
          }
          // candidate(及未知 role):默认右对齐
          return (
            <div key={m.turn_index} className="ml-auto max-w-[85%] border border-ide-border bg-ide-bg-alt p-2">
              <div className="whitespace-pre-wrap text-ide-fg">{m.content}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 底部输入 + 操作 */}
      <div className="flex items-center gap-2 border-t border-ide-border bg-ide-bg-alt px-3 py-2">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }}
          placeholder="输入回答,Enter 发送"
          className="flex-1 border border-ide-border bg-ide-bg px-2 py-1.5 text-xs" />
        <button onClick={send} disabled={!draft.trim() || sending}
          className="border border-ide-accent px-3 py-1.5 text-xs text-ide-accent hover:bg-ide-accent hover:text-ide-bg disabled:opacity-50">
          {sending ? "发送中…" : "发送"}
        </button>
        {isHost && (
          <button onClick={askAi} disabled={aiDisabled}
            className="border border-ide-success px-3 py-1.5 text-xs text-ide-success hover:bg-ide-success hover:text-ide-bg disabled:opacity-50">
            {aiBusy ? "追问中…" : aiCooldown > 0 ? `冷却 ${aiCooldown}s` : "AI 追问"}
          </button>
        )}
      </div>
    </div>
  );
}

export default RoomChatView;
