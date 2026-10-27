#!/usr/bin/env node
// G06 · 鉴权作用域覆盖门禁（作用域语义，不是行号比较）
//
// 为什么这样写（11-final-plan P0-5 / S-09 的教训）:
//   旧版门禁只比较「authMiddleware 出现的行号 < 路由行号」，不看挂载前缀。
//   `app.use("/mcp", mcpRouter)` 这种没有 auth 的挂载会被误判 PASS。
//   正确语义是「作用域覆盖」:每一条会处理请求的路由挂载,其路径前缀上
//   必须已经挂过对应作用域的鉴权中间件;前缀不覆盖(如 /api 的 auth 罩不住
//   /mcp)即为绕过。
//
// 判定规则:
//   R1  authMiddleware 只覆盖 /api 作用域;mcpAuthMiddleware 只覆盖 /mcp。
//   R2  任何「路由挂载」(app.use(scope, router) 或 app.METHOD(scope, ...))
//       的 scope 必须被更早注册的、作用域能覆盖它的鉴权挂载罩住。
//   R3  白名单:/api/health(探活豁免)。
//   R4  门禁自身可信性:每次运行先跑「合成绕过样本回归」,任何一条分类
//       错误即退出码 2(门禁不可信,等同于失败)。
//
// 退出码: 0 = 通过 · 1 = 发现真实绕过 · 2 = 门禁自身回归失败

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 多文件扫描(审查 F1:此前只扫 index.js,platform/index.mjs 的全部挂载是盲区;
// mountPlatform(app) 内的 app.use 逃过检查)。auth 作用域按文件序跨文件携带。
const SCAN_FILES = [
  path.join(ROOT, "server", "index.js"),
  path.join(ROOT, "server", "platform", "index.mjs"),
];
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// ---- 纯函数核心(供测试与合成回归复用) ------------------------------------

// 已知的鉴权中间件 → 其能覆盖的作用域前缀
const AUTH_SCOPES = {
  authMiddleware: "/api",
  mcpAuthMiddleware: "/mcp",
};

// 白名单:精确完整路径。豁免必须显式登记并给理由(作用域豁免审计制):
//   /api/health                基础探活(基座既有豁免)
//   /pay/alipay/notify         外部回调,鉴权 = 支付宝 RSA2 验签(通知体逐字段)
//   /track                     匿名埋点,事件白名单+2KB 上限,不落 PII
//   /api/platform/auth/alipay/* 登录入口(OAuth 授权码流):公开是语义本身,
//                              防护 = state 一次性(10min)+ 公共限流;登录后才是平台令牌
const EXEMPT_REMAINDERS = new Set([
  "/api/health", "/pay/alipay/notify", "/track",
  "/api/platform/auth/alipay/start", "/api/platform/auth/alipay/callback",
  "/share/:code.svg",
]);

const METHOD_NAMES = ["get", "post", "put", "delete", "patch", "all"];

/**
 * 从 app.use( / app.METHOD( 的开括号起,做带字符串状态机的括号配平,
 * 返回完整参数文本与结束位置。字符串/模板串里的括号不计数。
 */
function scanBalanced(src, openIdx) {
  let depth = 0, i = openIdx, str = null, esc = false;
  while (i < src.length) {
    const c = src[i];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === str) str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; i++; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { text: src.slice(openIdx + 1, i), end: i };
    }
    i++;
  }
  return null; // 未闭合
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/**
 * 解析源码中的挂载与路由注册,返回按出现顺序排列的条目。
 * 作用域必须是第一个参数且为字符串字面量;中间件参数取括号配平后的完整文本
 * (箭头函数体内引用 authMiddleware 也能被识别)。
 * @returns {Array<{kind:"use"|"route", scope:string, mids?:string, method?:string, line:number}>}
 */
