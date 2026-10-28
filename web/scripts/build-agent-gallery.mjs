// 智能体广场构建脚本:
//   读取 data/community-agents/*.json(社区贡献的 .ix-agent.json)
//   → schema 校验(缺必填/超长/违禁词一律拒绝,退出码 1)
//   → 生成 web/public/agents/index.json(列表+摘要,SPA /gallery 消费)
//   → 生成 web/public/agents/<id>/index.html(静态详情页:终端风内联 CSS +
//     「复制 JSON」按钮 + encodeURIComponent data URI 下载 .ix-agent.json)
// 用法:node scripts/build-agent-gallery.mjs [--data <dir>] [--out <dir>]
//   测试可用 --out 指到临时目录,不污染 public/。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "..");
const DEFAULT_DATA_DIR = path.join(repoRoot, "data", "community-agents");
const DEFAULT_OUT_DIR = path.join(webDir, "public", "agents");

// ===== 校验规则(枚举与 web/src/lib/agentIO.ts 导入白名单保持一致) =====
export const VALID_ROLES = ["hr", "tech", "ceo", "custom"];
export const VALID_TONES = ["gentle", "direct", "aggressive", "neutral", "professional"];
export const VALID_AGENT_KINDS = ["interviewer", "candidate"];
// 内容红线:见 CONTRIBUTING.md「提交你的智能体到广场」——只服务练习,不服务"替你上场"
export const BANNED_WORDS = ["替考", "作弊", "代面"];

export const LIMITS = {
  NAME_MAX: 40,
  AUTHOR_MAX: 30,
  DESC_MAX: 200,
  // promptTemplate 是智能体的灵魂:≥200 字保证有可执行结构(流程/追问/输出格式)
  PROMPT_MIN: 200,
  PROMPT_MAX: 8000,
  TAGS_MIN: 1,
  TAGS_MAX: 8,
  TAG_LEN_MAX: 12,
  FOCUS_MAX: 8,
};

// id 取自文件名(去 .json),必须是合法 slug,保证能安全落成目录名
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * 校验单个社区智能体。返回 { ok, errors }。
 * 与 server/test/platform-gallery.test.js 共用(从本模块 import)。
 */
