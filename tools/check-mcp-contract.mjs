#!/usr/bin/env node
// G11a · MCP 工具契约门禁 —— 冻结件 config/mcp-tools.json 的结构不变量。
// 判据(写死):恰好 6 个工具;名字唯一;五注解显式且布尔;scope ⊆ 冻结五档;
//   ask_next_question 是唯一 destructive + idempotentHint=false 的工具;
//   evidence.search 是唯一 openWorldHint=true;上限 12(G24);
//   实现文件(tools.mjs)必须导出清单里每个工具。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const m = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "mcp-tools.json"), "utf8"));
const errs = [];

const FROZEN_SCOPES = new Set(["rooms:read", "rooms:join", "rooms:advance", "self_review", "evidence:read"]);
if (m.tools.length !== 6) errs.push(`工具数必须恰好 6(A 期冻结),实际 ${m.tools.length}`);
if (m.tools.length > 12) errs.push("超过工具上限 12(G24)");
const names = new Set();
for (const t of m.tools) {
  if (names.has(t.name)) errs.push(`工具重名:${t.name}`);
  names.add(t.name);
  if (!FROZEN_SCOPES.has(t.scope)) errs.push(`${t.name}:scope ${t.scope} 不在冻结五档`);
  const a = t.annotations ?? {};
  for (const k of ["title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
    if (!(k in a)) errs.push(`${t.name}:缺注解 ${k}(四注解全显式)`);
    if (k !== "title" && typeof a[k] !== "boolean") errs.push(`${t.name}:注解 ${k} 必须是布尔(显式 false 而非缺省)`);
  }
}
const destructive = m.tools.filter((t) => t.annotations?.destructiveHint === true);
if (destructive.length !== 1 || destructive[0].name !== "ask_next_question") {
  errs.push("唯一 destructive 工具必须是 ask_next_question");
}
const nonIdem = m.tools.filter((t) => t.annotations?.idempotentHint === false);
if (nonIdem.length !== 1 || nonIdem[0].name !== "ask_next_question") {
  errs.push("唯一 idempotentHint=false 工具必须是 ask_next_question");
}
const openWorld = m.tools.filter((t) => t.annotations?.openWorldHint === true);
if (openWorld.length !== 1 || openWorld[0].name !== "evidence.search") {
  errs.push("唯一 openWorldHint=true 工具必须是 evidence.search");
}

// 实现与冻结件一致
const impl = fs.readFileSync(path.join(ROOT, "server", "platform", "mcp", "tools.mjs"), "utf8");
for (const t of m.tools) {
  const key = `  "${t.name}":`;
  if (!impl.includes(`"${t.name}"`) && !impl.includes(`${t.name}:`)) {
    errs.push(`tools.mjs 未实现冻结工具:${t.name}`);
  }
}
// 返回值纪律:实现里不得出现 room_code 回显。三处合法引用豁免:
//   注释(纪律陈述)/ stripCode 脱敏器(把 room_code 从返回对象剔除的实现本身)/ join_room 入参
// 行为级保证在 platform-mcp.test.js(断言所有响应文本不含 room_code)。
const implNoComments = impl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  .replace(/^.*stripCode.*$/gm, "");
const joinBlock = implNoComments.split("join_room:")[1]?.split("ask_next_question:")[0] ?? "";
if (/room_code/.test(implNoComments.replace(joinBlock, ""))) {
  errs.push("tools.mcp 实现中出现 join_room 之外的 room_code 引用(入座凭证不回显纪律)");
}

if (errs.length > 0) {
  console.error(`G11a MCP 契约:${errs.length} 处违例`);
  for (const e of errs) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("G11a MCP 契约:通过(6 工具冻结 · 五注解显式 · 实现齐备 · room_code 零回显)");
