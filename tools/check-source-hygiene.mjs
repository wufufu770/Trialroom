#!/usr/bin/env node
// G12 · 题库来源卫生门禁
// 判据:
//   1. data/sources-license.json 存在且含必需键(base_questionbank.provenance/content_domain_whitelist)
//   2. 题库源文件(data/questionbank-src/*.ts)中出现的每个 URL 域名都必须在白名单内
//   3. 若设置 REFERENCE_CORPUS_DIR(禁复制语料),做 12-gram 重合检测;未设置时显式跳过(不作 silently pass)
//   4. 基座题库 provenance 必须如实为 unverified —— 禁止把未验证来源标成 verified(诚实纪律)
// 退出码:0 通过 · 1 违例 · 2 门禁自身不可用(台账缺失)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ledgerPath = path.join(ROOT, "data", "sources-license.json");
if (!fs.existsSync(ledgerPath)) {
  console.error("G12 失败(2):来源台账 data/sources-license.json 不存在 —— 门禁不可用");
  process.exit(2);
}
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const whitelist = ledger.content_domain_whitelist ?? {};
const errs = [];

if (!ledger.base_questionbank?.provenance) errs.push("台账缺 base_questionbank.provenance");
if (ledger.base_questionbank?.provenance === "verified") {
  errs.push("基座题库 provenance 被标为 verified —— 与零 provenance 事实不符(诚实纪律)");
}
if (Object.keys(whitelist).length === 0) errs.push("台账域白名单为空");

// ── 扫描题库 URL ──
const srcDir = path.join(ROOT, "data", "questionbank-src");
const URL_RE = /https?:\/\/([a-zA-Z0-9.-]+(?::\d+)?)/g;
const bad = new Set();
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
  const src = fs.readFileSync(path.join(srcDir, f), "utf8");
  for (const m of src.matchAll(URL_RE)) {
    const host = m[1].toLowerCase().replace(/:\d+$/, "");
    if (!(host in whitelist)) bad.add(`${f}: ${host}`);
  }
}
for (const b of bad) errs.push(`未在白名单的域名:${b}`);

// ── 12-gram 重合检测(提供参照语料时) ──
const refDir = process.env.REFERENCE_CORPUS_DIR;
let overlapNote = "未设置 REFERENCE_CORPUS_DIR,12-gram 重合检测跳过(禁复制语料台账见 sources-license.json)";
if (refDir && fs.existsSync(refDir)) {
  const grams = new Set();
  const N = 12;
  const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
  for (const f of fs.readdirSync(refDir)) {
    const text = norm(fs.readFileSync(path.join(refDir, f), "utf8"));
    for (let i = 0; i + N <= text.length; i += 1) grams.add(text.slice(i, i + N));
  }
  let hits = 0;
  for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
    const text = norm(fs.readFileSync(path.join(srcDir, f), "utf8"));
    for (let i = 0; i + N <= text.length; i += 1) if (grams.has(text.slice(i, i + N))) hits++;
  }
  if (hits > 0) errs.push(`与禁复制语料 12-gram 重合 ${hits} 处(hello-agents 为 CC BY-NC-SA,零复制纪律)`);
  overlapNote = `12-gram 检测完成:重合 ${hits} 处`;
}

if (errs.length > 0) {
  console.error(`G12 题库来源卫生:${errs.length} 处违例`);
  for (const e of errs) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`G12 题库来源卫生:通过(${overlapNote})`);
