// 群面个人表现报告:纯函数单测(parseGroupReport / buildGroupReportTranscript)
// 关注点:这两个函数直接决定"用户玩完群面后拿到的是可信评估还是垃圾数据"。
// parseGroupReport 任何不合法都必须抛 ValidationError(→ 400 VALIDATION),
// 绝不能把未校验结构透传给客户端。
//
// 注:analysis.js 顶层 import db.js(模块加载即建库),必须在动态 import 前
// 设置 DB_DIR;外部已设置时(npm test 的 setup-env.mjs / CI)一律尊重。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.DB_DIR) {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-group-report-"));
}

const { parseGroupReport, buildGroupReportTranscript } = await import("../routes/analysis.js");
const { ValidationError } = await import("../db.js");

// 合法报告样例(供各用例复用/篡改)
const validReport = {
  dimensions: { logic: 4, communication: 3, teamwork: 5 },
  strengths: ["主动推进了讨论节奏", "观点有数据支撑"],
  improvements: ["发言可更简洁", "注意倾听他人观点", "结论可再量化"],
};

test("合法 JSON:完整通过并返回强校验结构", () => {
  const r = parseGroupReport(JSON.stringify(validReport));
  assert.deepEqual(r.dimensions, { logic: 4, communication: 3, teamwork: 5 });
  assert.equal(r.strengths.length, 2);
  assert.equal(r.improvements.length, 3);
  // 不允许夹带未校验字段以外的顶层垃圾 —— 结构恒为 dimensions/strengths/improvements
  assert.deepEqual(Object.keys(r).sort(), ["dimensions", "improvements", "strengths"]);
});

test("包裹文本:```json 代码围栏(以及前后噪声/think 块)均能解析", () => {
  const fenced = "```json\n" + JSON.stringify(validReport, null, 2) + "\n```";
  assert.deepEqual(parseGroupReport(fenced).dimensions, validReport.dimensions);

  const noisy = `好的,以下是评估结果:\n<think>推理过程,不该影响解析</think>\n${fenced}\n希望对你有帮助`;
  assert.deepEqual(parseGroupReport(noisy).strengths, validReport.strengths);
});

test("缺维度:dimensions 缺字段 / strengths 缺失 → 400 VALIDATION", () => {
  // 缺 teamwork 维度
  assert.throws(
    () => parseGroupReport(JSON.stringify({
      dimensions: { logic: 4, communication: 3 },
      strengths: ["a"], improvements: ["b"],
    })),
    (e) => e instanceof ValidationError && /团队协作/.test(e.message),
  );
  // 整个 dimensions 缺失
  assert.throws(
    () => parseGroupReport(JSON.stringify({ strengths: ["a"], improvements: ["b"] })),
    (e) => e instanceof ValidationError && /dimensions/.test(e.message),
  );
  // strengths 缺失
  assert.throws(
    () => parseGroupReport(JSON.stringify({ dimensions: validReport.dimensions, improvements: ["b"] })),
    ValidationError,
  );
  // 完全不是 JSON
  assert.throws(() => parseGroupReport("模型拒绝了请求"), ValidationError);
});

test("分数越界:0 或 6(含非整数/字符串数字)→ 400 VALIDATION", () => {
  for (const bad of [0, 6, -1, 3.5, "high"]) {
    const report = {
      dimensions: { logic: bad, communication: 3, teamwork: 5 },
      strengths: ["a"], improvements: ["b"],
    };
    assert.throws(
      () => parseGroupReport(JSON.stringify(report)),
      (e) => e instanceof ValidationError && /分数缺失或越界/.test(e.message),
      `score=${JSON.stringify(bad)} 应被拒绝`,
    );
  }
  // 边界内 1 和 5 必须放行
  const ok = parseGroupReport(JSON.stringify({
    dimensions: { logic: 1, communication: 5, teamwork: 3 },
    strengths: ["a"], improvements: ["b"],
  }));
  assert.deepEqual(ok.dimensions, { logic: 1, communication: 5, teamwork: 3 });
});

test("超长输入:截断后仍可解析,且护栏(40 条 / 6000 字符)生效", () => {
  // 80 条用户发言,单条 300 字符 → 远超双护栏
  const longSpeech = "这是发言内容".repeat(50); // 300 字符
  const messages = Array.from({ length: 80 }, (_, i) => ({
    role: "user", content: `第${i}条:${longSpeech}`,
  }));
  const transcript = buildGroupReportTranscript(messages);
  assert.ok(transcript.length <= 6000 + 20, `截断后应 ≤6000 字符左右,实际 ${transcript.length}`);
  assert.ok(transcript.includes("已截断"), "应标注截断");
  // 截断后的 transcript 拼进 prompt 照常评估,LLM 合法输出仍可解析
  const r = parseGroupReport(JSON.stringify(validReport));
  assert.deepEqual(r.dimensions, validReport.dimensions);
});

test("用户发言提取:只取用户、兼容三种消息形态、条数上限 40", () => {
  const mixed = [
    { role: "assistant", content: "面试官开场" },                 // analysis 形态,非用户
    { role: "user", content: "用户发言一" },                       // analysis 形态
    { speakerKind: "candidate", content: "候选人甲" },             // MeetingMessage 形态,非用户
    { speakerKind: "user", content: "用户发言二" },                // MeetingMessage 形态
    { speakerId: "user", content: "用户发言三" },                  // speakerId 形态
    { role: "user", content: "   " },                              // 空白发言剔除
    "不是对象",                                                     // 脏元素剔除
    null,
  ];
  const transcript = buildGroupReportTranscript(mixed);
  assert.ok(transcript.includes("用户发言一"));
  assert.ok(transcript.includes("用户发言二"));
  assert.ok(transcript.includes("用户发言三"));
  assert.ok(!transcript.includes("面试官开场"));
  assert.ok(!transcript.includes("候选人甲"));

  // 恰好 41 条用户发言 → 只取前 40 条
  const many = Array.from({ length: 41 }, (_, i) => ({ role: "user", content: `发言${i}` }));
  const t40 = buildGroupReportTranscript(many);
  assert.ok(t40.includes("发言39"), "第 40 条应保留");
  assert.ok(!t40.includes("发言40"), "第 41 条应被截掉");

  // 无用户发言 → 空串(路由层据此报 400)
  assert.equal(buildGroupReportTranscript([{ role: "assistant", content: "只有 AI" }]), "");
  assert.equal(buildGroupReportTranscript(undefined), "");
  assert.equal(buildGroupReportTranscript("not-an-array"), "");
});

test("建议列表:非字符串项剔除、超 3 条截断、空列表 → 400", () => {
  const r = parseGroupReport(JSON.stringify({
    dimensions: validReport.dimensions,
    strengths: ["有效的", 42, null, "也是有效的", "第三条", "第四条被截"],
    improvements: ["改进一"],
  }));
  assert.deepEqual(r.strengths, ["有效的", "也是有效的", "第三条"]);
  assert.deepEqual(r.improvements, ["改进一"]);

  // strengths 全是非字符串 → 400
  assert.throws(
    () => parseGroupReport(JSON.stringify({
      dimensions: validReport.dimensions,
      strengths: [1, 2, 3],
      improvements: ["b"],
    })),
    (e) => e instanceof ValidationError && /strengths/.test(e.message),
  );
});
