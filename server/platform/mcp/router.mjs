// MCP HTTP 挂载点 —— JSON-RPC 2.0 + 2026-07-28 规范新增边界。
// 依据:11-final-plan §3.7(S-11/12/13)/§3.3.2(tools/list 分片 / tools/call 授权)
//
// 边界纪律:
//   S-11 Mcp-Method/Mcp-Name 头体一致性:不一致 → 400 + HeaderMismatch(-32020),网关禁按头授权
//   S-12 _meta 只白名单取 protocolVersion/clientCapabilities 两键,原始体 ≤4KB
//   S-13 Origin 校验(防 DNS rebinding);无 Origin(服务端 agent)放行
//   roots/sampling/logging 显式不实现:收到 -32601(方案 §3.7.7)
//   tools/call 是唯一授权强制点;tools/list 收敛只做 UX(§3.2 双层模型)
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tools } from "./tools.mjs";
import { getDb, genId, nowIso } from "../db.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "mcp-tools.json"), "utf8"));

const NOT_FOUND_CODE = -32004;
const META_KEYS = new Set(["protocolVersion", "clientCapabilities"]);
const META_MAX_BYTES = 4096;
const ALLOWED_ORIGINS = () =>
  (process.env.MCP_ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:9090").split(",").map((s) => s.trim());

export const mcpRouter = express.Router();

mcpRouter.get("/", (req, res) => {
  // server/discover:公开元数据卡(不含工具细节与任何业务数据)
  res.json({
    name: MANIFEST.server.name,
    version: MANIFEST.server.version,
    protocol_version: MANIFEST.server.protocol_version,
    capabilities: { tools: {} },
    auth: { type: "bearer", scope_class: "mcp_tokens" },
  });
});

mcpRouter.post("/", express.json({ limit: "256kb" }), (req, res) => {
  const db = getDb();
  const clip = (v) => String(v ?? "").slice(0, 64); // 审计字段截断(审查 P0-2:超长 method/tool 灌库)
  const audit = (decision, extra = {}) =>
    db.prepare(`INSERT INTO mcp_audit (id, token_id, decision, deny_reason, method, tool_name, principal, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(genId("aud"), req.mcp?.token_id ?? null, decision, extra.deny_reason ?? null,
        clip(extra.method), clip(extra.tool), req.mcp?.user_id ?? null, extra.ms ?? null);

  const fail = (http, code, message, extra = {}) => {
    audit("deny", { deny_reason: extra.reason ?? String(code), method: req.body?.method, tool: req.body?.params?.name });
    res.status(http).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code, message } });
  };
  const ok = (result) => res.json({ jsonrpc: "2.0", id: req.body?.id ?? null, result });

  // S-13 Origin 校验(浏览器来源必须白名单;非浏览器 agent 无 Origin 放行)
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS().includes(origin)) {
    return fail(403, -32003, "Origin 不在白名单", { reason: "ORIGIN_DENIED" });
  }
  const body = req.body;
  if (!body || typeof body !== "object" || !body.method) {
    return fail(400, -32600, "非法 JSON-RPC 请求");
  }
  // S-11 头体一致性
  const hMethod = req.headers["mcp-method"];
  if (typeof hMethod === "string" && hMethod !== body.method) {
    return fail(400, -32020, "HeaderMismatch:Mcp-Method 与 body.method 不一致", { reason: "HEADER_MISMATCH" });
  }
  const hName = req.headers["mcp-name"];
  if (typeof hName === "string" && body.method === "tools/call" && hName !== body.params?.name) {
    return fail(400, -32020, "HeaderMismatch:Mcp-Name 与 tools/call 目标不一致", { reason: "HEADER_MISMATCH" });
  }
  // S-12 _meta 白名单 + 4KB 上限
  if (body._meta !== undefined) {
    const raw = JSON.stringify(body._meta);
    if (Buffer.byteLength(raw) > META_MAX_BYTES) {
      return fail(400, -32002, "_meta 超过 4KB 上限", { reason: "META_OVERSIZE" });
    }
    for (const k of Object.keys(body._meta)) {
      if (!META_KEYS.has(k)) delete body._meta[k]; // 只白名单取 2 键,其余忽略
    }
  }

  const started = Date.now();
  switch (body.method) {
    case "initialize":
      return ok({
        protocolVersion: MANIFEST.server.protocol_version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MANIFEST.server.name, version: MANIFEST.server.version },
        instructions: "Bearer mcp token;tools/list 按令牌 scope 分片;tools/call 为唯一授权点。",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return res.status(202).end();
    case "tools/list": {
      const visible = MANIFEST.tools.filter((t) => req.mcp.scopes.includes(t.scope));
      return ok({
        tools: visible.map((t) => ({
          name: t.name, description: t.description, annotations: t.annotations,
          inputSchema: { type: "object", properties: t.input, additionalProperties: false },
        })),
        _meta: { scope_sharded: true, total: MANIFEST.tools.length, visible: visible.length },
      });
    }
    case "tools/call": {
      const name = body.params?.name;
      const def = MANIFEST.tools.find((t) => t.name === name);
      // 越权与不存在同响应:不在 scope 的工具与未知工具同一错误(不泄露工具存在性)
      if (!def || !req.mcp.scopes.includes(def.scope)) {
        return fail(400, -32602, `unknown tool: ${name}`);
      }
      try {
        const result = tools[name](req.mcp, body.params?.arguments ?? {});
        if (result?.error) {
          audit("deny", { method: "tools/call", tool: name, reason: "TOOL_" + result.error.code, ms: Date.now() - started });
          return res.status(result.error.code === NOT_FOUND_CODE ? 404 : 400)
            .json({ jsonrpc: "2.0", id: body.id ?? null,
              error: { code: result.error.code, message: result.error.message } });
        }
        audit("allow", { method: "tools/call", tool: name, ms: Date.now() - started });
        return ok({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (e) {
        audit("deny", { method: "tools/call", tool: name, reason: "TOOL_CRASH", ms: Date.now() - started });
        return fail(500, -32603, "internal error");
      }
    }
    // 显式不实现的三能力(§3.7.7):收到即 -32601
    case "roots/list":
    case "sampling/createMessage":
    case "logging/setLevel":
      return fail(400, -32601, `${body.method} 未实现(A 期显式不实现)`);
    default:
      return fail(400, -32601, `method not found: ${body.method}`);
  }
});

