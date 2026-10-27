// κ 统计核心 —— 象限加权 Cohen's κ、Gwet AC1、bootstrap 区间。
// 依据:docs/spec/11-final-plan.md §4.2(三条禁令/双阈值/量纲对齐/κ_QW/bootstrap)
//
// 量纲纪律:κ 只定义在(题 × 维)的 A–E 有序类别标签上;标签不得转分数再算。
// 三条禁令的落地:
//   禁绝对点估计 → 本模块永远返回 {点估计, ci_lo, ci_hi}
//   禁合并单一 κ → 调用方逐维调用,本模块不提供"总体 κ"
//   禁只报 κ 不报边际 → 返回 prevalence
//
// 全部纯函数、零依赖、确定性(seeded PRNG)——同一输入永远同一区间,可复核。

export const LABELS = ["A", "B", "C", "D", "E"];
export const K = LABELS.length;

/** 象限加权:w_ij = 1 - ((i-j)/4)^2(方案 §4.2.4;|i-j|=0 → 1,=4 → 0)。 */
export function weight(i, j) {
  return 1 - ((i - j) / (K - 1)) ** 2;
}

export function confusion(r1, r2) {
  if (r1.length !== r2.length) throw new Error("两个标注序列长度不一致");
  const m = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let t = 0; t < r1.length; t++) {
    const i = LABELS.indexOf(r1[t]), j = LABELS.indexOf(r2[t]);
    if (i < 0 || j < 0) throw new Error(`非法标签:${r1[t]}/${r2[t]}(只允许 A..E)`);
    m[i][j]++;
  }
  return m;
}

export function margins(m) {
  const n = m.flat().reduce((a, b) => a + b, 0);
  const row = m.map((r) => r.reduce((a, b) => a + b, 0) / n);
  const col = Array.from({ length: K }, (_, j) => m.reduce((a, r) => a + r[j], 0) / n);
  return { n, row, col };
}

export function rawAgreement(r1, r2) {
  const { n } = margins(confusion(r1, r2));
  let hit = 0;
  for (let t = 0; t < r1.length; t++) if (r1[t] === r2[t]) hit++;
  return hit / n;
}

/** 象限加权 Cohen's κ(主口径 κ_QW)。 */
export function quadraticWeightedKappa(r1, r2) {
  const m = confusion(r1, r2);
  const { n, row, col } = margins(m);
  let po = 0, pe = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const w = weight(i, j);
      po += (m[i][j] / n) * w;
      pe += row[i] * col[j] * w;
    }
  }
  const den = 1 - pe;
  if (den === 0) return { kappa: 1, po, pe }; // 完全集中且一致的退化情形
  return { kappa: (po - pe) / den, po, pe };
}

/** Gwet AC1(边际依赖纠正;对类别流行度偏斜更稳健的参考口径)。 */
export function gwetAC1(r1, r2) {
  const m = confusion(r1, r2);
  const { n, row, col } = margins(m);
  const po = m.reduce((a, r, i) => a + r[i], 0) / n;
  // 平均边际 p_k = (row_k + col_k) / 2
  let sumPk = 0;
  for (let k = 0; k < K; k++) {
    const pk = (row[k] + col[k]) / 2;
    sumPk += pk * (1 - pk);
  }
  const pe = sumPk / (K - 1);
  const den = 1 - pe;
  if (den === 0) return { ac1: 1, po, pe };
  return { ac1: (po - pe) / den, po, pe };
}

/** mulberry32 —— 确定性 PRNG(bootstrap 可复现的关键)。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * item-level bootstrap(方案 §4.2.4):对(题×维)条目重采样,取 2.5/97.5 分位。
 * 同 seed 同区间 —— 「能独立复核」是硬要求。
 */
export function bootstrapCI(r1, r2, { iterations = 10000, seed = 42, stat = quadraticWeightedKappa } = {}) {
  const rnd = mulberry32(seed);
  const n = r1.length;
  const vals = new Float64Array(iterations);
  const b1 = new Array(n), b2 = new Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let t = 0; t < n; t++) {
      const idx = Math.floor(rnd() * n);
      b1[t] = r1[idx]; b2[t] = r2[idx];
    }
    vals[it] = stat(b1, b2).kappa;
  }
  const sorted = Array.from(vals).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
  return { lo: q(0.025), hi: q(0.975), iterations, seed };
}

/**
 * 一次校准对比的全部统计(逐维调用;judge vs h1、judge vs h2 分别算,禁均值 J-28)。
 * 返回 G14 要求的四键 + 区间 + 边际。
 */
export function compare(r1, r2, opts = {}) {
  const qw = quadraticWeightedKappa(r1, r2);
  const ac1 = gwetAC1(r1, r2);
  const ci = bootstrapCI(r1, r2, opts);
  const { row } = margins(confusion(r1, r2));
  const prevalence = {};
  LABELS.forEach((l, i) => { prevalence[l] = Number(row[i].toFixed(4)); });
  return {
    n: r1.length,
    kappa_qw: Number(qw.kappa.toFixed(4)),
    ac1: Number(ac1.ac1.toFixed(4)),
    raw_agree: Number(rawAgreement(r1, r2).toFixed(4)),
    ci_lo: Number(ci.lo.toFixed(4)),
    ci_hi: Number(ci.hi.toFixed(4)),
    bootstrap: { iterations: ci.iterations, seed: ci.seed },
    prevalence,
  };
}

// ── 旧→新换算表(方案 §4.3,参评材料必放) ─────────────────────────────────
// 旧门槛「单维一致率 ≥85%」在 5 类、边际近似均匀(p_e ∈ [0.20, 0.25])下
// 对应 κ ≈ (0.85 - p_e)/(1 - p_e) ∈ [0.80, 0.8125],取保守端 0.79 为目标;
// 「κ ≥ 0.70」反算一致率 ≈ 0.70×(1-p_e)+p_e ≈ 76%-77% —— 是降标不是升标。
export const CONVERSION_TABLE = Object.freeze([
  { legacy: "一致率 ≥ 85%(V6 旧门槛)", kappa_equiv: 0.79, note: "新目标 κ_QW ≥ 0.79(逐维)" },
  { legacy: "κ ≥ 0.70(被否决的提案)", kappa_equiv: 0.70, note: "≈ 一致率 76.5% —— 低于旧门槛,已弃用" },
  { legacy: "绝对地板", kappa_equiv: 0.60, note: "低于此值不许上线(G1),非「达标」定义" },
]);
