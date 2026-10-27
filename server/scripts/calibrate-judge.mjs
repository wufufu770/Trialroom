#!/usr/bin/env node
// κ 校准管线(mock-first) —— S2 采样 → S3 标注 → S4 判据 → S5 产物。
// 依据:docs/spec/11-final-plan.md §4.2.7(S0–S5)/§4.10(成本)
//
// 用法:
//   node server/scripts/calibrate-judge.mjs                  # mock 判官,产占位产物
//   node server/scripts/calibrate-judge.mjs --full           # bootstrap 10000 次(mock 500)
//   node server/scripts/calibrate-judge.mjs --provider minimax   # 真实判官(需环境变量)
//
// 诚实纪律:mock 判官的产物 verdict=placeholder,任何 κ 数值不得进参评材料;
//          真实判官走 key 环境变量,五指纹落库,一次 run 出现两种 model_version 即作废。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  LABELS, compare, mulberry32,
} from "../platform/calibration/kappa.mjs";
import { JUDGE_DIMENSIONS, gateCalibration } from "../platform/calibration/qualification.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "qa", "calibration");

// ── S2 采样(40 题 × 3 判定维 = 120 item,按难度分层 —— mock 语料按同结构生成) ──
const SAMPLE_QUESTIONS = Number(process.env.CALIB_N ?? 40);

// ── S3 标注 ────────────────────────────────────────────────────────────────
// mock 标注者:种子确定性;h1/h2 之间、judge/h1 之间的扰动率是**构造参数**,
// 让 mock 产物天然落在真实校准会出现的区间(κ_HH 高、κ_JH 略低),便于全链路演练。
function mockLabels(n, seed, jitterTo) {
  const rnd = mulberry32(seed);
  const truth = Array.from({ length: n }, () => Math.floor(rnd() * LABELS.length));
  const mk = (jitterRate) => truth.map((t) =>
    rnd() < jitterRate ? Math.max(0, Math.min(LABELS.length - 1, t + (rnd() < 0.5 ? -1 : 1))) : t);
  return { truth, labels: mk(jitterTo) };
}

function toLetters(idx) { return idx.map((i) => LABELS[i]); }

// ── 主流程 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const provider = args.includes("--provider") ? args[args.indexOf("--provider") + 1] : "mock";
const full = args.includes("--full");

// ── 真实判官(OpenAI 兼容协议;TRIALROOM_LLM_BASE_URL / _API_KEY / _MODEL) ──
const LLM_BASE = process.env.TRIALROOM_LLM_BASE_URL ?? "https://api.minimax.chat/v1";
const LLM_MODEL = process.env.TRIALROOM_LLM_MODEL ?? "MiniMax-M2";

const ANCHORS = {
  logic: "A=论证链完整无跳跃 B=基本完整有小缺口 C=部分成立 D=链路断裂为主 E=未围绕问题",
  problem_solving: "A=方案可落地且权衡到位 B=可落地权衡略欠 C=方向对但落地存疑 D=偏题 E=未回答",
  technical_depth: "A=概念+原理+边界都准 B=概念原理准缺边界 C=概念准但浅 D=有事实性错误 E=未涉及",
};

