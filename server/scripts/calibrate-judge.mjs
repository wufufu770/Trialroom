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

if (provider !== "mock") {
  const keyEnv = "TRIALROOM_LLM_API_KEY";
  if (!process.env[keyEnv]) {
    console.error(`真实判官(${provider})需要环境变量 ${keyEnv}。当前只有 mock 管线可用。`);
    console.error("注入 key 后重跑本命令;管线/门禁/换算表均已就绪,只是差真实标注。");
    process.exit(2);
  }
  // TODO(P3-real): judge = chat via provider(OpenAI 兼容);逐 item 记录 model_version,
  // 两种版本出现即整 run 作废(§4.6)。管线结构已就位,不阻塞 mock 交付。
  console.error("真实判官调用尚未接线(等待 API key 注入后按 ADR-001 隔离评分引擎复用)。");
  process.exit(2);
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
