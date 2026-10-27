// 平台 REST:房间 + 开发令牌 + 埋点(挂载于 /api/platform,platformAuth 身份层)。
import express from "express";
import { platformAuth, createDevUser, requireScope } from "../auth.mjs";
import * as rooms from "../rooms.mjs";
import { startAttempt, finishAttempt, myAttempts, closeRoom, leaveRoom } from "../attempts.mjs";
import { aiFollowUp } from "../interviewer.mjs";
import { getDb, nowIso } from "../db.mjs";

export const router = express.Router();

// 开发用户引导(仅 mock/开发态;生产 403)—— Web 收银台在无部署认证体系时的入口
router.post("/auth/dev-token", (req, res) => {
  try {
    const { user_id, token, expires_at } = createDevUser(req.body?.display_name);
    res.json({ ok: true, user_id, token, expires_at, note: "开发态令牌,仅显示这一次;生产环境此端点禁用" });
  } catch (e) {
    res.status(e.status ?? 403).json({ ok: false, message: e.message });
  }
});

router.post("/rooms", platformAuth, requireScope("platform:write"), (req, res) => {
  const r = rooms.createRoom({ hostUserId: req.user.id, industry: req.body?.industry, position: req.body?.position });
  res.json({ ok: true, ...r, note: "room_code 仅本次返回,请立即分享;此后任何接口不再回显" });
});

router.get("/rooms", platformAuth, (req, res) => {
  res.json({ ok: true, rooms: rooms.myRooms(req.user.id) });
});

router.post("/rooms/join", platformAuth, requireScope("platform:write"), (req, res) => {
  const r = rooms.joinRoom({ userId: req.user.id, roomCode: req.body?.room_code });
  if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: r.error.message });
  res.json({ ok: true, ...r });
});

router.get("/rooms/:roomId", platformAuth, (req, res) => {
  const r = rooms.roomDetail({ roomId: req.params.roomId, userId: req.user.id });
  if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: r.error.message });
  res.json({ ok: true, ...r });
});

router.get("/rooms/:roomId/messages", platformAuth, (req, res) => {
  const r = rooms.listMessages({ roomId: req.params.roomId, userId: req.user.id, afterTurn: req.query.after });
  if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: r.error.message });
  res.json({ ok: true, ...r });
});

router.post("/rooms/:roomId/messages", platformAuth, requireScope("platform:write"), (req, res) => {
  const r = rooms.postMessage({ roomId: req.params.roomId, userId: req.user.id, content: req.body?.content, role: req.body?.role });
  if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: r.error.message });
  res.json({ ok: true, ...r });
});

// ── P0#1 面试尝试(付费闭环:开跑扣次 / 收卷判定 / 我的尝试) ───────────────
router.post("/attempts", platformAuth, requireScope("platform:write"), (req, res) => {
  try {
    const r = startAttempt({ userId: req.user.id, roomCode: req.body?.room_code, position: req.body?.position, difficulty: req.body?.difficulty });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(e.status ?? 500).json({ ok: false, code: e.code ?? "ATTEMPT_FAILED", message: e.message });
  }
});

router.post("/attempts/:id/finish", platformAuth, requireScope("platform:write"), (req, res) => {
  try {
    const r = finishAttempt({ attemptId: req.params.id, userId: req.user.id, ...req.body });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(e.status ?? 500).json({ ok: false, message: e.message });
  }
});

router.get("/attempts", platformAuth, (req, res) => {
  res.json({ ok: true, attempts: myAttempts(req.user.id, req.query.limit) });
});

// ── 商业化 #7 权益提醒 + #9 话术:剩余额度 + 最近到期的时间卡 ──────────────
// 次卡口径与 consumeEntitlement 一致:status='active' 且未过期;quota_total-quota_used 求和。
router.get("/attempts/quota", platformAuth, (req, res) => {
  const db = getDb();
  const now = nowIso();
  const packs = db.prepare(`SELECT COALESCE(SUM(quota_total - quota_used), 0) AS quota_left
    FROM entitlements WHERE user_id = ? AND kind = 'attempt_pack' AND status = 'active'
      AND (valid_until IS NULL OR valid_until > ?)`).get(req.user.id, now);
  const tp = db.prepare(`SELECT MIN(valid_until) AS nearest FROM entitlements
    WHERE user_id = ? AND kind = 'time_pass' AND status = 'active' AND valid_until > ?`)
    .get(req.user.id, now);
  // 对抗审查 R3(质量#3):时间卡不限次,quota_left=0 ≠ 不可用 —— 前端按 time_pass_active 分支
  res.json({ ok: true, quota_left: packs.quota_left, time_pass_active: Boolean(tp.nearest), time_pass_nearest_expiry: tp.nearest ?? null });
});