export function validateAgent(agent, source = "agent") {
  const errors = [];
  const e = (msg) => errors.push(`${source}: ${msg}`);
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return { ok: false, errors: [`${source}: 必须是 JSON 对象`] };
  }
  // 必填 + 类型
  if (agent.kind !== "interviewx-agent") e(`kind 必须为 "interviewx-agent"`);
  if (agent.version !== 1) e(`version 必须为 1`);
  if (typeof agent.name !== "string" || !agent.name.trim()) e("name 必填且为非空字符串");
  else if (agent.name.length > LIMITS.NAME_MAX) e(`name 超长(${agent.name.length} > ${LIMITS.NAME_MAX})`);
  if (typeof agent.author !== "string" || !agent.author.trim()) e("author 必填且为非空字符串");
  else if (agent.author.length > LIMITS.AUTHOR_MAX) e(`author 超长(${agent.author.length} > ${LIMITS.AUTHOR_MAX})`);
  if (typeof agent.description !== "string" || !agent.description.trim()) e("description 必填且为非空字符串");
  else if (agent.description.length > LIMITS.DESC_MAX) e(`description 超长(${agent.description.length} > ${LIMITS.DESC_MAX})`);
  if (typeof agent.promptTemplate !== "string" || agent.promptTemplate.trim().length < LIMITS.PROMPT_MIN)
    e(`promptTemplate 必填且不少于 ${LIMITS.PROMPT_MIN} 字(当前 ${typeof agent.promptTemplate === "string" ? agent.promptTemplate.trim().length : 0})`);
  else if (agent.promptTemplate.length > LIMITS.PROMPT_MAX) e(`promptTemplate 超长(${agent.promptTemplate.length} > ${LIMITS.PROMPT_MAX})`);
  if (typeof agent.avatar !== "string" || !agent.avatar.trim()) e("avatar 必填(建议一个 emoji)");
  else if (agent.avatar.length > LIMITS.AVATAR_MAX) e(`avatar 超长(${agent.avatar.length} > ${LIMITS.AVATAR_MAX})`);
  // 枚举
  if (!VALID_ROLES.includes(agent.role)) e(`role 必须是 ${VALID_ROLES.join("/")}`);
  if (!VALID_TONES.includes(agent.tone)) e(`tone 必须是 ${VALID_TONES.join("/")}`);
  if (!VALID_AGENT_KINDS.includes(agent.agentKind)) e(`agentKind 必须是 ${VALID_AGENT_KINDS.join("/")}`);
  if (typeof agent.difficulty !== "number" || !Number.isInteger(agent.difficulty) || agent.difficulty < 1 || agent.difficulty > 10)
    e("difficulty 必须是 1-10 的整数");
  // 数组字段
  if (!Array.isArray(agent.tags) || agent.tags.length < LIMITS.TAGS_MIN || agent.tags.length > LIMITS.TAGS_MAX)
    e(`tags 必须是 ${LIMITS.TAGS_MIN}-${LIMITS.TAGS_MAX} 个元素的数组`);
  else if (agent.tags.some((t) => typeof t !== "string" || !t.trim() || t.length > LIMITS.TAG_LEN_MAX))
    e(`tags 每项必须为非空字符串且 ≤ ${LIMITS.TAG_LEN_MAX} 字`);
  if (!Array.isArray(agent.focusAreas) || agent.focusAreas.length === 0 || agent.focusAreas.length > LIMITS.FOCUS_MAX)
    e(`focusAreas 必须是 1-${LIMITS.FOCUS_MAX} 个元素的数组`);
  else if (agent.focusAreas.some((t) => typeof t !== "string" || !t.trim() || t.length > LIMITS.FOCUS_LEN_MAX))
    e(`focusAreas 每项必须为非空字符串且 ≤ ${LIMITS.FOCUS_LEN_MAX} 字`);
  // meta:广场展示元信息(与顶层字段同义,便于消费方一次取齐)
  if (!agent.meta || typeof agent.meta !== "object" || Array.isArray(agent.meta)) {
    e("meta 必填且为对象 { author, tags, difficulty, description }");
  } else {
    if (typeof agent.meta.author !== "string" || !agent.meta.author.trim()) e("meta.author 必填且为非空字符串");
    if (!Array.isArray(agent.meta.tags) || agent.meta.tags.length === 0) e("meta.tags 必须为非空数组");
    if (typeof agent.meta.difficulty !== "number" || agent.meta.difficulty < 1 || agent.meta.difficulty > 10) e("meta.difficulty 必须是 1-10 的数字");
    if (typeof agent.meta.description !== "string" || !agent.meta.description.trim()) e("meta.description 必填且为非空字符串");
    else if (agent.meta.description.length > LIMITS.DESC_MAX) e(`meta.description 超长(> ${LIMITS.DESC_MAX})`);
    if (typeof agent.meta.author !== "string" || agent.meta.author.length > LIMITS.AUTHOR_MAX) e(`meta.author 超长(> ${LIMITS.AUTHOR_MAX})`);
  }
  // 内容红线:任何文本字段出现违禁词即拒绝
  const scanned = [agent.name, agent.description, agent.promptTemplate, agent.author, agent.avatar, ...(agent.tags || []), ...(agent.focusAreas || []),
    agent.meta?.author, agent.meta?.description, ...(agent.meta?.tags || [])]
    .filter((v) => typeof v === "string")
    .join("\n");
  for (const w of BANNED_WORDS) {
    if (scanned.includes(w)) e(`含违禁词「${w}」(内容红线:不服务替考/作弊/代面类用途)`);
  }
  return { ok: errors.length === 0, errors };
}

