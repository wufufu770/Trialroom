-- 001_platform_schema.sql —— Trialroom 平台层schema(重建版)
-- 依据:docs/spec/11-final-plan.md §三(3.4/3.5/3.10)、§五(5.3/5.7)
-- 原则:
--   * 平台数据独立于基座 interviewx.db,落 trialroom.db(隔离,不动基座表)
--   * orders 冗余采集全部待确认口径的字段(OPEN_QUESTIONS.md 的对冲设计)
--   * entitlements 是权益唯一真相源;orders 只表达交易
--   * room_id 是 capability(≥128bit),room_code 只是入座凭证,两者分离
--   * 所有 JSON 列由应用层校验,SQLite 只存 TEXT

PRAGMA foreign_keys = ON;

-- ── 1. users ──────────────────────────────────────────────────────────────
-- 平台用户。A 期无密码登录:identity 以支付宝买家标识/平台 token 锚定。
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                    -- u_<22位随机>
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('member','admin')),
  alipay_user_hash TEXT UNIQUE,                      -- 支付宝买家账号哈希(A1 口径)
  realname_digest   TEXT,                            -- 实名主体摘要(A1 口径)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── 2. api_tokens ─────────────────────────────────────────────────────────
-- 平台 Web/API 会话令牌(SHA-256 哈希落库,与 mcp_tokens 是两个 token class)。
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash    TEXT PRIMARY KEY,                    -- hex(sha256(token))
  user_id       TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL DEFAULT 'default',
  scopes        TEXT NOT NULL DEFAULT '["platform:read","platform:write"]',
  expires_at    TEXT,
  revoked_at    TEXT,
  revoke_reason TEXT,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id, expires_at);

