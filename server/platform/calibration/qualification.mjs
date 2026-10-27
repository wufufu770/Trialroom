// 达标判定(三条件)与发布门禁(双阈值) —— κ 已从逐题判定中移除(P0-3/J-01)。
// 依据:docs/spec/11-final-plan.md §4.1 / §4.2.2
//
// 三条件(逐题,写入 interview_attempts.qualification):
//   C1 score_after ≥ 岗位基准线(116 题摊 16 域×5 档,每格 ~1.4 题 —— 只是可编辑默认值)
//   C2 判定维度(logic/problem_solving/technical_depth)上 after 均值 ≥ before
//   C3 单答案稳定性守卫:首评 + 临界维度复评(±0.5 档内触发),稳定比例 ≥ 0.60
//   (κ 不在其中 —— 它是语料级×版本级统计量,只能进发布门禁)
//
// 发布门禁 G14(双阈值,报区间不报二值):
//   G1 绝对地板:κ_JH(d) ≥ 0.60(每维)
//   G2 相对天花板:κ_JH(d) ≥ 0.85 × κ_HH(d)(每维)
//   G3 区间下界相对上版跌幅 ≤ 0.05(有上版时)
//   G4 天花板自检:min κ_HH ≥ 0.50(rubric 不可判时先修 rubric,不修 judge)

export const JUDGE_DIMENSIONS = ["logic", "problem_solving", "technical_depth"];
export const FLOOR = 0.60;
export const CEILING_RATIO = 0.85;
export const HH_MIN = 0.50;
export const DROP_LIMIT = 0.05;
export const TARGET_KAPPA = 0.79; // 见 kappa.mjs CONVERSION_TABLE 的推导

/**
 * 逐题三条件判定。输入均为数値;返回 {cond1,cond2,cond3,passed}。
 * C3 输入:首评标签 vs 复评标签的锚点差数组(仅临界维度复评),稳定=差≤1档且有依据。
 */
export function evaluateQualification({ scoreAfter, baseline, dimsBefore, dimsAfter, recheckDeltas, recheckGrounded }) {
  const c1 = scoreAfter >= baseline;
  const before = mean(JUDGE_DIMENSIONS.map((d) => dimsBefore[d]));
  const after = mean(JUDGE_DIMENSIONS.map((d) => dimsAfter[d]));
  const c2 = after >= before;
  const deltas = recheckDeltas ?? [];
  const stable = deltas.filter((x) => Math.abs(x) <= 1).length;
  const c3 = deltas.length === 0 ? false : (stable / deltas.length) >= 0.60 && (recheckGrounded ?? false);
  return { cond1: c1, cond2: c2, cond3: c3, passed: c1 && c2 && c3 };
}

/**
 * 发布门禁(双阈值 + 区间纪律)。
 * @param results 逐维结果:[{dimension, kappa_qw, kappa_hh, ci_lo, ci_hi}]
 * @param prev    可选上版同结构结果(G3 跌幅)
 * @param measured false(占位/mock)时不判阈值,只验结构 —— 占位数据不得伪装成测量
 */
export function gateCalibration(results, { prev = null, measured = false } = {}) {
  const failures = [];
  const dims = new Set(results.map((r) => r.dimension));
  for (const d of JUDGE_DIMENSIONS) {
    if (!dims.has(d)) failures.push(`缺判定维 ${d} 的结果(禁止合并单一 κ)`);
  }
  for (const r of results) {
    const need = ["kappa_qw", "ac1", "kappa_hh", "ci_lo", "ci_hi"];
    for (const k of need) {
      if (typeof r[k] !== "number" || Number.isNaN(r[k])) failures.push(`${r.dimension}:缺数值字段 ${k}(G14 四键纪律)`);
    }
    if (!(r.ci_lo <= r.kappa_qw && r.kappa_qw <= r.ci_hi)) {
      failures.push(`${r.dimension}:点估计不在自身区间内 [${r.ci_lo}, ${r.ci_hi}]`);
    }
    if (!measured) continue; // 占位数据:结构合格即可,阈值不作数
    if (r.kappa_qw < FLOOR) failures.push(`${r.dimension}:G1 绝对地板 —— κ_JH ${r.kappa_qw} < ${FLOOR}`);
    if (r.kappa_qw < CEILING_RATIO * r.kappa_hh) {
      failures.push(`${r.dimension}:G2 相对天花板 —— κ_JH ${r.kappa_qw} < 0.85×κ_HH(${(CEILING_RATIO * r.kappa_hh).toFixed(4)})`);
    }
    if (r.kappa_hh < HH_MIN) failures.push(`${r.dimension}:G4 天花板自检 —— κ_HH ${r.kappa_hh} < ${HH_MIN}(先修 rubric)`);
    const p = prev?.find((x) => x.dimension === r.dimension);
    if (p && r.ci_lo < p.ci_lo - DROP_LIMIT) {
      failures.push(`${r.dimension}:G3 区间下界较上版跌幅 > ${DROP_LIMIT}(${r.ci_lo} vs ${p.ci_lo})`);
    }
  }
  return { pass: failures.length === 0, failures, measured };
}

function mean(xs) {
  const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
  if (v.length === 0) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

// ── 参评材料纪律(§4.11):四个禁用词 ──────────────────────────────────────
export const FORBIDDEN_CLAIMS = Object.freeze([
  "行业基准", "人类面试官水平", "达到专家水平", "国际领先",
]);
