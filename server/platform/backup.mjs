// 数据备份(P2#17):每日 VACUUM INTO 一致性快照,保留 7 份轮转。
import fs from "node:fs";
import path from "node:path";
import { DB_DIR } from "../paths.js";
import { getDb } from "./db.mjs";

export function backupNow() {
  const dir = path.join(DB_DIR, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(dir, `trialroom-${stamp}.db`);
  getDb().prepare(`VACUUM INTO ?`).run(target);
  // 轮转:按名排序删最老,只留 7 份
  const all = fs.readdirSync(dir).filter((f) => /^trialroom-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 7))) {
    try { fs.unlinkSync(path.join(dir, old)); } catch { /* 轮转失败不致命 */ }
  }
  return { file: target, kept: Math.min(all.length + 1, 7) };
}

export function scheduleBackup(intervalMs = 24 * 3600_000) {
  const t = setInterval(() => { try { backupNow(); } catch { /* 下个周期重试 */ } }, intervalMs);
  t.unref();
  return t;
}