-- ── 3. rooms ──────────────────────────────────────────────────────────────
-- 面试房间。room_id 是 capability:rm_ + 22 位随机(≥128bit,方案 §3.4.3)。
CREATE TABLE IF NOT EXISTS rooms (
  room_id       TEXT PRIMARY KEY
                CHECK (room_id GLOB 'rm_[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]'),
  room_code     TEXT NOT NULL UNIQUE
                CHECK (length(room_code) = 6),       -- 仅入座凭证,10^6 空间,限流保护
  host_user_id  TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','running','closed')),
  industry      TEXT,
  position      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms(host_user_id, status);

-- ── 4. room_seats ─────────────────────────────────────────────────────────
-- 座位。推进权判 seat(is_host),不判 scope(方案 §3.4.3 第 ③ 层)。
CREATE TABLE IF NOT EXISTS room_seats (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(room_id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  seat_no       INTEGER NOT NULL,
  is_host       INTEGER NOT NULL DEFAULT 0 CHECK (is_host IN (0,1)),
  joined_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  left_at       TEXT,
  UNIQUE (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_seats_room ON room_seats(room_id, seat_no);

-- ── 5. room_messages ──────────────────────────────────────────────────────
-- 房间消息流(证据区数据源之一;内容上限 8KB,应用层截断)。
CREATE TABLE IF NOT EXISTS room_messages (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(room_id),
  seat_id       TEXT NOT NULL REFERENCES room_seats(id),
  turn_index    INTEGER NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('interviewer','candidate','system')),
  content       TEXT NOT NULL CHECK (length(content) <= 8192),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages(room_id, turn_index);

-- ── 6. self_reviews ───────────────────────────────────────────────────────
-- 候选人自评(MCP submit_self_review 的落点)。
-- 幂等:UNIQUE(room_id, turn_index, seat_id) + ON CONFLICT(方案 §3.3.2)。
CREATE TABLE IF NOT EXISTS self_reviews (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(room_id),
  seat_id       TEXT NOT NULL REFERENCES room_seats(id),
  turn_index    INTEGER NOT NULL,
  content       TEXT NOT NULL CHECK (length(content) <= 8192),
  visibility    TEXT NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private','shared')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (room_id, turn_index, seat_id) ON CONFLICT REPLACE
);

-- ── 7. interview_attempts ─────────────────────────────────────────────────
-- 一次完整面试尝试(计费/达标判定的主体)。qualification 存三条件结果 JSON。
CREATE TABLE IF NOT EXISTS interview_attempts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  room_id       TEXT REFERENCES rooms(room_id),
  session_ref   TEXT,                                 -- 基座 sessions.id(只引用,不复制)
  position      TEXT,
  difficulty    TEXT CHECK (difficulty IN ('easy','normal','hard','extreme','hell')),
  qualification TEXT,                                 -- JSON:{cond1,cond2,cond3,passed}
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON interview_attempts(user_id, started_at);

-- ── 8. orders ─────────────────────────────────────────────────────────────
-- 订单(交易事实)。冗余采集全部待官方确认口径的字段 —— 官方回复后只切报表口径。
-- amount_fen 单位:分。支付宝 total_amount 物理范围 [0.01, 100000000] 元 → [1, 10^10] 分。
CREATE TABLE IF NOT EXISTS orders (
  order_no      TEXT PRIMARY KEY,                     -- 平台单号 = 支付宝 out_trade_no
  user_id       TEXT NOT NULL REFERENCES users(id),
  product_code  TEXT NOT NULL,                        -- first_order_001 | single_390 | pack5_1990 | ...
  product_name  TEXT NOT NULL DEFAULT '',
  amount_fen    INTEGER NOT NULL CHECK (amount_fen >= 1 AND amount_fen <= 10000000000),
  status        TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN ('created','pending','paid','refund_requested','refunded','closed')),
  provider      TEXT NOT NULL DEFAULT 'mock'
                CHECK (provider IN ('alipay_web','mock')),
  source        TEXT NOT NULL DEFAULT 'self_built'
                CHECK (source IN ('self_built','suite')),   -- B3 双轨口径
  idempotency_key TEXT UNIQUE,                        -- 合成键 principal+operation+client_key
  -- ── 口径冗余采集(OPEN_QUESTIONS.md) ──
  buyer_account_hash TEXT,                            -- A1 账号键
  buyer_realname_digest TEXT,                         -- A1 实名键
  is_internal_verification INTEGER NOT NULL DEFAULT 0 -- 内控:团队自测单标记(报表排除)
                CHECK (is_internal_verification IN (0,1)),
  review_passed_at   TEXT,                            -- A4 前置口径(作品级回填)
  -- ── 支付宝侧 ──
  trade_no      TEXT,                                 -- 支付宝交易号
  paid_at       TEXT,
  refund_state  TEXT CHECK (refund_state IS NULL OR refund_state IN ('requested','done','rejected')),
  refunded_at   TEXT,
  refund_amount_fen INTEGER CHECK (refund_amount_fen IS NULL OR refund_amount_fen >= 0),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);

-- ── 9. order_events ───────────────────────────────────────────────────────
-- 订单事件流(证据链:orders → order_events → entitlements)。
CREATE TABLE IF NOT EXISTS order_events (
  id            TEXT PRIMARY KEY,
  order_no      TEXT NOT NULL REFERENCES orders(order_no),
  event         TEXT NOT NULL
                CHECK (event IN ('created','pay_pending','paid','refund_requested','refunded','closed','internal_verify')),
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_no, created_at);

-- ── 10. payment_notifications ─────────────────────────────────────────────
-- 支付异步通知原文落库(验签前后都留档,争议时回放)。
CREATE TABLE IF NOT EXISTS payment_notifications (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  notify_type   TEXT NOT NULL DEFAULT 'trade_status_sync',
  raw_body      TEXT NOT NULL,
  verify_ok     INTEGER NOT NULL DEFAULT 0 CHECK (verify_ok IN (0,1)),
  parsed        TEXT,                                 -- 验签后的字段 JSON
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── 11. entitlements ──────────────────────────────────────────────────────
-- 权益(唯一真相源)。订单支付成功后授予;退款即作废。
CREATE TABLE IF NOT EXISTS entitlements (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  order_no      TEXT NOT NULL REFERENCES orders(order_no),
  kind          TEXT NOT NULL
                CHECK (kind IN ('attempt_pack','time_pass','room_share')),
  quota_total   INTEGER NOT NULL DEFAULT 1,           -- 次数型总额度
  quota_used    INTEGER NOT NULL DEFAULT 0,
  valid_from    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  valid_until   TEXT,                                 -- 时间型有效期(时间卡)
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','exhausted','expired','refunded')),
  granted_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id, status);

-- ── 12. entitlement_ledger ────────────────────────────────────────────────
-- 权益流水(每次授予/消耗/退回一行,可审计)。
CREATE TABLE IF NOT EXISTS entitlement_ledger (
  id              TEXT PRIMARY KEY,
  entitlement_id  TEXT NOT NULL REFERENCES entitlements(id),
  delta           INTEGER NOT NULL,                   -- +1 授予/退回,-1 消耗
  reason          TEXT NOT NULL
                  CHECK (reason IN ('grant','consume','refund','expire')),
  ref             TEXT,                               -- 关联 attempt/room
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ent_ledger ON entitlement_ledger(entitlement_id, created_at);

-- ── 13. idempotency_keys ──────────────────────────────────────────────────
-- 幂等占位表(方案 §3.10:原子占位 → 执行 → 写结果;保留期按次计费 ≥24h)。
-- 复合键格式:mcp:<user_id>:<operation>:<client_key> —— UNIQUE 即作用域隔离,
-- 修复原 idx_orders_idempotency 全局唯一与 MCP 作用域的冲突(CF-10/决策 #40)。
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT PRIMARY KEY,
  principal     TEXT NOT NULL,                        -- user_id
  operation     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'reserved'
                CHECK (status IN ('reserved','done','failed')),
  response      TEXT,                                 -- done 后的结果 JSON(重放用)
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── 14. funnel_events ─────────────────────────────────────────────────────
-- 漏斗埋点(方案 §5.7 六事件 + 房间两事件)。
CREATE TABLE IF NOT EXISTS funnel_events (
  id            TEXT PRIMARY KEY,
  event         TEXT NOT NULL
                CHECK (event IN ('landing_uv','practice_start','practice_complete','review_view','first_redo','first_pay','room_join','room_paid_by_invitee')),
  user_hash     TEXT,                                 -- 匿名口径,不落 PII
  session_ticket TEXT,                                -- 落地页→练习的会话票据
  room_code     TEXT,
  props         TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_funnel_event ON funnel_events(event, created_at);

-- ── 15. review_pass_log ───────────────────────────────────────────────────
-- 作品审核通过时间(A4 口径的锚点;提交→审核通过→计数窗口起算)。
CREATE TABLE IF NOT EXISTS review_pass_log (
  id              TEXT PRIMARY KEY,
  work_slug       TEXT NOT NULL UNIQUE,               -- 例:trialroom
  submitted_at    TEXT,
  review_passed_at TEXT,
  note            TEXT NOT NULL DEFAULT ''
);
