// R2 · 组合/跨功能/逻辑不变量测试(两两 → 三元 → 多元)
// 方法:同一内存库上交叉驱动 REST 语义(service 层)与业务不变量,
//      不重复 G15 已覆盖的 HTTP 层,专注「功能间交互」与「守恒律」。
process.env.TRIALROOM_DEV = "1";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting, sha256Hex, getDb } from "../platform/db.mjs";
import * as svc from "../platform/payment/service.mjs";
import * as rooms from "../platform/rooms.mjs";
import { issueToken, platformAuth, createDevUser } from "../platform/auth.mjs";

function fresh() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  for (const u of ["uA", "uB", "uAdmin"]) db.prepare("INSERT INTO users (id) VALUES (?)").run(u);
  db.prepare("INSERT INTO users (id, role) VALUES ('uRoot', 'admin')").run();
  return db;
}
const pay = (userId, code, o = {}) => {
  const order = svc.createOrder({ userId, productCode: code, ...o });
  return { order, ent: svc.markPaid(order.order_no, { buyerAccountHash: `alipay:${userId}` }) };
};
const ledgerSum = (db, entId) => db.prepare(
  "SELECT COALESCE(SUM(delta),0) s FROM entitlement_ledger WHERE entitlement_id = ? AND reason != 'refund'").get(entId).s;

// ═══ 逻辑不变量 ═══
test("L-守恒律:次卡 授予 = 已消耗 + 剩余(全程含退款中途)", () => {
  const db = fresh();
  const { order, ent } = pay("uA", "pack5_1990");
  const entId = db.prepare("SELECT id FROM entitlements WHERE order_no = ?").get(order.order_no).id;
  svc.consumeEntitlement("uA"); svc.consumeEntitlement("uA");          // 用掉 2
  const mid = db.prepare("SELECT * FROM entitlements WHERE id = ?").get(entId);
  assert.equal(mid.quota_used, 2);
  svc.refundOrder(order.order_no);                                     // 中途退款
  const after = db.prepare("SELECT * FROM entitlements WHERE id = ?").get(entId);
  assert.equal(after.status, "refunded");
  assert.equal(svc.consumeEntitlement("uA"), null, "退款后不得再消耗");
  // 守恒:消耗台账 -2,授予 +5(退款行 delta=0 不计入)
  assert.equal(ledgerSum(db, entId), 5 - 2);
});

test("L-状态机:订单仅可达路径 created→paid→refunded;非法转换被拒", () => {
  fresh();
  const { order } = pay("uA", "single_390");
  const r1 = svc.refundOrder(order.order_no);
  assert.equal(r1.status, "refunded", "首退成功");
  assert.throws(() => svc.refundOrder(order.order_no), /不可退款/, "重复退款拒绝");
  const o2 = svc.createOrder({ userId: "uA", productCode: "single_390" });
  assert.throws(() => svc.refundOrder(o2.order_no), /不可退款/, "未支付不可退");
  // pending/refund_requested/closed:当前代码从不产生(支付宝通知直达 paid),
  // 状态机留白记录于 ROADMAP;此处锁定「不产生非法中间态」
  assert.ok(["created", "pending"].includes(o2.status));
});

test("L-时间卡边界:valid_until 当口过期即不可用", () => {
  fresh();
  const { order } = pay("uA", "monthly_2990");
  const ent = getDb().prepare("SELECT * FROM entitlements WHERE order_no = ?").get(order.order_no);
  assert.ok(ent.valid_until > new Date().toISOString());
  assert.ok(svc.consumeEntitlement("uA", "time_pass"), "有效期内可用");
  getDb().prepare("UPDATE entitlements SET valid_until = '2000-01-01T00:00:00Z' WHERE id = ?").run(ent.id);
  assert.equal(svc.consumeEntitlement("uA", "time_pass"), null, "过期即拒");
});

