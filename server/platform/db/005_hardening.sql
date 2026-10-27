-- 005_hardening.sql —— 对抗性审查(2026-10-27 四席)后的约束加固
-- 依据:支付席 P0-1(首单限一次只在下单检查)/ MCP席 P1-4(轮次重复)/
--       数据席 F5(统计视图退款口径死列)

-- 1. 首单限一次的原子保证:同用户同商品只允许一张 paid 首单
--    (markPaid 的 UPDATE 也受此索引约束 —— TOCTOU 与"未支付多单顺序结清"一并封死)
CREATE UNIQUE INDEX IF NOT EXISTS idx_first_order_paid
  ON orders(user_id) WHERE product_code = 'first_order_001' AND status = 'paid';

-- 2. 轮次唯一:同房同轮只允许一条消息(多进程部署/崩溃残留 reserved 键时的兜底)
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_messages_turn
  ON room_messages(room_id, turn_index);

-- 3. 座位号唯一:并发入座不得重号
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_seats_no
  ON room_seats(room_id, seat_no);

-- 4. 统计视图重写:基础集合纳入退款单(否则 refunded_fen 恒 0、excl_refund 列恒等死列)
DROP VIEW IF EXISTS v_paid_orders;
CREATE VIEW v_paid_orders AS
SELECT * FROM orders
WHERE status IN ('paid', 'refunded') AND is_internal_verification = 0;

DROP VIEW IF EXISTS v_paid_user_stats;
CREATE VIEW v_paid_user_stats AS
SELECT
  COUNT(DISTINCT COALESCE(buyer_account_hash, 'u:' || user_id))                            AS dedup_account,
  COUNT(DISTINCT COALESCE(buyer_realname_digest, buyer_account_hash, 'u:' || user_id))     AS dedup_realname,
  COUNT(DISTINCT user_id)                                                                  AS dedup_user,
  COUNT(DISTINCT CASE WHEN amount_fen > 1
        THEN COALESCE(buyer_account_hash, 'u:' || user_id) END)                            AS dedup_account_excl_001,
  COUNT(DISTINCT CASE WHEN status = 'paid'
        THEN COALESCE(buyer_account_hash, 'u:' || user_id) END)                            AS dedup_account_excl_refund,
  COUNT(DISTINCT CASE WHEN review_passed_at IS NOT NULL AND paid_at >= review_passed_at
        THEN COALESCE(buyer_account_hash, 'u:' || user_id) END)                            AS dedup_account_after_review,
  COUNT(*) FILTER (WHERE status = 'paid')                                                  AS order_count,
  SUM(CASE WHEN status = 'paid' THEN amount_fen ELSE 0 END)                                AS gross_fen,
  SUM(COALESCE(refund_amount_fen, 0))                                                      AS refunded_fen
FROM v_paid_orders;
