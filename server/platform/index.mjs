// 平台层统一挂载点 —— index.js 只需要一行 mountPlatform(app)。
// 挂载拓扑(与 G06 门禁的判定一致):
//   /api/platform/*    基座 /api 认证罩外层 + platformAuth 身份层(payment 路由内部)
//   /pay/alipay/notify 根作用域公开端点(鉴权 = RSA2 验签;G06 白名单登记)
//   /mcp               mcpAuthMiddleware(独立 token class)→ mcpRouter
import express from "express";
import { getDb } from "./db.mjs";
import { ensureAdminFromEnv } from "./auth.mjs";
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

export function mountPlatform(app) {
  getDb();                 // 首次挂载即建库迁移(trialroom.db)
  ensureAdminFromEnv();    // 若配置了 TRIALROOM_ADMIN_TOKEN 则引导管理员

  app.use("/api/platform", payment.router);
  app.use("/api/platform", roomsRoutes.router);
  app.use("/api/platform/mcp-tokens", mcpTokensRouter); // 商业化 #3:MCP 令牌自助

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
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
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