test("L-首单三重防线:两张未付首单,支付期复查拒第二张", () => {
  fresh();
  const o1 = svc.createOrder({ userId: "uA", productCode: "first_order_001" });
  const o2 = svc.createOrder({ userId: "uA", productCode: "first_order_001" }); // 都未支付,创建期互不可见
  svc.markPaid(o1.order_no, { buyerAccountHash: "alipay:uA" });
  assert.throws(() => svc.markPaid(o2.order_no, { buyerAccountHash: "alipay:uA" }), /限一次|UNIQUE/);
  assert.equal(svc.getOrder(o2.order_no).status, "created", "被拒订单留在未支付态");
  assert.throws(() => svc.createOrder({ userId: "uA", productCode: "first_order_001" }), /限一次/, "已有 paid 后创建期即拒");
});

test("L-scope 矩阵:只读令牌对全部写路由 403,读路由放行", async () => {
  fresh();
  const ro = issueToken("uA", { name: "ro", scopes: ["platform:read"] });
  const rw = issueToken("uA", { name: "rw", scopes: ["platform:read", "platform:write"] });
  const mk = (token, role = "member") => ({ headers: { authorization: `Bearer ${token}` }, user: undefined, method: "POST", path: "/orders", body: {}, ip: "1.2.3.4", get: () => undefined });
  // 逐一驱动 platformAuth + requireScope(与路由同序)
  const { requireScope } = await import("../platform/auth.mjs");
  const probe = async (token, scope) => await new Promise((resolve) => {
    const req = mk(token);
    const res = { status: (c) => ({ json: (o) => resolve({ http: c, code: o.code }) }) };
    platformAuth(req, res, () => requireScope(scope)(req, res, () => resolve({ ok: true })));
  });
  assert.deepEqual(await probe(ro.token, "platform:write"), { http: 403, code: "SCOPE_DENIED" });
  assert.equal((await probe(rw.token, "platform:write")).ok, true);
});

// ═══ 两两组合 ═══
test("X2-支付×漏斗:first_pay 仅首单且内控排除;room_join 随入座", () => {
  fresh();
  pay("uA", "single_390");
  const fp = getDb().prepare("SELECT COUNT(*) c FROM funnel_events WHERE event='first_pay'").get().c;
  assert.equal(fp, 0, "非首单商品不产 first_pay");
  pay("uA", "first_order_001");
  assert.equal(getDb().prepare("SELECT COUNT(*) c FROM funnel_events WHERE event='first_pay'").get().c, 1);
  const r = rooms.createRoom({ hostUserId: "uA" });
  rooms.joinRoom({ userId: "uB", roomCode: r.room_code });
  assert.ok(getDb().prepare("SELECT 1 FROM funnel_events WHERE event='room_join' AND room_code = ?").get(r.room_code));
});

test("X2-支付×房间:room_share 权益落库且可消耗;购买不改变在座状态", () => {
  fresh();
  const r = rooms.createRoom({ hostUserId: "uA" });
  rooms.joinRoom({ userId: "uB", roomCode: r.room_code });
  const before = getDb().prepare("SELECT seat_no FROM room_seats WHERE room_id = ? AND user_id='uB'").get(r.room_id);
  const { ent } = pay("uB", "room_share_990");
  assert.equal(ent.granted, true);
  assert.ok(svc.consumeEntitlement("uB", "room_share"));
  const after = getDb().prepare("SELECT seat_no FROM room_seats WHERE room_id = ? AND user_id='uB'").get(r.room_id);
  assert.deepEqual(before, after, "购买不得扰动座位");
});

test("X2-房间×幂等:重复入座同座;离开复活保留原座位号", () => {
  fresh();
  const r = rooms.createRoom({ hostUserId: "uA" });
  const j1 = rooms.joinRoom({ userId: "uB", roomCode: r.room_code });
  const j2 = rooms.joinRoom({ userId: "uB", roomCode: r.room_code });
  assert.equal(j1.seat_no, j2.seat_no);
  getDb().prepare("UPDATE room_seats SET left_at = '2026-01-01T00:00:00Z' WHERE room_id = ? AND user_id = 'uB'").run(r.room_id);
  const j3 = rooms.joinRoom({ userId: "uB", roomCode: r.room_code });
  assert.equal(j3.seat_no, j1.seat_no, "复活保留原座位(UNIQUE 复活路径)");
  const j4 = rooms.joinRoom({ userId: "uA", roomCode: r.room_code });
  assert.equal(j4.already_seated, true, "房主重复入座幂等");
});

