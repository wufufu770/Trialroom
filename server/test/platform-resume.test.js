// P2 · 简历感知出题:extractSkillKeywords 词面命中 + 取题简历加权 + 建房归属校验。
// 纪律:基座 db.js 在模块加载时即连库,DB_DIR 必须先于任何 server 模块 import 就位
// (与 test/setup-env.mjs 同一语义;外部已设置时尊重,不覆盖)——故全部 server 模块走动态 import。
process.env.TRIALROOM_DEV = "1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
if (!process.env.DB_DIR) {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "resume-room-test-"));
}

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMigrations, listMigrationFiles } from "../platform/db/migrate.mjs";

const { setDbForTesting, getDb } = await import("../platform/db.mjs");
const { extractSkillKeywords, pickQuestion } = await import("../platform/questions.mjs");
const rooms = await import("../platform/rooms.mjs");
const { tools } = await import("../platform/mcp/tools.mjs");
const { getDb: getBaseDb } = await import("../db.js"); // 基座:materials/material_contents

// 题库真实内容锚点(先验核过:该题 keyPoints=["SET NX","Lua 原子","看门狗续约","Redlock"],
// tags=["Redis","分布式锁","Lua"]——Redis 命中落在 keyPoints∪tags;简历文本下交集 7 分,
// 远超次名 3 分,命中把握充足)。
const REDIS_LOCK_QREF = "backend-code-011";
// loadBank 同口径(pro 优先并入,缺 pro 文件时仅基座):无简历回归锚点 = 合并库顺序第一道 backend 题
function firstBackendRef() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8")).questions ?? []; }
    catch { return []; } };
  const bank = [...read("../data/pro-bank.json"), ...read("../data/questionbank.json")];
  return bank.find((q) => q.industry === "backend").id;
}
const RESUME_TEXT = "负责订单系统分布式锁:基于 SET NX 加锁、Redlock 方案与看门狗续约,深挖过 Redis 持久化与缓存一致性";

function fresh() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  setDbForTesting(db);
  db.prepare("INSERT INTO users (id) VALUES ('uA')").run();
  return db;
}

let seq = 0;
/** 在基座库造一份简历材料(直接落表:createMaterial 不接收 user_id,归属列须显式写)。 */
function seedMaterial(userId, text) {
  const id = `mat_resume_${process.pid}_${++seq}`;
  getBaseDb().prepare(
    "INSERT INTO materials (material_id, user_id, type, source_type, char_count) VALUES (?, ?, 'resume', 'paste', ?)")
    .run(id, userId, text.length);
  getBaseDb().prepare("INSERT INTO material_contents (material_id, raw_text) VALUES (?, ?)").run(id, text);
  return id;
}

const roomBinding = (roomId) =>
  getDb().prepare("SELECT resume_material_id FROM rooms WHERE room_id = ?").get(roomId)?.resume_material_id ?? null;

test("extractSkillKeywords:命中技术词(中英)并按频次排序;无命中返回空", () => {
  const kws = extractSkillKeywords(
    "三年 K8s 运维,熟悉 kubernetes;用 Redis 做缓存,Redis 集群扩容,Redis 主从切换;k8s 节点排障");
  assert.ok(kws.includes("redis"), `应命中 redis,实际 ${kws.slice(0, 5)}`);
  assert.ok(kws.includes("k8s"), "应命中英文技术词 k8s");
  assert.equal(kws[0], "redis", "redis 出现 3 次应排在 k8s(2 次)之前");
  assert.ok(kws.length <= 20, "关键词至多 20 个");
  assert.deepEqual(extractSkillKeywords("今天天气不错,出去走走"), [], "无技术词命中返回空数组");
  assert.deepEqual(extractSkillKeywords(null), [], "空输入返回空数组");
});

test("取题加权:简历写 Redis 分布式锁 → 首选题即 Redis 分布式锁题(keyPoints/tags 命中 Redis)", () => {
  fresh();
  const r = rooms.createRoom({ hostUserId: "uA", industry: "backend" });
  // 回归锚点:同房无简历 = 题库顺序第一题
  assert.equal(pickQuestion({ roomId: r.room_id, industry: "backend" }).question_ref, firstBackendRef());
  // 有简历:同 tier 内按 keyPoints/tags 与关键词交集数加权,交集最多者优先
  const picked = pickQuestion({ roomId: r.room_id, industry: "backend", resumeText: RESUME_TEXT });
  assert.equal(picked.question_ref, REDIS_LOCK_QREF);
  // 用题库真实内容复核:该题 keyPoints∪tags 确含 Redis(不是拍脑袋断言)
  const bank = JSON.parse(fs.readFileSync(new URL("../data/questionbank.json", import.meta.url), "utf8"));
  const q = (bank.questions ?? bank).find((x) => x.id === picked.question_ref);
  assert.ok([...(q.keyPoints ?? []), ...(q.tags ?? [])].some((s) => /redis/i.test(String(s))),
    "首选题的 keyPoints/tags 应含 Redis");
});

