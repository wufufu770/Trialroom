-- 006_view_null_fix.sql —— 全链路 E2E(L2-09)发现的缺陷修复
-- 问题:v_paid_user_stats 的 SUM 在空集合上返回 NULL 而非 0
-- (gross_fen/refunded_fen 为 null,任何把它当数字的消费方会崩)。
-- 修复:聚合全部 COALESCE 到 0;同时给出 paid_order_count 的显式命名别名。

DROP VIEW IF EXISTS v_paid_user_stats;
CREATE VIEW v_paid_user_stats AS
SELECT
  COUNT(DISTINCT COALESCE(buyer_account_hash, 'u:' || user_id))                        AS dedup_account,
  COUNT(DISTINCT COALESCE(buyer_realname_digest, buyer_account_hash, 'u:' || user_id)) AS dedup_realname,
  COUNT(DISTINCT user_id)                                                              AS dedup_user,
  COUNT(DISTINCT CASE WHEN amount_fen > 1
        THEN COALESCE(buyer_account_hash, 'u:' || user_id) END)                        AS dedup_account_excl_001,
  COUNT(DISTINCT CASE WHEN status = 'paid'
        THEN COALESCE(buyer_account_hash, 'u:' || user_id) END)                        AS dedup_account_excl_refund,
  COUNT(DISTINCT CASE WHEN review_passed_at IS NOT NULL AND paid_at >= review_passed_at
        THEN COALESCE(buyer_account_hash, 'u:' || user_id) END)                        AS dedup_account_after_review,
  COUNT(*) FILTER (WHERE status = 'paid')                                              AS order_count,
  COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_fen ELSE 0 END), 0)               AS gross_fen,
  COALESCE(SUM(COALESCE(refund_amount_fen, 0)), 0)                                     AS refunded_fen
FROM v_paid_orders;
