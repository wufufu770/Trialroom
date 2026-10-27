#!/usr/bin/env node
/*
 * R2 压力测试(非门禁,手动/巡检跑):真实进程,五类负载。
 *   S1 并发同键幂等(50 并发同 idempotency_key 下单)
 *   S2 限流突发(100 并发 /track,预期 ~30 过 ~70 429,零 5xx)
 *   S3 吞吐画像(300 顺序下单+查询,p50/p95/p99/rps)
 *   S4 双进程 WAL 争用(两 server 同库并发写,验证多副本部署假设)
 *   S5 房间并发入座(20 并发,座位号唯一)
 *   S6 MCP 并发幂等推进(20 并发同键,恰好一轮)
 * 用法:node scripts/stress-platform.mjs   退出码 0=全部达标
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "http://127.0.0.1:3811";
const TMP = fs.mkdtempSync("/tmp/trialroom-stress-");
const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length * p)]); };

const mkServer = (port) => spawn(process.execPath, ["index.js"], {
  cwd: path.join(ROOT, "server"), stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DB_DIR: TMP,
    INTERVIEWX_API_TOKEN: "t", TRIALROOM_ADMIN_TOKEN: "stress-admin-token-0123456789", NODE_ENV: "development",
    API_RATE_GENERAL: "100000" }, // 压测显式调高通配额(限流行为由 S2 专项验证)
});
const s1 = mkServer(3811);

const H = (token) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });
const post = async (url, body, token) => {
  const t0 = performance.now();
  const r = await fetch(url, { method: "POST", headers: token ? H(token) : { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j, ms: performance.now() - t0 };
};
const waitReady = async (base) => {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server 未就绪");
};

const out = [];
const rep = (id, ok, detail) => { out.push({ id, ok }); console.log(`${ok ? "✓" : "✗"} ${id}  ${detail}`); };

try {
  await waitReady(BASE);
  const dev = (await post(`${BASE}/api/platform/auth/dev-token`, { display_name: "stress" })).json;
  const T = dev.token;

  // S1 并发同键幂等
  const key = `s1-${Date.now()}`;
  const r1 = await Promise.all(Array.from({ length: 50 }, () => post(`${BASE}/api/platform/orders`, { product_code: "single_390", idempotency_key: key }, T)));
  const nos = new Set(r1.filter((x) => x.status === 200).map((x) => x.json.order_no));
  rep("S1 并发同键幂等", r1.every((x) => x.status === 200) && nos.size === 1,
    `50 并发 → 订单号 ${nos.size} 个(应=1),0 异常`);

  // S2 限流突发(注意会耗尽 publicLimiter 30/min,后续依赖该桶的用例需换桶/等待)
  const r2 = await Promise.all(Array.from({ length: 100 }, () => post(`${BASE}/track`, { event: "landing_uv" })));
  const ok2 = r2.filter((x) => x.status === 202).length, limited = r2.filter((x) => x.status === 429).length;
  const s5xx = r2.filter((x) => x.status >= 500).length;
  rep("S2 限流突发", ok2 <= 32 && ok2 + limited === 100 && s5xx === 0,
    `202×${ok2} · 429×${limited} · 5xx×${s5xx}`);

  // S3 吞吐画像(顺序)
  const lat = [];
  for (let i = 0; i < 300; i++) {
    const r = await post(`${BASE}/api/platform/orders`, { product_code: "single_390", idempotency_key: `s3-${i}` }, T);
    if (r.status !== 200) throw new Error(`S3 第 ${i} 笔失败:${r.status}`);
    lat.push(r.ms);
  }
  const total = lat.reduce((a, b) => a + b, 0) / 1000;
  rep("S3 吞吐画像", pct(lat, 0.99) < 300,
    `300 笔 · ${total.toFixed(1)}s · ${Math.round(300 / total)} rps · p50 ${pct(lat, 0.5)}ms · p95 ${pct(lat, 0.95)}ms · p99 ${pct(lat, 0.99)}ms`);

  // S5 房间并发入座
  const room = (await post(`${BASE}/api/platform/rooms`, {}, T)).json;
  const guests = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const g = (await post(`${BASE}/api/platform/auth/dev-token`, { display_name: `g${i}` })).json;
    return post(`${BASE}/api/platform/rooms/join`, { room_code: room.room_code }, g.token);
  }));
  const seats = guests.filter((x) => x.status === 200).map((x) => x.json.seat_no);
  rep("S5 并发入座", guests.length === 20 && guests.every((x) => x.status === 200) && new Set(seats).size === 20,
    `20 入座全 200,座位号唯一 ${new Set(seats).size}/20`);

  // S6 MCP 并发幂等推进
  const db = new Database(path.join(TMP, "trialroom.db"));
  const mt = "mt_stress";
  const hostUser = db.prepare("SELECT user_id FROM api_tokens WHERE name != 'admin-env' LIMIT 1").get().user_id;
  db.prepare(`INSERT INTO mcp_tokens (token_id, token_hash, user_id, scopes) VALUES ('tk_s', ?, ?, '["rooms:read","rooms:advance","rooms:join"]')`).run(sha256Hex(mt), hostUser);
  db.prepare("INSERT OR IGNORE INTO room_seats (id, room_id, user_id, seat_no, is_host) SELECT 'st_s', ?, ?, 99, 1 WHERE NOT EXISTS (SELECT 1 FROM room_seats WHERE room_id = ? AND user_id = ?)")
    .run(room.room_id, hostUser, room.room_id, hostUser);
  const mcp = (key) => post(`${BASE}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "ask_next_question", arguments: { room_id: room.room_id, idempotency_key: key } } }, mt);
  const r6 = await Promise.all(Array.from({ length: 20 }, () => mcp("s6-key")));
  const turns = db.prepare("SELECT COUNT(*) c FROM room_messages WHERE room_id = ?").get(room.room_id).c;
  const ok6 = r6.every((x) => x.status === 200) && turns === 1;
  rep("S6 MCP 并发幂等推进", ok6,
    `20 并发同键 → 消息 ${turns} 条(应=1),状态分布 ${[...new Set(r6.map((x) => x.status))].join("/")}`);

  // S4 双进程 WAL 争用(最后跑,单独第二个进程)
  const s2p = mkServer(3812);
  await waitReady("http://127.0.0.1:3812");
  const B2 = "http://127.0.0.1:3812";
  const dev2 = (await post(`${B2}/api/platform/auth/dev-token`, { display_name: "stress2" })).json;
  const jobs = [];
  for (let i = 0; i < 100; i++) {
    const b = i % 2 ? BASE : B2;
    const tk = i % 2 ? T : dev2.token;
    jobs.push(post(`${b}/api/platform/orders`, { product_code: "single_390", idempotency_key: `s4-${i}` }, tk));
  }
  const r4 = await Promise.all(jobs);
  const errs = r4.filter((x) => x.status !== 200);
  const rows = db.prepare("SELECT COUNT(*) c FROM orders WHERE order_no LIKE 'TR%' AND product_code='single_390'").get().c;
  rep("S4 双进程 WAL 争用", errs.length === 0 && rows >= 400,
    `双进程 ×100 并发写 → 失败 ${errs.length}(SQLITE_BUSY 等),总订单 ${rows}`);
  if (errs.length) console.log("   首个错误:", JSON.stringify(errs[0].json).slice(0, 160));
  db.close();
  s2p.kill("SIGTERM");
} catch (e) {
  rep("FATAL", false, e.message);
} finally {
  s1.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(TMP, { recursive: true, force: true });
}
const bad = out.filter((x) => !x.ok);
console.log(`\n═══ 压力测试:${out.length - bad.length}/${out.length} 达标 ═══`);
process.exit(bad.length ? 1 : 0);
