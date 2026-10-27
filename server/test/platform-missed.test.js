// 单元测试:错题本跨会话聚合(listMissedQuestions,★3)
//
// ## 为什么需要
// `listQuestionFeedback(sessionId)` 只有按会话视图,复习场景需要跨会话的
// is_missed=1 聚合:按题干去重、保留最近一次回答、累计错误次数、按时间倒序。
// 聚合 SQL 若写错(漏 WHERE / 漏去重 / 排序方向反),前端错题本会静默失真,
// 所以直接对 db.js 新函数做行为断言。
//
// ## 结构说明(遵循既有模式)
// `db.js` 是带副作用的模块:import 时即按 DB_DIR 建库。基座测试(db-concurrency
//.test.js)的"独立实例"做法是:设 `process.env.DB_DIR` 指向临时目录后再动态
// `import()`(真实文件库的临时目录模式)。platform-schema 的 fresh 模式不适用
// (analysis/基座用的是 db.js 而非 platform/db.mjs),本文件照抄临时目录模式。
// 每个用例独立临时目录 → 用子进程隔离不必要:node --test 每文件独立进程,
// 文件内所有用例共享一次 import(同一连接),故统一在一个用例里建数据,不 close。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tryout-missed-${tag}-`));
}

// DB_DIR 必须在 import db.js 之前生效(模块加载时即建库)
process.env.DB_DIR = tmpDir("main");

const { createQuestionFeedback, setQuestionMissed, listMissedQuestions, getDb } = await import("../db.js");

/** 插入一条反馈并(可选)标记为错题、覆写 created_at(排序用;datetime('now') 只有秒级精度) */
function seed({ question, answer, sessionId, missed, at, betterAnswer = null, weaknessTags = [] }) {
  const { feedbackId } = createQuestionFeedback({
    sessionId, question, answer, score: 4, weaknessTags, improvement: null, betterAnswer,
  });
  if (missed) setQuestionMissed(feedbackId, true);
  if (at) getDb().prepare("UPDATE question_feedback SET created_at = ? WHERE feedback_id = ?").run(at, feedbackId);
  return feedbackId;
}

test("错题本聚合:按题干去重,保留最近一次回答/会话/时间,累计 missed 次数", () => {
  // 同一题干两次错题(跨会话):应合并为一条,count=2,取最近一次
  seed({ question: "讲讲 Redis 持久化", answer: "旧回答 RDB 快照", sessionId: "s_old", missed: true, at: "2026-10-01 10:00:00" });
  seed({
    question: "讲讲 Redis 持久化", answer: "新回答 RDB+AOF 混合", sessionId: "s_new",
    missed: true, at: "2026-10-20 12:30:00", betterAnswer: "RDB 快照 + AOF 追加,混合持久化",
    weaknessTags: ["缺乏量化结果", "逻辑跳跃"],
  });
  // 未标记错题的同题干回答:不应计入
  seed({ question: "讲讲 Redis 持久化", answer: "答得不错的一版", sessionId: "s_ok", missed: false, at: "2026-10-25 09:00:00" });

  const rows = listMissedQuestions();
  const hit = rows.find((r) => r.question === "讲讲 Redis 持久化");
  assert.ok(hit, "已标记错题的题干必须出现在聚合里");
  assert.equal(hit.missedCount, 2, `missed 次数应聚合为 2,实际 ${hit.missedCount}`);
  assert.equal(hit.answer, "新回答 RDB+AOF 混合", "应保留最近一次回答");
  assert.equal(hit.sessionId, "s_new", "应保留最近一次 sessionId");
  assert.equal(hit.lastMissedAt, "2026-10-20 12:30:00", "应保留最近一次错题时间");
  assert.equal(hit.betterAnswer, "RDB 快照 + AOF 追加,混合持久化", "应带出最近一次的参考答案(better_answer)");
  assert.deepEqual(hit.weaknessTags, ["缺乏量化结果", "逻辑跳跃"], "应带出最近一次的短板标签(JSON 已解包)");
});

test("错题本排序:按最近一次错题时间倒序;is_missed=0 与其他题干互不串扰", () => {
  seed({ question: "进程与线程的区别", answer: "A 版", sessionId: "s1", missed: true, at: "2026-10-05 08:00:00" });
  seed({ question: "TCP 三次握手", answer: "B 版", sessionId: "s2", missed: true, at: "2026-10-15 08:00:00" });
  seed({ question: "TCP 四次挥手", answer: "未标记,不该出现", sessionId: "s3", missed: false, at: "2026-10-26 23:00:00" });

  const rows = listMissedQuestions();
  const questions = rows.map((r) => r.question);
  assert.ok(!questions.includes("TCP 四次挥手"), "is_missed=0 的反馈不得进入错题本");
  const idx = { "进程与线程的区别": questions.indexOf("进程与线程的区别"), "TCP 三次握手": questions.indexOf("TCP 三次握手") };
  assert.ok(idx["TCP 三次握手"] < idx["进程与线程的区别"], `应按最近错题时间倒序(新题在前),实际顺序:${questions.join(" | ")}`);
  assert.ok(rows.every((r) => r.isMissed === undefined || r.isMissed === true), "聚合行不应混入未标记行");
});

test("错题本 LIMIT:钳制参数,只返回最近 N 条(防全表拉取)", () => {
  // 共享同一连接(模块只求值一次),这批种子必须是全库最新的,
  // 才能断言"LIMIT 截断保留的是最近的两条"(前面的种子都在 10-20 及以前)
  for (let i = 1; i <= 5; i++) {
    seed({ question: `限流测试题 ${i}`, answer: `回答 ${i}`, sessionId: `s_lim_${i}`, missed: true, at: `2026-10-2${i} 00:00:00` });
  }
  const rows = listMissedQuestions(2);
  assert.equal(rows.length, 2, `LIMIT 2 应只返回 2 条,实际 ${rows.length}`);
  assert.equal(rows[0].question, "限流测试题 5", "LIMIT 截断应保留最近的题(5 号最新)");
  assert.equal(rows[1].question, "限流测试题 4", "次新题为 4 号");
});

test("错题本空库/全未标记:返回空数组而非抛错", () => {
  seed({ question: "只答不错的一题", answer: "ok", sessionId: "s_clean", missed: false });
  const fresh = listMissedQuestions();
  // 前面用例可能已插入错题,这里只断言"该题干不在结果里 + 返回是数组"
  assert.ok(Array.isArray(fresh));
  assert.ok(!fresh.some((r) => r.question === "只答不错的一题"));
});