test("MCP ask_next_question 全链路:绑定简历材料 → 推进即问简历相关题;答案零泄漏", () => {
  fresh();
  const matId = seedMaterial("uA", RESUME_TEXT);
  const r = rooms.createRoom({ hostUserId: "uA", industry: "backend", resumeMaterialId: matId });
  assert.equal(roomBinding(r.room_id), matId, "归属房主的材料应成功绑定");
  const mcp = { token_id: "tk", user_id: "uA", scopes: [] };
  const a1 = tools.ask_next_question(mcp, { room_id: r.room_id, idempotency_key: "rk1" });
  assert.equal(a1.question_ref, REDIS_LOCK_QREF, "简历写了 Redis 分布式锁就先问它");
  const a2 = tools.ask_next_question(mcp, { room_id: r.room_id, idempotency_key: "rk2" });
  assert.notEqual(a2.question_ref, a1.question_ref, "同房两题不同(去重)");
  const all = JSON.stringify(getDb().prepare("SELECT content FROM room_messages WHERE room_id = ?").all(r.room_id));
  assert.ok(!/"referenceAnswer"/.test(all), "消息流零参考答案");
});

test("无绑定行为不变:普通房推进仍取题库顺序第一题(回归)", () => {
  fresh();
  const r = rooms.createRoom({ hostUserId: "uA", industry: "backend" });
  assert.equal(roomBinding(r.room_id), null, "未传材料不绑定");
  const a = tools.ask_next_question({ token_id: "tk", user_id: "uA", scopes: [] }, { room_id: r.room_id });
  assert.equal(a.question_ref, firstBackendRef());
});

test("归属校验:材料不属于房主/不存在 → 忽略绑定,降级为普通房(不报错)", () => {
  fresh();
  const other = seedMaterial("uB", RESUME_TEXT); // 属于 uB
  const r1 = rooms.createRoom({ hostUserId: "uA", industry: "backend", resumeMaterialId: other });
  assert.equal(roomBinding(r1.room_id), null, "他人材料不得绑定");
  const r2 = rooms.createRoom({ hostUserId: "uA", industry: "backend", resumeMaterialId: "mat_resume_不存在" });
  assert.equal(roomBinding(r2.room_id), null, "不存在的材料 ID 忽略");
  // 降级后取题与普通房一致
  const a = tools.ask_next_question({ token_id: "tk", user_id: "uA", scopes: [] }, { room_id: r1.room_id });
  assert.equal(a.question_ref, firstBackendRef(), "降级房按题库原序取题");
});

test("REST 建房透传:resume_material_id 可绑定;详情只回 ID 不回材料内容", async () => {
  fresh();
  const { default: express } = await import("express");
  const { mountPlatform } = await import("../platform/index.mjs");
  const { createDevUser } = await import("../platform/auth.mjs");
  const app = express();
  app.use(express.json());
  mountPlatform(app);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const host = createDevUser("host");
    const matId = seedMaterial(host.user_id, RESUME_TEXT);
    const call = async (method, p, { token, body } = {}) => {
      const res = await fetch(`${base}${p}`, {
        method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const created = await call("POST", "/api/platform/rooms", { token: host.token, body: { industry: "backend", resume_material_id: matId } });
    assert.equal(created.status, 200);
    const detail = await call("GET", `/api/platform/rooms/${created.json.room_id}`, { token: host.token });
    assert.equal(detail.json.room.resume_material_id, matId, "详情回传绑定的材料 ID");
    assert.ok(!JSON.stringify(detail.json).includes("看门狗续约"), "详情不得回传简历内容");
  } finally {
    srv.close();
  }
});

test("迁移清单:8 个 SQL 文件,008 为 rooms 增列", () => {
  const files = listMigrationFiles();
  assert.equal(files.length, 8, `应有 8 个迁移文件,实际 ${files.length}`);
  assert.equal(files[files.length - 1], "008_resume_room.sql");
  const db = new Database(":memory:");
  applyMigrations(db);
  const cols = db.prepare("PRAGMA table_info(rooms)").all().map((c) => c.name);
  assert.ok(cols.includes("resume_material_id"), "rooms 应有 resume_material_id 列");
  assert.equal(applyMigrations(db).length, 0, "重复应用应为空(幂等)");
});