// ===== HTML 生成 =====

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// <script type="application/json"> 内嵌原始 JSON:< 转义为 \u003c 防 </script> 提前闭合
function embedJsonSafe(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function difficultyDots(value) {
  return Array.from({ length: 10 }, (_, i) => `<span class="dot${i < value ? " on" : ""}"></span>`).join("") + `<span class="dim">${value}/10</span>`;
}

function detailPage(agent, id) {
  const jsonText = JSON.stringify(agent, null, 2);
  const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(jsonText)}`;
  const safeFile = `${id}.ix-agent.json`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(agent.name)} · Tryout 智能体广场</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background:#1e1e1e; color:#d4d4d4; font:13px/1.7 "SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace; padding:24px 16px 48px; }
  .wrap { max-width:860px; margin:0 auto; }
  .titlebar { display:flex; align-items:center; gap:8px; color:#6a9955; border:1px solid #333; background:#252526; padding:8px 12px; }
  .titlebar .path { color:#808080; }
  .card { border:1px solid #333; background:#252526; margin-top:16px; padding:20px; }
  h1 { font-size:20px; color:#4ec9b0; margin-bottom:4px; }
  .desc { color:#9cdcfe; margin:10px 0 14px; }
  .meta-row { display:flex; flex-wrap:wrap; gap:16px; align-items:center; color:#808080; font-size:12px; margin-bottom:10px; }
  .tag { display:inline-block; border:1px solid #3c3c3c; background:#1e1e1e; color:#ce9178; padding:1px 8px; margin:2px 4px 2px 0; font-size:11px; }
  .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#3c3c3c; margin-right:2px; }
  .dot.on { background:#4ec9b0; }
  .dim { color:#808080; margin-left:6px; font-size:11px; }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0 24px; }
  .btn { display:inline-block; border:1px solid #4ec9b0; color:#4ec9b0; background:transparent; padding:7px 14px; cursor:pointer; font:inherit; text-decoration:none; }
  .btn:hover { background:#4ec9b0; color:#1e1e1e; }
  .btn:disabled { opacity:.5; cursor:default; }
  h2 { font-size:14px; color:#569cd6; margin:18px 0 8px; }
  pre.prompt { white-space:pre-wrap; word-break:break-word; border:1px solid #333; background:#1e1e1e; padding:14px; color:#d4d4d4; }
  .hint { color:#808080; font-size:12px; margin-top:8px; }
  .foot { margin-top:24px; color:#808080; font-size:12px; }
  .foot a { color:#4ec9b0; text-decoration:none; }
  .ok { color:#6a9955 !important; }
</style>
</head>
<body>
<div class="wrap">
  <div class="titlebar"><span>●</span><span class="path">~/tryout/community-agents/${escapeHtml(id)}.json</span></div>
  <div class="card">
    <h1>${escapeHtml(agent.avatar)} ${escapeHtml(agent.name)}</h1>
    <div class="meta-row">
      <span>作者 ${escapeHtml(agent.author)}</span>
      <span>角色 ${escapeHtml(agent.role)}</span>
      <span>语气 ${escapeHtml(agent.tone)}</span>
      <span>难度 ${difficultyDots(agent.difficulty)}</span>
    </div>
    <div>${agent.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
    <p class="desc">${escapeHtml(agent.description)}</p>
    <div class="actions">
      <button class="btn" id="copy-btn" type="button">复制 JSON</button>
      <a class="btn" id="dl-btn" href="${dataUri}" download="${escapeHtml(safeFile)}">下载 ${escapeHtml(safeFile)}</a>
    </div>
    <p class="hint" id="copy-hint">复制后可在 Agent 工作台 → 导入,直接粘贴建卡;下载的 .ix-agent.json 可通过「导入」按钮加载。</p>
    <h2>promptTemplate</h2>
    <pre class="prompt">${escapeHtml(agent.promptTemplate)}</pre>
    <div class="foot"><a href="/gallery">← 返回智能体广场(/gallery)</a> · 由 build-agent-gallery.mjs 静态生成 · 提交你的智能体见 CONTRIBUTING.md</div>
  </div>
</div>
<script id="agent-data" type="application/json">${embedJsonSafe(agent)}</script>
<script>
(function () {
  var agent = JSON.parse(document.getElementById("agent-data").textContent);
  var btn = document.getElementById("copy-btn");
  var hint = document.getElementById("copy-hint");
  btn.addEventListener("click", function () {
    var text = JSON.stringify(agent, null, 2);
    function done(ok) {
      btn.textContent = ok ? "已复制 ✓" : "复制失败";
      if (ok) { btn.classList.add("ok"); setTimeout(function () { btn.textContent = "复制 JSON"; btn.classList.remove("ok"); }, 2000); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback(text)); });
    } else {
      done(fallback(text));
    }
  });
  // 非 https / 旧浏览器回退:隐藏 textarea + execCommand
  function fallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
})();
</script>
</body>
</html>
`;
}

