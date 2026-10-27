// 商业化 #3 · MCP 令牌自助(挂载于 /api/platform/mcp-tokens)。
// 与平台 Web 令牌(api_tokens)是两个 token class:本路由签发的是 mcp_tokens,
// 供外部 agent 走 /mcp(JSON-RPC)接入。纪律:SHA-256 哈希落库,
// 明文只在创建响应里回显一次;列表永不回明文;吊销即时生效(auth-mcp 每次请求查表)。
import crypto from "node:crypto";
import express from "express";
import { platformAuth, requireScope } from "../auth.mjs";
import { getDb, genId, sha256Hex, nowIso } from "../db.mjs";

// 冻结五档(与 config/mcp-tools.json scopes 一致,G11 门禁校验;变更须走 ADR)
export const MCP_SCOPES = Object.freeze(["rooms:read", "rooms:join", "rooms:advance", "self_review", "evidence:read"]);

const DEFAULT_TTL_DAYS = 90;

export const router = express.Router();

// 创建:name 仅作展示用途,落 client_id 字段(外部 agent 客户端标识,语义同源)
router.post("/", platformAuth, requireScope("platform:write"), (req, res) => {
  const db = getDb();
  const name = String(req.body?.name ?? "").trim().slice(0, 64) || "mcp-token";
  const scopes = req.body?.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ ok: false, code: "SCOPES_REQUIRED", message: "scopes 必须是非空数组(冻结五档的子集)" });
  }
  const unique = [...new Set(scopes.map(String))];
  const illegal = unique.filter((s) => !MCP_SCOPES.includes(s));
  if (illegal.length > 0) {
    // platform:admin 等平台档位不属于 MCP 冻结五档,一律拒绝
    return res.status(400).json({ ok: false, code: "SCOPE_ILLEGAL", message: `scopes 含未冻结档位:${illegal.join(",")}(允许:${MCP_SCOPES.join(",")})` });
  }
  // 对抗审查 R3-5:每用户活跃 token 上限 20,防刷表灌库
  const activeCount = db.prepare(`SELECT COUNT(*) AS c FROM mcp_tokens
    WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
    .get(req.user.id, new Date().toISOString()).c;
  if (activeCount >= 20) {
    return res.status(409).json({ ok: false, code: "TOKEN_LIMIT", message: "活跃 MCP 令牌已达上限(20),请先吊销不用的令牌" });
  }
  const token = `mt_${crypto.randomBytes(24).toString("base64url")}`;
  const tokenId = genId("mcp");
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 86400_000).toISOString();
  db.prepare(`INSERT INTO mcp_tokens (token_id, token_hash, user_id, client_id, scopes, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(tokenId, sha256Hex(token), req.user.id, name, JSON.stringify(unique), expiresAt);
  res.json({ ok: true, token, token_id: tokenId, name, scopes: unique, expires_at: expiresAt,
    note: "明文仅此一次显示,请立即保存;平台侧只存哈希,丢失只能吊销重签" });
});

// 列表:只回元数据,永不回明文/哈希
router.get("/", platformAuth, (req, res) => {
  const rows = getDb().prepare(
    "SELECT token_id, client_id, scopes, expires_at, revoked_at, created_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC")
    .all(req.user.id);
  res.json({
    ok: true,
    tokens: rows.map((r) => ({
      token_id: r.token_id, name: r.client_id, scopes: JSON.parse(r.scopes),
      expires_at: r.expires_at, revoked_at: r.revoked_at, created_at: r.created_at,
    })),
  });
});

// 吊销:仅本人 token 可吊销;他人 token 与不存在同响应 404(不泄露存在性)
router.post("/:id/revoke", platformAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM mcp_tokens WHERE token_id = ?").get(req.params.id);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "令牌不存在" });
  }
  if (row.revoked_at) return res.json({ ok: true, token_id: row.token_id, revoked_at: row.revoked_at, already: true });
  const at = nowIso();
  db.prepare("UPDATE mcp_tokens SET revoked_at = ?, revoke_reason = ? WHERE token_id = ?")
    .run(at, "user_revoked", row.token_id);
  res.json({ ok: true, token_id: row.token_id, revoked_at: at });
});
