#!/usr/bin/env node
// G07 · 路由数量下限门禁。
// 11-final-plan W1 目标:路由 ≥ 70 条(平台化新增路由后只增不减)。
// 统计口径:server/index.js 的 app.METHOD(...) + server/routes/*.js 的 router.METHOD(...)。
// 失败即退出码 1 —— 防止重构时路由被静默丢失。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN = Number(process.env.G07_MIN_ROUTES ?? 70);

function countFile(file, re) {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(re)].length;
}

const APP_RE = /app\.(?:get|post|put|delete|patch|all)\(\s*(?=["'`/])/g;
const ROUTER_RE = /router\.(?:get|post|put|delete|patch|all)\(\s*(?=["'`/])/g;

let total = countFile(path.join(ROOT, "server", "index.js"), APP_RE);
const routesDir = path.join(ROOT, "server", "routes");
const detail = [`index.js: ${total}`];
if (fs.existsSync(routesDir)) {
  for (const f of fs.readdirSync(routesDir).filter((f) => f.endsWith(".js"))) {
    const n = countFile(path.join(routesDir, f), ROUTER_RE);
    total += n;
    detail.push(`${f}: ${n}`);
  }
}
// 平台路由(platform/routes/*.js)同口径计入
const platDir = path.join(ROOT, "server", "platform", "routes");
if (fs.existsSync(platDir)) {
  for (const f of fs.readdirSync(platDir).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
    const n = countFile(path.join(platDir, f), ROUTER_RE);
    total += n;
    detail.push(`platform/${f}: ${n}`);
  }
}

console.log(`G07 路由下限:${total} 条(下限 ${MIN})[${detail.join(" + ")}]`);
if (total < MIN) {
  console.error(`G07 失败:路由数 ${total} < 下限 ${MIN} —— 有路由被静默丢失或未挂载`);
  process.exit(1);
}