// ===== 主流程 =====

function parseArgs(argv) {
  const out = { data: DEFAULT_DATA_DIR, out: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data") out.data = path.resolve(argv[++i]);
    else if (argv[i] === "--out") out.out = path.resolve(argv[++i]);
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
    else { console.error(`[build-agents] 未知参数: ${argv[i]}`); process.exit(1); }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/build-agent-gallery.mjs [--data <dir>] [--out <dir>]");
    return;
  }
  if (!fs.existsSync(args.data)) {
    console.error(`[build-agents] 数据目录不存在: ${args.data}`);
    process.exit(1);
  }
  const files = fs.readdirSync(args.data).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`[build-agents] ${args.data} 下没有任何 .json,广场不能为空`);
    process.exit(1);
  }

  const entries = [];
  let failed = false;
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const full = path.join(args.data, file);
    let agent;
    try {
      agent = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (err) {
      console.error(`✗ ${file}: JSON 解析失败 — ${err.message}`);
      failed = true;
      continue;
    }
    if (!ID_PATTERN.test(id)) {
      console.error(`✗ ${file}: 文件名 id「${id}」不合法(需匹配 ${ID_PATTERN})`);
      failed = true;
      continue;
    }
    const { ok, errors } = validateAgent(agent, file);
    if (!ok) {
      for (const msg of errors) console.error(`✗ ${msg}`);
      failed = true;
      continue;
    }
    entries.push({ id, file: `${id}.ix-agent.json`, agent });
  }
  if (failed) {
    console.error(`[build-agents] 校验失败,已拒绝(共 ${files.length} 个文件)。请按 CONTRIBUTING.md 修正后重试。`);
    process.exit(1);
  }

  // 输出目录:先清掉旧产物再写,防止改名/删除的智能体残留
  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(args.out, { recursive: true });

  const index = {
    kind: "interviewx-agent-gallery",
    version: 1,
    generatedAt: new Date().toISOString(),
    count: entries.length,
    agents: entries.map(({ id, file, agent }) => ({
      // 摘要字段(卡片直接可用)
      id,
      name: agent.name,
      description: agent.description,
      tags: agent.tags,
      difficulty: agent.difficulty,
      tone: agent.tone,
      role: agent.role,
      avatar: agent.avatar,
      author: agent.author,
      focusAreas: agent.focusAreas,
      agentKind: agent.agentKind,
      // 静态详情页(相对 web 根)与建议下载文件名
      detailPage: `agents/${id}/`,
      file,
      // 完整 .ix-agent.json 原文(SPA 端拼 data URI 下载导入用)
      agent,
    })),
  };

  for (const { id, agent } of entries) {
    const dir = path.join(args.out, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), detailPage(agent, id), "utf8");
  }
  fs.writeFileSync(path.join(args.out, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`[build-agents] ${entries.length} 个社区智能体 → ${path.relative(repoRoot, args.out)} (index.json + ${entries.length} 个详情页)`);
}

// 直接执行时才跑 main;被 import(测试复用校验函数)时只暴露 API
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
