// MCP 鉴权 —— 独立 token class(mcp_tokens),与基座全局 token、平台 api_tokens 物理分表。
// 依据:11-final-plan §3.5(X-1 令牌混淆)/§3.5.3。
// 纪律:SHA-256 哈希查表;revoked_at IS NULL 且未过期才放行;deny 与 allow 同权审计。
import crypto from "node:crypto";
import { getDb, sha256Hex, nowIso, genId } from "../db.mjs";

export function issueMcpToken({ userId, clientId = "", scopes = [], ttlDays = 90 } = {}) {
  const db = getDb();
  const token = `mt_${crypto.randomBytes(24).toString("base64url")}`;
  const token_id = genId("mcp");
  db.prepare(`INSERT INTO mcp_tokens (token_id, token_hash, user_id, client_id, scopes, aud, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(token_id, sha256Hex(token), userId, clientId, JSON.stringify(scopes),
      process.env.MCP_AUD ?? "https://trialroom.example/mcp",
      ttlDays ? new Date(Date.now() + ttlDays * 86400_000).toISOString() : null);
  return { token, token_id };
}

export function mcpAuthMiddleware(req, res, next) {
  const db = getDb();
  // GET /mcp = server/discover 公开元数据卡(等价 /api/health 的探活豁免:
  // 无业务数据、无工具细节;真正的授权强制点在 tools/call)。
  if (req.method === "GET" && req.path === "/") return next();
  const audit = (decision, extra = {}) => {
    db.prepare(`INSERT INTO mcp_audit (id, token_id, decision, deny_reason, method, tool_name, principal, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(genId("aud"), extra.token_id ?? null, decision, extra.deny_reason ?? null,
        extra.method ?? null, extra.tool_name ?? null, extra.principal ?? null, req.ip ?? null);
  };
  const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  const rpcFail = (code, message, httpStatus, denyReason) => {
    audit("deny", { deny_reason: denyReason, method: req.body?.method });
    res.status(httpStatus).json({ jsonrpc: "2.0", id: req.body?.id ?? null,
      error: { code, message } });
  };
  if (!m) return rpcFail(-32001, "缺少 MCP token", 401, "AUTH_MISSING");
  const row = db.prepare("SELECT * FROM mcp_tokens WHERE token_hash = ?").get(sha256Hex(m[1].trim()));
  if (!row) return rpcFail(-32001, "MCP token 无效", 401, "AUTH_INVALID");
  if (row.revoked_at) return rpcFail(-32001, "MCP token 已吊销", 401, "REVOKED");
  if (row.expires_at && row.expires_at < nowIso()) return rpcFail(-32001, "MCP token 已过期", 401, "EXPIRED");
  req.mcp = {
    token_id: row.token_id, user_id: row.user_id, client_id: row.client_id,
    scopes: JSON.parse(row.scopes), aud: row.aud,
  };
  audit("allow", { token_id: row.token_id, principal: row.user_id, method: req.body?.method });
  next();
}
