// P2 · 平台 schema 迁移与约束测试
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMigrations, checkMigrations, listMigrationFiles } from "../platform/db/migrate.mjs";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

test("迁移:四个 SQL 文件按序应用且幂等", () => {
  assert.deepEqual(listMigrationFiles(), [
    "001_platform_schema.sql", "002_mcp_schema.sql", "003_payment_views.sql", "004_calibration_schema.sql",
  ]);
  const db = freshDb();
  const again = applyMigrations(db);
  assert.equal(again.length, 0, "重复应用应为空");
  assert.equal(checkMigrations(db).ok, true);
});

test("迁移:001 的 15 张表全部存在", () => {
  const db = freshDb();
  const expected = ["users", "api_tokens", "rooms", "room_seats", "room_messages", "self_reviews",
    "interview_attempts", "orders", "order_events", "payment_notifications", "entitlements",
    "entitlement_ledger", "idempotency_keys", "funnel_events", "review_pass_log"];
  const got = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of expected) assert.ok(got.includes(t), `缺表 ${t}`);
});

test("约束:room_id 必须 rm_ + 22 位,room_code 6 位", () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id) VALUES ('u_x')").run();
  const ins = db.prepare("INSERT INTO rooms (room_id, room_code, host_user_id) VALUES (?, ?, 'u_x')");
  ins.run("rm_" + "a".repeat(22), "123456");
  assert.throws(() => ins.run("rm_short", "123457"), /GLOB/i);
  assert.throws(() => ins.run("rm_" + "a".repeat(22) + "x", "123458"), /GLOB/i);
  assert.throws(() => ins.run("rm_" + "b".repeat(22), "12345"), /length/);
});

test("约束:订单金额物理范围 [0.01, 100000000] 元(分)", () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id) VALUES ('u_x')").run();
  const ins = db.prepare(
    "INSERT INTO orders (order_no, user_id, product_code, amount_fen) VALUES (?, 'u_x', 'x', ?)");
  ins.run("o1", 1);            // ¥0.01 → 1 分,合法
  ins.run("o2", 10000000000);  // ¥100,000,000,合法上界
  assert.throws(() => ins.run("o3", 0), /CHECK/i);
  assert.throws(() => ins.run("o4", 10000000001), /CHECK/i);
});

test("幂等键:复合键 UNIQUE 天然作用域隔离(mcp:user:op:client)", () => {
  const db = freshDb();
  const ins = db.prepare(
    "INSERT INTO idempotency_keys (key, principal, operation, expires_at) VALUES (?, ?, ?, ?)");
  ins.run("mcp:u1:ask_next_question:abc", "u1", "ask_next_question", "2026-12-31T00:00:00Z");
  // 不同 principal 的同名 client_key 不冲突
  ins.run("mcp:u2:ask_next_question:abc", "u2", "ask_next_question", "2026-12-31T00:00:00Z");
  assert.throws(() =>
    ins.run("mcp:u1:ask_next_question:abc", "u1", "ask_next_question", "2026-12-31T00:00:00Z"), /UNIQUE/i);
});

test("self_reviews:UNIQUE(room,turn,seat) + ON CONFLICT REPLACE 幂等", () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id) VALUES ('u_h')").run();
  db.prepare("INSERT INTO rooms (room_id, room_code, host_user_id) VALUES (?, '111111', 'u_h')")
    .run("rm_" + "c".repeat(22));
  db.prepare("INSERT INTO room_seats (id, room_id, user_id, seat_no, is_host) VALUES ('s1', ?, 'u_h', 1, 1)")
    .run("rm_" + "c".repeat(22));
  const ins = db.prepare(
    "INSERT INTO self_reviews (id, room_id, seat_id, turn_index, content) VALUES (?, ?, 's1', 1, ?)");
  ins.run("sr1", "rm_" + "c".repeat(22), "第一次自评");
  ins.run("sr2", "rm_" + "c".repeat(22), "第二次自评(替换)"); // 同 room/turn/seat → REPLACE
  const rows = db.prepare("SELECT * FROM self_reviews").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, "第二次自评(替换)");
});

test("mcp_tokens:token_hash 唯一,scope 外键到 users", () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id) VALUES ('u_x')").run();
  const ins = db.prepare(
    "INSERT INTO mcp_tokens (token_id, token_hash, user_id, scopes) VALUES ('t1', ?, 'u_x', '[\"rooms:read\"]')");
  ins.run("hash1");
  assert.throws(() =>
    db.prepare("INSERT INTO mcp_tokens (token_id, token_hash, user_id) VALUES ('t2', 'hash1', 'u_x')").run(),
    /UNIQUE/i);
  assert.throws(() =>
    db.prepare("INSERT INTO mcp_tokens (token_id, token_hash, user_id) VALUES ('t3', 'hash2', 'u_不存在')").run(),
    /FOREIGN KEY/i);
});

test("003 视图:v_paid_user_stats 多口径并列输出", () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id) VALUES ('u1')").run();
  db.prepare("INSERT INTO users (id) VALUES ('u2')").run();
  const ins = db.prepare(`INSERT INTO orders (order_no, user_id, product_code, amount_fen, status,
    buyer_account_hash, refund_state, refund_amount_fen, review_passed_at, paid_at)
    VALUES (?, ?, 'p', ?, 'paid', ?, ?, ?, '2026-11-22T00:00:00Z', '2026-11-23T00:00:00Z')`);
  ins.run("o1", "u1", 1, "acc_a", null, null);                  // ¥0.01 已付,未退款
  ins.run("o2", "u1", 390, "acc_a", "done", 390);               // ¥3.9 已付但已全额退款
  ins.run("o3", "u2", 390, "acc_b", null, null);                // ¥3.9 已付
  const s = db.prepare("SELECT * FROM v_paid_user_stats").get();
  assert.equal(s.dedup_account, 2);                              // a + b
  assert.equal(s.dedup_account_excl_001, 2);                     // 排除 0.01 后仍 a + b
  assert.equal(s.dedup_account_excl_refund, 2);                  // 剔除退款单:acc_a 仍有 0.01 单在
  assert.equal(s.dedup_account_after_review, 2);                 // paid_at 均晚于 review_passed_at
  assert.equal(s.order_count, 3);
  assert.equal(s.gross_fen, 781);
});

test("004 校准:rater 与 label 的 CHECK 收紧", () => {
  const db = freshDb();
  db.prepare("INSERT INTO calibration_items (id, question_ref, dimension, answer_text, industry, difficulty, q_type, answer_len) VALUES ('i1','q1','logic','ans','backend','L1','concept',3)").run();
  const ins = db.prepare("INSERT INTO calibration_labels (id, item_id, rater_id, label) VALUES (?,'i1',?,?)");
  ins.run("l1", "h1", "A");
  ins.run("l2", "judge", "E");
  assert.throws(() => ins.run("l3", "h3", "A"), /CHECK/i);      // 非法 rater
  assert.throws(() => ins.run("l4", "h2", "F"), /CHECK/i);      // 非法标签
});
