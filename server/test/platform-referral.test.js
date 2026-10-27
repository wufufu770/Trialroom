// 商业化包 · 邀请返利 + MCP 令牌自助 + 权益提醒(#1/#3/#7)测试
// 覆盖:自邀拒绝 / 幽灵邀请人拒绝 / 返利原子性与不重复发放 /
//       被邀请人退款不追回(设计意图:返利单向礼让,防"退款夺回"套利 —— refundOrder
//       有意不触碰 referral 权益,本文件用例锁定该行为)/ scopes 冻结五档子集校验 / 吊销越权 404
process.env.TRIALROOM_DEV = "1";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting, getDb } from "../platform/db.mjs";
import { mountPlatform } from "../platform/index.mjs";
import { startAttempt } from "../platform/attempts.mjs";
import { refundOrder } from "../platform/payment/service.mjs";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
applyMigrations(db);
setDbForTesting(db);

const app = express();
app.use(express.json());
mountPlatform(app);
let srv, base;
before(async () => { srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`; });
after(() => srv.close());

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const { createDevUser } = await import("../platform/auth.mjs");

// 下单并走 mock 轨结清(未配钥态;markPaid 在此链路内触发返利判定)
async function buyPaid(token, productCode, invitedBy = undefined) {
  const o = await call("POST", "/api/platform/orders", { token, body: { product_code: productCode, invited_by: invitedBy } });
  assert.equal(o.status, 200, `下单失败:${JSON.stringify(o.json)}`);
  const pay = await call("POST", `/api/platform/orders/${o.json.order_no}/mock-pay`, { token });
  assert.equal(pay.status, 200, `结清失败:${JSON.stringify(pay.json)}`);
  return o.json.order_no;
}
const referralGrants = (inviterId) => getDb().prepare(`SELECT l.*, e.user_id AS holder FROM entitlement_ledger l
  JOIN entitlements e ON e.id = l.entitlement_id
  WHERE e.kind = 'attempt_pack' AND l.reason = 'grant' AND l.ref LIKE 'referral:%' AND e.user_id = ?`).all(inviterId);

// ── #1 邀请返利:下单校验 ──────────────────────────────────────────────────
test("自邀拒绝:invited_by = 自己 → 409;不存在邀请人 → 400", async () => {
  const u = createDevUser("selfer");
  const self = await call("POST", "/api/platform/orders", { token: u.token, body: { product_code: "single_390", invited_by: u.user_id } });
  assert.equal(self.status, 409);
  const ghost = await call("POST", "/api/platform/orders", { token: u.token, body: { product_code: "single_390", invited_by: "u_ghost_not_exist" } });
  assert.equal(ghost.status, 400);
  assert.ok(referralGrants(u.user_id).length === 0, "拒绝路径不得留下任何返利痕迹");
});

// ── #1 邀请返利:原子授予 + 不重复 ────────────────────────────────────────
test("返利:被邀请人首笔 paid → 邀请人 +1 attempt_pack 且 ledger 有 referral 记录;第二笔不重复发", async () => {
  const inviter = createDevUser("inviter");
  const invitee = createDevUser("invitee");

  const orderNo = await buyPaid(invitee.token, "single_390", inviter.user_id);
  const grants = referralGrants(inviter.user_id);
  assert.equal(grants.length, 1, "首笔 paid 恰好授予一次");
  assert.equal(grants[0].delta, 1);
  assert.equal(grants[0].ref, `referral:${orderNo}`, "ledger ref 关联本单");

  // 权益本体:邀请人名下 1 次 attempt_pack、未消耗
  const ent = getDb().prepare(`SELECT * FROM entitlements WHERE user_id = ? AND kind='attempt_pack'`).all(inviter.user_id);
  assert.equal(ent.length, 1);
  assert.equal(ent[0].quota_total, 1);
  assert.equal(ent[0].order_no, orderNo, "权益 order_no 关联被邀请人的本单");

  // 同一被邀请人第二笔 paid:不重复发放
  await buyPaid(invitee.token, "single_390", inviter.user_id);
  assert.equal(referralGrants(inviter.user_id).length, 1, "第二笔 paid 不得重复发奖");

  // 换一个新被邀请人:再奖一次(每被邀请人各一次)
  const invitee2 = createDevUser("invitee2");
  await buyPaid(invitee2.token, "single_390", inviter.user_id);
  assert.equal(referralGrants(inviter.user_id).length, 2);
});

test("非首笔不奖励:被邀请人先有一笔无邀请的 paid,带 invited_by 的后续单不发奖", async () => {
  const inviter = createDevUser("inviter-b");
  const invitee = createDevUser("invitee-b");
  await buyPaid(invitee.token, "single_390"); // 第一笔:不带邀请
  await buyPaid(invitee.token, "single_390", inviter.user_id); // 第二笔才带 → 非首笔
  assert.equal(referralGrants(inviter.user_id).length, 0);
});

test("退款不追回:被邀请人退款后,邀请人已获返利保持 active(单向礼让,有意设计)", async () => {
  const inviter = createDevUser("inviter-c");
  const invitee = createDevUser("invitee-c");
  const orderNo = await buyPaid(invitee.token, "single_390", inviter.user_id);
  assert.equal(referralGrants(inviter.user_id).length, 1);
  // 平台层退款无对外 REST(仅服务层 + 对账),此处直接走服务语义
  refundOrder(orderNo);
  const ent = getDb().prepare(`SELECT status FROM entitlements WHERE user_id = ? AND order_no = ?`)
    .get(inviter.user_id, orderNo);
  assert.equal(ent.status, "active", "邀请人的返利权益不随被邀请人退款作废(不追回)");
});

// ── #3 MCP 令牌自助 ───────────────────────────────────────────────────────
test("MCP 令牌:冻结五档子集可签发(明文只回一次,库中只有哈希);空数组与 platform:admin 拒绝", async () => {
  const u = createDevUser("mcp-owner");
  const bad1 = await call("POST", "/api/platform/mcp-tokens", { token: u.token, body: { name: "x", scopes: [] } });
  assert.equal(bad1.status, 400, "空数组拒绝");
  const bad2 = await call("POST", "/api/platform/mcp-tokens", { token: u.token, body: { name: "x", scopes: ["platform:admin"] } });
  assert.equal(bad2.status, 400, "平台档位不属于 MCP 冻结五档,拒绝");
  const bad3 = await call("POST", "/api/platform/mcp-tokens", { token: u.token, body: { name: "x", scopes: ["rooms:read", "nonsense:scope"] } });
  assert.equal(bad3.status, 400);

  const ok = await call("POST", "/api/platform/mcp-tokens", {
    token: u.token, body: { name: "my-agent", scopes: ["rooms:read", "rooms:join", "rooms:read"] },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token.startsWith("mt_"));
  assert.deepEqual(ok.json.scopes, ["rooms:read", "rooms:join"], "重复档位去重");
  const row = getDb().prepare("SELECT * FROM mcp_tokens WHERE token_id = ?").get(ok.json.token_id);
  assert.notEqual(row.token_hash, ok.json.token, "明文不得落库");
  assert.equal(row.client_id, "my-agent");

  const list = await call("GET", "/api/platform/mcp-tokens", { token: u.token });
  assert.equal(list.status, 200);
  const one = list.json.tokens.find((t) => t.token_id === ok.json.token_id);
  assert.equal(one.name, "my-agent");
  assert.equal(one.revoked_at, null);
  assert.ok(!JSON.stringify(list.json).includes(ok.json.token), "列表永不回明文");
  assert.ok(!JSON.stringify(list.json).includes(row.token_hash), "列表不回哈希");
});

test("MCP 令牌吊销:本人可吊销;越权与不存在同响应 404;重复吊销幂等", async () => {
  const owner = createDevUser("revoke-owner");
  const stranger = createDevUser("revoke-stranger");
  const t1 = await call("POST", "/api/platform/mcp-tokens", { token: owner.token, body: { name: "a", scopes: ["evidence:read"] } });
  // 越权:陌生人吊销他人 token → 404(不泄露存在性)
  const forbidden = await call("POST", `/api/platform/mcp-tokens/${t1.json.token_id}/revoke`, { token: stranger.token });
  assert.equal(forbidden.status, 404);
  // 不存在的 token 也 404,同响应
  const missing = await call("POST", "/api/platform/mcp-tokens/mcp_does_not_exist/revoke", { token: owner.token });
  assert.equal(missing.status, 404);
  assert.equal(forbidden.json.message, missing.json.message, "越权与不存在同文案");
  // 本人吊销 → 成功;重复吊销幂等
  const mine = await call("POST", `/api/platform/mcp-tokens/${t1.json.token_id}/revoke`, { token: owner.token });
  assert.equal(mine.status, 200);
  const again = await call("POST", `/api/platform/mcp-tokens/${t1.json.token_id}/revoke`, { token: owner.token });
  assert.equal(again.status, 200);
  assert.equal(again.json.already, true);
  assert.equal(getDb().prepare("SELECT revoked_at FROM mcp_tokens WHERE token_id = ?").get(t1.json.token_id).revoked_at != null, true);
});

// ── #7 权益提醒:quota 端点 ────────────────────────────────────────────────
test("GET /attempts/quota:次卡余量求和 + 时间卡最近到期", async () => {
  const u = createDevUser("quota-user");
  let quota = await call("GET", "/api/platform/attempts/quota", { token: u.token });
  assert.equal(quota.status, 200);
  assert.equal(quota.json.quota_left, 0);
  assert.equal(quota.json.time_pass_nearest_expiry, null);
  await buyPaid(u.token, "pack5_1990");
  startAttempt({ userId: u.user_id });
  startAttempt({ userId: u.user_id });
  quota = await call("GET", "/api/platform/attempts/quota", { token: u.token });
  assert.equal(quota.json.quota_left, 3, "5 次包扣 2 场余 3");
  assert.equal(quota.json.time_pass_nearest_expiry, null);
  await buyPaid(u.token, "monthly_2990");
  quota = await call("GET", "/api/platform/attempts/quota", { token: u.token });
  assert.ok(quota.json.time_pass_nearest_expiry, "时间卡返回最近到期时间");
  const daysAhead = (new Date(quota.json.time_pass_nearest_expiry) - Date.now()) / 86400_000;
  assert.ok(daysAhead > 29.9 && daysAhead <= 30, "30 天卡到期时间合理");
});

// ── #2 就绪度认证卡 ───────────────────────────────────────────────────────
test("GET /ready-card:<70% 修炼版(无 κ);≥70% 就绪版(含达标率)", async () => {
  const { finishAttempt } = await import("../platform/attempts.mjs");
  const low = createDevUser("low-user");
  await buyPaid(low.token, "pack5_1990");
  const a1 = startAttempt({ userId: low.user_id, position: "Go 后端" });
  finishAttempt({ attemptId: a1.attempt_id, userId: low.user_id, scoreAfter: 10, baseline: 60,
    dimsBefore: { logic: 3, problem_solving: 3, technical_depth: 3 }, dimsAfter: { logic: 1, problem_solving: 1, technical_depth: 1 },
    recheckDeltas: [2, 2], recheckGrounded: false });
  let card = await call("GET", "/api/platform/ready-card", { token: low.token });
  assert.equal(card.status, 200);
  assert.equal(card.json.ready, false);
  assert.ok(card.json.svg.includes("修炼中"), "未达标输出修炼版");
  assert.ok(!card.json.svg.includes("κ"), "校准纪律:任何分支不得出现 κ 数值");
  assert.ok(card.json.svg.includes("0%"), "达标率照实呈现(非 κ)");

  const high = createDevUser("high-user");
  await buyPaid(high.token, "pack5_1990");
  for (let i = 0; i < 4; i++) {
    const a = startAttempt({ userId: high.user_id, position: "后端工程师" });
    const pass = i < 3; // 3/4 = 75% ≥ 70%
    finishAttempt({
      attemptId: a.attempt_id, userId: high.user_id,
      scoreAfter: pass ? 80 : 10, baseline: 60,
      dimsBefore: { logic: 3, problem_solving: 3, technical_depth: 3 },
      dimsAfter: pass ? { logic: 4, problem_solving: 3, technical_depth: 4 } : { logic: 1, problem_solving: 1, technical_depth: 1 },
      recheckDeltas: pass ? [0, 0, 0] : [2, 2],
      recheckGrounded: pass,
    });
  }
  card = await call("GET", "/api/platform/ready-card", { token: high.token });
  assert.equal(card.json.ready, true, "75% 达标率 → 就绪认证");
  assert.ok(card.json.svg.includes("岗位就绪认证"));
  assert.ok(card.json.svg.includes("75%"));
  assert.ok(card.json.svg.includes("high-use"), "含 display_name 前 8 位");
  assert.ok(!card.json.svg.includes("κ"));
});
