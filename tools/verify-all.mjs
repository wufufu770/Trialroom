#!/usr/bin/env node
// verify-all —— 门禁唯一真相源(GATES 数组)
//
// 纪律(11-final-plan §3.11.2 / §6.9):
//   1. 每道门禁必须**能独立失败**:命令非零退出即 FAIL,缺脚本即 BROKEN(exit 2)。
//   2. 元自检:GATES 数组自身的完整性(id 唯一、脚本文件存在)每次运行先查 ——
//      注册表里出现指向不存在脚本的条目 = 门禁体系不可信(CF-05 的教训)。
//   3. 环境缺失(docker / e2e 前置)记 SKIP,不记 PASS。
//
// 用法:node tools/verify-all.mjs [--list] [--only G06,G11]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── GATES 注册表(唯一真相源;新增门禁必须在此登记) ───────────────────────
// kind: "static" 纯静态检查 · "test" 测试套件 · "build" 构建 · "optional" 环境缺失时 SKIP
export const GATES = [
  { id: "G01", name: "语法检查", cmd: "node tools/check-syntax.mjs", kind: "static" },
  { id: "G06", name: "鉴权作用域覆盖", cmd: "node tools/check-middleware-order.mjs", kind: "static" },
  { id: "G07", name: "路由数量下限", cmd: "node tools/check-routes-count.mjs", kind: "static" },
  { id: "G03", name: "后端单元测试", cmd: "npm --prefix server test", kind: "test" },
  { id: "G04", name: "前端单元测试", cmd: "npm --prefix web test", kind: "test" },
  { id: "G02", name: "前端类型检查", cmd: "cd web && npx tsc --noEmit", kind: "static" },
  { id: "G05", name: "前端构建", cmd: "npm --prefix web run build", kind: "build" },
  // G08 绕过回归:内嵌于 G06 脚本(合成样本每次运行),不单列命令。
  { id: "G09", name: "E2E 路由冒烟", cmd: "node server/scripts/e2e-route-smoke.mjs", kind: "optional", env: "TRIALROOM_E2E=1" },
  { id: "G14", name: "κ 校准门禁", cmd: "node tools/check-calibration.mjs", kind: "static" },
  { id: "G12", name: "题库来源卫生", cmd: "node tools/check-source-hygiene.mjs", kind: "static" },
  { id: "G13", name: "许可分发义务", cmd: "node tools/check-license-dist.mjs", kind: "static" },
  { id: "G11", name: "MCP 契约与暴露面", cmd: "node tools/check-mcp-contract.mjs && node tools/check-mcp-surface.mjs", kind: "static" },
  { id: "G10", name: "Docker 镜像构建", cmd: "node tools/check-docker-build.mjs", kind: "optional", needsDocker: true, env: "TRIALROOM_DOCKER=1" },
];

// ── 元自检 ────────────────────────────────────────────────────────────────
function metaCheck() {
  const problems = [];
  const ids = GATES.map((g) => g.id);
  if (new Set(ids).size !== ids.length) problems.push("GATES 存在重复 id");
  for (const g of GATES) {
    const m = g.cmd.match(/(tools\/[A-Za-z0-9_-]+\.(?:mjs|js))|((?:server|scripts)\/[A-Za-z0-9_/.-]+\.(?:mjs|js))/);
    if (!m) continue; // npm 命令无法静态定位脚本,运行期会自然失败
    const file = path.join(ROOT, m[1] ?? m[2]);
    if (!fs.existsSync(file)) problems.push(`${g.id} 指向的脚本不存在:${m[1] ?? m[2]}`);
  }
  return problems;
}

// ── 运行器 ────────────────────────────────────────────────────────────────
function shouldSkip(g) {
  if (g.needsDocker) {
    const probe = spawnSync("docker", ["--version"], { shell: true, stdio: "ignore" });
    if (probe.status !== 0) return "docker 不可用"; // 审查 F8:原写法 !x.status===0 恒 false(死分支)
  }
  if (g.env?.startsWith("TRIALROOM_E2E") && process.env.TRIALROOM_E2E !== "1") {
    return "TRIALROOM_E2E 未开启";
  }
  return null;
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log("id    kind      name");
  for (const g of GATES) console.log(`${g.id.padEnd(5)} ${g.kind.padEnd(9)} ${g.name}`);
  process.exit(0);
}

const only = args.find((a) => a.startsWith("--only"))?.split("=")[1]?.split(",");

const meta = metaCheck();
if (meta.length > 0) {
  console.error("元自检失败 —— GATES 注册表不可信:");
  for (const p of meta) console.error(`  ✗ ${p}`);
  process.exit(2);
}

const results = [];
for (const g of GATES) {
  if (only && !only.includes(g.id)) continue;
  const skipReason = shouldSkip(g);
  if (skipReason) {
    console.log(`— ${g.id} ${g.name}(跳过:${skipReason})`);
    results.push({ id: g.id, status: "SKIP" });
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(g.cmd, { cwd: ROOT, shell: true, encoding: "utf8", timeout: 15 * 60_000, env: { ...process.env, FORCE_COLOR: "0" } });
  const ms = Date.now() - t0;
  if (r.status === 0) {
    console.log(`✓ ${g.id} ${g.name}(${ms}ms)`);
    results.push({ id: g.id, status: "PASS" });
  } else {
    console.log(`✗ ${g.id} ${g.name}(${ms}ms,退出码 ${r.status})`);
    if (r.stdout) process.stdout.write(r.stdout.split("\n").slice(-12).join("\n"));
    if (r.stderr) process.stderr.write(r.stderr.split("\n").slice(-12).join("\n"));
    results.push({ id: g.id, status: "FAIL" });
  }
}

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const skip = results.filter((r) => r.status === "SKIP").length;
console.log(`\n──────────────────────────────────────`);
console.log(`门禁 ${results.length} 道:通过 ${pass} · 失败 ${fail} · 跳过 ${skip}(GATES 数组为唯一真相源,共 ${GATES.length} 项注册)`);
process.exit(fail > 0 ? 1 : 0);