async function judgeLabelViaLlm({ question, answer, dimension, apiKey }) {
  const system = `你是技术面试评分判官。对候选人在维度「${dimension}」上的回答给出锚点评级。锚点:${ANCHORS[dimension]}。只输出一个字母(A/B/C/D/E),不输出其他内容。`;
  const user = `题目:${question}\n\n候选人回答:${answer}`;
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0,
      max_tokens: 4,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`判官调用失败 HTTP ${res.status}:${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "";
  const m = text.toUpperCase().match(/[ABCDE]/);
  if (!m) throw new Error(`判官输出无法解析为锚点:${JSON.stringify(text).slice(0, 100)}`);
  return { label: m[0], model: j.model ?? LLM_MODEL, prompt_hash: crypto.createHash("sha256").update(system).digest("hex").slice(0, 16) };
}

async function runRealJudge() {
  const apiKey = process.env.TRIALROOM_LLM_API_KEY;
  if (!apiKey) {
    console.error("真实判官需要环境变量 TRIALROOM_LLM_API_KEY(以及可选 TRIALROOM_LLM_BASE_URL / TRIALROOM_LLM_MODEL)。");
    console.error("key 未注入前,先用默认 mock 管线(结构/门禁/换算表全部就绪,κ 为占位符)。");
    process.exit(2);
  }
  // 语料:题面取真实题库(分层抽样),回答为种子生成语料(真实用户语料回填前,
  // 判官测的是「锚点量纲下的判官稳定性」,该限制写入产物 honesty_note)
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "data", "questionbank.json"), "utf8"));
  const questions = (bank.questions ?? bank)
    .filter(q => q.referenceAnswer && (q.content ?? q.title).length >= 40)
    .sort(() => 0.5 - Math.sin(20261027)) // 确定性洗牌(可复现)
    .slice(0, SAMPLE_QUESTIONS);
  const seenModels = new Set();
  const dimensions = {};
  for (const dim of JUDGE_DIMENSIONS) {
    const dimSeed = crypto.createHash("sha256").update(`real:${dim}`).digest().readUInt32BE(0);
    const jitter = mulberry32(dimSeed);
    const h1 = [], h2 = [], judge = [];
    for (const q of questions) {
      // 标注者标签:锚点+受控扰动(真实流程替换为人工标注入库 calibration_labels)
      const truth = Math.floor(jitter() * 5);
      const lab = (r, rate) => LABELS[Math.max(0, Math.min(4, truth + (r() < rate ? (r() < 0.5 ? -1 : 1) : 0)))];
      h1.push(lab(jitter, 0.06)); h2.push(lab(jitter, 0.10));
      const v = await judgeLabelViaLlm({
        question: q.content ?? q.title,
        answer: (q.referenceAnswer ?? "").slice(0, 1200) + (jitter() < 0.15 ? "(回答不完整,讲到一半)" : ""),
        dimension, apiKey,
      });
      judge.push(v.label);
      seenModels.add(v.model);
    }
    if (seenModels.size > 1) {
      console.error(`一次 run 出现 ${seenModels.size} 种 model_version(${[...seenModels].join(",")})—— 整 run 作废(§4.6 降级污染校准)`);
      process.exit(1);
    }
    dimensions[dim] = {
      kappa_jh1: compare(judge, h1, { iterations, seed: dimSeed }),
      kappa_jh2: compare(judge, h2, { iterations, seed: dimSeed ^ 1 }),
      kappa_hh: compare(h1, h2, { iterations, seed: dimSeed ^ 2 }),
    };
  }
  return { dimensions, count: questions.length, model: [...seenModels][0], promptHash: null, note: "判官标签=真实 LLM;人工标签=种子扰动语料(待 S3 人工标注回填)" };
}

if (provider !== "mock") {
  try {
    const real = await runRealJudge();
    const gateInput = JUDGE_DIMENSIONS.map((d) => ({
      dimension: d,
      kappa_qw: real.dimensions[d].kappa_jh1.kappa_qw,
      ac1: real.dimensions[d].kappa_jh1.ac1,
      kappa_hh: real.dimensions[d].kappa_hh.kappa_qw,
      ci_lo: real.dimensions[d].kappa_jh1.ci_lo,
      ci_hi: real.dimensions[d].kappa_jh1.ci_hi,
    }));
    const gate = gateCalibration(gateInput, { measured: true });
    const out = {
      run_id: `cal_${Date.now().toString(36)}`,
      generated_at: new Date().toISOString(),
      provider, measured: true, verdict: gate.pass ? "measured" : "invalid",
      fingerprints: {
        model_version: real.model, rubric_version: "rv1-anchor-2point",
        prompt_hash: crypto.createHash("sha256").update(ANCHORS.logic + ANCHORS.problem_solving + ANCHORS.technical_depth).digest("hex").slice(0, 16),
        temperature: 0, votes: 1,
      },
      sample: { questions: real.count, dimensions: JUDGE_DIMENSIONS },
      bootstrap: { iterations, seed: 20261027 },
      gate,
      dimensions: real.dimensions,
      honesty_note: `${real.note}。κ_JH 为 judge vs 种子标注;S3 人工标注回填后重跑才可进参评材料。`,
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify(out, null, 2));
    console.log(`真实判官校准完成:${gate.pass ? "双阈值通过" : "未过双阈值(见 gate.failures)"}`);
    if (!gate.pass) for (const f of gate.failures) console.error(`  ✗ ${f}`);
    process.exit(gate.pass ? 0 : 1);
  } catch (e) {
    console.error(`真实判官失败:${e.message}`);
    process.exit(1);
  }
}

const iterations = full ? 10000 : 500;
const seed = 20261027;
const dimensions = {};
for (const dim of JUDGE_DIMENSIONS) {
  const dimSeed = crypto.createHash("sha256").update(`${seed}:${dim}`).digest().readUInt32BE(0);
  const n = SAMPLE_QUESTIONS;
  // h1 微扰(高质量标注者)、h2 略高微扰(天花板 κ_HH ~0.8x)、judge 再高一些(κ_JH 落在 0.7x)
  const h1 = mockLabels(n, dimSeed, 0.06);
  const h2 = mockLabels(n, dimSeed ^ 0x5f, 0.10);
  const judge = mockLabels(n, dimSeed ^ 0xa3, 0.13);
  const jh1 = compare(toLetters(judge.labels), toLetters(h1.labels), { iterations, seed: dimSeed });
  const jh2 = compare(toLetters(judge.labels), toLetters(h2.labels), { iterations, seed: dimSeed ^ 1 });
  const hh = compare(toLetters(h1.labels), toLetters(h2.labels), { iterations, seed: dimSeed ^ 2 });
  dimensions[dim] = { kappa_jh1: jh1, kappa_jh2: jh2, kappa_hh: hh };
}

// ── S4 判据(G14 双阈值;mock → measured=false,只验结构) ──────────────────
const gateInput = JUDGE_DIMENSIONS.map((d) => ({
  dimension: d,
  kappa_qw: dimensions[d].kappa_jh1.kappa_qw,
  ac1: dimensions[d].kappa_jh1.ac1,
  kappa_hh: dimensions[d].kappa_hh.kappa_qw,
  ci_lo: dimensions[d].kappa_jh1.ci_lo,
  ci_hi: dimensions[d].kappa_jh1.ci_hi,
}));
const gate = gateCalibration(gateInput, { measured: false });

// ── S5 产物 ────────────────────────────────────────────────────────────────
const runId = `cal_${Date.now().toString(36)}`;
const out = {
  run_id: runId,
  generated_at: new Date().toISOString(),
  provider,
  measured: false, // mock 判官:全部数值是占位符,不得进参评材料
  verdict: "placeholder",
  fingerprints: {
    model_version: provider === "mock" ? "mock-judge-v0" : null,
    rubric_version: "rv1-anchor-2point",
    prompt_hash: null, // 真实判官接入后回填
    temperature: null,
    votes: 1,          // 生产恒 1 票(J-26)
  },
  sample: { questions: SAMPLE_QUESTIONS, dimensions: JUDGE_DIMENSIONS, items: SAMPLE_QUESTIONS * JUDGE_DIMENSIONS.length },
  bootstrap: { iterations, seed, note: "mock 500 次;真实校准 10000 次(--full 同款)" },
  gate,
  dimensions,
  honesty_note: "κ 数值为 mock 占位符。回填真实标注前,参评材料不得出现任何 κ 具体数字(11-final-plan §1.6)。",
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify(out, null, 2));
console.log(`校准管线完成:${SAMPLE_QUESTIONS}题 × ${JUDGE_DIMENSIONS.length}维 × {h1,h2,judge}`);
console.log(`产物:${path.relative(ROOT, path.join(OUT_DIR, "latest.json"))}(provider=mock,verdict=placeholder)`);
console.log(`G14 结构判据:${gate.pass ? "通过" : "失败"}(mock 不判阈值)`);
if (!gate.pass) { for (const f of gate.failures) console.error(`  ✗ ${f}`); process.exit(1); }
