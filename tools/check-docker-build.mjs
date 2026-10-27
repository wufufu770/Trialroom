#!/usr/bin/env node
// G10 · Docker 镜像构建门禁(verify-all 按 optional 登记:无 docker 时 SKIP)。
// 构建两个镜像并要求成功;失败即退出码 1。缓存与回收由 build.sh do_docker 负责。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG = `trialroom-gate:${Date.now().toString(36)}`;

const probe = spawnSync("docker", ["--version"], { shell: true, stdio: "ignore" });
if (probe.status !== 0) {
  console.log("G10 Docker 构建:跳过(docker 不可用)");
  process.exit(0); // optional 门禁:环境缺失记 SKIP 语义
}
const daemon = spawnSync("docker", ["info"], { shell: true, stdio: "ignore" });
if (daemon.status !== 0) {
  console.log("G10 Docker 构建:跳过(daemon 未运行)");
  process.exit(0);
}

const builds = [
  ["server", "-f", "docker/Dockerfile.server", "."],
  ["web", "-f", "docker/Dockerfile.web", "."],
];
let failed = 0;
for (const [name, ...args] of builds) {
  const r = spawnSync("docker", ["build", "-t", `${TAG}-${name}`, ...args], {
    cwd: ROOT, shell: true, encoding: "utf8", timeout: 10 * 60_000,
  });
  if (r.status !== 0) {
    console.error(`✗ ${name} 镜像构建失败\n${(r.stdout || "") + (r.stderr || "")}`.split("\n").slice(-15).join("\n"));
    failed++;
  } else {
    console.log(`✓ ${name} 镜像构建成功`);
  }
  spawnSync("docker", ["rmi", "-f", `${TAG}-${name}`], { shell: true, stdio: "ignore" });
}
process.exit(failed > 0 ? 1 : 0);
