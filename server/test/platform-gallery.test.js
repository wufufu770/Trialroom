// 智能体广场:社区智能体数据门禁
//   直接读 data/community-agents/(fs.readdir),复用 build 脚本导出的同款校验函数,
//   并真实执行 build 脚本到临时目录,断言 index.json 覆盖全部条目。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// 校验逻辑与构建脚本同源:改规则只改 build-agent-gallery.mjs 一处,测试自动跟随
import { validateAgent, BANNED_WORDS, LIMITS, ID_PATTERN } from "../../web/scripts/build-agent-gallery.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const dataDir = path.join(repoRoot, "data", "community-agents");
const buildScript = path.join(repoRoot, "web", "scripts", "build-agent-gallery.mjs");
const webDir = path.join(repoRoot, "web");

function loadAgents() {
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json")).sort();
  assert.ok(files.length >= 4, "广场至少应有 4 个社区智能体");
  return files.map((f) => ({
    file: f,
    id: f.replace(/\.json$/, ""),
    agent: JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")),
  }));
}

test("gallery:全部社区智能体通过构建脚本同款校验(必填字段/枚举/长度/id 命名)", () => {
  const agents = loadAgents();
  for (const { file, id, agent } of agents) {
    const { ok, errors } = validateAgent(agent, file);
    assert.ok(ok, `${file} 应通过校验,错误: ${errors.join("; ")}`);
    assert.match(id, ID_PATTERN, `${file} 文件名需为合法 slug(小写字母/数字/短横线)`);
  }
});

test("gallery:promptTemplate 长度达标且含可执行结构,meta 与顶层字段齐全", () => {
  for (const { file, agent } of loadAgents()) {
    assert.ok(
      typeof agent.promptTemplate === "string" && agent.promptTemplate.trim().length >= LIMITS.PROMPT_MIN,
      `${file} promptTemplate ≥ ${LIMITS.PROMPT_MIN} 字`
    );
    // 可执行结构:至少包含流程与输出格式的章节标记,拒绝一句人设式 prompt
    assert.match(agent.promptTemplate, /流程/, `${file} promptTemplate 应包含面试流程章节`);
    assert.match(agent.promptTemplate, /输出格式|复盘输出格式/, `${file} promptTemplate 应包含输出格式章节`);
    // meta 与顶层字段一并提供(author/tags/difficulty/description)
    assert.equal(typeof agent.meta?.author, "string", `${file} meta.author 应为字符串`);
    assert.ok(Array.isArray(agent.meta?.tags) && agent.meta.tags.length > 0, `${file} meta.tags 应为非空数组`);
    assert.equal(agent.meta?.difficulty, agent.difficulty, `${file} meta.difficulty 应与顶层 difficulty 一致`);
    assert.equal(typeof agent.meta?.description, "string", `${file} meta.description 应为字符串`);
  }
});

test("gallery:tags 为受限字符串数组,且全库无违禁词(替考/作弊/代面)", () => {
  for (const { file, agent } of loadAgents()) {
    assert.ok(Array.isArray(agent.tags), `${file} tags 必须是数组`);
    assert.ok(agent.tags.length >= LIMITS.TAGS_MIN && agent.tags.length <= LIMITS.TAGS_MAX, `${file} tags 数量 1-${LIMITS.TAGS_MAX}`);
    for (const tag of agent.tags) {
      assert.equal(typeof tag, "string", `${file} tag 应为字符串`);
      assert.ok(tag.trim().length > 0 && tag.length <= LIMITS.TAG_LEN_MAX, `${file} tag「${tag}」超长或为空`);
    }
    // 违禁词扫描:所有用户可见文本字段
    const scanned = [agent.name, agent.description, agent.promptTemplate, agent.author, ...agent.tags, ...agent.focusAreas]
      .filter((v) => typeof v === "string")
      .join("\n");
    for (const w of BANNED_WORDS) {
      assert.ok(!scanned.includes(w), `${file} 不得含违禁词「${w}」`);
    }
  }
  // 反向验证:校验函数确实会拒绝含违禁词的智能体(防"测试通过但门禁失效")
  const good = loadAgents()[0].agent;
  const poisoned = { ...good, name: "代面神器", meta: { ...good.meta, author: "x" } };
  assert.equal(validateAgent(poisoned, "poisoned.json").ok, false, "含违禁词的智能体应被拒绝");
});

test("gallery:build 脚本可在临时目录真实执行,index.json 包含全部条目与详情页", () => {
  const agents = loadAgents();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ix-gallery-"));
  try {
    execFileSync(process.execPath, [buildScript, "--out", tmp], { cwd: webDir, stdio: "pipe" });
    const idx = JSON.parse(fs.readFileSync(path.join(tmp, "index.json"), "utf8"));
    assert.equal(idx.count, agents.length, "index.json.count 与源文件数一致");
    const ids = idx.agents.map((a) => a.id).sort();
    assert.deepEqual(ids, agents.map((a) => a.id).sort(), "index.json 覆盖全部条目");
    for (const entry of idx.agents) {
      // 每个智能体都有静态详情页,内含 data URI 下载链接与复制按钮
      const htmlPath = path.join(tmp, entry.id, "index.html");
      assert.ok(fs.existsSync(htmlPath), `${entry.id} 详情页已生成`);
      const html = fs.readFileSync(htmlPath, "utf8");
      assert.ok(html.includes("复制 JSON"), `${entry.id} 详情页含复制按钮`);
      assert.match(html, /href="data:application\/json;charset=utf-8,[^"]+"/, `${entry.id} 详情页含 data URI 下载链接`);
      assert.ok(html.includes(encodeURIComponent(JSON.stringify(entry.agent, null, 2)).slice(0, 200)), `${entry.id} data URI 内容与完整 JSON 一致`);
      // 索引条目携带完整 .ix-agent.json,SPA 可直接拼 data URI 下载导入
      assert.equal(entry.agent.kind, "interviewx-agent");
      assert.equal(typeof entry.agent.promptTemplate, "string");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
