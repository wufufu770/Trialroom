-- 003_payment_views.sql —— 多口径统计视图(冗余对冲的读出端)
-- 依据:docs/official/OPEN_QUESTIONS.md;方案 §5.3(v_paid_user_stats)
-- 原则:WHERE 条件即口径声明。官方口径未定 → 全部口径并列输出,
--       官方回复到达后参评材料选对应列,数据层零改动。

-- 有效支付订单基础视图:排除内控自测单;0.01 是否计入由外层列切分。
CREATE VIEW IF NOT EXISTS v_paid_orders AS
SELECT * FROM orders
WHERE status = 'paid' AND is_internal_verification = 0;

-- 全口径并列的去重付费用户统计(官方回复前后的唯一差异 = 选哪一列)。
--   dedup_account        :按买家账号哈希去重(A1 账号键)
--   dedup_realname       :按实名摘要去重(A1 实名键;空摘要并入账号键)
--   dedup_user           :按平台 user_id 去重(最宽松,下限参考)
--   incl_001 / excl_001  :含/不含 ¥0.01 首单(A2)
--   excl_refund          :剔除已退款(A3 扣减口径)
--   after_review_pass    :仅计作品审核通过后的交易(A4 前置口径)
CREATE VIEW IF NOT EXISTS v_paid_user_stats AS
SELECT
  COUNT(DISTINCT buyer_account_hash)                            AS dedup_account,
  COUNT(DISTINCT COALESCE(buyer_realname_digest, buyer_account_hash)) AS dedup_realname,
  COUNT(DISTINCT user_id)                                       AS dedup_user,
  COUNT(DISTINCT CASE WHEN amount_fen > 1  THEN buyer_account_hash END) AS dedup_account_excl_001,
  COUNT(DISTINCT CASE WHEN refund_state IS NULL OR refund_state != 'done'
                      THEN buyer_account_hash END)              AS dedup_account_excl_refund,
  COUNT(DISTINCT CASE WHEN review_passed_at IS NOT NULL
                        AND paid_at >= review_passed_at
                      THEN buyer_account_hash END)              AS dedup_account_after_review,
  COUNT(*)                                                      AS order_count,
  SUM(amount_fen)                                               AS gross_fen,
  SUM(COALESCE(refund_amount_fen, 0))                           AS refunded_fen
FROM v_paid_orders;
