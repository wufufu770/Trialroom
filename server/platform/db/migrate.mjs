// 平台 schema 迁移器 —— 幂等、可校验(--check)、按文件名有序。
// 依据:方案 §3.5.2(migrate 链 + G4 `--check`)。
// 用法:
//   node server/platform/db/migrate.mjs            # 应用全部未应用迁移
//   node server/platform/db/migrate.mjs --check    # 有未应用/哈希不符 → 退出码 1
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export function listMigrationFiles() {
  return fs.readdirSync(DIR).filter((f) => /^\d{3}.*\.sql$/.test(f)).sort();
}

/** 在给定 db 上确保迁移登记表存在(自身也幂等)。 */
export function ensureMetaTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_migrations (
    filename  TEXT PRIMARY KEY,
    sha256    TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
}

export function appliedMigrations(db) {
  ensureMetaTable(db);
  return new Map(db.prepare("SELECT filename, sha256 FROM platform_migrations").all()
    .map((r) => [r.filename, r.sha256]));
}

/** 应用全部未应用迁移;已应用但哈希不符 → 抛错(防静默篡改)。 */
export function applyMigrations(db) {
  const applied = appliedMigrations(db);
  const pending = [];
  for (const file of listMigrationFiles()) {
    const sql = fs.readFileSync(path.join(DIR, file), "utf8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");
    if (applied.has(file)) {
      if (applied.get(file) !== hash) {
        throw new Error(`迁移文件被篡改:${file}(已应用版本的 sha256 与当前不符)`);
      }
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO platform_migrations (filename, sha256) VALUES (?, ?)").run(file, hash);
    })();
    pending.push(file);
  }
  return pending;
}

/** --check 语义:全部已应用且哈希一致 → true;否则 false。 */
export function checkMigrations(db) {
  const applied = appliedMigrations(db);
  const files = listMigrationFiles();
  for (const file of files) {
    if (!applied.has(file)) return { ok: false, reason: `未应用:${file}` };
    const hash = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(DIR, file), "utf8")).digest("hex");
    if (applied.get(file) !== hash) return { ok: false, reason: `哈希不符:${file}` };
  }
  if (files.length === 0) return { ok: false, reason: "无迁移文件" };
  return { ok: true };
}

// ---- CLI ----
const IS_MAIN = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (IS_MAIN) {
  const dbPath = process.argv.find((a) => a.endsWith(".db")) ?? null;
  if (process.argv.includes("--check")) {
    // --check 面向既有部署库;不带库文件时退到内存库只会得到"全部未应用"的
    // 误导性失败(重跑验证时踩过) —— 显式报用法错误而非假红。
    if (!dbPath) {
      console.error("用法:node platform/db/migrate.mjs --check <path/to/trialroom.db>(--check 需要目标库)");
      process.exit(2);
    }
    const db = new Database(dbPath);
    const r = checkMigrations(db);
    if (!r.ok) { console.error(`迁移检查失败:${r.reason}`); process.exit(1); }
    console.log(`迁移检查通过:${listMigrationFiles().length} 个文件全部就绪`);
    process.exit(0);
  }
  const db = dbPath ? new Database(dbPath) : new Database(":memory:");
  const pending = applyMigrations(db);
  console.log(pending.length ? `已应用 ${pending.length} 个迁移:${pending.join(", ")}` : "无待应用迁移");
}