// ── 商业化 #2 岗位就绪度认证卡:最近 10 场已完成的达标率 → SVG(认证版/修炼版)──
// 校准纪律:κ 是语料级×版本级统计量,只在发布门禁内部流转;此卡只呈现用户自身
// 达标率(passed 占比),任何分支都不得出现 κ 数值。
router.get("/ready-card", platformAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(req.user.id);
  const rows = db.prepare(`SELECT position, qualification, finished_at FROM interview_attempts
    WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 10`).all(req.user.id);
  const isPassed = (q) => { try { return JSON.parse(q ?? "null")?.passed === true; } catch { return false; } };
  const passedCount = rows.filter((r) => isPassed(r.qualification)).length;
  const rate = rows.length ? passedCount / rows.length : 0;
  // 对抗审查 R3-1(纪律):判据目前来自客户端回传,在接入服务端评分引擎前,
  // 本卡只能是「练习达标记录」而非「认证」;样本 <5 场不给比率以免小样本误导。
  const ready = rows.length >= 5 && rate >= 0.7;
  const certified = false; // 服务端判分落地前恒为 false
  const svg = buildReadyCardSvg({
    name: String(user?.display_name ?? "").slice(0, 8) || "候选人",
    rate, passedCount, total: rows.length,
    position: String(rows[0]?.position ?? "通用岗位").slice(0, 16),
    date: new Date().toISOString().slice(0, 10),
    ready, certified,
  });
  res.json({ ok: true, svg, ready: certified, practice_ready: ready, pass_rate: rate, passed: passedCount, sample: rows.length });
});

// 与 index.mjs /share/:code.svg 同一视觉语言(#0d1117 底 / 等宽 / #3fb950 绿)
function buildReadyCardSvg({ name, rate, passedCount, total, position, date, ready }) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pct = `${Math.round(rate * 100)}%`;
  if (ready) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320">
  <rect width="100%" height="100%" fill="#0d1117"/>
  <rect x="8" y="8" width="584" height="304" fill="none" stroke="#3fb950" stroke-width="2"/>
  <text x="40" y="66" fill="#3fb950" font-family="monospace" font-size="24">$ 练习达标记录(非认证) · TRIALROOM</text>
  <text x="40" y="130" fill="#e6edf3" font-family="monospace" font-size="52">${esc(name)}</text>
  <text x="40" y="180" fill="#e6edf3" font-family="monospace" font-size="34">${esc(position)} · 达标率 ${esc(pct)}</text>
  <text x="40" y="230" fill="#8b949e" font-size="17">近 ${total} 场已完成面试 ${passedCount} 场达到三条件标准</text>
  <text x="40" y="282" fill="#8b949e" font-size="15">${esc(date)} · 练习自报口径,非认证;服务端判分上线后自动升级</text>
</svg>`;
  }
  // 修炼版:不出现任何 κ 数值(校准纪律),也不宣示达标
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320">
  <rect width="100%" height="100%" fill="#0d1117"/>
  <rect x="8" y="8" width="584" height="304" fill="none" stroke="#8b949e" stroke-width="1"/>
  <text x="40" y="66" fill="#d29922" font-family="monospace" font-size="24">修炼中 · TRIALROOM</text>
  <text x="40" y="130" fill="#e6edf3" font-family="monospace" font-size="52">${esc(name)}</text>
  <text x="40" y="180" fill="#e6edf3" font-family="monospace" font-size="30">${esc(position)} · 完成 ${total} 场 · 达标 ${passedCount} 场</text>
  <text x="40" y="230" fill="#8b949e" font-size="17">继续练习:达标率 70% 即可获得岗位就绪认证</text>
  <text x="40" y="282" fill="#8b949e" font-size="15">${esc(date)} · 认证只看三条件实测,不做预测性背书</text>
</svg>`;
}

// ── P1#8 房间生命周期 ─────────────────────────────────────────────────────
router.post("/rooms/:roomId/close", platformAuth, requireScope("platform:write"), (req, res) => {
  const r = closeRoom({ roomId: req.params.roomId, userId: req.user.id });
  if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: "房间不存在" });
  res.json({ ok: true, ...r });
});

router.post("/rooms/:roomId/leave", platformAuth, requireScope("platform:write"), (req, res) => {
  const r = leaveRoom({ roomId: req.params.roomId, userId: req.user.id });
  if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: "座位不存在" });
  res.json({ ok: true, ...r });
});

// P2#13:AI 面试官追问(LLM 可用时走模型,否则模板降级)
router.post("/rooms/:roomId/ai-turn", platformAuth, requireScope("platform:write"), async (req, res) => {
  const r = await aiFollowUp({ roomId: req.params.roomId, userId: req.user.id });
  if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: "房间不存在" });
  res.json({ ok: true, ...r });
});
