// 对账补偿(P1#5):notify 可能丢失(支付宝重试有限),主动查单兜底。
// 策略:每 5 分钟扫 created/pending 超过 15 分钟的真实单,alipay.trade.query:
//   TRADE_SUCCESS/TRADE_FINISHED → 补落账(证据链记 reconcile 来源);
//   TRADE_CLOSED → 本地 closed;其余(等待中)留观。
import { getDb, nowIso } from "../db.mjs";
import { queryTrade, isConfigured } from "./alipay.mjs";
import { markPaid, recordNotification, getOrder, pruneOldNotifications } from "./service.mjs";

export async function runReconciliation({ olderThanMin = 15, limit = 50 } = {}) {
  const prunedNotifications = pruneOldNotifications(); // 开头先清理过期通知原文(R5)
  if (!isConfigured()) return { skipped: true, reason: "未配置支付宝,跳过(mock 轨无对账对象)" };
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMin * 60_000).toISOString();
  const pending = db.prepare(`SELECT order_no FROM orders
    WHERE provider = 'alipay_web' AND status IN ('created','pending') AND created_at < ?
    ORDER BY created_at ASC LIMIT ?`).all(cutoff, limit);
  const result = { compensated: 0, closed: 0, kept: 0, errors: 0 };
  for (const { order_no } of pending) {
    try {
      const t = await queryTrade(order_no);
      recordNotification({ provider: "alipay_web", rawBody: JSON.stringify({ reconcile: true, ...t }), verifyOk: true, parsed: { ...t, source: "reconcile" } });
      if (t.trade_status === "TRADE_SUCCESS" || t.trade_status === "TRADE_FINISHED") {
        markPaid(order_no, { tradeNo: t.trade_no, buyerAccountHash: t.buyer_user_id ? `alipay:${t.buyer_user_id}` : null });
        result.compensated++;
      } else if (t.trade_status === "TRADE_CLOSED") {
        db.prepare("UPDATE orders SET status = 'closed' WHERE order_no = ? AND status IN ('created','pending')").run(order_no);
        result.closed++;
      } else {
        result.kept++;
      }
    } catch (e) {
      result.errors++;
      if (result.errors <= 3) console.warn(`[reconcile] ${order_no}: ${e.message}`);
    }
  }
  result.scanned = pending.length;
  result.pruned_notifications = prunedNotifications;
  return result;
}

// 单飞标志(R3):上一轮对账未跑完则跳过本轮,防慢网关下定时器堆叠重入
let reconcileRunning = false;

/** 供 mountPlatform 定时调度(仅在配钥态)。 */
export function scheduleReconciliation(intervalMs = 5 * 60_000) {
  if (!isConfigured()) return null;
  const timer = setInterval(async () => {
    if (reconcileRunning) return;
    reconcileRunning = true;
    try { const r = await runReconciliation(); if (r.scanned > 0) console.log("[reconcile]", JSON.stringify(r)); }
    catch (e) { console.warn("[reconcile] fatal:", e.message); }
    finally { reconcileRunning = false; }
  }, intervalMs);
  timer.unref();
  return timer;
}
void nowIso; void getOrder;
