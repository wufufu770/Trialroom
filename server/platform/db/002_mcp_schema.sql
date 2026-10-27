-- 002_mcp_schema.sql —— MCP 暴露面 schema(重建版)
-- 依据:docs/spec/11-final-plan.md §3.5(mcp_tokens DDL 草案)
-- 纪律:token class 物理分表(与 api_tokens 隔离,X-1 令牌混淆防护);
--       只存 SHA-256 哈希,永不存明文;aud 默认独立于 Web 域。

-- ── mcp_tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_id      TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,                 -- hex(sha256(plaintext))
  user_id       TEXT NOT NULL REFERENCES users(id),
  client_id     TEXT NOT NULL DEFAULT '',             -- 绑定的外部 agent 客户端
  scopes        TEXT NOT NULL DEFAULT '[]',           -- JSON 数组,冻结五档
  aud           TEXT NOT NULL DEFAULT 'https://trialroom.example/mcp',
  expires_at    TEXT,
  revoked_at    TEXT,
  revoke_reason TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_client ON mcp_tokens(client_id);

-- ── mcp_audit ─────────────────────────────────────────────────────────────
-- MCP 审计:deny 与 allow 同权落档(方案 §3.5.2)。
CREATE TABLE IF NOT EXISTS mcp_audit (
  id            TEXT PRIMARY KEY,
  token_id      TEXT,                                 -- NULL = 未通过鉴权的尝试
  decision      TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  deny_reason   TEXT,                                 -- AUTH_MISSING/AUTH_INVALID/EXPIRED/REVOKED/AUD_MISMATCH/SCOPE_DENIED/NOT_FOUND/HEADER_MISMATCH/META_REJECTED/ORIGIN_DENIED
  method        TEXT,                                 -- JSON-RPC method
  tool_name     TEXT,
  principal     TEXT,                                 -- user_id(鉴权通过后)
  ip            TEXT,
  latency_ms    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_token ON mcp_audit(token_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_decision ON mcp_audit(decision, created_at);

-- ── mcp_request_state_nonces ──────────────────────────────────────────────
-- B 期预留(MRTR/input_required 续跑态;A 期无工具返回 input_required,表先建,
-- 收到相关能力调用一律 -32601,方案 §3.7.4)。nonce 一次性消费。
CREATE TABLE IF NOT EXISTS mcp_request_state_nonces (
  nonce         TEXT PRIMARY KEY,
  state_blob    TEXT NOT NULL,                        -- HMAC 保护的状态密文
  consumed_at   TEXT,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
