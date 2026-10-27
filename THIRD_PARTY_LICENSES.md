# 第三方许可与致谢(THIRD_PARTY_LICENSES)

> 本清单是 G13「许可分发义务」门禁的依据文件。
> 声明式清单:许可证标注以各包随包自带的 LICENSE 为最终准绳
> (`node_modules/<pkg>/LICENSE`),本文件若与之冲突,以随包文件为准。

## 本项目许可

Trialroom 以 [MIT](./LICENSE) 许可发布(继承自 Tryout 基座)。

## 运行时依赖(server,`npm ci` 安装)

| 包 | 许可证 | 用途 |
|---|---|---|
| express | MIT | Web 框架 |
| cors | MIT | CORS |
| multer | MIT | 文件上传 |
| mammoth | BSD-2-Clause | DOCX 解析 |
| better-sqlite3 | MIT | SQLite 驱动 |
| nanoid | MIT | ID 生成 |
| pdfjs-dist | Apache-2.0 | PDF 文本提取(含中文 CMap) |
| undici | MIT | HTTP 客户端(SSRF 防护承载) |
| @xenova/transformers | Apache-2.0 | 本地 Whisper 推理 |

## 前端依赖(web)

| 包 | 许可证 | 用途 |
|---|---|---|
| react / react-dom | MIT | UI 框架 |
| vite | MIT | 构建工具 |
| typescript | Apache-2.0 | 类型系统 |
| tailwindcss | MIT | 样式 |
| monaco-editor | MIT | 代码编辑器 |
| zustand | MIT | 状态管理 |
| vitest | MIT | 测试 |

## 题库语料

见 [`data/sources-license.json`](./data/sources-license.json)。
基座 808 题**零 provenance(unverified)** —— 材料表述纪律见该文件 `statement` 字段。
禁复制语料(hello-agents,CC BY-NC-SA 4.0)零引用。

## 许可义务落地状态

| 义务 | 状态 |
|---|---|
| 仓库根 LICENSE(MIT) | ✅ 存在 |
| 本 THIRD_PARTY_LICENSES.md | ✅ 本文件 |
| 构建产物携带 LICENSE(web/dist/LICENSE) | ✅ build.sh 构建后复制(G13 校验) |
| 题库来源台账 sources-license.json | ✅ 存在(G12 校验) |
| Web「关于」页含 MIT 授权句 | ⬜ P7(Web 侧) |
| Docker 镜像 LABEL org.opencontainers.image.licenses | ⬜ 部署包 |
| GHCR 镜像描述附许可信息 | ⬜ 首次推送时 |
