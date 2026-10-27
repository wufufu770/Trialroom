#!/usr/bin/env node
// G01 · 语法门禁:对 server/ 与 tools/ 的全部 JS/MJS 做 node --check。
// 每个文件独立 spawn,任何语法错误即非零退出。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "test", "fixtures", "data"]);

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(path.join(dir, ent.name));
    } else if (/\.(js|mjs)$/.test(ent.name)) {
      yield path.join(dir, ent.name);
    }
  }
}

const files = [...walk(path.join(ROOT, "server")), ...walk(path.join(ROOT, "tools"))];
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`✗ ${path.relative(ROOT, f)}\n${r.stderr}`);
    failed++;
  }
}
if (failed > 0) {
  console.error(`\nG01 语法检查:${failed}/${files.length} 个文件失败`);
  process.exit(1);
}
console.log(`G01 语法检查:${files.length} 个文件全部通过`);
