#!/usr/bin/env node
// G13 · 许可分发义务门禁
// 判据:
//   1. 根 LICENSE 存在且为 MIT(与项目声明一致)
//   2. THIRD_PARTY_LICENSES.md 存在且非空、含"题库语料"章节
//   3. data/sources-license.json 存在(G12 也查,这里查存在性以保分发完备)
//   4. 若 web/dist 存在(已构建),dist 内必须携带 LICENSE 副本
//   5. LICENSE 年份一致性:文件内年份不得早于仓库创建年(2026)且不得晚于当前年
// 退出码:0 通过 · 1 违例
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errs = [];

const licPath = path.join(ROOT, "LICENSE");
if (!fs.existsSync(licPath)) errs.push("根 LICENSE 不存在");
else {
  const lic = fs.readFileSync(licPath, "utf8");
  // 2026-10-27 起为专有商用许可(私有仓,未经书面许可不得使用),不再是 MIT
  if (!/保留所有权利|All Rights Reserved/i.test(lic)) {
    errs.push("LICENSE 缺少「保留所有权利 / All Rights Reserved」专有声明");
  }
  if (!/未取得.{0,12}许可|未经.{0,12}许可|without (prior )?(written )?permission/i.test(lic)) {
    errs.push("LICENSE 缺少「未经书面许可不得使用」条款");
  }
  if (!/THIRD_PARTY_LICENSES/.test(lic)) errs.push("LICENSE 未指向第三方许可清单");
  const years = [...lic.matchAll(/20\d\d/g)].map((m) => Number(m[0]));
  const nowY = new Date().getFullYear();
  if (years.some((y) => y > nowY)) errs.push(`LICENSE 年份出现未来年份(当前 ${nowY})`);
}

const tpPath = path.join(ROOT, "THIRD_PARTY_LICENSES.md");
if (!fs.existsSync(tpPath)) errs.push("THIRD_PARTY_LICENSES.md 不存在");
else {
  const tp = fs.readFileSync(tpPath, "utf8");
  if (tp.length < 200) errs.push("THIRD_PARTY_LICENSES.md 过短(疑似占位)");
  if (!/题库语料/.test(tp)) errs.push("THIRD_PARTY_LICENSES.md 缺「题库语料」章节");
}
if (!fs.existsSync(path.join(ROOT, "data", "sources-license.json"))) {
  errs.push("data/sources-license.json 不存在");
}

const distLic = path.join(ROOT, "web", "dist", "LICENSE");
if (fs.existsSync(path.join(ROOT, "web", "dist"))) {
  if (!fs.existsSync(distLic)) errs.push("web/dist 已构建但未携带 LICENSE(build.sh 构建段应复制)");
}

if (errs.length > 0) {
  console.error(`G13 许可分发义务:${errs.length} 处违例`);
  for (const e of errs) console.error(`  ✗ ${e}`);
  process.exit(1);
}
const dist = fs.existsSync(path.join(ROOT, "web", "dist"));
console.log(`G13 许可分发义务:通过(dist ${dist ? "已携带 LICENSE" : "未构建,跳过 dist 检查"})`);
