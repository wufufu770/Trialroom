// AI 面试官追问(P2#13 最小可行):基于候选人最近发言生成面试官回应。
// LLM 路径:OpenAI 兼容(TRIALROOM_LLM_* 环境变量,与判官同源;固定 env 源,
// 出网前校验 host 非私网/环回/保留地址)。无 key 或调用失败 → 模板降级(可用性优先)。
import { getDb, genId } from "./db.mjs";
import { stripInvisibleChars } from "./evidence/extractor.mjs";

const LLM_BASE = () => process.env.TRIALROOM_LLM_BASE_URL ?? "https://api.minimax.chat/v1";

// per-room 追问冷却(R2):模块级 roomId -> lastAt(ms);间隔不足即 429,
// 防单房间高频触发 LLM(成本/滥用面)。房间关闭后的残留条目无害(仅小对象)。
const followUpLastAt = new Map(); // roomId -> ms
export const FOLLOWUP_COOLDOWN_MS = 3000;

// 出网主机校验:仅 http/https,拒绝环回/私网/保留(遵循安全约束,防 env 被改成内网地址)
function assertSafeHost(urlStr) {
  const u = new URL(urlStr);
  if (!/^https?:$/.test(u.protocol)) throw new Error("仅允许 http/https");
  const h = u.hostname;
  if (h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || h.endsWith(".internal")) {
    throw new Error("LLM 地址指向内网/保留地址,已拒绝");
  }
}

async function llmReply({ position, lastAnswer, questionTitle }) {
  const key = process.env.TRIALROOM_LLM_API_KEY;
  if (!key) return null;
  assertSafeHost(`${LLM_BASE()}/chat/completions`);
  const res = await fetch(`${LLM_BASE()}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.TRIALROOM_LLM_MODEL ?? "MiniMax-M2",
      temperature: 0.4, max_tokens: 300,
      messages: [
        { role: "system", content: `你是资深技术面试官(岗位:${position ?? "通用"}),针对候选人上一个回答给一句简短追问(60字内),聚焦漏洞或要求举例。` },
        { role: "user", content: `题目:${questionTitle ?? "(自由问答)"}\n候选人回答:${lastAnswer}` },
      ],
    }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j.choices?.[0]?.message?.content?.trim() ?? null;
}

const templateFollowUp = (last) => {
  const kw = (last.match(/[\u4e00-\u9fa5A-Za-z]{2,6}/g) ?? ["方案"]).slice(0, 3).join("、");
  return `你提到了「${kw}」。请结合一个真实项目举例:当时的约束、你的取舍与最终量化结果是什么?`;
};

/**
 * 生成一轮面试官追问并写入房间消息流(座位成员可用;幂等:同轮已有追问则返回)。
 * 返回 { turn_index, content, source: "llm" | "template" }。
 */
export async function aiFollowUp({ roomId, userId }) {
  const db = getDb();
  const room = db.prepare("SELECT * FROM rooms WHERE room_id = ? AND room_id IN (SELECT room_id FROM room_seats WHERE user_id = ? AND left_at IS NULL)").get(roomId, userId);
  if (!room) return { error: { status: 404, code: "NOT_FOUND", message: "房间不存在" } };
  // 冷却检查在幂等 noop 之前:连续追问(即使上一条已是面试官消息)同样受限
  const now = Date.now();
  if (now - (followUpLastAt.get(roomId) ?? 0) < FOLLOWUP_COOLDOWN_MS) {
    return { error: { status: 429, code: "COOLDOWN", message: "追问过于频繁" } };
  }
  followUpLastAt.set(roomId, now);
  const seat = db.prepare("SELECT * FROM room_seats WHERE room_id = ? AND user_id = ?").get(roomId, userId);
  const lastCandidate = db.prepare("SELECT content, turn_index FROM room_messages WHERE room_id = ? AND role = 'candidate' ORDER BY turn_index DESC LIMIT 1").get(roomId);
  const lastTurn = db.prepare("SELECT turn_index, role FROM room_messages WHERE room_id = ? ORDER BY turn_index DESC LIMIT 1").get(roomId);
  const turn = (lastTurn?.turn_index ?? 0) + 1;
  // 幂等:候选人最新发言之后已有面试官消息 → 不再生成
  if (lastTurn?.role === "interviewer") {
    return { turn_index: lastTurn.turn_index, content: "(本轮已有面试官回应)", source: "noop" };
  }
  // 候选人原文先剥离不可见字符(零宽/双向文本等注入载体)再拼 LLM prompt(R2)
  const answer = stripInvisibleChars(lastCandidate?.content ?? "(候选人尚未发言)");
  let content, source;
  try {
    content = await llmReply({ position: room.position, lastAnswer: answer.slice(0, 1500), questionTitle: null });
    source = "llm";
  } catch { content = null; }
  if (!content) { content = templateFollowUp(answer.slice(0, 300)); source = "template"; }
  db.prepare("INSERT INTO room_messages (id, room_id, seat_id, turn_index, role, content) VALUES (?, ?, ?, ?, 'interviewer', ?)")
    .run(genId("msg"), roomId, seat.id, turn, content.slice(0, 2000));
  return { turn_index: turn, content, source };
}
