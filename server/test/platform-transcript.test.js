// 逐字稿复盘(getSessionTranscript / buildTranscriptTimeline / GET /api/sessions/:id/transcript)
//
// 背景:复盘数据(问答 messages / 逐题评估 evaluations / 语音答题 answer_recordings)
// 早已各自落库,但散在三张表拼不出"逐字稿回放"时间轴。本文件锁三件事:
//   1. 纯函数 buildTranscriptTimeline 的排序/去重/维度合并/截断(无库即可测);
//   2. db.getSessionTranscript 的聚合与 kind 映射(user→answer,其余→question);
//   3. HTTP 层:新路由必须落在基座认证作用域内(无 token 401),
//      session 不存在 404,正常 200 返回 {ok, transcript}。
//
// HTTP 用例沿用 multer-errors.test.js 的模式:spawn 真实 index.js(独立 DB_DIR +
// 随机端口 + 读 .api_token),而不是手搭 mini express —— 因为"鉴权作用域"本身就是
// index.js 的挂载顺序决定的,手搭 app 会把这个被测对象 mock 掉。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 进程内 db.js(模块加载即建库):DB_DIR 必须在 import 前就位;
// npm test 的 setup-env.mjs / CI 已设置时一律尊重(platform-group-report 同款守卫)。
if (!process.env.DB_DIR) {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-transcript-"));
}

const { buildTranscriptTimeline } = await import("../routes/analysis.js");
const dbm = await import("../db.js");
const { createSession, addMessage, createEvaluation, createAnswerRecording, getSessionTranscript, getDb } = dbm;

// SQLite datetime 同秒精度:messages.created_at 默认 datetime('now'),连插两条同秒
// 无法区分先后。统一用显式回填时间戳保证时间轴顺序可断言。
// (evaluations 的时间列是 generated_at,与 messages/answer_recordings 的 created_at 不同名)
function backdate(table, idCol, id, ts) {
  const timeCol = table === "evaluations" ? "generated_at" : "created_at";
  getDb().prepare(`UPDATE ${table} SET ${timeCol} = ? WHERE ${idCol} = ?`).run(ts, id);
}

// ---- 纯函数:buildTranscriptTimeline ----

test("纯函数:乱序输入按 t 升序,同 t 按 key 决出确定序", () => {
  const raw = [
    { t: "2026-10-28 09:00:03", kind: "answer", role: "user", text: "第三条", key: "msg:m3" },
    { t: "2026-10-28 09:00:01", kind: "question", role: "assistant", text: "第一条", key: "msg:m1" },
    { t: "2026-10-28 09:00:02", kind: "answer", role: "user", text: "第二条", key: "msg:m2" },
  ];
  const tl = buildTranscriptTimeline(raw);
  assert.deepEqual(tl.map((x) => x.text), ["第一条", "第二条", "第三条"]);
  assert.deepEqual(tl.map((x) => x.kind), ["question", "answer", "answer"]);

  // 同 t:按 key 字典序稳定(不依赖 Array.sort 的偶然稳定性,显式次序)
  const tie = buildTranscriptTimeline([
    { t: "2026-10-28 09:00:01", kind: "answer", role: "user", text: "b", key: "msg:kb" },
    { t: "2026-10-28 09:00:01", kind: "question", role: "assistant", text: "a", key: "msg:ka" },
  ]);
  assert.deepEqual(tie.map((x) => x.key), ["msg:ka", "msg:kb"]);
});

test("纯函数:文本截断到 300 字,非法行(null/未知 kind)直接丢弃", () => {
  const long = "长".repeat(500);
  const tl = buildTranscriptTimeline([
    { t: "2026-10-28 09:00:01", kind: "question", role: "assistant", text: long, key: "msg:m1" },
    null,
    { t: "2026-10-28 09:00:02", kind: "hacker", role: "x", text: "未知类型", key: "bad:k" },
    { kind: "answer", role: "user", text: "缺 t 也保留(t 排空串最前)", key: "msg:m0" },
  ]);
  assert.equal(tl.length, 2, "null 与未知 kind 必须被过滤");
  assert.ok(tl[1].text.length <= 301, "截断后 300 字 + 省略号");
  assert.ok(tl[1].text.endsWith("…"));
  assert.equal(tl[1].text.replace("…", "").length, 300);
  assert.equal(tl[0].t, "");
});

