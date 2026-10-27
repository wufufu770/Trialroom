#!/usr/bin/env node
/*
 * 平台层全链路 E2E(大厂流程 L2):真实 server 进程 + 真实 SQLite + 完整用户旅程。
 * 覆盖:健康/匿名边界 → 平台身份 → 支付全旅程(mock) → 房间全旅程 → MCP 全旅程
 *       (含安全负例:无 token/伪 token/越权/头体不一致) → 支付通知守卫 → 匿名埋点
 *       → 限流生效 → 管理统计口径 → 性能冒烟(p95)。
 * 用法:node scripts/e2e-platform-full.mjs(自起自灭,退出码 0=全过)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3777;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync("/tmp/trialroom-e2e-");

const env = {
  ...process.env,
  PORT: String(PORT),
  HOST: "127.0.0.1",
  DB_DIR: TMP,
  INTERVIEWX_API_TOKEN: "base-smoke-token",
  TRIALROOM_ADMIN_TOKEN: "admin-smoke-token-32chars",
  NODE_ENV: "development",
  DISABLE_WHISPER: "1",
};

const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
};

const server = spawn(process.execPath, ["index.js"], { cwd: path.join(ROOT, "server"), env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));

const json = async (method, p, { token, body, base } = {}) => {
  const res = await fetch(`${base ?? BASE}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), text: res.ok ? null : await res.text().catch(() => "") };
};

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server 未就绪");
}

const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const p95 = (xs) => xs.slice(Math.floor(xs.length * 0.95))[0] ?? xs.at(-1);

let lastRaw = null; // 诊断:MCP 最后一次原始响应(FATAL 时带出)

try {
  await waitReady();
  step("L2-01 服务启动 + 健康检查(未认证)", (await fetch(`${BASE}/api/health`)).ok);

  const prods = await json("GET", "/api/platform/products");
  step("L2-02 匿名商品目录(基座 auth 对 /platform 前缀旁路)", prods.status === 200 && prods.json.products.length >= 5);

  const noAuth = await json("GET", "/api/sessions");
  step("L2-03 基座 API 仍需认证(非 platform 前缀不受旁路影响)", noAuth.status === 401);

  const host = (await json("POST", "/api/platform/auth/dev-token", { body: { display_name: "e2e-host" } })).json;
  const guest = (await json("POST", "/api/platform/auth/dev-token", { body: { display_name: "e2e-guest" } })).json;
  step("L2-04 平台令牌签发(dev 态)", host.token?.startsWith("pt_") && guest.token?.startsWith("pt_"));

  // —— 支付全旅程 ——
  const order = (await json("POST", "/api/platform/orders", { token: host.token, body: { product_code: "pack5_1990", idempotency_key: "e2e-k1" } })).json;
  const order2 = (await json("POST", "/api/platform/orders", { token: host.token, body: { product_code: "pack5_1990", idempotency_key: "e2e-k1" } })).json;
  step("L2-05 幂等下单(同键同单)", order.order_no === order2.order_no);
  const paid = await json("POST", `/api/platform/orders/${order.order_no}/mock-pay`, { token: host.token });
  step("L2-06 mock 支付入账 + 内控标", paid.status === 200 && paid.json.order.status === "paid");
  const strangerView = await json("GET", `/api/platform/orders/${order.order_no}`, { token: guest.token });
  step("L2-07 订单越权 404(不泄露存在性)", strangerView.status === 404);
  const readOnly = await json("GET", "/api/platform/stats/paid", { token: host.token });
  step("L2-08 统计端点非 admin 不可见", readOnly.status === 404);
  const stats = (await json("GET", "/api/platform/stats/paid", { token: env.TRIALROOM_ADMIN_TOKEN })).json.stats;
  step("L2-09 内控单排除出统计口径", stats.order_count === 0 && stats.refunded_fen === 0);

  // —— 房间全旅程 ——
  const room = (await json("POST", "/api/platform/rooms", { token: host.token, body: { industry: "backend" } })).json;
  step("L2-10 建房(房号仅返回一次)", /^\d{6}$/.test(room.room_code));
  const joined = await json("POST", "/api/platform/rooms/join", { token: guest.token, body: { room_code: room.room_code } });
  step("L2-11 凭房号入座", joined.status === 200 && joined.json.seat_no === 2);
  const posted = await json("POST", `/api/platform/rooms/${room.room_id}/messages`, { token: guest.token, body: { content: "全链路回答" } });
  step("L2-12 房间发言", posted.status === 200);
  const msgs = await json("GET", `/api/platform/rooms/${room.room_id}/messages`, { token: host.token });
  step("L2-13 消息拉取", msgs.json.messages?.length === 1);

  // —— MCP 全旅程 ——
  const mcpNoAuth = await json("POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "initialize" } });
  step("M1 MCP 无 token 401", mcpNoAuth.status === 401);
  const mcpToken = "mt_e2e_secret";
  const db = new Database(path.join(TMP, "trialroom.db"));
  // 确定性挂靠:必须用「房主」用户(dev-token 返回的 user_id)。
  // 此前 SELECT ... LIMIT 1 无序取行,时而取到 admin/访客 —— ask 判 is_host
  // 正确拒绝(404),造成 E2E 间歇性 FATAL(D5,测试基建缺陷,业务逻辑无恙)。
  db.prepare(`INSERT INTO mcp_tokens (token_id, token_hash, user_id, scopes) VALUES ('tk_e2e', ?, ?, '["rooms:read","rooms:join","rooms:advance","evidence:read"]')`)
    .run(sha256Hex(mcpToken), host.user_id);
  const call = (body, extraHeaders = {}) => fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${mcpToken}`, ...extraHeaders },
    body: JSON.stringify(body),
  }).then(async (r) => { const j = await r.json().catch(() => null); lastRaw = `${r.status}:${JSON.stringify(j)?.slice(0, 200)}`; return { status: r.status, json: j }; });

  const init = await call({ jsonrpc: "2.0", id: 2, method: "initialize" });
  step("M2 MCP initialize", init.json?.result?.protocolVersion === "2026-07-28");
  // 注:/mcp 限流 30/min(P0-1 加固)。本 E2E 全程 MCP 调用预算 ≤ 30:
  // M2..M7 共 8 次 + 性能采样 15 次 initialize;tools/list 只采样一次在 M4。
  const hdr = await call({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-method": "initialize" });
  step("M3 S-11 头体不一致 -32020", hdr.status === 400 && hdr.json.error.code === -32020);
  const listing = await call({ jsonrpc: "2.0", id: 4, method: "tools/list" });
  step("M4 scope 分片(无 self_review → 5 工具)", listing.json.result.tools.length === 5 && !listing.json.result.tools.some((t) => t.name === "submit_self_review"));
  const joinMcp = await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "join_room", arguments: { room_code: room.room_code } } });
  step("M5 MCP 入座 + room_code 零回显", joinMcp.status === 200 && !JSON.stringify(joinMcp.json).includes(room.room_code));
  const ask1 = await call({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ask_next_question", arguments: { room_id: room.room_id, idempotency_key: "k-1" } } });
  const ask2 = await call({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ask_next_question", arguments: { room_id: room.room_id, idempotency_key: "k-1" } } });
  const p1 = JSON.parse(ask1.json.result.content[0].text), p2 = JSON.parse(ask2.json.result.content[0].text);
  step("M6 幂等推进(重放同轮)", p1.turn_index === p2.turn_index && p2.replayed === true);
  const ev = await call({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "evidence.search", arguments: { query: "%" } } });
  const evp = JSON.parse(ev.json.result.content[0].text);
  step("M7 证据检索通配符已转义", evp.results.every((x) => x.content?.includes("%") || (x.excerpt ?? "").includes("%")));

  // —— 通知守卫 / 埋点 / 限流 ——
  const notifyRes = await fetch(`${BASE}/pay/alipay/notify`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "out_trade_no=X&trade_status=TRADE_SUCCESS" });
  step("P1 未配钥通知 → failure(不 500)", (await notifyRes.text()) === "failure");
  const tr = await fetch(`${BASE}/track`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "landing_uv" }) });
  step("P2 匿名埋点 202", tr.status === 202);
  let limited = 0, lastStatus = 202;
  for (let i = 0; i < 35; i++) {
    const r = await fetch(`${BASE}/track`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "landing_uv" }) });
    lastStatus = r.status; if (r.status === 429) limited++;
  }
  step("P3 埋点限流生效(30/min)", limited > 0 && lastStatus === 429, `429×${limited}`);

  // —— 性能冒烟(注意限流预算:/mcp 30/min、/api 120/min) ——
  const t = (fn) => async () => { const t0 = performance.now(); await fn(); return performance.now() - t0; };
  const latOrder = [], latMcp = [];
  for (let i = 0; i < 50; i++) {
    latOrder.push(await t(() => json("POST", "/api/platform/orders", { token: host.token, body: { product_code: "single_390", idempotency_key: `perf-${i}` } }))());
  }
  for (let i = 0; i < 15; i++) {
    latMcp.push(await t(() => call({ jsonrpc: "2.0", id: 500 + i, method: "initialize" }))());
  }
  const perf = { order_p95ms: Math.round(p95(latOrder.slice().sort((x, y) => x - y))), mcp_p95ms: Math.round(p95(latMcp.slice().sort((x, y) => x - y))) };
  step("PERF 热路径 p95 < 500ms(本机,mock 轨)", perf.order_p95ms < 500 && perf.mcp_p95ms < 500, JSON.stringify(perf));

  db.close();
} catch (e) {
  step("FATAL", false, `${e.message}${lastRaw ? ` | 最后 MCP 响应: ${lastRaw}` : ""}`);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n═══ 平台层全链路 E2E:${results.length - failed.length}/${results.length} 通过 ${failed.length ? "· 失败:" + failed.map((f) => f.name).join(",") : ""} ═══`);
process.exit(failed.length ? 1 : 0);
