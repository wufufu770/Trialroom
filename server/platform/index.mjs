// 平台层统一挂载点 —— index.js 只需要一行 mountPlatform(app)。
// 挂载拓扑(与 G06 门禁的判定一致):
//   /api/platform/*    基座 /api 认证罩外层 + platformAuth 身份层(payment 路由内部)
//   /pay/alipay/notify 根作用域公开端点(鉴权 = RSA2 验签;G06 白名单登记)
//   /mcp               mcpAuthMiddleware(独立 token class)→ mcpRouter
import express from "express";
import { getDb } from "./db.mjs";
import { ensureAdminFromEnv } from "./auth.mjs";
import * as payment from "./routes/payment.mjs";
import { mcpAuthMiddleware } from "./mcp/auth-mcp.mjs";
import { mcpRouter } from "./mcp/router.mjs";

export function mountPlatform(app) {
  getDb();                 // 首次挂载即建库迁移(trialroom.db)
  ensureAdminFromEnv();    // 若配置了 TRIALROOM_ADMIN_TOKEN 则引导管理员

  app.use("/api/platform", payment.router);

  // 支付宝异步通知:form-urlencoded 原文留存(req.rawBody)→ RSA2 验签。
  // 公开端点:鉴权即签名本身;G06 白名单显式登记(作用域豁免审计制)。
  const rawBodyParser = express.urlencoded({
    extended: false,
    verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); },
  });
  app.post("/pay/alipay/notify", ...payment.notifyHandler(rawBodyParser));

  // MCP:同挂载内 auth 在前、router 在后(G06 的 PASS 形态)
  app.use("/mcp", mcpAuthMiddleware, mcpRouter);
}
