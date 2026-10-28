// 平台层统一挂载点 —— index.js 只需要一行 mountPlatform(app)。
// 挂载拓扑(与 G06 门禁的判定一致):
//   /api/platform/*    基座 /api 认证罩外层 + platformAuth 身份层(payment 路由内部)
//   /pay/alipay/notify 根作用域公开端点(鉴权 = RSA2 验签;G06 白名单登记)
//   /mcp               mcpAuthMiddleware(独立 token class)→ mcpRouter
import express from "express";
import { getDb } from "./db.mjs";
import { ensureAdminFromEnv, platformAuth, requireScope } from "./auth.mjs";
import { createRateLimiter } from "../rateLimiter.js";
import * as payment from "./routes/payment.mjs";
import * as roomsRoutes from "./routes/rooms.mjs";
import { router as mcpTokensRouter } from "./routes/mcp-tokens.mjs";
import { trackEvent } from "./rooms.mjs";
import { buildAuthStartUrl, loginWithAuthCode, consumeState } from "./auth-alipay.mjs";
import { scheduleReconciliation } from "./payment/reconcile.mjs";
import { scheduleBackup } from "./backup.mjs";
import { mcpAuthMiddleware } from "./mcp/auth-mcp.mjs";
import { mcpRouter } from "./mcp/router.mjs";
import * as realtimeSessions from "./realtime/session.mjs";

