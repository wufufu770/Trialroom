// 平台层数据库连接(独立于基座 interviewx.db,落 trialroom.db)。
// 首次打开即自动迁移;进程内单例。
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { DB_DIR } from "../paths.js";
import { applyMigrations } from "./db/migrate.mjs";

let db = null;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(path.join(DB_DIR, "trialroom.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

/** 供测试注入独立连接。 */
export function setDbForTesting(connection) { db = connection; }

// ── 常用生成器 ────────────────────────────────────────────────────────────
import crypto from "node:crypto";
export const genId = (prefix) => `${prefix}_${crypto.randomBytes(11).toString("base64url")}`;
export const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
/** room_id:rm_ + 22 位 [A-Za-z0-9](=16 字节随机,≥128bit,方案 §3.4.3)。 */
export function newRoomId() {
  return "rm_" + crypto.randomBytes(22).toString("base64url").replace(/[-_]/g, (c) =>
    c === "-" ? "A" : "B").slice(0, 22);
}
/** room_code:6 位数字(10^6 空间,只作入座凭证,靠限流与锁定保护)。 */
export function newRoomCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}
export const nowIso = () => new Date().toISOString();
