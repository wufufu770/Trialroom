// Monaco CDN 钉版(对抗审查 质量#1):@monaco-editor/loader 默认拉 0.55.1,
// 与 package 依赖版本漂移;显式钉到与 package.json 一致的版本。
// 注意:编辑器代码走 CDN,断网时仅代码编辑器降级 —— 数据仍零出本机(README 口径)。
import { loader } from "@monaco-editor/react";

loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs" },
});

export {};
