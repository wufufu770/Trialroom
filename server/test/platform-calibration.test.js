// P3 · κ 统计与达标判定测试(含手工验算边界)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LABELS, weight, rawAgreement, quadraticWeightedKappa, gwetAC1, bootstrapCI, compare, CONVERSION_TABLE,
} from "../platform/calibration/kappa.mjs";
import {
  evaluateQualification, gateCalibration, JUDGE_DIMENSIONS, FORBIDDEN_CLAIMS,
} from "../platform/calibration/qualification.mjs";

test("象限权重:w(0,0)=1,w(0,4)=0,w(0,2)=0.75", () => {
  assert.equal(weight(0, 0), 1);
  assert.equal(weight(0, 4), 0);
  assert.equal(weight(0, 2), 0.75);
});

test("完全一致 → κ=1,AC1=1", () => {
  const r = ["A", "B", "C", "D", "E", "A", "B"];
  assert.ok(Math.abs(quadraticWeightedKappa(r, r).kappa - 1) < 1e-9);
  assert.ok(Math.abs(gwetAC1(r, r).ac1 - 1) < 1e-9);
});

test("手工验算:r1 全 A、r2 全 B → 加权κ=0(边际下期望一致),AC1=-1/7", () => {
  // po = w_AB = 1-(1/4)^2 = 0.9375;pe = 1×1×0.9375 → κ=(po-pe)/(1-pe)=0
  const r1 = ["A", "A", "A", "A"], r2 = ["B", "B", "B", "B"];
  const qw = quadraticWeightedKappa(r1, r2);
  assert.equal(qw.po, 0.9375);
  assert.equal(qw.kappa, 0);
  // AC1:po=0;平均边际 pA=pB=0.5 → Σp(1-p)=0.5 → pe=0.5/4=0.125 → (0-0.125)/0.875=-1/7
  const ac1 = gwetAC1(r1, r2);
  assert.equal(ac1.pe, 0.125);
  assert.ok(Math.abs(ac1.ac1 - (-1 / 7)) < 1e-12);
});

test("κ 随一致性单调;相邻档分歧惩罚小于隔档", () => {
  const base = ["A", "B", "C", "D", "E"];
  const nearMiss = ["B", "A", "C", "D", "E"];  // 一处相邻档分歧
  const farMiss = ["E", "B", "C", "D", "A"];   // 两处隔两档分歧
  const k1 = quadraticWeightedKappa(base, base).kappa;
  const k2 = quadraticWeightedKappa(base, nearMiss).kappa;
  const k3 = quadraticWeightedKappa(base, farMiss).kappa;
  assert.ok(k1 > k2 && k2 > k3, `期望 k1>k2>k3,实际 ${k1}/${k2}/${k3}`);
});

test("bootstrap:同 seed 同区间(可复核),区间包含点估计", () => {
  const rnd = (s) => { let a = s; return () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648; };
  const r1 = Array.from({ length: 60 }, (_, i) => LABELS[i % 5]);
  const r2 = r1.map((x, i) => (i % 7 === 0 ? LABELS[(LABELS.indexOf(x) + 1) % 5] : x));
  const a = bootstrapCI(r1, r2, { iterations: 300, seed: 7 });
  const b = bootstrapCI(r1, r2, { iterations: 300, seed: 7 });
  assert.deepEqual(a, b);
  const point = quadraticWeightedKappa(r1, r2).kappa;
  assert.ok(a.lo <= point && point <= a.hi, `区间 [${a.lo},${a.hi}] 应包含点估计 ${point}`);
  assert.ok(a.hi - a.lo > 0);
});

test("compare:返回 G14 四键 + 边际 + 复现信息", () => {
  const r1 = ["A", "B", "C", "D", "E", "A", "B", "C"];
  const r2 = ["A", "B", "C", "C", "E", "A", "B", "D"];
  const c = compare(r1, r2, { iterations: 200, seed: 3 });
  for (const k of ["n", "kappa_qw", "ac1", "raw_agree", "ci_lo", "ci_hi", "prevalence"]) {
    assert.ok(k in c, `compare 缺 ${k}`);
  }
  assert.equal(c.n, 8);
  assert.ok(c.raw_agree >= 0.5);
});

