# 贡献指南

感谢你考虑贡献 Tryout。这个文档覆盖从零开始到提交 PR 的全部步骤。

## 10 分钟跑起来

**环境要求**：Node.js ≥ 20

```bash
git clone https://github.com/wufufu770/Tryout.git
cd Tryout

# 后端
cd server && npm install --ignore-scripts && node index.js   # → http://localhost:3001

# 前端（另开一个终端）
cd web && npm install && npm run dev                          # → http://localhost:5173
```

> `--ignore-scripts` 是为了跳过 better-sqlite3 的本地编译（它会下载预编译二进制）。
> 如果安装失败，可参考 README「Windows 用户注意」手动下载预编译包。

**用 Docker（更简单）**：

```bash
cd Tryout/docker
cp .env.example .env
docker compose up -d --build      # → http://localhost:9090
```

## 跑测试

```bash
cd server && npm test        # node --test，测试安全模块与数据层
cd web && npm test           # vitest
```

改动前后都跑一遍。CI 会真实执行这两条命令（失败即红），所以本地跑通很重要。

## 代码风格

本项目暂不强制 ESLint，**请跟随现有代码的风格**：

- **注释用中文**，与现有代码保持一致
- 关键决策写"为什么"而非"做了什么"——现有代码里 `v10.2:` 这类版本标记是很好的范例
- 2 空格缩进，分号结尾
- 前端用 TypeScript，后端用 ESM JavaScript

## 提交与 PR

```bash
git checkout -b feat/xxx      # 或 fix/xxx / docs/xxx / refactor/xxx
# ...改动...
git add -A
git commit -m "feat: 简短描述"
git push origin feat/xxx
```

**一个 PR 只做一件事。** 混在一起的 PR 很难 review。

PR 描述请说明：
- 改了什么、为什么
- 怎么验证的（跑了哪些测试、看了哪些页面）
- 相关的 issue 编号（如果有）

## 启用 pre-commit（可选但推荐）

```bash
git config core.hooksPath .githooks
```

该 hook 会拦截敏感文件（`.env`、密钥、SQLite 数据文件等）并对暂存的 JS 做语法检查。

## 适合新手的任务

**题库贡献是最容易上手的入口**——不需要读懂整个代码库。

题库位于 `web/src/data/questionBank.<行业>.ts`，每道题的格式：

```ts
{
  id: "backend-tech-001",              // 唯一 id，命名规则：<行业>-<类型>-<序号>
  industry: "backend",
  type: "technical",                    // technical | design | behavioral | coding | questions
  difficulty: "junior",                 // junior | mid | senior
  title: "HashMap 底层原理与扩容机制",
  content: "请详细描述 JDK 1.8 中 HashMap 的底层数据结构、put 流程…",
  referenceAnswer: "底层是数组 + 链表 + 红黑树。put 时先 hash 扰动求下标…",
  keyPoints: ["hash 扰动", "链表转红黑树阈值", "扩容因子 0.75"],
  tags: ["Java", "集合", "HashMap"],
  estimatedMinutes: 8,
}
```

可以做的事：
- **补充新题**（尤其是你所在行业/岗位的真题）
- **修订参考答案**（如果发现不准确或有错漏）
- **补充 keyPoints / tags**（越细越好，后续用于检索匹配）
- **翻译题库**到其他语言

其他适合新手的：
- 修文档里的错别字、失效链接
- 补充 i18n 缺失的翻译键
- 提 bug 复现步骤

## 需要帮助？

- 遇到问题：开 issue，描述你的环境（操作系统、Node 版本）和复现步骤
- 想讨论功能方向：开 issue 用 `feature request` 标签
- 认领任务：在 issue 下留言，避免重复劳动

## 提交你的智能体到广场

智能体广场（前端 `/gallery` 页）展示社区贡献的面试官智能体，数据全部来自 `data/community-agents/` 目录，构建时静态生成，无服务器依赖。

提交流程：

1. 在 Agent 工作台（`/agents`）调好你的智能体，点列表项上的分享按钮导出 `.ix-agent.json`。
2. 把文件放进 `data/community-agents/`，文件名用英文短横线命名（如 `frontend-stress.json`，会同时作为广场 id 与详情页目录名）。
3. 在导出文件基础上补齐社区元信息：`author`、`tags`（1-8 个）、`description`（≤200 字）与 `meta: { author, tags, difficulty, description }`。
4. 本地校验并预览：

   ```bash
   cd web && npm run build:agents   # 校验失败会以退出码 1 拒绝
   npm run dev                       # 打开 /gallery 查看
   ```

5. 提 PR。CI 会重跑校验与测试，校验不过的 PR 会被拒绝。

字段要求（完整规则见 `web/scripts/build-agent-gallery.mjs`）：

- `kind` 必须是 `interviewx-agent`，`version` 为 `1`；
- `role`（hr/tech/ceo/custom）、`tone`（gentle/direct/aggressive/neutral/professional）、`agentKind`（interviewer/candidate）取值需在白名单内；
- `difficulty` 为 1-10 的整数；
- `promptTemplate` ≥ 200 字，且要有可执行的结构（角色设定 / 流程 / 追问策略 / 输出格式），不要只写一句人设；
- `name` / `author` / `avatar` / `description` / `focusAreas`（1-8 项）均必填。

内容红线（违反直接拒绝）：

- 不得用于违法用途，不得包含违法、歧视、骚扰内容；
- 不得包含替考、作弊、代面等“代替本人参加真实面试/考试”类用途的话术——广场只服务“练习与陪练”，不服务“替你上场”。
