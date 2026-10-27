#!/usr/bin/env node
// G14 · κ 校准门禁 —— 校准产物的结构、诚实性与双阈值一致性。
// 依据:方案 §4.2.2(双阈值四条)/§4.11(诚实表述)/§6.9.3(写死判据)
//
// 判据(写死,不配置化):
//   1. qa/calibration/latest.json 存在且含 3 个判定维(禁止合并单一 κ)
//   2. 每维含四键:kappa_qw / ac1 / kappa_hh / 区间(ci_lo≤点估计≤ci_hi)
//   3. provider=mock → measured 必须 false 且 verdict 必须 placeholder(占位数据不得伪装测量)
//   4. provider≠mock → gate.pass 必须与双阈值重算结果一致
//   5. 产物含 honesty_note(诚实纪律的自我声明)
// 退出码:0 通过 · 1 违例 · 2 用法错误
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JUDGE_DIMENSIONS, gateCalibration } from "../server/platform/calibration/qualification.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function validate(doc) {
  const errs = [];
  if (!doc || typeof doc !== "object") return ["产物不是 JSON 对象"];
  for (const d of JUDGE_DIMENSIONS) {
    if (!doc.dimensions?.[d]) errs.push(`缺判定维 ${d}(J-19:禁合并单一 κ)`);
  }
  if (doc.dimensions) {
    for (const d of Object.keys(doc.dimensions)) {
      const v = doc.dimensions[d];
      const need = ["kappa_jh1", "kappa_hh"];
      for (const k of need) if (!v?.[k]) errs.push(`${d}:缺 ${k}`);
      if (v?.kappa_jh1) {
        for (const k of ["kappa_qw", "ac1", "ci_lo", "ci_hi"]) {
          if (typeof v.kappa_jh1[k] !== "number") errs.push(`${d}:kappa_jh1 缺数值键 ${k}`);
        }
        if (typeof v.kappa_jh1.ci_lo === "number" && typeof v.kappa_jh1.ci_hi === "number" &&
            !(v.kappa_jh1.ci_lo <= v.kappa_jh1.kappa_qw && v.kappa_jh1.kappa_qw <= v.kappa_jh1.ci_hi)) {
          errs.push(`${d}:点估计不在区间内`);
        }
      }
    }
  }
  if (doc.provider === "mock") {
    if (doc.measured !== false) errs.push("provider=mock 但 measured≠false —— 占位数据伪装成测量");
    if (doc.verdict !== "placeholder") errs.push("provider=mock 但 verdict≠placeholder");
  } else if (doc.provider) {
    const gateInput = JUDGE_DIMENSIONS.map((d) => ({
      dimension: d,
      kappa_qw: doc.dimensions[d]?.kappa_jh1?.kappa_qw,
      ac1: doc.dimensions[d]?.kappa_jh1?.ac1,
      kappa_hh: doc.dimensions[d]?.kappa_hh?.kappa_qw,
      ci_lo: doc.dimensions[d]?.kappa_jh1?.ci_lo,
      ci_hi: doc.dimensions[d]?.kappa_jh1?.ci_hi,
    }));
    const recomputed = gateCalibration(gateInput, { measured: true });
    if (doc.gate?.pass !== recomputed.pass) {
      errs.push(`gate.pass(${doc.gate?.pass})与双阈值重算(${recomputed.pass})不一致`);
    }
    if (!recomputed.pass) errs.push(...recomputed.failures.map((f) => `双阈值:${f}`));
  }
  if (!doc.honesty_note) errs.push("缺 honesty_note(§4.11 诚实纪律)");
  return errs;
}

const fixture = process.argv.find((a) => a.startsWith("--fixture="))?.split("=")[1];
const target = fixture
  ? path.resolve(fixture)
  : path.join(ROOT, "qa", "calibration", "latest.json");

if (!fs.existsSync(target)) {
  console.error(`G14 失败:校准产物不存在(${path.relative(ROOT, target)})—— 先跑 calibrate-judge.mjs`);
  process.exit(1);
}
const errs = validate(JSON.parse(fs.readFileSync(target, "utf8")));
if (errs.length > 0) {
  console.error(`G14 κ 校准门禁:${errs.length} 处违例`);
  for (const e of errs) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`G14 κ 校准门禁:通过(${fixture ? "fixture 模式" : path.relative(ROOT, target)})`);