test("换算表:85%→0.79 目标、0.60 地板都在,且 0.70 标注为弃用", () => {
  assert.ok(CONVERSION_TABLE.some((x) => x.kappa_equiv === 0.79 && x.legacy.includes("85%")));
  assert.ok(CONVERSION_TABLE.some((x) => x.kappa_equiv === 0.60));
  assert.ok(CONVERSION_TABLE.some((x) => x.kappa_equiv === 0.70 && x.note.includes("弃用")));
});

test("达标判定:三条件独立成立;κ 不在其中", () => {
  const q = evaluateQualification({
    scoreAfter: 72, baseline: 65,
    dimsBefore: { logic: 3, problem_solving: 3, technical_depth: 2 },
    dimsAfter: { logic: 4, problem_solving: 3, technical_depth: 3 },
    recheckDeltas: [0, 0, 1, 0, 0, 1],
    recheckGrounded: true,
  });
  assert.deepEqual(q, { cond1: true, cond2: true, cond3: true, passed: true });
  // C3 失败:稳定比例 1/3
  const q3 = evaluateQualification({
    scoreAfter: 72, baseline: 65,
    dimsBefore: { logic: 3 }, dimsAfter: { logic: 4 },
    recheckDeltas: [0, 2, 2], recheckGrounded: true,
  });
  assert.equal(q3.cond3, false);
  assert.equal(q3.passed, false);
});

function dimResult(d, kappa, hh, ciLo, ciHi) {
  return { dimension: d, kappa_qw: kappa, ac1: kappa, kappa_hh: hh, ci_lo: ciLo ?? kappa - 0.1, ci_hi: ciHi ?? kappa + 0.1 };
}

test("G14 双阈值:达标通过;地板/相对/天花板/缺维四种失败", () => {
  const ok = gateCalibration([
    dimResult("logic", 0.72, 0.80), dimResult("problem_solving", 0.70, 0.82), dimResult("technical_depth", 0.75, 0.85),
  ], { measured: true });
  assert.equal(ok.pass, true);

  assert.equal(gateCalibration([
    dimResult("logic", 0.55, 0.80), dimResult("problem_solving", 0.75, 0.82), dimResult("technical_depth", 0.75, 0.85),
  ], { measured: true }).failures.some((f) => f.includes("G1")), true);

  // κ_JH=0.65 < 0.85×0.90=0.765 → G2 失败
  assert.equal(gateCalibration([
    dimResult("logic", 0.65, 0.90), dimResult("problem_solving", 0.75, 0.82), dimResult("technical_depth", 0.75, 0.85),
  ], { measured: true }).failures.some((f) => f.includes("G2")), true);

  // κ_HH=0.40 → G4 天花板自检失败
  assert.equal(gateCalibration([
    dimResult("logic", 0.70, 0.40), dimResult("problem_solving", 0.75, 0.82), dimResult("technical_depth", 0.75, 0.85),
  ], { measured: true }).failures.some((f) => f.includes("G4")), true);

  // 缺一个维度 → 失败(禁合并)
  assert.equal(gateCalibration([
    dimResult("logic", 0.75, 0.82), dimResult("problem_solving", 0.75, 0.82),
  ], { measured: true }).failures.some((f) => f.includes("缺判定维")), true);
});

test("G14:mock(measured=false)只验结构不判阈值", () => {
  const r = gateCalibration([
    dimResult("logic", 0.10, 0.10), dimResult("problem_solving", 0.10, 0.10), dimResult("technical_depth", 0.10, 0.10),
  ], { measured: false });
  assert.equal(r.pass, true, "占位数据数值不作数,结构齐全即过");
});

test("诚实纪律:四个禁用词冻结在常量里", () => {
  assert.equal(FORBIDDEN_CLAIMS.length, 4);
  assert.ok(FORBIDDEN_CLAIMS.includes("行业基准"));
  assert.ok(JUDGE_DIMENSIONS.length === 3);
});