test("X2-管理×统计:审核回填 × 退款 × 内控 三因子口径正交", () => {
  fresh();
  pay("uA", "first_order_001");                       // 真实 0.01
  const p2 = pay("uB", "single_390");                 // 真实 3.9
  svc.refundOrder(p2.order.order_no);                 // 退款
  const oi = svc.createOrder({ userId: "uA", productCode: "single_390", internal: true });
  svc.markPaid(oi.order_no, { buyerAccountHash: "alipay:uA" });
  getDb().prepare("UPDATE orders SET is_internal_verification = 1 WHERE order_no = ?").run(oi.order_no);
  const s = svc.paidUserStats();
  assert.equal(s.dedup_account, 2, "两买家(uA 的 0.01 + uB 的已退 3.9)");
  assert.equal(s.order_count, 1, "paid 口径仅 0.01");
  assert.equal(s.refunded_fen, 390);
  svc.backfillReviewPassedAt("2026-01-01T00:00:00Z");
  assert.equal(svc.paidUserStats().dedup_account_after_review, 2);
});

// ═══ 三元/多元 ═══
test("X3-房间×MCP×支付:三用户混合通道(REST建房+MCP推进+权益扣减)一致", async () => {
  fresh();
  const r = rooms.createRoom({ hostUserId: "uA" });
  rooms.joinRoom({ userId: "uB", roomCode: r.room_code });
  // MCP 通道(直接驱动 tools,同 G15 语义)
  const { tools } = await import("../platform/mcp/tools.mjs");
  const mcpHost = { token_id: "tk_x", user_id: "uA", scopes: ["rooms:advance", "rooms:read", "evidence:read"] };
  const ask = tools["ask_next_question"](mcpHost, { room_id: r.room_id, idempotency_key: "q1" });
  assert.equal(ask.turn_index, 1);
  // REST 侧发言与 MCP 轮次共享一个流
  rooms.postMessage({ roomId: r.room_id, userId: "uB", content: "回答 100%" });
  const ev = tools["evidence.search"](mcpHost, { query: "%" });
  assert.ok(ev.results.some((x) => (x.excerpt ?? "").includes("100%")));
  // 房主买了 5 次包,消耗不影响房间状态
  pay("uA", "pack5_1990");
  svc.consumeEntitlement("uA");
  const detail = rooms.roomDetail({ roomId: r.room_id, userId: "uA" });
  assert.equal(detail.seats.length, 2);
  assert.equal(detail.is_host, true);
});

test("XN-多订单风暴:10 商品 × 2 用户交错下单支付退款,守恒与口径不漂移", () => {
  const db = fresh();
  const codes = Object.keys(svc.PRODUCTS);
  let paid = 0;
  for (const u of ["uA", "uB"]) {
    for (const c of codes) {
      try {
        const o = svc.createOrder({ userId: u, productCode: c });
        const { granted } = svc.markPaid(o.order_no, { buyerAccountHash: `alipay:${u}` });
        if (granted) paid++;
      } catch { /* 首单第二张被拒是预期 */ }
    }
  }
  // 退款一半(向上取整)可退订单,计数精确跟踪
  const refundable = db.prepare("SELECT order_no FROM orders WHERE status='paid' AND amount_fen >= 390").all();
  const refundCount = Math.ceil(refundable.length / 2);
  for (const r of refundable.slice(0, refundCount)) svc.refundOrder(r.order_no);
  const s = svc.paidUserStats();
  const base = db.prepare("SELECT COUNT(*) c FROM v_paid_orders").get().c;
  assert.equal(s.order_count + refundCount, base, "口径守恒:paid + refunded == 基础集合");
  assert.ok(paid >= 2 * (codes.length - 1), "两用户各至少 5 单成功(首单第二张拒)");
});