test("纯函数:同 key 评估行合并维度并去重,重复行不放大时间轴", () => {
  const evalRow = {
    t: "2026-10-28 09:00:05", kind: "evaluation", role: "evaluator",
    text: "逐题评估报告", key: "eval:e1", overallScore: 7.5,
    evidence: "锚点 L2;锚点 E1",
    dims: [
      { name: "逻辑思维", score: 4, evidence: "锚点 L2" },
      { name: "表达力", score: 3, evidence: "锚点 E1" },
    ],
  };
  // JOIN 拆行场景:同一评估的维度被拆到两行
  const split = [
    { ...evalRow, dims: [{ name: "逻辑思维", score: 4, evidence: "锚点 L2" }] },
    { ...evalRow, dims: [{ name: "表达力", score: 3, evidence: "锚点 E1" }] },
  ];
  const merged = buildTranscriptTimeline(split);
  assert.equal(merged.length, 1, "同 key 必须合并为一条");
  assert.deepEqual(merged[0].dims.map((d) => d.name), ["逻辑思维", "表达力"]);

  // 完全重复的行(重放/双写)不产生重复条目;维度也不因重复行翻倍
  const replayed = buildTranscriptTimeline([...split, ...split, evalRow]);
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].dims.length, 2);
  assert.equal(replayed[0].overallScore, 7.5);
});

test("纯函数:recording 行保留时长/语速,无 key 时按 kind+t+text 去重", () => {
  const rec = { t: "2026-10-28 09:00:04", kind: "recording", role: "user", text: "语音转写", wpm: 180, durationMs: 63000 };
  const tl = buildTranscriptTimeline([rec, { ...rec }]);
  assert.equal(tl.length, 1, "无显式 key 的完全重复行按合成键去重");
  assert.equal(tl[0].durationMs, 63000);
  assert.equal(tl[0].wpm, 180);
});

// ---- db 层:getSessionTranscript ----

test("db:不存在的 session 返回 null;存在但无数据的 session 返回空数组", () => {
  assert.equal(getSessionTranscript("sess_不存在"), null);
  assert.equal(getSessionTranscript(""), null);
  const s = createSession({ title: "空会话", modelId: "test-model" });
  assert.deepEqual(getSessionTranscript(s.sessionId), []);
});

test("db:纯问答时间轴按时间序,user→answer、assistant→question 映射", () => {
  const s = createSession({ title: "问答会话", modelId: "test-model" });
  const q1 = addMessage({ sessionId: s.sessionId, role: "assistant", content: "请介绍一下你的项目" });
  const a1 = addMessage({ sessionId: s.sessionId, role: "user", content: "我做过一个电商系统……" });
  const q2 = addMessage({ sessionId: s.sessionId, role: "assistant", content: "遇到的最大挑战是什么" });
  backdate("messages", "message_id", q1.messageId, "2026-10-28 09:00:01");
  backdate("messages", "message_id", a1.messageId, "2026-10-28 09:00:02");
  backdate("messages", "message_id", q2.messageId, "2026-10-28 09:00:03");

  const rows = getSessionTranscript(s.sessionId);
  assert.deepEqual(rows.map((r) => r.kind), ["question", "answer", "question"]);
  assert.deepEqual(rows.map((r) => r.role), ["assistant", "user", "assistant"]);
  assert.ok(rows[0].t <= rows[1].t && rows[1].t <= rows[2].t, "时间轴必须升序");
  assert.ok(rows.every((r) => r.text.length <= 301), "db 层输出即已截断");
  // 同一份数据喂给纯函数:顺序/形态保持,不因二次处理丢条目
  const tl = buildTranscriptTimeline(rows);
  assert.equal(tl.length, 3);
  assert.deepEqual(tl.map((x) => x.kind), ["question", "answer", "question"]);
});

test("db:评估行携带维度分与证据,录音行携带时长与转写,并在时间轴中按时间混排", () => {
  const s = createSession({ title: "全量会话", modelId: "test-model" });
  const q = addMessage({ sessionId: s.sessionId, role: "assistant", content: "说说你的方案" });
  const a = addMessage({ sessionId: s.sessionId, role: "user", content: "我的方案是……" });
  const ev = createEvaluation({
    sessionId: s.sessionId,
    overallScore: 7.5,
    report: "整体结构清晰",
    improvementAdvice: "建议补充量化结果",
    dimensions: [
      { dimensionName: "逻辑思维", score: 4, comment: "锚点 L2 依据:先说了目标再讲路径" },
      { dimensionName: "表达力", score: 3, comment: "锚点 E1" },
    ],
  });
  const rec = createAnswerRecording({
    sessionId: s.sessionId, question: "说说你的方案", transcript: "语音作答转写文本",
    wpm: 165, durationMs: 42000, model: "whisper",
  });
  backdate("messages", "message_id", q.messageId, "2026-10-28 09:00:01");
  backdate("messages", "message_id", a.messageId, "2026-10-28 09:00:02");
  backdate("evaluations", "evaluation_id", ev.evaluationId, "2026-10-28 09:00:03");
  backdate("answer_recordings", "recording_id", rec.recordingId, "2026-10-28 09:00:04");

  const tl = buildTranscriptTimeline(getSessionTranscript(s.sessionId));
  assert.deepEqual(tl.map((x) => x.kind), ["question", "answer", "evaluation", "recording"]);

  const evalItem = tl[2];
  assert.equal(evalItem.overallScore, 7.5);
  assert.deepEqual(evalItem.dims.map((d) => `${d.name}:${d.score}`), ["逻辑思维:4", "表达力:3"]);
  assert.ok(evalItem.evidence.includes("锚点 L2"), "维度评语(原文依据)应进入证据字段");

  const recItem = tl[3];
  assert.equal(recItem.durationMs, 42000);
  assert.equal(recItem.text, "语音作答转写文本");

  // 评估的维度行即便被拆散重放,也不在时间轴里出现重复评估卡
  const rows = getSessionTranscript(s.sessionId);
  assert.equal(buildTranscriptTimeline([...rows, ...rows]).length, 4);
});

