// 平台身份:api_tokens(与基座全局 token、mcp_tokens 三个独立 token class)。
// 纪律:哈希落库永不存明文;发放时唯一一次回显;吊销即时生效。
import crypto from "node:crypto";
import { getDb, genId, sha256Hex, nowIso } from "./db.mjs";

export function issueToken(userId, { name = "default", scopes = ["platform:read", "platform:write"], ttlDays = 30 } = {}) {
  const db = getDb();
  const token = `pt_${crypto.randomBytes(24).toString("base64url")}`;
  const expires = ttlDays ? new Date(Date.now() + ttlDays * 86400_000).toISOString() : null;
  db.prepare(`INSERT INTO api_tokens (token_hash, user_id, name, scopes, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run(sha256Hex(token), userId, name, JSON.stringify(scopes), expires);
  return { token, expires_at: expires };
}

/** 管理员引导:TRIALROOM_ADMIN_TOKEN 环境变量固定值(便于部署侧轮换)。 */
export function ensureAdminFromEnv() {
  const fixed = process.env.TRIALROOM_ADMIN_TOKEN;
  if (!fixed) return null;
  const db = getDb();
  let admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get();
  if (!admin) {
    admin = { id: genId("u") };
    db.prepare("INSERT INTO users (id, display_name, role) VALUES (?, 'admin', 'admin')").run(admin.id);
  }
  const hash = sha256Hex(fixed);
  db.prepare(`INSERT INTO api_tokens (token_hash, user_id, name, scopes) VALUES (?, ?, 'admin-env', '["platform:read","platform:write","platform:admin"]')
    ON CONFLICT(token_hash) DO UPDATE SET revoked_at = NULL`).run(hash, admin.id);
  return admin;
}

/** 开发用户引导(仅 mock/开发态;生产禁止)。 */
export function createDevUser(displayName = "dev") {
  if (process.env.NODE_ENV === "production") throw Object.assign(new Error("生产环境禁用开发用户引导"), { status: 403 });
  const db = getDb();
  const user = { id: genId("u") };
  db.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").run(user.id, displayName.slice(0, 32));
  const t = issueToken(user.id, { name: "dev" });
  return { user_id: user.id, ...t };
}

export function platformAuth(req, res, next) {
  const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ ok: false, code: "AUTH_MISSING", message: "需要平台 token" });
  const db = getDb();
  const row = db.prepare(`SELECT t.*, u.role FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?`).get(sha256Hex(m[1].trim()));
  if (!row || row.revoked_at || (row.expires_at && row.expires_at < nowIso())) {
    return res.status(401).json({ ok: false, code: "AUTH_INVALID", message: "平台 token 无效或已过期" });
  }
  db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?").run(nowIso(), row.token_hash);
  req.user = { id: row.user_id, role: row.role, scopes: JSON.parse(row.scopes) };
  next();
}
