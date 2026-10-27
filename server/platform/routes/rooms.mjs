// 平台 REST:房间 + 开发令牌 + 埋点(挂载于 /api/platform,platformAuth 身份层)。
import express from "express";
import { platformAuth, createDevUser, requireScope } from "../auth.mjs";
import * as rooms from "../rooms.mjs";
import { startAttempt, finishAttempt, myAttempts, closeRoom, leaveRoom } from "../attempts.mjs";
import { aiFollowUp } from "../interviewer.mjs";

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