// ---- HTTP 层:真实 index.js(spawn 子进程,独立 DB_DIR + .api_token) ----

/** 起一个隔离的真实服务实例(沿用 multer-errors.test.js 模式) */
async function withServer(fn) {
  const PORT = 3700 + Math.floor(Math.random() * 300);
  const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-transcript-http-"));
  const child = spawn("node", ["index.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT), DB_DIR, NODE_ENV: "production",
      INTERVIEWX_AUTH_DISABLED: "",   // 强制开启认证:无 token 必须 401
      INTERVIEWX_API_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const BASE = `http://127.0.0.1:${PORT}`;
  try {
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 15000) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) { up = true; break; } } catch { /* 未就绪 */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!up) throw new Error(`服务未就绪:\n${log.slice(-1000)}`);
    const TOKEN = fs.readFileSync(path.join(DB_DIR, ".api_token"), "utf8").trim();
    return await fn({ BASE, TOKEN, DB_DIR });
  } finally {
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
  }
}

test("HTTP:无 token 401(认证作用域)/ 不存在 404 / 正常 200 返回 {ok, transcript}", async () => {
  await withServer(async ({ BASE, TOKEN, DB_DIR }) => {
    const url = `${BASE}/api/sessions/sess_http_missing/transcript`;

    // 1) 越权基线:不带 token 必须被全局 authMiddleware 拒绝 ——
    //    证明新路由与既有 analysis 路由同处认证作用域(index.js 挂载顺序)。
    const anon = await fetch(url);
    assert.equal(anon.status, 401, "无 token 访问逐字稿必须 401");

    // 2) session 不存在:404 NOT_FOUND(即使已认证)
    const missing = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    assert.equal(missingBody.code, "NOT_FOUND");

    // 3) 正常路径:向子服务的库直写一场"问答 + 评估 + 录音"(WAL 支持并发连接,
    //    显式 created_at 避开同秒精度),断言响应形态与时间轴顺序。
    const seed = new Database(path.join(DB_DIR, "tryout.db"));
    seed.pragma("busy_timeout = 5000");
    seed.prepare(`INSERT INTO sessions (session_id, title, model_id) VALUES ('sess_http_1', 'HTTP 逐字稿', 'm')`).run();
    seed.prepare(`INSERT INTO messages (message_id, session_id, role, content, created_at) VALUES ('hm1', 'sess_http_1', 'assistant', '请介绍项目', '2026-10-28 09:00:01')`).run();
    seed.prepare(`INSERT INTO messages (message_id, session_id, role, content, created_at) VALUES ('hm2', 'sess_http_1', 'user', '我做了 A 与 B', '2026-10-28 09:00:02')`).run();
    seed.prepare(
      `INSERT INTO evaluations (evaluation_id, session_id, overall_score, report, improvement_advice, generated_at) VALUES ('he1', 'sess_http_1', 8, '结构完整', '补充量化', '2026-10-28 09:00:03')`
    ).run();
    seed.prepare(
      `INSERT INTO evaluation_dimensions (evaluation_id, dimension_name, score, weight, comment) VALUES ('he1', '逻辑思维', 4, 1, '锚点 L2 依据:先目标后路径')`
    ).run();
    seed.prepare(
      `INSERT INTO answer_recordings (recording_id, session_id, question, transcript, wpm, duration_ms, model, created_at) VALUES ('hr1', 'sess_http_1', '请介绍项目', '语音转写内容', 170, 30000, 'whisper', '2026-10-28 09:00:04')`
    ).run();
    seed.close();

    const resp = await fetch(`${BASE}/api/sessions/sess_http_1/transcript`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.ok(body.ok);
    assert.equal(body.data.ok, true);
    const tl = body.data.transcript;
    assert.deepEqual(tl.map((x) => x.kind), ["question", "answer", "evaluation", "recording"]);
    assert.equal(tl[2].dims[0].name, "逻辑思维");
    assert.equal(tl[2].dims[0].score, 4);
    assert.equal(tl[3].durationMs, 30000);
  });
});
