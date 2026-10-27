// 构建后义务:把仓库根 LICENSE 复制进 dist(MIT 分发义务,G13 门禁校验)。
// 放在 web 构建脚本里而非 build.sh —— 任何路径触发构建(npm run build / CI / verify-all)都生效。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(webDir, "..");
const dist = path.join(webDir, "dist");
if (fs.existsSync(dist)) {
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(dist, "LICENSE"));
  fs.copyFileSync(path.join(root, "THIRD_PARTY_LICENSES.md"), path.join(dist, "THIRD_PARTY_LICENSES.md"));
  console.log("[copy-license] LICENSE + THIRD_PARTY_LICENSES.md → dist/");
} else {
  console.error("[copy-license] dist/ 不存在,跳过");
  process.exit(1);
}