export function parseMounts(src) {
  const out = [];
  for (const m of src.matchAll(/app\.use\(\s*(?="|')/g)) {
    const open = src.indexOf("(", m.index);
    const balanced = scanBalanced(src, open);
    if (!balanced) continue;
    const argText = balanced.text;
    const scopeMatch = argText.match(/^\s*(?:"([^"]+)"|'([^']+)')\s*,\s*([\s\S]*)$/);
    if (!scopeMatch) continue;
    out.push({
      kind: "use",
      scope: scopeMatch[1] ?? scopeMatch[2],
      mids: scopeMatch[3],
      line: lineOf(src, m.index),
      _pos: m.index,
    });
  }
  for (const name of METHOD_NAMES) {
    for (const m of src.matchAll(new RegExp(`app\\.${name}\\(\\s*(?="|')`, "g"))) {
      const open = src.indexOf("(", m.index);
      const balanced = scanBalanced(src, open);
      if (!balanced) continue;
      const scopeMatch = balanced.text.match(/^\s*(?:"([^"]+)"|'([^']+)')/);
      if (!scopeMatch) continue;
      out.push({
        kind: "route",
        scope: scopeMatch[1] ?? scopeMatch[2],
        method: name,
        line: lineOf(src, m.index),
        _pos: m.index,
      });
    }
  }
  return out.sort((a, b) => a._pos - b._pos);
}

function covers(authScope, target) {
  if (authScope === target) return true;
  if (authScope === "/") return true;
  return target.startsWith(authScope.endsWith("/") ? authScope : authScope + "/");
}

// 鉴权类别匹配:/mcp 路径必须由 mcpAuthMiddleware 罩住(token class 分离,
// 全局 authMiddleware 挂在根作用域也不算数 —— X-1 令牌混淆防护);
// 其余路径接受 authMiddleware。
function classMatches(mids, target) {
  if (target === "/mcp" || target.startsWith("/mcp/")) {
    return mids.includes("mcpAuthMiddleware");
  }
  return mids.includes("authMiddleware");
}

function isAuthMount(mids) {
  return mids.includes("authMiddleware") || mids.includes("mcpAuthMiddleware");
}

/**
 * 作用域覆盖判定。返回违例数组(空 = 通过)。
 * 只判定 use-挂载中的「路由型」挂载(带 router/Router 变量)与全部 route 注册;
 * 纯中间件挂载(限流等)跳过。
 */
export function evaluateMounts(mounts) {
  const violations = [];
  const authedScopes = []; // {scope, mids, line} 已注册的鉴权挂载
  for (const m of mounts) {
    if (m.kind === "use") {
      if (isAuthMount(m.mids ?? "")) {
        authedScopes.push({ scope: m.scope, mids: m.mids, line: m.line });
        continue; // 鉴权挂载本身不是被保护对象
      }
      // 路由型挂载:末尾实参 token 是 router/Router(含属性式 payment.router,审查 F2)
      if (/[A-Za-z_$.)]*[Rr]outer\b/.test(m.mids ?? "")) {
        const covered = authedScopes.some((a) => covers(a.scope, m.scope) && classMatches(a.mids, m.scope));
        if (!covered) {
          violations.push({
            line: m.line,
            scope: m.scope,
            why: `路由挂载 ${m.scope} 之前没有任何作用域能覆盖它的鉴权中间件`,
          });
        }
      }
      continue;
    }
    if (m.kind === "route") {
      const target = m.scope; // 精确路由路径
      if (EXEMPT_REMAINDERS.has(target)) continue;
      const covered = authedScopes.some((a) => covers(a.scope, target) && classMatches(a.mids, target));
      if (!covered) {
        violations.push({
          line: m.line,
          scope: m.scope,
          why: `路由 app.${m.method}(${m.scope}) 未被任何鉴权作用域覆盖`,
        });
      }
    }
  }
  return violations;
}

// ---- 合成绕过样本回归(门禁可信性) ----------------------------------------
// 每条样本都必须被正确分类;任何一条分错 → 退出码 2。
// 样本按 11-final-plan §3.11.1「21 项绕过回归」的类别压缩为代表性全集。
const REGRESSION_SAMPLES = [
  // [名称, 源码片段, 应当违例(true)/应当通过(false)]
  ["基线:/api auth 在前 + 路由在后", `app.use("/api", authMiddleware);\napp.get("/api/agents", h);`, false],
  ["绕过1:路由在 auth 之前", `app.get("/api/agents", h);\napp.use("/api", authMiddleware);`, true],
  ["绕过2:mcp router 无 auth", `app.use("/api", authMiddleware);\napp.use("/mcp", mcpRouter);`, true],
  ["绕过2b:属性式 router 挂载无 auth(payment.router 形态)", `app.use("/secret", payment.router);`, true],
  ["绕过2c:platform 文件里的裸路由", `app.get("/internal/export", h);`, true],
  ["通过:mcp 同挂载内 auth 在前", `app.use("/mcp", mcpAuthMiddleware, mcpRouter);`, false],
  ["通过:mcp 挂载带限流前缀 + auth + router", `app.use("/mcp", createRateLimiter({ max: 30 }), mcpAuthMiddleware, mcpRouter);`, false],
  ["通过:mcp 先 auth 后 router 分挂", `app.use("/mcp", mcpAuthMiddleware);\napp.use("/mcp", mcpRouter);`, false],
  ["绕过3:/api auth 罩不住 /mcp", `app.use("/api", authMiddleware);\napp.use("/mcp", (req,res,next)=>next());\napp.post("/mcp/x", h);`, true],
  ["绕过4:根作用域 router 无 auth", `app.use("/", rootRouter);`, true],
  ["通过:/ 根 auth 覆盖一切", `app.use("/", (req,res,next)=>authMiddleware(req,res,next));\napp.use("/api", analysisRouter);`, false],
  ["通过:health 白名单", `app.use("/api", authMiddleware);\napp.get("/api/health", h);`, false],
  ["绕过5:health 白名单不豁免子路径", `app.get("/api/health/inner", h);`, true],
  ["通过:限流挂载不需要 auth", `app.use("/api", createRateLimiter({max:1}));`, false],
  ["绕过6:深前缀未被浅 auth 覆盖的反例不成立(字符串前缀陷阱)", `app.use("/api-v2", authMiddleware);\napp.use("/api", analysisRouter);`, true],
  ["绕过7:仅 mcpAuth 不覆盖 /api", `app.use("/mcp", mcpAuthMiddleware);\napp.get("/api/sessions", h);`, true],
  ["通过:同级二次挂载 router 已被覆盖", `app.use("/api", authMiddleware);\napp.use("/api", analysisRouter);\napp.use("/api", paymentRouter);`, false],
];

function runRegression() {
  let failed = 0;
  for (const [name, src, shouldViolate] of REGRESSION_SAMPLES) {
    const v = evaluateMounts(parseMounts(src));
    const violated = v.length > 0;
    if (violated !== shouldViolate) {
      console.error(`  ✗ 回归样本分类错误:「${name}」期望${shouldViolate ? "违例" : "通过"},实际${violated ? "违例" : "通过"}`);
      failed++;
    }
  }
  return failed;
}

// ---- CLI(仅作为主模块执行时) --------------------------------------------
if (IS_MAIN) {
  const [, , targetFile] = process.argv;
  const files = targetFile ? [path.resolve(targetFile)] : SCAN_FILES;
  // 逐文件解析并按文件序拼接(auth 作用域跨文件携带:index.js 的 /api auth
  // 依然罩住 platform/index.mjs 里后注册的同前缀路由)
  let allMounts = [];
  for (const f of files) allMounts = allMounts.concat(parseMounts(fs.readFileSync(f, "utf8")));
  const violations = evaluateMounts(allMounts);

  const regFailed = runRegression();
  if (regFailed > 0) {
    console.error(`\nG06 门禁自身回归失败 ${regFailed} 条 —— 门禁不可信,视为失败`);
    process.exit(2);
  }
  if (violations.length > 0) {
    console.error(`\nG06 鉴权作用域覆盖:发现 ${violations.length} 处绕过`);
    for (const v of violations) console.error(`  server/index.js:${v.line}  ${v.why}`);
    process.exit(1);
  }
  console.log(`G06 鉴权作用域覆盖:通过(含 ${REGRESSION_SAMPLES.length} 条合成绕过回归全绿,扫描 ${files.length} 个文件)`);
}
