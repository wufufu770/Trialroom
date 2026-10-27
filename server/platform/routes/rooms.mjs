// 平台 REST:房间 + 开发令牌 + 埋点(挂载于 /api/platform,platformAuth 身份层)。
import express from "express";
import { platformAuth, createDevUser, requireScope } from "../auth.mjs";
import * as rooms from "../rooms.mjs";

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
