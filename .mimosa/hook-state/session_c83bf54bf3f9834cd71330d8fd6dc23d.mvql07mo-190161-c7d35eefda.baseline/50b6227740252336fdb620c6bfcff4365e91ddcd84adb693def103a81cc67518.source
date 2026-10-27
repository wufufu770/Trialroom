// B5 · 证据抽取器 / 监控四信号 / 备份 / Pro 题库
process.env.TRIALROOM_DEV = "1";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../platform/db/migrate.mjs";
import { setDbForTesting, getDb } from "../platform/db.mjs";
import { extractFacts, stripInvisibleChars, LIMITS } from "../platform/evidence/extractor.mjs";
import { computeSignals, THRESHOLDS } from "../platform/calibration/signals.mjs";
import { pickQuestion } from "../platform/questions.mjs";

function fresh() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('u1')").run();
  return db;
}

test("抽取器:不可见字符剥离;条数/长度边界;规则降级产出结构化事实", async () => {
  fresh();
  assert.equal(stripInvisibleChars("a\u200bb\u202ec"), "abc");
  const poisoned = "正常内容\u200b\u202e(reversed)";
  const r = await extractFacts([poisoned, "第二句。第三句;", "".padEnd(50, "x")]);
  assert.equal(r.source, "rule", "无 key 时规则降级");
  assert.ok(r.facts.length >= 2 && r.facts.length <= LIMITS.ITEMS_MAX);
  for (const f of r.facts) {
    assert.ok(typeof f.what === "string" && !f.what.includes("\u202e"));
    assert.ok(!("review" in f) && !("score" in f), "证据条目不得含评价字段(证据≠结论)");
  }
  // 超量输入被截断
  const many = await extractFacts(Array.from({ length: 50 }, (_, i) => `条目${i}内容足够长以通过最小长度过滤`));
  assert.ok(many.facts.length <= LIMITS.ITEMS_MAX);
});

test("抽取器:空输入 noop;审计表可承接失败", async () => {
  fresh();
  const r = await extractFacts([]);
  assert.deepEqual([r.facts.length, r.source], [0, "noop"]);
});

test("监控四信号:阈值判定与红绿汇总", () => {
  const green = computeSignals({ anchorFlipRate: 0.1, crossItemStd: 0.9, kappaDeltaByDim: { logic: 0.05 }, parseFailRate: 0.01 });
  assert.equal(green.verdict, "green");
  const red = computeSignals({ anchorFlipRate: 0.3, crossItemStd: 0.3, kappaDeltaByDim: { logic: 0.2 }, parseFailRate: 0.05 });
  assert.equal(red.verdict, "red");
  assert.equal(red.red_count, 4);
  assert.ok(THRESHOLDS.M1 === 0.25 && THRESHOLDS.M4 === 0.03);
});

test("Pro 题库:并入取题器且优先;含 rubricHints;参考答案不出现在抽取链路", () => {
  fresh();
  const q = pickQuestion({ roomId: "rm_" + "p".repeat(22), industry: "backend" });
  assert.ok(q.question_ref.startsWith("pro-backend"), `Pro 优先,实际 ${q.question_ref}`);
  assert.ok(!("referenceAnswer" in q));
  const raw = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../data/pro-bank.json"), "utf8"));
  assert.ok(raw.questions.length >= 12);
  for (const item of raw.questions) {
    assert.ok(Array.isArray(item.rubricHints) && item.rubricHints.length === 5, `${item.id} 须带五档 rubricHints`);
    assert.ok(item.referenceAnswer.length > 50);
  }
});

test("备份:VACUUM INTO 快照可打开且含数据;文件名按日", async () => {
  process.env.DB_DIR = fs.mkdtempSync("/tmp/trialroom-bak-");
  const db = new Database(":memory:");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('u1')").run();
  const { backupNow } = await import("../platform/backup.mjs");
  const r = backupNow();
  assert.ok(/trialroom-\d{4}-\d{2}-\d{2}\.db$/.test(r.file));
  const snap = new Database(r.file);
  assert.equal(snap.prepare("SELECT COUNT(*) c FROM users").get().c, 1);
  snap.close();
  fs.rmSync(process.env.DB_DIR, { recursive: true, force: true });
  delete process.env.DB_DIR;
});

test("A4 静态断言:评分判官 prompt 不拼接证据字段", () => {
  const judge = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/calibrate-judge.mjs"), "utf8");
  const anchors = judge.split("const ANCHORS")[1]?.split("};")[0] ?? "";
  for (const banned of ["room_messages", "self_reviews", "evidence", "rawEvidence"]) {
    assert.ok(!anchors.includes(banned), `判官锚点不得引用 ${banned}(证据/结论分离)`);
  }
});
