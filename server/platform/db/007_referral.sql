-- 007_referral.sql —— 邀请返利(商业化包):orders 记录被邀请人所带的邀请人
-- 规则(§商业化 #1):
--   * 下单时可携带 invited_by(邀请人 user_id;下单路由校验存在性且不得是自己)
--   * 被邀请人【首笔】paid 订单 → 邀请人获 1 次 attempt_pack(同一被邀请人只奖一次)
--   * 被邀请人退款不追回已发返利(单向礼让:返利与被邀请单后续状态解耦,防"退款夺回"套利)
-- 幂等:platform_migrations 表防重放,直接 ADD COLUMN 即可(SQLite 不支持 IF NOT EXISTS 列)。
ALTER TABLE orders ADD COLUMN invited_by TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_invited_by ON orders(invited_by);
