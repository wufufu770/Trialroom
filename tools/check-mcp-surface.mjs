#!/usr/bin/env node
// G11b · MCP 暴露面门禁 —— 挂载拓扑与规范边界的静态断言。
// 判据:
//   1. index.js 存在 `app.use("/mcp", mcpAuthMiddleware, mcpRouter)`(同挂载 auth 在前)
//   2. index.js 存在 platform 挂载点 mountPlatform(app)
//   3. router.mjs:头体不一致 -32020;_meta 4KB 上限;三能力 -32601;越权 NOT_FOUND 404 语义
//   4. auth-mcp.mjs:sha256 查表 + revoked/expires 校验 + deny/allow 同权审计
//   5. nginx:独立 location /mcp/ 且 Mcp-* 头透传(SPA fallback 吞 /mcp 的修复)
//   6. tools.mjs:推进判 seat 不判 scope(is_host);返回不含 room_code 由 G11a 管
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const errs = [];
const need = (cond, msg) => { if (!cond) errs.push(msg); };

const idx = read("server/index.js");
need(/app\.use\("\/mcp",[^;]*mcpAuthMiddleware[^;]*mcpRouter\)/.test(read("server/platform/index.mjs")),
  "platform/index.mjs 缺同挂载鉴权形态 app.use(\"/mcp\", [限流...,] mcpAuthMiddleware, mcpRouter)");
need(idx.includes("mountPlatform(app)"), "index.js 缺 mountPlatform(app) 挂载点");

const router = read("server/platform/mcp/router.mjs");
need(router.includes("-32020") && router.includes("HeaderMismatch"), "router 缺 S-11 头体一致(-32020)");
need(router.includes("META_MAX_BYTES") && router.includes("4096"), "router 缺 S-12 _meta 4KB 上限");
need(router.includes("-32601"), "router 缺 roots/sampling/logging 的 -32601 显式不实现");
need(/status\(result\.error\.code === NOT_FOUND_CODE \? 404/.test(router), "router 缺越权 404 语义(NOT_FOUND 同响应)");

const auth = read("server/platform/mcp/auth-mcp.mjs");
need(auth.includes("token_hash") && auth.includes("sha256Hex"), "auth-mcp 必须哈希查表(不存明文)");
need(auth.includes("revoked_at") && auth.includes("expires_at"), "auth-mcp 缺吊销/过期校验");
need(auth.includes('audit("allow"') && auth.includes('audit("deny"'), "auth-mcp 缺 allow/deny 同权审计");

const tools = read("server/platform/mcp/tools.mjs");
need(tools.includes("is_host"), "tools.mjs 推进权必须判 seat(is_host) 不判 scope");

const nginx = read("docker/nginx.conf");
need(/location\s+\/mcp\//.test(nginx), "nginx 缺独立 location /mcp/(SPA fallback 会吞掉 /mcp)");
need(/location\s+=\s+\/mcp\b/.test(nginx), "nginx 缺精确 location = /mcp(挂载根无尾斜杠,审查 F3)");
need(/location\s+=\s*\/track\b/.test(nginx), "nginx 缺 location = /track(埋点被 SPA 吞,landing_uv 全丢)");
need(nginx.includes("proxy_set_header Mcp-Method") && nginx.includes("proxy_set_header Mcp-Name"),
  "nginx /mcp/ 必须显式透传 Mcp-* 头(头名大小写敏感)");
need(/location\s+\/pay\//.test(nginx), "nginx 缺 location /pay/(支付宝异步通知)");

if (errs.length > 0) {
  console.error(`G11b MCP 暴露面:${errs.length} 处违例`);
  for (const e of errs) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("G11b MCP 暴露面:通过(挂载拓扑 · 规范边界 · nginx 独立通路)");