export function mountPlatform(app) {
  getDb();                 // 首次挂载即建库迁移(trialroom.db)
  ensureAdminFromEnv();    // 若配置了 TRIALROOM_ADMIN_TOKEN 则引导管理员

  app.use("/api/platform", payment.router);
  app.use("/api/platform", roomsRoutes.router);
  app.use("/api/platform/mcp-tokens", mcpTokensRouter); // 商业化 #3:MCP 令牌自助

  // —— GLM-Realtime 实时语音面试(服务端中继:浏览器 WS 不能带鉴权头) ——
  // POST   /api/platform/realtime/sessions           创建(未配 key 且非 mock → 503 明确提示)
  // POST   /api/platform/realtime/sessions/:id/messages  发 user 帧;text/audio_commit 走 SSE 回推
  // DELETE /api/platform/realtime/sessions/:id        主动结束
  const realtimeRouter = express.Router();
  // 鉴权限定在 /realtime 前缀(对抗审查修复:裸 router.use 会对所有 /api/platform/*
  // 生效,把后注册的 OAuth 公开回调也 401 掉 —— 全量回归抓到的挂载顺序回归)
  realtimeRouter.use("/realtime", platformAuth, requireScope("platform:write"));
  realtimeRouter.post("/realtime/sessions", (req, res) => {
    realtimeSessions.startSession({ userId: req.user.id, position: req.body?.position })
      .then((r) => {
        if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: r.error.message });
        res.json({ ok: true, session_id: r.sessionId, mock: r.mock });
      })
      .catch((e) => res.status(500).json({ ok: false, message: e.message }));
  });
  realtimeRouter.post("/realtime/sessions/:id/messages", (req, res) => {
    const msg = req.body ?? {};
    // 音频分片追加:无事件可回,直接 JSON 应答(事件由后续 text/audio_commit 的 SSE 流回)
    if (msg.type === "audio") {
      const r = realtimeSessions.relay(req.params.id, req.user.id, msg);
      if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: r.error.message });
      return res.json({ ok: true, appended: true });
    }
    if (msg.type !== "text" && msg.type !== "audio_commit") {
      return res.status(400).json({ ok: false, message: "type 仅支持 text / audio / audio_commit" });
    }
    // 先 relay 后 SSE:会话 404 / 帧校验 400 走 JSON 状态码路径(而非 200+错误事件)。
    // 上游事件最快也在 microtask/网络回合到达,sink 在同步块内绑好,不丢首帧。
    const relayed = realtimeSessions.relay(req.params.id, req.user.id, msg);
    if (relayed.error) {
      return res.status(relayed.error.status).json({ ok: false, code: relayed.error.code, message: relayed.error.message });
    }
    // SSE:逐上游事件 res.write;response.done 即收流;15s 心跳防中间层断连
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();
    let closed = false;
    const hb = setInterval(() => { if (!closed) res.write(": ping\n\n"); }, 15_000);
    hb.unref?.();
    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      realtimeSessions.unbindSink(req.params.id, req.user.id); // 断连标记 lastAt,供空闲回收
      res.end();
    };
    const bind = realtimeSessions.bindSink(req.params.id, req.user.id, (evt) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
      if (evt?.type === "response.done" || evt?.type === "connection.closed") finish();
    });
    if (bind.error) { // 极窄竞态(relay 后会话被并发 DELETE):头已发出,以事件形式回错
      res.write(`data: ${JSON.stringify({ type: "error", code: bind.error.code, message: bind.error.message })}\n\n`);
      return finish();
    }
    // 断连检测用 res 而非 req:Node 18+ 的 req 'close' 在请求体读尽时就会触发
    // (并不代表客户端断开),会把刚建立的事件流立即掐断。res 'close' 在连接
    // 中断时触发;正常 res.end() 后的 close 由 closed 幂等挡住。
    res.on("close", () => { if (!closed) finish(); });
  });
  realtimeRouter.delete("/realtime/sessions/:id", (req, res) => {
    const r = realtimeSessions.endSession(req.params.id, req.user.id);
    if (r.error) return res.status(r.error.status).json({ ok: false, code: r.error.code, message: r.error.message });
    res.json({ ok: true, ended: true });
  });
  app.use("/api/platform", realtimeRouter);

  // 根作用域公开端点的独立限流(审查 F6/P0-1:此前 /track、/pay、/mcp 全部零限流)
  const publicLimiter = createRateLimiter({ windowMs: 60_000, max: 30, label: "public-root" });

  // 支付宝异步通知:form-urlencoded 原文留存(req.rawBody)→ RSA2 验签。
  // 公开端点:鉴权即签名本身;G06 白名单显式登记(作用域豁免审计制)。
  const rawBodyParser = express.urlencoded({
    extended: false,
    verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); },
  });
  app.post("/pay/alipay/notify", publicLimiter, ...payment.notifyHandler(rawBodyParser));

  // 匿名埋点(落地页 landing_uv 等无 token 场景):公开端点,G06 白名单登记;
  // 事件名白名单在 trackEvent 内校验,内容上限 2KB,不落 PII(user_hash 为匿名哈希)。
  app.post("/track", publicLimiter, express.json({ limit: "8kb" }), (req, res) => {
    const r = trackEvent({
      event: req.body?.event,
      userHash: req.body?.user_hash ?? null,
      sessionTicket: req.body?.session_ticket ?? null,
      roomCode: req.body?.room_code ?? null,
      props: req.body?.props ?? {},
    });
    if (r.error) return res.status(r.error.status).json({ ok: false, message: r.error.message });
    res.status(202).json({ ok: true });
  });

  // P0#3 支付宝 OAuth 登录(公开入口;state 一次性防 CSRF)
  app.get("/api/platform/auth/alipay/start", publicLimiter, (req, res) => {
    try {
      const redirect = process.env.ALIPAY_OAUTH_REDIRECT ?? `${req.protocol}://${req.get("host")}/api/platform/auth/alipay/callback`;
      const { url } = buildAuthStartUrl(redirect);
      res.redirect(url);
    } catch (e) {
      res.status(e.status ?? 503).json({ ok: false, message: e.message });
    }
  });
  app.get("/api/platform/auth/alipay/callback", publicLimiter, async (req, res) => {
    const { auth_code, state } = req.query;
    if (!consumeState(state) || !auth_code) {
      return res.status(400).json({ ok: false, message: "state 无效或缺少 auth_code(10 分钟一次性)" });
    }
    try {
      const r = await loginWithAuthCode(auth_code);
      // 开发态直接回 JSON;生产建议改为 Set-Cookie + 302 回前端(部署清单项)
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(e.status ?? 502).json({ ok: false, message: e.message });
    }
  });

  // P1#5 对账补偿定时任务(仅配钥态)+ P2#17 每日备份
  scheduleReconciliation();
  scheduleBackup();

  // P2#11 分享卡(SVG):房号即邀请凭证,公开传播是设计意图;公共限流防滥用
  app.get("/share/:code.svg", publicLimiter, (req, res) => {
    const code = String(req.params.code ?? "");
    if (!/^\d{6}$/.test(code)) return res.status(404).type("text").send("not found");
    // esc 与 routes/rooms.mjs buildReadyCardSvg 保持同一转义集(& < >)——待抽 svg.mjs 共享
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320">
  <rect width="100%" height="100%" fill="#0d1117"/>
  <text x="40" y="70" fill="#3fb950" font-family="monospace" font-size="26">\$ Trialroom · 面试房间邀请</text>
  <text x="40" y="170" fill="#e6edf3" font-family="monospace" font-size="88" letter-spacing="18">${esc(code)}</text>
  <text x="40" y="240" fill="#8b949e" font-size="18">打开 ${esc(process.env.PUBLIC_BASE_URL ?? "http://localhost:5173")}/welcome?code=${esc(code)}</text>
  <text x="40" y="275" fill="#8b949e" font-size="15">AI 多面试官 · 808 题客观基准 · 数据不出本机</text>
</svg>`;
    res.setHeader("content-type", "image/svg+xml");
    res.setHeader("cache-control", "public, max-age=300");
    res.send(svg);
  });

  // MCP:限流(审查 P0-1:join_room 可 74 分钟枚举 10^6 房号)→ 同挂载内 auth 在前
  // (G06 的 PASS 形态;限流中间件在鉴权前,保护 DB 免受未认证请求打审计表)
  app.use("/mcp", createRateLimiter({ windowMs: 60_000, max: 30, label: "mcp" }), mcpAuthMiddleware, mcpRouter);

  // 埋点保留期:每日清理 90 天前的匿名事件(审查 F6 遗留项)
  const FUNNEL_RETENTION_DAYS = 90;
  const pruneFunnel = () => {
    try {
      getDb().prepare(`DELETE FROM funnel_events WHERE created_at < datetime('now', ?)`)
        .run(`-${FUNNEL_RETENTION_DAYS} days`);
    } catch { /* 清理失败不致命,下个周期重试 */ }
  };
  pruneFunnel();
  setInterval(pruneFunnel, 24 * 3600_000).unref();
}
