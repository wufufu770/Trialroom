# Trialroom 参赛最终方案 v3（合并稿）

> **文档定位**：本文件是《Trialroom 参赛最终方案 v3》的**合并终稿**，由四节独立成稿 + 业主方交叉裁决 + 五份独立核验报告合并而成，取代 `review/07-final-plan.md`、`review/08-final-plan.md` 与 `research/platformization-report-20261026.md` 的现行版本。
> **合并范围**：第一节 平台化架构与线上 MCP 暴露面 / 第二节 评分内核、人工校准与达标判定 / 第三节 赛道路径归位、支付接入与商业化漏斗 / 第四节 44 天施工排期 v3、门禁验收与止损点。
> **事实纪律**：本稿**不改写四节的事实**。只做四件事——统一术语、去除重复、补齐跨节衔接、**显式标出跨节矛盾并给出建议（不自行调和）**。四节的每一条 P0 / P1 落点都还在。
> **取证标注**：`实测` = 用只读取证或零依赖脚本跑出来的数字；`引用` = 代码注释 / 既有文档 / 论文原文（原出处已标明，本轮未复核的已注明）；`推算` = 由实测数字推导。
> **术语表（全稿统一）**：MCP（Model Context Protocol，模型上下文协议）/ OAuth 2.1 / scope（作用域，权限档位）/ handle（不透明、不可猜测、绑定主体的资源句柄）/ κ（Cohen's kappa，一致性系数）/ Vibe Pay（主赛道名）/ 网页应用收款（Vibe Pay 基础收款能力下的收款产品）/ 去重用户数（主办方口径下的有效交易去重人数）/ BYO（自带模型）/ MCP server（对外暴露的工具服务）/ 门禁（可独立失败、失败即构建变红的自动化检查）/ T-pay（统计意义上的上线日）/ T-demo（演示意义上的上线日）。
> **文档版本**：v3 · 合并于 2026-10-27 · 依据 `review/10-adversarial-verdict.md`（业主方交叉裁决，最高权威）。

---

## 一、执行摘要

### 1.1 当前状态

方案的方向全部成立：44 天只能做一条腿、评分指标要换量纲、平台化收敛到统一权限模型、「用户接入的东西只供给证据不参与结论」——这四条经五席交叉复核均未被推翻，都是相对既有基线的真实增量。但**上一版方案（`08-final-plan.md` + 研究终稿 `platformization-report-20261026.md`）不能直接执行**，原因有三类。

**第一类：5 个 P0 级硬错。** 上一版方案含 5 个 P0 级硬错，其中 **1 个已修**（P0-5「鉴权作用域绕过」——`check-middleware-order.mjs` 原只比较行号、不比较挂载前缀，`app.use("/mcp", …)` 会被判成 PASS，已重写为作用域覆盖判定并补 21 项绕过回归，本轮实测 `verify-all` 10/10 全绿、`gate-bypass-regression` 21/21 全绿），**4 个已在本方案中改写**：

| 编号 | 硬错 | 本方案的改写位置 |
|---|---|---|
| **P0-1** | **赛道错配**：终稿写「支付只走 Machine Pay 一条轨」，而 Machine Pay 是独立特殊赛道、不在 Vibe Pay 计入口径内，`:127` 又规定同一赛道最多 1 件作品获奖——换赛道等于换奖池 | §3.1 赛道路径归位：Trialroom = Vibe Pay 主赛道 + 网页应用收款；Machine Pay 移入 §3.10 附录并标注「属于另一件独立作品」 |
| **P0-2** | **「¥0.01 下限」引到了错误的产品上**：该区间出自 Machine Pay 文档，而本地留存的官方 Machine Pay 文档只写「不超过 50 元」+ 示例 0.01，**并未写下限**；真正写死下限的是网页应用收款的 `total_amount` 取值范围 `[0.01, 100000000]` | §3.2 依据纠正 + 兜底语义重写（¥0.01 是通道物理下限，没有更低的档；切 ¥0.1 是**语义变化**，需两套首单文案，不是改一个配置） |
| **P0-3** | **judge-κ 的层级放错了**：κ 是语料级 × 版本级统计量，被写进逐题 `passed = 1 当且仅当 …` 的 AND 条件，要么恒真（又是一个死条件），要么要求生产环境持续人工标注 | §2.1 κ 从四条件中**移除**，改为**发布门禁**；运行时第三条件改为「单答案稳定性守卫」。门禁写成双阈值 `κ_JH ≥ 0.85 × κ_HH`（相对）**且** `κ_JH ≥ 0.60`（绝对地板），**报区间不报二值** |
| **P0-4** | **MCP 规范表述反向**：终稿第 68 行「最小 scope 是规范内建的能力」与第 72 行「真正的边界在服务端」直接自相矛盾 | §1.2 改为**双层强制**：`tools/list` 收敛只做 UX（降 token、降误选），`tools/call` 负例才是 CI 主断言 |

**第二类：判据与排期重写。** 上一版方案被当作「W1 的增量」提出，实为「W1 的替换」：五席中的一致性席独立算出本轮净增 15.7–20.9 人日，而 A 期 committed 64.0 人日缓冲为 0，第二口径判定已超载 12%–48%。更关键的是，上一版方案的五处改动（MCP / 平台化 / 校准 / 人工标注 / BYO / OAuth / 分账 / x402）在 `08-final-plan.md` 中**出现次数均为 0**——它是一份与基线**平行的方案**，不是基线的一份修订版。本方案 §4.2 显式算出 v3 净需求 **89.7 人日**、供给 **106.0 人日**（10/30 扩到 3 人后）、缺口 **25.7 人日 = 产能的 40.2%**（不扩编情景），并给出等量置换表与情景 A / B 两条分支。

**第三类：商业化维度整体缺失。** 上一版方案全文零「获客 / 漏斗 / UV / 渠道」，7 项开工清单无一项是商业化的。而商业化 25% 是**唯一无法靠写代码提升的维度**。本方案 §3.7 补上获客渠道表、分母写死的验算式、三个 checkpoint 人数目标、六个埋点事件与方案 B 备料。

### 1.2 本轮改了什么

- **合并四节为一份终稿**，四节的 P0 / P1 落点索引全部保留（§3.4 支付席 PC-01~PC-18 + A1~A4；§2.12 AI 席 J-01~J-28；§4.13 一致性席 CF-/G-/R- + 许可席 L-01~L-22 + 裁决 R-1~R-14；§1.11 MCP 席 S-01~S-20 的门禁落点）。
- **逐条吸收五份独立核验报告的「建议修订清单」**，共 **58 条**（平台 24 + 评分 11 + 支付 16 + 排期 14 + 元复核 3 条纠偏，见 §9.4）。其中 4 项 P0 阻断与 1 条 P0 级缺失（S-16）已在本稿修正。
- **显式标出 4 类跨节矛盾**（κ 阈值口径、支付相关日期、MCP server 数量、门禁条数），**不自行调和**，逐条给出建议与代价（§4）。
- **统一术语与编号**：全文 MCP / OAuth 2.1 / scope / handle / κ / Vibe Pay / 网页应用收款 / 去重用户数 口径一致；两套编号并存问题用 §9.3 的对照表解决。

### 1.3 本轮四路独立核验与机械门禁的修订记录

四节正文由四位作者独立撰写，随后由四路独立核验各自回查，最后由 `tools/check-plan-coverage.mjs` 做机械覆盖核对。**四路核验一致判定「需修订」**——不是走过场：核验者实跑了 `verify-all.mjs`（10/10）与 `gate-bypass-regression.test.mjs`（21/21）、逐条回查了 100+ 处「文件:行号」与 43 处官方细则行号、独立重算了题库覆盖度与 κ 的蒙特卡洛区间。本轮据此修正的缺陷（保持可追溯，原文均未删除）：

| # | 缺陷 | 发现方式 | 处置 |
|---|---|---|---|
| 1 | 报名硬截止日被误标为官方条款 | 机械门禁日期一致性检查报「声明值 ≠ 官方值」 | §6.3.5 与 §6.5 倒排时间线改写；源节 `sections/04-schedule.md` 同步改正（细节见下） |
| 2 | §6.1「选项 B」平铺已被推翻的旧结论 | 机械门禁硬错残留检测（K1 命中 1 处非纠正语境） | 改为「沿用研究终稿已被本方案推翻的写法（见 §5.1.2）」 |
| 3 | 评分席核验的 5 处硬伤 | 对核验报告的元复核 | 已吸收（§4.2.1 / §4.2.2 / §4.6） |
| 4 | 支付席核验中的 1 条阻断级假阳性与 1 条伪造官方引用 | 对核验报告的元复核 | 已拦截，未照抄 |
| 5 | 排期席核验的 4 项 P0 阻断 + 6 项 P1 重要 + 5 项 P2 建议 | 独立核验 | 已逐条吸收（§6 全章） |

**缺陷 1 的细节。** 原文把报名硬截止日写成 11/30，并给它挂上了一个并不存在的官方条款编号。

回查细则 `:26` 与承诺书全文后确认：官方报名阶段是 9/21 00:00:00 ~ 12/01 23:59:59，**细则与承诺书里没有任何 11/30**。那个 11/30 出自本项目自定清单 `官方规则原文与限制清单.md:214` 第 7 条，是**内部缓冲日**——我们自己的提醒，不是主办方的规定。

处置：§6.3.5 与 §6.5 倒排时间线改为写 12-01 23:59:59（官方报名截止，细则 `:26`），11/30 明确标注为内部缓冲日；源节 `sections/04-schedule.md` 同步改正。

> **门禁的可复现性**：机械核对脚本为 `trialroom/tools/check-plan-coverage.mjs`（纯 node 内置模块，零依赖），报告 `trialroom/review/13-verify-gate/coverage-report.md`。脚本自带 P0 集合相等自检（39 条基线），任何软失败路径都被禁止，**能独立失败**。
>
> **门禁自身的反向回归**：`trialroom/tools/check-plan-coverage.test.mjs` 用 7 条合成样本逐条证明门禁会红——缺落点、处置语义被清空、硬错残留、日期与官方硬日期矛盾、支付里程碑出现第 4 个互斥日期，五类都必须非 0 退出；真实终稿必须为 0 退出。**回归不过 → 门禁视为不可信。**

### 1.4 接下来 7 天做什么

W1（10/27–11/02）是全表最薄的一周（供给 10.0 人日 / 计划 9.5 / 余量 0.5）。本周必须同时完成五件互不可代的事：**① 报名完成 + 开通【网页应用收款】（10/31 硬门槛）**；**② 赛道路径归位拍板**；**③ 支付适配器接口契约 + 支付窗口 10/27 起**；**④ κ_HH + κ_JH 校准（W1 交付，报区间 + 双阈值门禁）**；**⑤ MIT 义务 + 题库来源合规门禁**。其中 ①② 是**零代码前置**，逾期直接归零（开通收款逾期 = 商业化 25% 归零；赛道未定 = 作品被判投特殊赛道 = 换奖池）。第 6~10 项见 §5。

### 1.5 需要业主方拍板什么

三件，全部在本周内截止，详见 §6：

1. **赛道路径归位**（截止 **10/28**）：Trialroom 走 Vibe Pay 主赛道 + 网页应用收款；Machine Pay 若做必须另立独立作品、不共用作品链接。
2. **支付窗口前移与扩到 3 人的决策日**（支付窗口 **10/27** 起、扩编决策 **10/30**）：支付工作量实测 15–25 人日，原排期「11/18 开工、11/22 上线」在物理上不成立；扩编决策日从 11/09 提前到 10/30 的原因是报名表须 11/15 前改。
3. **获客 checkpoint 人数目标**（**11/12 / 11/22 / 12/01** 三点）：官方激励门槛是 10 人（去重），内部目标必须比它更激进，否则「影响力 20%」和「商业化 25%」都没有抓手。

### 1.6 诚实性声明

本方案有 **4 处已修正的硬错**（P0-1~P0-4，上表）、**3 类尚未验证的假设**（κ 的真实值需 S3 标注回填、YAML 化的渠道 UV 估算需首篇发布数据实测、¥0.01 首单能否过风控官方文档侧无任何证据）、**4 项依赖官方回复才能闭合的口径**（去重键、小额是否计入、退款是否扣减人数、「作品提交并通过审核后」的计数前置，详见 §7）。**κ 的具体数值在本方案中全部是占位符**（X / Y / Z / A–B / [C, D]），在回填之前，参评材料里不得出现任何 κ 的具体数字。

---

## 二、本方案的边界与不做什么

以下事项**明确不在本方案范围内**。列出来是为了防止评审现场把它们当成本方案的主张，或防止后续有人「顺手」把它们加回清单。

### 2.1 不讨论的六项

| # | 不做的事 | 理由 | 边界出处 |
|---|---|---|---|
| 1 | **域名、ICP 备案的具体选型** | 备案是 1–3 周的全程最长前置，但它的**唯一约束是「不能晚于 W1 启动」**。选哪家注册商、用什么后缀，不影响任何技术判据。本方案只规定「W1 当天启动」这一条 | §4.3.1 W1 第 7 项；§4.12 R-19（备案未过则用 IP + 临时域名兜底，**不影响支付**——支付不依赖域名） |
| 2 | **服务器规格与云厂商选型** | 真实约束已在代码里写死：应用容器实际 1 核（`Trialroom-全量设计方案.md:239-245` 的 M-67），ASR 并发上限 = 2。选 1c 还是 2c 是部署细节，不改变「并发上限 = 2 → 排队 15s → 429 → 失败退次数 → 退款流水」这条因果链 | §3.9.3（`asrGuard.js:32-34`、`:74-77`） |
| 3 | **第三方托管平台** | BYO 远程 endpoint 接入已移 B 期 W9；理由不是「托管不好」，而是只接远程 HTTP = 要求用户有公网可达回调地址，2c2g 自建 / 动态 IP / 无 HTTPS 的用户用不了——这条腿做出来是「演示专用」而非「可用功能」，参评材料不能暗示它是普适能力 | §4.3.8 W9；§4.13.2 一致性席 R-11、CF-13 |
| 4 | **扩编预算与招聘渠道** | 本方案只把「扩到 3 人」当作**排期前提**（10/30 决策日、11/03 到岗、第三人边际有效产能按 8 人日/周计），不讨论人力成本、激励设计、招聘流程 | §4.2.1 供给侧三条硬规定；§4.4.4 情景 A / B |
| 5 | **OAuth 2.1 资源服务器的完整实现** | 44 天走不完就别写进清单，写进去会让整套判据体系失真。A 期用 Bearer + per-tool scope；OAuth 2.1 降为 B 期 W11–W12 的**备选**，不作为本作品的依赖 | 业主方裁决 §七末段；§4.5.3 删三项第 1 条 |
| 6 | **分账能力** | 本期收入模型是单边的：用户付费 → 平台交付 → 用户获得权益，**平台不向用户付款**，因此不需要任何分账能力。且参评材料**不写「分账」两个字**——它占用的是一个 25 分的位置，讲的却是数据模型整洁性 | §3.8.1；§3.7.1（三处错位） |

### 2.2 口径上刻意不主张的六件事

| # | 不主张 | 原因 |
|---|---|---|
| 1 | 「我们的评分达到真人面试官水平」 | **事实错误**。κ 测的是「两名开发者标注者」与 judge 的一致性，不是面试官水平。方案里其实有三种「人」（真人面试官 / 开发者标注者 / 用户本人历史），三者不是同一分布 |
| 2 | 「行业基准」 | 40 题 × 3 维的自建锚定集不是行业基准，40 题的自建锚定集不是行业基准 |
| 3 | 「多模型投票」「六维隔离 + 投票」 | 实际架构是**单 provider + 故障降级链**；「六维隔离」存在，「多模型投票」不存在。写不存在的架构被追问几行代码即露馅 |
| 4 | 「¥9.9 / 5 次」档位 | 设计文档 §7.1.3 是 **¥19.9 / 5 次**。终稿写的 ¥9.9/5 次 = 1.98 元/次、折扣 49%，远深于行业惯例 7%–35%，会把价格锚永久钉在「两块钱一次」 |
| 5 | 「我们的 808 题」 | 基座 808 题零 provenance，无法证明原创。材料里应写「基座 808 题为历史题库，Pro 轨 116 题为本次新制、带完整判据链」 |
| 6 | 「公开人工校准集 = 影响力杠杆」 | 官方影响力 20% 的口径是**作品详情页在官网的浏览、点赞、评论**。校准集不产生互动量。它是**产品完整度 30% 的佐证物**，不是影响力打法 |

### 2.3 四个禁用词（出现在参评材料即扣分）

**行业基准**（事实错误）、**人类面试官水平**（事实错误）、**达到专家水平**（不可证）、**国际领先**（不可证）。评审现场被追问一次就全盘失信。

---

## 三、第一节 · 平台化架构与线上 MCP 暴露面及权限边界

> 本节改写的对象：研究终稿 `final_turn_001.md` §四「MCP 暴露面与权限边界」与 §五「可集成工具的许可与借鉴取舍」。上游依据：业主方交叉裁决 P0-4、第五节 MCP 席 P0 汇总（S-02~S-18），以及 MCP 安全席报告 `review/09-mcp-security.md` 全文。

### 3.1 线上暴露面拓扑与信任边界

Trialroom 对外暴露的 MCP 面只有一个入口 `/mcp`，它是本项目**第一条完全绕开既有认证基线、owner 隔离基线与三道既有 CI 门禁的新通路**（MCP 安全席 S-01…S-20，`review/09-mcp-security.md:33-52`）。这不是推测：`server/auth.js` 的 `authMiddleware` 挂在 `app.use("/api", …)` 上（`server/index.js:344-348`），Express 的挂载作用域**不覆盖** `/mcp`；`auth.js` 的 token 模型（`server/auth.js:53-93` 的 `loadTokens()`、`:115-135` 的 `authMiddleware`）**没有 scope、没有 audience、没有过期、没有吊销、没有用户维度**，且那个 token 正是前台 Settings 页明文展示给每个登录用户的那一个（`server/auth.js:81`）。

因此本节的全部设计围绕一条主线：**把 `/mcp` 从「一个新增的未鉴权端点」改造成「一个自带独立 token class、独立资源级授权、独立幂等语义的受控暴露面」**。

请求链路（A 期形态）：

```
外部 agent（支付宝 AI 付侧 agent / 第三方 agent / 用户自带工具的宿主）
        │  Authorization: Bearer <mcp token>
        ▼
反向代理（基座实现 = nginx；设计文档写 Caddy —— 不一致，见 §3.9.2）
        │  location /mcp/ 独立段（非 SPA fallback），Mcp-* 头透传
        ▼
mcpAuthMiddleware（挂在 /mcp 挂载点自身，不依赖 /api 作用域）
        │  查 mcp_tokens：revoked_at IS NULL AND expires_at > now() 且 aud 匹配
        │  注入 req.mcp = { tokenId, userId, clientId, scopes }
        ▼
mcpRouter
        ├─ server/discover（2026-07-28 规范 MUST 实现）
        ├─ tools/list   —— 按 scope 分片；cacheScope=private；ttlMs≤5000；顺序确定
        └─ tools/call   —— 唯一授权强制点
              ├─ scope 判定（deny-by-default）
              ├─ 资源归属判定（room_seats.is_host / owner_user_id / seat 归属）
              ├─ handle 校验（room_id 绑定 principal+tenant，每次调用重判）
              ├─ 幂等键（principal + operation + key）
              └─ 审计落痕（allow 与 deny 都写）
```

信任边界的划分只有一条：**凡是平台不拥有的输入（外部 agent 的返回、用户自带工具的返回、用户自带模型产生的文本），一律不参与「结论」，只允许参与「事实」。** 评分结论（出题、评分、复盘判断）只能由平台自有且可校准的模型在平台自有上下文里产生。

### 3.2 双层强制权限模型

#### 3.2.1 对终稿第 68 行表述的纠正（P0-4）

研究终稿在 MCP 节标注为**第 68 行**（物理行号见 §3.14 的换算说明）写：

> 「这意味着**同一个 `/mcp` 端点，不同 token 看到不同的工具子集**——最小 scope 是规范内建的能力，不是我们要自己造的东西【8】。」

同一节标注为**第 72 行**（物理行号 92）写：

> 「注解不是安全边界：客户端完全可以忽略它，绕过客户端直接调 API 也照样能执行。**真正的边界在服务端**——确认令牌、限流、访问控制、作用域校验【11】。」

这两句**直接自相矛盾**。MCP 安全席 S-01 的裁决是：**站第 72 行这一边**（`review/09-mcp-security.md:58-79`）；业主方交叉裁决 P0-4 把这条列为「不改就不能开工」的硬错（`review/10-adversarial-verdict.md:78-82`）。规范侧的依据是 2026-07-28 迁移指南的两句原文：

- 「Treat TTL as a freshness hint, **not proof that downstream permissions have not changed**」——TTL 是新鲜度提示，不是权限未变的证明；
- 「高风险工具权限变化时，**服务端仍应在每次 `tools/call` 中重新鉴权**」。

结论必须改写为：**规范给的是目录呈现层（表现层 affordance）的许可，执行层的 scope 校验正是「我们要自己造的东西」。**

这个纠正有两个可验证的直接后果，不修就一定出事：

1. **吊销不生效。** 客户端响应缓存默认开启（Python SDK v2「Caching hints」），命中 TTL 就不回源。管理员吊销某用户的 `trialroom:advance`，在 TTL 到期前该用户客户端**仍然看得见** `ask_next_question` 的名字与描述。所以「工具列表按授权收敛」在吊销场景下**失效**——它不是安全边界，只是一个发现性提示。
2. **客户端可以忽略。** 客户端完全可以拿着完整工具列表去调一个它没有权限的工具；绕过客户端直接打 `/mcp` 也照样能执行。第 68 行的最后一句与第 72 行不能同时成立。

#### 3.2.2 两层的职责划分

| 维度 | 列表层（`tools/list`） | 调用层（`tools/call`） |
|---|---|---|
| 作用 | UX：降 token、降误选、让 agent 少看见不该看见的东西 | 安全：**唯一**的授权边界 |
| 实现 | 按 token 的 scope 过滤工具目录 | 按 token 的 scope + 资源归属做 deny-by-default 判定 |
| 时效 | 允许缓存（`ttlMs` / `cacheScope`） | **实时**，每次调用重新查 `mcp_tokens` 与资源归属 |
| 吊销后的表现 | TTL 内仍可见工具名与描述 | 立即拒绝 |
| 能否作为安全断言 | **不能** | **能，且必须是 CI 主断言** |
| 门禁形态 | 按 scope fixture 分片快照哈希（辅助断言，见 §3.11.3） | 每工具 × 每 scope 的正负例矩阵（主断言） |

主断言与辅助断言的分工必须写死，否则会出现「快照门禁全绿所以安全」的倒置推理。为此建议在主设计文档补 **ADR-11「MCP 授权的唯一强制点在 `tools/call`」**，并在 ADR 正文里显式写明「`tools/list` 的 scope 收敛是优化项，不作为安全断言」——这样以后任何人拿「列表里没有这个工具」来论证安全，都会被 ADR 直接挡回去。ADR-11 属于业主方本周清单第 10 项「MCP 边界补进主设计文档」的一部分（`review/10-adversarial-verdict.md:186`）。

#### 3.2.3 外部 agent 与用户自带工具的同源处理

「用户自带工具」和「外部 agent」在本项目里是**同一类对象**：都是平台不拥有的、都可能携带任意文本的、都由攻击者控制的输入。因此两者**必须走同一条管道**，不允许为「用户自己的东西」开任何豁免。理由很直接：攻击者注册一个账号就能带任意工具，所以「用户自带」不构成安全属性。

同源处理的四条硬规则：

1. **都不直接进评分 prompt**——统一经平台抽取器转为受控事实条目（§3.6）。
2. **都不能声明身份**——服务端只从 token 取 principal（§3.7.2 的 `_meta` 白名单是这条规则的协议层落地）。
3. **都不参与结论生成**——出题、评分、复盘判断只吃平台自有上下文：题库题目、岗位基准、候选人自己的作答、以及结构化事实条目（§3.3.2「返回值去向」列的正式化）。
4. **都过同一条 prompt 组装点静态门禁**——门禁不区分来源，因为「区分来源」是实现层最容易漏掉的分支。

### 3.3 暴露面切分与最终工具表

#### 3.3.1 「一个 server 一个领域」的落地形态

规范的设计原则要求 per-server 边界是权限可控的原因（终稿 `:93` 段引用的「数据库 server 与邮件 server 分开」；MCP 席 §四第 3 条复核成立，`review/09-mcp-security.md:571`）。终稿拍板表写「先切 1 个（房间与面试）」（终稿 `:195`），但终稿的工具表里 `evidence.*` 三行属于**另一个 server**（终稿 `:106-108`）——这是 MCP 席 S-18 判定的自洽性矛盾（`review/09-mcp-security.md:50`）。

**本节结论**：A 期 = **1 个 server（房间与面试）+ 6 个工具**（5 个房间与面试工具 + 1 个只读证据工具）。房间与面试、证据供给都属于「面试过程」这一个领域，不违反「一域一 server」；而保留 1 个只读证据工具是**必须的**——若把 `evidence.*` 整体移 B 期，平台化最核心的叙事（「外部输入只供给证据、不参与结论」）在 A 期外部完全不可见，评审看到的就是「把面试 API 包了一层」（S-18 同款论证，`review/09-mcp-security.md:537`）。

#### 3.3.2 A 期最终工具表

四个注解字段全部显式写出。规范默认值是 `readOnlyHint=false / destructiveHint=true / idempotentHint=false / openWorldHint=true`（MCP 席 §3.5 取证，`review/09-mcp-security.md:200-205`），且 `destructiveHint` / `idempotentHint` **只在 `readOnlyHint=false` 时才有意义**（同处 `:209`）——所以写工具必须四个全写。

| 工具名 | 所属 server | readOnlyHint | destructiveHint | idempotentHint | openWorldHint | 所需 scope | 绑定规则（资源级判定，不可省） | 返回值去向 |
|---|---|---|---|---|---|---|---|---|
| `list_rooms` | 房间与面试 | `true` | `false` | `false` | `false` | `trialroom:read` | 只列 `owner_user_id=me` 或我在 `room_seats` 有未退席位的房间；**返回值中不得出现 `room_code`** | 直接返回调用方（仅结构化房间元数据） |
| `get_room` | 房间与面试 | `true` | `false` | `false` | `false` | `trialroom:read` | 同上；`room_id` handle 每次调用重鉴（绑定 principal+tenant）；**不得返回 `room_code`** | 直接返回调用方 |
| `join_room` | 房间与面试 | `false` | `false` | `true` | `false` | `trialroom:join` | `room_code` 仅作**入座凭证**（一次性、限流）；入座后拿到的 `room_id` 才是 handle；同房同席重复入座天然幂等 | 直接返回调用方（返回 `room_id` handle，不回显房号） |
| `ask_next_question` | 房间与面试 | `false` | `true` | `false` | `false` | `trialroom:advance` | **判 `room_seats.is_host=1`（或 `rooms.owner_user_id`），不判 scope**；否则 **404**；**必须**配服务端幂等键 | 直接返回调用方 |
| `submit_self_review` | 房间与面试 | `false` | `false` | `true` | `false` | `trialroom:self_review` | 本人 seat 且 `room_seats.visibility='private'`；覆盖写同一 `(room_id, turn_index, seat_id)` → 幂等 | 直接返回调用方 |
| `evidence.search` | 房间与面试（只读证据） | `true` | `false` | `false` | `true` | `evidence:read` | 只读平台已登记的证据条目；**不接受任意 URL**（A 期不做 BYO 出网，见 §3.8） | **仅进证据区**；返回结构化事实条目，**不进评分 prompt** |

> **口径统一说明（吸收核验报告 verify-platform 第 11 条）**：三个只读工具（`list_rooms` / `get_room` / `evidence.search`）的 `destructiveHint` / `idempotentHint` 在本表统一**显式填 `false`**（而非留空），因此「四个注解字段全部显式写出」这句在本表成立。`config/mcp-tools.json` 的 `annotations` 约定为「**四字段恒定存在，值可为 `false`**」。

注解取值逐条依据：

- `join_room` / `submit_self_review` / `evidence.search` 的 `destructiveHint` 语义与实现一致（纯追加 / 覆盖写同一键 / 纯读），标注 `false` 后绝大多数客户端不会弹确认窗。MCP 席 §3.5 指出客户端严格程度不一（「clients vary in how strictly they honor the pessimistic defaults」），所以**标注写对是必要但不充分**——真正的二次确认放在服务端（§3.7.4 的 `input_required`），不依赖客户端弹窗。
- `ask_next_question` 显式 `destructiveHint=true`：推进轮次会覆盖 `rooms.current_turn`、写入 `room_turns` 并消耗房间的付费额度，这是破坏性操作。它同时是**唯一一个 `idempotentHint=false` 的写工具**——客户端在超时后**不得**放心重试，幂等性由服务端幂等键兜底（§3.10）。
- `submit_self_review` 的 `idempotentHint=true` 有前提：幂等性来自「对同一 `(room_id, turn_index, seat_id)` 的自评草稿做覆盖写」。**只要实现里是每次 append 一行、或每次生成新草稿 id，它就不幂等**（MCP 席 §3.5 判定，`review/09-mcp-security.md:230-234`）。因此必须给 `self_reviews` 加唯一索引 `(room_id, turn_index, seat_id)`，写用 `INSERT … ON CONFLICT DO UPDATE`。注意 `db/001_platform_schema.sql:206` 已经有 `CREATE UNIQUE INDEX idx_room_turns_index ON room_turns(room_id, turn_index)`，自评表要照此模式建自己的唯一索引。
- `evidence.search` 的 `openWorldHint=true`：它读的是外部世界来源的内容，即使在 A 期只读平台已登记的证据，读取方仍须按「输出不可信」视角审视（规范原话：「提示输出为不可信内容，需过信任边界」）。**但 A 期它只返回已结构化的事实条目，不返回原始文本**——这一点由 §3.6 的抽取器保证，不是由注解保证。

#### 3.3.3 不进 A 期的工具及其理由

| 工具 | 原 scope | 处置 | 理由 |
|---|---|---|---|
| `get_transcript` | `trialroom:read` | **A 期不暴露** | 返回其他参与者的作答内容。按《房间机制与安全规范》§1.6「真人候选人的答案默认对其他参与者不可见；看他人答案需房主授权」（`Trialroom-房间机制与安全规范.md:176-183`），把它搬到 MCP 需要重做一遍逐席可见性过滤，且 MCP 面**没有 UI 去承载「房主授权」这一步**（本方案把 MRTR 只留给 `start_scoring` 与 `evidence.attach`，见 §3.7.4）。A 期 transcript 留在 Web UI，那里授权流程已经存在 |
| `evidence.get_item` | `evidence:read` | **A 期不暴露** | 与 `evidence.search` 的职责重叠，且它的返回值是「单条原始条目」，是 §3.6 里最容易漏进 prompt 的形状。A 期用 `evidence.search` 一条即可证明边界 |
| `evidence.attach` | `evidence:attach` | **移 B 期** | 它需要 BYO 远程 endpoint 通道（§3.8），而 BYO 通道依赖出口管控与抽取器；且它是唯一会「把外部世界的原始内容接进平台」的写操作，风险面最大。MCP 席 §3.14 与 §6.2 均建议 BYO 远程 endpoint 接入移 B 期（`review/09-mcp-security.md:518`、`:634`） |
| `submit_self_review` 的 `trialroom:advance` scope | — | **拆为 `trialroom:self_review`** | S-03 的唯一一条 scope 粒度建议：自评是「写自己的复盘草稿」，与「推进房间阶段」是完全不同的能力，混在一起会让只想自评的 token 拿到推进权（`review/09-mcp-security.md:164`）。其余四档（`read` / `join` / `advance` / `evidence:read`）粒度合适，**不再拆**——拆了 OAuth 落地成本反而上升 |

#### 3.3.4 工具表冻结件

工具表必须以**一份声明**为准，而不是散落在代码里：新建 `config/mcp-tools.json`，含每个工具的 `name / server / annotations(四字段) / scope / handle 规则 / 幂等语义 / 返回值去向`。作用有三：门禁对着这一份做断言（不必解析源码）；评审现场这张表本身就是产品文档（终稿 `:171`「对外暴露的工具描述就是评审现场看到的东西」）；scope 与工具的增删变成一次 diff 评审而不是一次代码考古。MCP 席 §6.1 第 12 项把这条列为「冻结件」，成本 0.2 人日（`review/09-mcp-security.md:627`）。

同时采纳一条工具数量上限门禁：**MCP 工具总数 ≤ 12，超出构建失败**（MCP 席 §四第 4 条建议，G-M3e）。理由是规范强调工具目录占模型上下文，且「100 张表 → 400+ 工具」本身就是反模式；每一个暴露的工具都是一个提示注入攻击面（`review/09-mcp-security.md:572`）。

### 3.4 scope 与房间的绑定

#### 3.4.1 scope 不是安全边界

终稿引用的 LangBot Box Runtime 文档那句 **「Scope controls session reuse; it is not a security boundary.」**（终稿 `:112`；MCP 席 §四第 6 条复核成立，`review/09-mcp-security.md:574`）必须直接抄进设计文档。它同时否定两种伪隔离：按用户隔离目录、按 scope 隔离会话。

**本节 S-03 就是这句话的直接应用**：scope 不绑定房间，等于用 scope 冒充安全边界。

#### 3.4.2 现有 schema 事实与攻击路径

```
db/001_platform_schema.sql:151-159
  room_id       TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id),
  room_code     TEXT NOT NULL,             -- 6 位房号，凭证进房
  title         TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'invite',     -- invite（凭房号）| public
```

`room_code` 是 **6 位房号**，注释直接写「凭证进房」，唯一索引在 `:170`（`idx_rooms_code`），而 `rooms.visibility` 有一档 `public`。

而《房间机制与安全规范》§1.6 的权限模型写得很清楚：**「房主（owner）：全部：改配置、踢人、换题、推进轮次、结束房间、管理付费席位」**；参与者「只答自己的题、提交追问请求、看自己的复盘」（`Trialroom-房间机制与安全规范.md:178-179`）。也就是说，**「推进轮次」在产品定义上是房主专属动作，但在 scope 模型里被压缩成了 `trialroom:advance` 这一个与房间无关的字符串**。

攻击路径（具体可复现）：

1. 攻击者持有任何一个带 `trialroom:advance` 的 token。外部 agent 场景下，token 甚至可能是平台自己发给用户的自助生成 token。
2. 房号空间大小不重要，**重要的是它是否被枚举**。终稿工具表里有 `list_rooms`（`trialroom:read`），而 `get_room` 的返回值极可能带 `room_code`（分享落地页就是靠房号进房的）。**一旦 `room_code` 出现在任何 MCP 返回值里，它就是一个 6 位可枚举凭证。**
3. 拿到 `room_code` → `join_room` → 进房 → `ask_next_question` → **在别人的房间里发题、推进轮次、消耗房间的付费额度**。
4. 若 `visibility='public'`，连房号都不需要。

这是上一轮 P0-2（全域 IDOR）在 MCP 面上的精确复现。而 P0-2 的修复方案 `scopedDb` 强制 owner，**作用域是数据库访问层**；MCP 工具层如果再加一层「scope 判断」，就会变成**两套并行的授权判定**，且 MCP 那套更粗（只判 scope，不判 owner）——**两套判定不一致时 MCP 那套赢，因为它是先判的**（`review/09-mcp-security.md:143`）。这是本节所有资源级规则的设计动机。

#### 3.4.3 三层绑定规则

| 层 | 规则 | 依据 |
|---|---|---|
| ① handle 绑定 | `room_id` 是 **capability 不是 secret**：≥128 bit 熵、不可猜测；**绑定 principal + tenant**；**每次 `tools/call` 重新鉴权**（不能因为「`join_room` 时验过了」就在同一房间上放宽后续调用）；handle 生命周期写进工具描述；过期时返回**可恢复错误** | 规范迁移指南原话：「Make handles opaque and unguessable. Bind each handle to the authenticated principal and tenant. Re-authorize the handle on every call. Document its lifetime in the tool description. Return a recoverable error when it expires.」（MCP 席 §3.3 引，`review/09-mcp-security.md:157`） |
| ② 越权返回 404 | 任何跨用户 / 跨房间的访问一律 **404**，不返回 403 | 《全量设计方案》§6.4 安全基线「授权」行：「scopedDb 强制 owner；跨用户访问返回 **404 而非 403**（403 会泄露 id 存在）」（`Trialroom-全量设计方案.md:1683`）；403 会把 6 位房号空间变成存在性预言机 |
| ③ 推进权判 seat | `ask_next_question` 的推进权判 **`room_seats.is_host=1`**（或 `rooms.owner_user_id`），**不判 scope**；`room_seats.is_host` 字段见 `db/001_platform_schema.sql:188` | 《房间机制与安全规范》§1.6（房主专属）；S-03 裁决第 3 条（`review/09-mcp-security.md:35`） |

#### 3.4.4 `room_code` 的处置

`room_code` 是 6 位可枚举凭证，必须做三件事：

1. **禁止**出现在任何 MCP 返回值里（`list_rooms` / `get_room` 都要剔掉）。分享链接走**独立的、不带 MCP 语义的**邀请 token 通道。
2. 6 位房号只保留在**网页邀请链接**这一条路径上，并配**按房号维度的失败尝试限流 + 锁定**。现有的 `createRateLimiter` 语义是 60 秒 120 次（`server/index.js:122`），对 10⁶ 量级的房号空间**不够**——必须增加按 `room_code` 维度的失败计数，而不是只按 IP / token 维度。
3. **独立熵源**：`room_code` 与 `room_id` 必须由**不同的随机源**生成。`room_id` 是 ≥128 bit 的不可猜测 handle，`room_code` 是 6 位可枚举短码——两者若来自同一个种子或同一个 PRNG 的相邻输出，撞库与枚举的组合风险会显著上升。实现上：`room_id` 用 `crypto.randomBytes(16)`（base64url，22 字符，`^rm_[A-Za-z0-9]{22}$` 形态见 §3.11.3 的白名单），`room_code` 用独立的 `crypto.randomBytes` 调用并对字符集做无模偏映射。

**并且 `room_id` 的格式必须写进 schema 约束**：当前 `db/001_platform_schema.sql:152` 只写 `room_id TEXT PRIMARY KEY`，**没有任何格式约束**——这是一个现成的具体动作（MCP 席 §3.3 明确指出，`review/09-mcp-security.md:158`）。

### 3.5 独立 token class 与 `/mcp` 挂载点鉴权

#### 3.5.1 现状取证与两种失败模式

| MCP 挂载位置 | 结果 | 证据 |
|---|---|---|
| `app.use("/mcp", mcpRouter)` | **完全无鉴权**。`authMiddleware` 挂在 `app.use("/api", …)` 上，Express 挂载作用域不覆盖 `/mcp` | `server/index.js:344-348` |
| `app.use("/api/mcp", mcpRouter)` | **被全局 token 集合放行**。`loadTokens()` 读 `INTERVIEWX_API_TOKEN` env + `data/.api_token` 文件，任一匹配即通过，**没有 scope、没有 audience、没有过期、没有吊销、没有用户维度** | `server/auth.js:53-93`、`:115-135` |

第二种模式的现实危险是具体的：**那个 token 就是前台 Settings 页明文展示给每个登录用户的那个全局 token**（`server/auth.js:79-81`）。也就是说，**任何一个注册用户天然持有一把能打进 `/mcp` 的钥匙，而这把钥匙没有 scope 概念——per-tool scope 在这个 token 模型里无处存放**（S-02，`review/09-mcp-security.md:34`）。

#### 3.5.2 `mcp_tokens` 表 DDL 草案

沿用 `db/migrate.mjs` 的迁移链与校验和机制（`db/migrate.mjs:21-30` 的迁移契约、`:340-384` 的校验和比对；CI 门禁 G4 跑 `node db/migrate.mjs --check`）。

```sql
-- db/002_mcp_schema.sql
-- MCP 专用 token class。与 user_sessions / data/.api_token 全局 token 物理隔离。

CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_id        TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL UNIQUE,      -- SHA-256(明文)；绝不存明文
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  client_id       TEXT,                      -- 调用方标识（支付宝 AI 付侧 agent / 第三方 agent / 本地 bridge）
  scopes          TEXT NOT NULL,             -- JSON 数组，如 ["trialroom:read","trialroom:join"]
  aud             TEXT NOT NULL DEFAULT 'https://trialroom.example/mcp',
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  revoke_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_client ON mcp_tokens(client_id);
```

配套两张表：`mcp_audit`（每次 `tools/call` 的审计，**deny 与 allow 同权记录**——拒绝事件比放行事件更值得留）与 `mcp_request_state_nonces`（§3.7.4 的 `requestState` 一次性消费标记）。

**迁移顺序硬规定**：`db/002_mcp_schema.sql` 必须在 `db/001_platform_schema.sql` 之后执行，且**不得在 `002` 里新增 `orders` / `entitlements` 表**——决策 #40 的「`entitlements` 唯一真相源」约束在 MCP 侧同样成立（见 §5.6 CF-10 落点）。

#### 3.5.3 `auth-mcp.js` 与挂载方式

- 新建 `server/auth-mcp.js`，导出 `mcpAuthMiddleware`。
- 挂载方式：`app.use("/mcp", mcpAuthMiddleware, mcpRouter)`——**鉴权中间件自带于挂载点**，不依赖 `/api` 作用域。
- **`不复用 `auth.js` 的 `loadTokens()`**。这不是「约定不读」，是「物理分表 + 无 join 路径」，并写成 e2e 双向负例（§3.12.1 的 F1）。
- `mcpAuthMiddleware` 注入 `req.mcp = { tokenId, userId, clientId, scopes }`，下游一律从 `req.mcp` 取 principal，**不得从 `req.headers` 或 `req.body` 取身份**。

### 3.6 证据与结论的职责分离

#### 3.6.1 从断言到不变量

「原始文本不进评分 prompt」如果只写成一句话，就是**不可验证断言**；而抽取器本身就是一次模型调用 = 新注入面。MCP 席 §3.4 的原文：

> 「原始文本不进 prompt」是一条**可以被机器验证**的不变量；而「抽取器是安全的」是一句**无法被机器验证**的承诺。前者能做成门禁，后者只能做成评审话术。

因此修复动作不是「让抽取器更聪明」，而是**让门禁去守住那条不变量**。

#### 3.6.2 抽取器两段式设计

```
段一：边界化（boundary）
  输入：证据条目的原始文本（来自 evidence.search / 用户自带工具返回值）
  硬约束：
    · 单条原文 ≤ 8KB；单次抽取条数 ≤ 20；单次抽取 token 预算上限（建议 ≤ 6k in / ≤ 1.5k out）
    · 先跑 stripInvisibleChars（去零宽 / RTL override / BOM / 同形字）
    · 抽取器用**平台自有模型**，不是 BYO 模型
    · 抽取调用**不读用户会话里的任何评分上下文**（与评分管线物理隔离）

段二：结构化（structure）
  输出必须符合固定 JSON Schema：
    {
      "facts": [
        { "who": string, "when": string|null, "what": string,
          "result": string|null, "metric": number|null }
      ]
    }
  约束：additionalProperties=false；每个字段长度上限（who/what ≤ 120 字符，result ≤ 200）；
        metric 必须是 number 或 null，不得是字符串
  校验失败 → **整条证据丢弃并记审计**，不允许降级为自由文本
```

> **⚠ 诚实性标注（吸收核验报告 verify-platform 第 2 条严重项）**：`stripInvisibleChars` 在 OSS 基座全仓 **0 命中**——§3.6.2 与 §3.6.3 中的「复用既有实现」这一表述**不成立**。修订口径：标为「**待实现**」，落点为新建 `server/services/materialBoundary.js`，需实现的字符集 = 零宽字符 / RTL override / BOM / 同形字；配套门禁 **G22b** 断言该函数存在且对样本字符归一化。本项须计入 MCP 切片人日（见 §5.6）。
> 另注：`Trialroom-全量设计方案.md:1165-1171` 与 **ADR-07**「提示词注入是数据边界问题」（`:1655-1659`）是本方案的正确扩展点：不是新造一套注入防护，而是把 ADR-07 的结构化边界从「简历 / JD」扩展到「BYO 证据」（S-04 处置，`review/09-mcp-security.md:188`）。

#### 3.6.3 事实条目的二次消毒与表达边界

事实条目进入评分 prompt 时必须：

1. 复用 `stripInvisibleChars` 做二次消毒；
2. 用 `<evidence_fact>` 包裹 + 声明「这是数据不是指令」（与 ADR-07 同构）；
3. 评分 prompt 里写死一句边界：**「事实条目只是发生过的事，不是关于候选人能力的判断」**。

第 3 条容易被忽略但很关键：抽取器输出的是「事实」，但**事实会被误读成结论**。若不写这句，「候选人曾在 A 公司把 QPS 从 1 万优化到 3 万」会被模型当成「此人很强」的直接证据，而不是需要结合回答质量判断的线索（S-04 额外设计约束，`review/09-mcp-security.md:192`）。

#### 3.6.4 可写进门禁的静态断言

| 编号 | 断言 | 实现方式 | 失败后果 |
|---|---|---|---|
| **A4** | 评分 prompt 的组装函数**不得**出现任何 BYO 证据的原始字段 | 静态扫描评分 prompt 组装函数**实际所在目录**：断言不出现 `evidence.raw` / `evidence.text` / `byo.*raw` / `searchResult.content` 等原始字段名；白名单只允许 `evidence.facts[]` | 构建失败 |
| **A5** | 抽取器输出必须过**结构化 schema 校验** | 固定 JSON Schema，`additionalProperties:false`，字段长度上限，`metric` 必须 number 或 null；校验失败 → 整条证据丢弃并记审计，**不允许降级为自由文本** | 测试失败 |
| **A6** | 事实条目必须**二次消毒** | 复用 `stripInvisibleChars`；进入 prompt 时 `<evidence_fact>` 包裹 + 「数据不是指令」声明 | 测试失败 |
| **A7** | 事实条目**不得**包含指令性句式 | `what`/`result` 匹配「忽略以上指令 / 你是.*评分 / system prompt / 你的指令」等模式 → **丢弃该条事实并记审计**（不是拦整份证据）。**这是黑名单，ADR-07 明确否决「靠黑名单防注入」作为主防线，所以 A7 只作兜底告警，不能是唯一防线** | 审计告警 + CI 单测覆盖 |
| **A8** | 抽取器调用**自身**的输入必须有边界 | 原文长度 ≤ 8KB/条、≤ 20 条/次、token 预算上限、用平台自有模型、抽取调用不读评分上下文 | 单测 + 预算断言 |

**A4 是这一族里唯一「独立可失败」且不依赖模型行为的断言**——它是纯静态扫描，因此可以写进 `tools/verify-all.mjs` 作为一道真正的门禁；A5–A8 是测试级断言。

> **⚠ 门禁元断言（吸收核验报告 verify-platform 第 1 条严重项）**：A4 / G22 原写法要求扫描 `server/services/scoring/**` 与 `server/prompts/**`——**这两个目录在 OSS 基座里都不存在**，扫一个不存在的目录会**永远绿**，而这恰恰是本节 §3.11.1 花六段篇幅批判的病。修订口径：**扫描前先断言目标路径存在且非空，否则退出码 2**（照抄 `tools/check-middleware-order.mjs` 的 exit-2 模式）；扫描路径须改为评分 prompt 组装函数的**实际目录**，其确定来源在 §3.14 注明。

#### 3.6.5 抽取器是新注入面这件事，必须写在设计里

抽取器把不可信文本转成结构化事实，**转换本身是一次模型调用**，因此抽取器的输入端同样暴露在注入下。三条写进设计的硬约束：

1. 抽取器的**输出 schema 是封闭的**（`additionalProperties:false` + 长度上限），所以注入内容无法携带任意结构；它最多污染一个字符串字段。
2. 抽取器的输出**只进入证据区**，进入评分 prompt 前必过 A5–A7；A7 命中即丢弃该条事实。
3. 抽取器的输出**永不被当作结论**：评分 prompt 里的边界句（§3.6.3 第 3 条）保证「事实 ≠ 判断」。

必须显式承认的一点：**A7 的黑名单是可被绕过的**（ADR-07 已否决黑名单作为主防线）。所以真正的保证来自 A4——**原始文本根本没有到达 prompt 组装点的机会**，抽取器只是一个「把已污染的原始文本压缩成受控形状」的降级装置，不是防线本身。这句话要写进设计文档，否则读者会以为抽取器是防线。

### 3.7 2026-07-28 规范新增边界的逐条落地

原方案复述了规范里「方便我们」的部分（无状态、缓存、注解），**没有复述规范里「约束我们」的部分**。本节逐条落地。

#### 3.7.1 `Mcp-Method` / `Mcp-Name` 头体一致性（S-11）

2026-07-28 规范要求 Streamable HTTP 的 POST 携带 `Mcp-Method`（镜像 JSON-RPC method）与 `Mcp-Name`（`tools/call` 时的工具名），头体不一致时错误码为 `HeaderMismatch(-32020)`。规范原话：

> 「Servers must reject a request when the routing headers disagree with the body」
> 「A gateway that authorizes `tools/list` from the header while the backend executes `tools/call` from the body is **vulnerable to a protocol-confusion bypass**」

对 Trialroom 的具体威胁是**必然发生**的：本项目一定会有反代（§3.9）。如果有人为了「按工具限流 / 路由 / 统计成本与失败率」在 nginx 里按 `Mcp-Name` 分流——这在规范推荐下非常自然——并**顺手在网关层做了工具级授权**，而服务端又从 body 取 `params.name` 做 scope 判定，那么**网关授权的工具 ≠ 后端执行的工具 = 绕过**。

三条落地规则：

1. **授权只在 body 解析后做**；网关层**只能**限流 / 路由 / 计费，**不得**做授权。
2. 执行点做头/体一致性校验：解析 body 后比对 `Mcp-Method` ↔ JSON-RPC `method`、`Mcp-Name` ↔ `params.name`，不一致 → **400 + `HeaderMismatch(-32020)`**。
3. **禁止**任何按 `Mcp-Name` 做授权决策的规则（**可以**按它做限流）。这条要写进 nginx 配置评审清单，也要写进门禁（§3.11.3 的 **G14c**）。

#### 3.7.2 `_meta` 只白名单取 2 个键（S-12）

2026-07-28 让**每个**请求都带 `_meta`（`io.modelcontextprotocol/protocolVersion` + `io.modelcontextprotocol/clientCapabilities`）。规范 server 作者检查清单原文：

> 「**Do not trust identity, tenant, or role claims supplied in arbitrary `_meta`.** Apply size limits and namespace rules to custom `_meta`.」
> 「Servers must reject a request when `MCP-Protocol-Version` disagrees with `io.modelcontextprotocol/protocolVersion` in `_meta`」（→ HTTP 400 / `-32020`）

威胁很具体：攻击者把 `{"_meta":{"user_id":"other","role":"admin","tenant":"..."}}` 塞进请求。只要服务端有任何一处「从 `_meta` 取用户」的代码（这种代码在调试期很常见），就是直接提权。**而且 `_meta` 是新加的必填字段，团队大概率会「先存下来再说」。**

落地规则：

1. 服务端**只从 token 取身份**，`_meta` 里任何身份 / 租户 / 角色字段**一律忽略**（不是「优先取 token」——是「不读」）。
2. `_meta` **只白名单取 2 个键**：`io.modelcontextprotocol/protocolVersion` 与 `io.modelcontextprotocol/clientCapabilities`；其余键**丢弃并限长**（整体 ≤ 4KB），自定义键必须落在 `io.modelcontextprotocol/` 命名空间下。
3. 版本头与 `_meta` 不一致 → **400**（`-32020`）。
4. 门禁断言：**带 `_meta` 提权字段的请求，其返回结果必须与不带时逐字节一致**（S-08 的 F6，`review/09-mcp-security.md:329`）。

#### 3.7.3 `Origin` 校验与 DNS rebinding（S-13）

规范要求：「**Streamable HTTP servers must validate Origin**, and local servers should bind to loopback rather than 0.0.0.0.」

现状：本项目容器 `HOST="0.0.0.0"`（`server/index.js:53`：`const HOST = process.env.HOST || (process.env.DOCKER === "1" ? "0.0.0.0" : "127.0.0.1");`，`docker/docker-compose.yml:25` 设 `DOCKER=1`），且预发环境是公网可达的。后果是：恶意网页可以向用户浏览器的 `https://staging.../mcp` 发 POST。虽然 Bearer token 不会被浏览器自动带上，但——① 若将来引入 cookie 会话（房间共享邀请链接很可能会）就立刻成立；② 即便现在，**跨站请求仍可消耗服务端资源并写入审计噪声**。

落地规则：

1. `/mcp` **强制 Origin 白名单**（只允许已知客户端域名）；**非浏览器客户端不带 Origin 则放行，但必须记录**（这是规范场景与浏览器场景的区分，不是漏洞）。
2. 预发环境**绑回环 + 隧道**，不公网直连。
3. DNS rebinding 防护：出网侧解析后再校验 IP（§3.8.2），入站侧靠 Origin 白名单 + 反代不信任 `Host` 之外的转发头。
4. 门禁断言：带恶意 Origin 的请求必须 **403**。

#### 3.7.4 `input_required` / MRTR 续跑状态（S-14）

终稿写「`resultType: "input_required"` 加 `inputRequests` 取代了服务端发起的 elicitation，**这正好是面试追问该用的标准机制**」（终稿 `:90`）。这里**功能定位错了**：

- MRTR（Multi Round-Trip Request）解决的是「**一次工具调用需要人补输入**」，不是「面试官追问候选人」。面试官追问是**服务端自己生成下一道题**——那是普通工具调用，不需要人补输入。
- 真正需要 `input_required` 的是「**这个动作需要房主点头**」。

**把 MRTR 用成「追问」，会让每个追问都变成一次人机往返 = 面试流程变成填表**（MCP 席 §3.12，`review/09-mcp-security.md:461`）。

> **口径修订（吸收核验报告 verify-platform 第 12 条）**：**A 期没有任何工具返回 `input_required`。** `start_scoring` 与 `evidence.attach` **均不在 A 期工具表内**（`evidence.attach` 已移 B 期，见 §3.3.3；`start_scoring` 在 A 期也没有对应的付费入口工具）。因此 A 期**不实现 MRTR 续跑**，下面的 `requestState` 规格是 **B 期预留**的设计约束，不是 A 期的施工项。
> 若后续决定让 `start_scoring` 进 A 期，必须**同批补进** §3.3.2 工具表（+ scope + 注解 + 门禁 + §3.12.3 的 scope 列表），否则会出现「协议支持了但没人实现」的悬空面。

安全面（终稿完全没写）：MRTR 的续跑状态 `requestState` 是 MCP **刚拆掉 session 之后**留下的全新有状态面。规范要求得很具体：

> 「On the server, **bind continuation state to the principal, operation, and expiry. Protect it against tampering and replay.**」
> 「treat the raw value as **opaque**; do not parse it, make assumptions about its contents, or **record the raw value in logs**」

`requestState` 实现要求：

- 结构：`{opId, tool, principal, exp, nonce}` + `HMAC(server_key, payload)`；
- **一次性消费**：消费后立刻失效（消费记录落 `mcp_request_state_nonces.consumed_at`），重复提交 → `-32602`；
- **过期可恢复**：过期时返回**可恢复错误**（「续跑已过期，请重新发起」），**不返回 500**；
- **不入日志**（logger 白名单排除）、不进错误回显、不进审计 payload——规范说的是「不记录原始值」，所以服务端只留 nonce 的消费标记。

#### 3.7.5 `x-mcp-header` 不得携带密钥的四条断言（S-06）

规范事实（比终稿的理由更重）：`x-mcp-header` 是工具 `inputSchema` 里的一个属性名，声明该属性「有资格被镜像到 `Mcp-Param-*` 请求头」；「Conforming HTTP clients then mirror those values into `Mcp-Param-*` headers」；「**The headers mirror the body, and every component that processes the body must reject disagreement rather than silently preferring either representation**」；「**do not mark secrets or sensitive personal data for header mirroring**」；「they routinely end up in infrastructure logs」。

所以终稿「因为代理能读头」这个理由**成立但不完整**——真正的问题是两条：**头会进基础设施日志** + **头/体不一致时谁优先**。

| 编号 | 断言 | 实现方式 |
|---|---|---|
| **B1** | **禁止**任何工具把 `x-mcp-header` 声明在 secret / credential / token / key / password / auth 语义的属性上 | 扫描 `server/mcp/tools/**` 里所有含 `x-mcp-header` 的属性名，与 `SECRETISH = /(secret\|token\|key\|password\|passwd\|credential\|auth\|bearer\|cookie\|sign)/i` 求交，**命中即构建失败**。**扫描目标目录不存在 → 退出码 2**（不扫不存在的目录 = 永远绿） |
| **B2** | `x-mcp-header` 只允许出现在**已声明的白名单**属性上 | 维护 `config/mcp-header-whitelist.json`，例如 `{"room_id": {"type":"string","maxLength":64,"pattern":"^rm_[A-Za-z0-9]{22}$"}}`；白名单外的 `x-mcp-header` → 构建失败。白名单条目必须带 `maxLength` 与 `pattern`（防把大对象塞进头） |
| **B3** | `x-mcp-header` 的值**不得**进入任何日志 | 扩展 `server/scripts/check-observability-privacy.mjs`（已登记为 verify-all 的 G8b，`tools/verify-all.mjs:92-97`）：断言 MCP 相关日志代码里不出现 `Mcp-Param-` / `req.headers["mcp-param` / `headers['mcp-param`，且请求日志的 header 白名单**不含** `mcp-param-*` |
| **B4** | 头 / 体不一致必须被拒 | 服务端解析 body 后，对每个声明了 `x-mcp-header` 的属性，把 `Mcp-Param-*` 头的值与 body 值做**恒等比对**，不一致 → **400 + `HeaderMismatch(-32020)`** |

**B1 的一条扩展（防止把密钥挪到别的头里）**：`Mcp-Name` 会被网关读到、`Mcp-Method` 会被网关读到、`Authorization` 本身是标准头——所以白名单机制必须覆盖**整个 `Mcp-*` 头族**，而不只是 `Mcp-Param-*`。B1 应改成「扫描所有 `Mcp-*` 头的处理点，断言其值不被写入日志、不被拼进 URL」（`review/09-mcp-security.md:264`）。

#### 3.7.6 无 session 下的显式 handle

2026-07-28 **移除**了 `initialize` 握手与 `Mcp-Session-Id` 头，列表类端点不再随连接变化。需要跨调用状态的服务器改用**显式 handle（server-minted handles）作为普通工具参数传递**。

对 Trialroom 的落地：`room_id` 就是这个 handle。它必须满足 §3.4.3 的三条（不可猜测、绑定 principal+tenant、每次调用重鉴），并且**handle 的生命周期写进工具描述**（规范要求 Document its lifetime in the tool description）。A 期的具体约定：`room_id` 在房间创建时铸造，随房间归档后失效；`join_room` 返回它；`list_rooms` 返回它；**工具描述里写明「房间归档后该 handle 失效，请重新 `list_rooms`」**。

#### 3.7.7 废弃的 roots / sampling / logging 怎么处理

2026-07-28 规范用 **SEP-2577** 一并废弃 **Roots、Sampling、Logging** 三个能力（**deprecate，不是 remove**），并由 **SEP-2596**（Specification Feature Lifecycle and Deprecation Policy）定义 Active / Deprecated / Removed 三态：**最短 12 个月退场窗口**，锚点是「首次标记 Deprecated 的那个规范版本」，因此本三者最早只能在 **2027-07-28 之后的第一个 Current 版本**被移除。

本项目的处置（**不是**「支持它们」，也不是「假装它们不存在」）：

| 能力 | 本项目是否实现 | 理由与替代 |
|---|---|---|
| **Roots** | **不实现** | Roots 是「客户端告诉 server 可以看哪些目录」，在本项目里**没有任何用途**——Trialroom 不读客户端文件系统。更重要的是：Roots 是**荣誉性边界**（honor-system），协议层不强制；把它当边界用是 LangBot 那句话（「Scope controls session reuse; it is not a security boundary.」）的同型错误。官方替代方向是「工具参数 / 资源 URI / 服务端配置」，本项目不需要其中任何一个 |
| **Sampling** | **不实现** | Sampling 是「server 反过来请求 client 的模型」。SEP-2577 的安全影响段明确指出这是三者中最敏感的：它让 server 经客户端发起 LLM 补全，是提示注入与数据外泄的攻击面。官方替代是「直接对接 LLM 厂商 API」——**这正是本项目评分内核的既有形态**（平台自有模型 + 自有 API key + 自有校准集），所以替代路径零成本 |
| **Logging** | **不实现** | 协议级 logging（`logging/setLevel` + `notifications/message`）在 2026-07-28 被移除（`logging/setLevel` 直接删除，日志级别改为请求级 `_meta["io.modelcontextprotocol/logLevel"]`）。官方替代是 stdio 写 stderr / OpenTelemetry。本项目跑 HTTP + 容器，**已有自己的可观测性体系**（《全量设计方案》§6.5，`Trialroom-全量设计方案.md:1692-1704`），且明确「不采集请求体、响应体、用户输入、cookie、简历内容」——不需要协议级日志通道 |

**实施口径**：A 期的 `server/discover` **不声明** roots / sampling / logging 三个能力位。服务端若收到客户端声明了这三个能力，**不实现对应处理分支**（收到 `roots/list` → `-32601 Method not found`；收到 `sampling/createMessage` → 同）。因为废弃期内这些方法仍可能在旧客户端上出现，**拒绝是正确的**——规范同时说明「wire 行为不变」是针对**协商到旧版本**的会话，本项目只实现 2026-07-28 一个版本（`server/discover` 声明支持版本集合），旧版客户端走 dual-era 兼容路径。

**为什么这条要单列**：终稿与裁决链里**完全没有提到 roots / sampling / logging**（`grep -rn "roots\|sampling\|logging"` 在 `review/09-mcp-security.md`、`review/10-adversarial-verdict.md`、`final_turn_001.md` 三份文件中均 0 命中）。一个只声明 2026-07-28 的 server 如果不显式处理这三个能力，它们会以「未声明但未实现」的形式悬在实现里，直到某个客户端真的调用时才暴露。显式不实现 + 显式声明不声明，是成本最低的正确姿势。

### 3.8 BYO 通道隔离

#### 3.8.1 只接受远程 HTTP 端点

终稿结论：「只接受用户提供的远程 HTTP 端点，由平台主动调用并包一层出口域名白名单、超时与响应体大小上限；**用户本机跑的 stdio server 一律不接**」（终稿 `:112`）。S-07 复核**成立**（`review/09-mcp-security.md:39`）。

方向正确的理由：平台代跑用户进程 = 平台承担任意代码执行风险（沙箱逃逸 / 供应链），在 44 天、1 核容器、无 gVisor / nsjail 的现实里不可接受。

**但它挡掉了一个真实场景**：用户想把「本地 Claude 桌面里装的 MCP」接进试镜间。原方案没给替代路径，而用户会直接说「那我用不了」。

#### 3.8.2 沙箱三档与本项目的档位选择

工业界三档做法（终稿 `:112` 引，MCP 席 §四第 5 条复核成立，`review/09-mcp-security.md:573`）：

| 档位 | 代表做法 | 本项目是否采用 | 理由 |
|---|---|---|---|
| 沙箱隔离 | Dify Sandbox（gVisor / nsjail，文件系统只读白名单、网络域名白名单、危险 syscall 限制、超时与内存上限） | **否** | 应用容器只有 1 核（`Trialroom-全量设计方案.md:239-245` 的 M-67），无 gVisor / nsjail。引沙箱 = 44 天里做一个必然半成品的旁路 |
| 独立自托管服务 | LibreChat 的代码解释器就是一个独立进程服务 | **部分**（用户侧） | 平台侧不做；由**用户**自托管，平台只当普通远程 HTTP 端点对待 |
| **不给 shell** | AnythingLLM 的 agent 文档里没有 shell 工具，同类里最安全 | **是（A 期档位）** | 唯一在 1 核容器里可落地的档位。平台不提供任何「执行用户代码」的工具 |

因此 A 期的 BYO 边界是：**平台不提供执行用户代码的工具；平台不代跑用户进程；平台只接受远程 HTTP 端点（B 期）。**

#### 3.8.3 用户本机 stdio server 的安全正确路径

**不做 stdio 代理，做「用户侧拉取（pull）」而不是「平台侧推送（push）」**：

1. 用户在自己的机器上跑一个**极小的本地桥**（`trialroom-bridge`），职责只有一件：**把本地 stdio MCP 的工具调用结果，以 HTTPS POST 的形式送到平台**。
2. 平台侧看到的仍然是一个**远程 HTTP 端点**——**平台的信任模型完全不变**：它只处理 HTTP，不启动任何用户进程。
3. 桥这一侧由**用户自己承担**：本地进程读本地数据、跑本地代码，风险留在用户机器上，不进入平台的执行面。
4. 桥与平台之间用**用户自己生成的绑定令牌**（不是用户的 Trialroom 账号 token）——**桥令牌与用户账号解耦，桥泄漏不等于账号泄漏**。

如果用户坚持要「平台直接接本地 stdio」，安全上唯一可接受的做法是：平台**永不**执行用户进程；只提供一个受控转发器（即上一条的 pull 形态）；并**明确拒绝**「平台在服务器上 spawn 用户提供的 stdio server」这一形态。

**并把它写进参评材料的「我们不做的事」清单**——这是一个可以主动讲的加分取舍，其话术锚点正是 LangBot 那句「**Scope controls session reuse; it is not a security boundary.**」（终稿 `:112`）。

#### 3.8.4 BYO 出网的四条管控

终稿只写了「域名白名单、超时、响应体上限」，不够（S-07 处置，`review/09-mcp-security.md:290-296`）：

| 管控 | 判据 | 为什么 |
|---|---|---|
| **出网白名单 + SSRF 复用** | 复用 `server/llm.js:35` 的 `assertSafeUrlAtFetch` + `server/llm.js:112` 的 `createSafeLookup` + `server/ssrf-shared.js` 的 IP / 元数据判定（`normalizeIp` / `isInternalIp` / `isMetadataHost` / `NO_REDIRECT_FETCH_INIT`） | 用户提供的 endpoint = 攻击者可控 URL，SSRF 是最直接的风险面。**复用既有资产是本节性价比最高的一条建议** |
| **私网 / 回环 / 元数据地址禁绝** | `169.254.169.254`、`127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16` 全禁；**解析后 IP 再校验一次**（防 DNS rebinding） | 云上最值钱的是元数据凭证 |
| **出口 IP 白名单（平台侧）** | 用户自建隧道需登记公网出口 IP，平台侧按 IP 放行 | 把「任意公网 endpoint」收紧成「登记过的 endpoint」 |
| **超时与响应体上限** | 连接超时 / 首字节超时 / 总超时；响应体硬上限；解压后大小二次校验（**此条沿用终稿**，与「要补的三条」区分） | 防慢速耗尽与内存炸弹 |

#### 3.8.5 BYO 模型的边界与对外话术（S-19）

终稿写「试镜间不能把 BYO 用在评分维度上，否则等于让用户自己给自己打分。BYO 只适用于体验层（面试官人格、追问风格），评分必须由平台自有且经人工校准的模型产生，**成本从付费包里出**」（终稿 `:114`）。

**结论成立，但理由要换**。把「成本」当理由，等于主动向评审暴露「我们一次面试的模型成本是 X」——商业化 25% 是评审会算账的维度，**你把成本结构递上去，评审就会用你给的成本去算你的毛利**；更糟的是评审会追问「那 BYO 模型能不能便宜一点」，**一句话把「评分质量」换成了「成本谈判」**。

替换成「可判」叙事（三句话，评审可直接引用）：

1. **「BYO 模型只能改『怎么问』，不能改『怎么判』。」** 面试官人格、追问风格、语气属于体验层，BYO 合理且有价值。
2. **「评分必须可校准，所以评分模型必须是我们能出具 κ 的那个。」** κ 是 judge 与人工标注集的对齐度；一个没进过校准集、我们无法出具 κ 的模型，不能出分。**BYO 模型出不了分，不是我们不让他出，是我们没法替他担保。**
3. **「评分内核的可判性，是我们对用户的唯一承诺；BYO 是可选项，不是替代品。」** 把 BYO 定位成「锦上添花」而不是「省钱手段」，避免它被当成「平台没能力所以让你自带」。

**成本这件事仍然要写进参评材料，但形态要变**：写成「单次成本区间 + 定价的关系」，不写「模型调用单价」。设计文档 §7.1.4 已有单次成本测算（`research/pricing-anchors-2026.md` 有「单场成本测算 0.05–0.12 元」），用「单场成本 0.05–0.12 元 vs 定价 ¥3.9」的形态写，比任何一句「评分模型很贵」都安全（S-19 处置，`review/09-mcp-security.md:561`）。

### 3.9 部署与反代

#### 3.9.1 nginx 的 SPA fallback 会吞掉 `/mcp`

基座 `docker/nginx.conf` 现状：

```
:8   location / {
:9       try_files $uri $uri/ /index.html;     ← SPA fallback
:13  location /api/ {
:24      proxy_set_header Connection "";
:27      proxy_buffering off;                   ← SSE 必需
:28      proxy_cache off;
:29      proxy_read_timeout 300s;
```

两个问题：

1. **`/mcp` 会落到 `location /`**，被 `try_files` 兜到 `/index.html` → MCP 客户端拿到 **200 + HTML**，表现为「连接成功但协议错误」。这类故障极难排查，因为 TCP / TLS 都正常。
2. **`/mcp` 需要自己的流式与超时配置**（2026-07-28 的 Streamable HTTP 支持 request-scoped SSE；`input_required` 的 MRTR 续跑、工具的长耗时调用都需要）。`/api/` 那段的关键设置（`proxy_buffering off` / `proxy_cache off` / `X-Accel-Buffering`）**不会**自动继承给 `/mcp`。

#### 3.9.2 Caddy 与 nginx 的不一致

**设计文档 §2.2 组件拓扑写的是「反向代理 (Caddy)」**（`Trialroom-全量设计方案.md:206`），**基座跑的是 nginx**（`docker/nginx.conf`）。MCP 的两个关键行为（自定义头透传、header / body 一致性校验、Origin 校验）在 Caddy 与 nginx 下写法不同。**反向代理实现不一致 = 头 / 体绕过风险在不同环境下表现不一致**。

**结论：统一到基座的 nginx。** 理由：(1) 基座的 `docker/nginx.conf` 已经在跑，改 Caddy 意味着引入第二套反代配置与第二套头部处理语义；(2) 设计文档只是拓扑图，重写拓扑图的成本远低于维护两套反代；(3) MCP 席 §3.10 的建议同向（「建议：统一到基座的 nginx，避免两套」，`review/09-mcp-security.md:418`）。**本次必须同步改掉 `Trialroom-全量设计方案.md:206` 的「Caddy」字样**，否则主文档与基座长期不一致。

#### 3.9.3 nginx 新增独立 `location /mcp/`

```nginx
    # MCP 专用入口。必须独立于 location /（SPA fallback 会把 /mcp 吞成 index.html）。
    location /mcp/ {
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $upstream_api http://server:3001;
        proxy_pass $upstream_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # 替换模式（与 /api/ 一致）：XFF 只含真实客户端 IP，不含攻击者注入的值
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Connection "";

        # MCP 专用：Streamable HTTP 的 request-scoped SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        chunked_transfer_encoding on;

        # Origin 校验（S-13）。非浏览器客户端不带 Origin 时放行，服务端记录。
        # if ($origin != "") { ... } 形式交由 map 模块实现，见 config/mcp-origin-map.conf
    }
```

三条硬要求：

1. **不得复用 SPA fallback**；`/mcp` 必须在 `location /` 之前被更精确的 location 命中。
2. **`Mcp-*` 头族必须逐跳存活**。规范迁移指南要求「Audit the entire request path: CDN, WAF, API gateway, reverse proxy, load balancer, service mesh… Confirm that custom `Mcp-*` headers survive every hop」，且「Header names are case-insensitive, but their **MCP values are case-sensitive**, so a proxy that normalizes casing can silently corrupt them」。nginx 侧要显式 `proxy_set_header Mcp-Method $http_mcp_method;` 等四个头（`Mcp-Method` / `Mcp-Name` / `Mcp-Param-*` / `MCP-Protocol-Version`），**不靠默认透传的运气**。注意 nginx 默认 `underscores_in_headers off` 会丢下划线形式的头——规范用连字符所以不受影响，但**要写进门禁而不是靠记忆**。
3. **Origin 校验放在同一层**（反代或应用，二选一但必须有一层），且与应用层的白名单保持同一份来源。

#### 3.9.4 门禁断言

- **G-M3 → 门禁编号 G19**：`tools/check-mcp-endpoint.mjs` 断言反代配置里存在 `location /mcp`（或等价规则），该块包含 `proxy_buffering off`，且 **`/mcp` 不在 SPA fallback 的可达集合里**——用一个真实 HTTP 探针断言 `GET /mcp` **不返回 `text/html`**。
- **G-M4 → 门禁编号 G20**：断言 `Mcp-Method` / `Mcp-Name` / `Mcp-Param-*` / `MCP-Protocol-Version` 四个头**未被反代剥离或改写**。

> **门禁编号双轨说明（吸收核验报告 verify-platform 第 15 条）**：本节早期稿用 `G-M3 / G-M4 / G-M9 / G-M10`，主节用 `G19 / G20 / G13a / G13b`。**本稿统一以主节的 G 编号为准**（`tools/verify-all.mjs` 的 `GATES` 数组是唯一真相源），G-M 编号只作席位原文对照保留。

### 3.10 幂等

#### 3.10.1 原理

`idempotentHint` **不是**幂等机制。规范原话：「Idempotency keys are an **application-level reliability pattern, not an MCP field mandated by the specification**.」终稿 `:92` 的判断是对的：「错误的 `idempotentHint: true` 会让客户端在超时后放心重放，支付类工具因此可能重复扣费，真正的幂等保证来自服务端自己铸的幂等键」。

本项目 MCP 要「按次计费」，所以幂等不是可靠性优化，是**防止重复扣费**。

#### 3.10.2 幂等键规格

| 项 | 规定 | 理由 |
|---|---|---|
| **作用域** | `principal(user_id) + operation(tool name) + idempotency_key` | **不能**只用 key 全局唯一——否则 A 用户的 key 会挡住 B 用户的合法请求 |
| **存什么** | 键 → （首次执行的结果引用 + 完成时间 + 状态） | 结果必须可重放 |
| **执行顺序** | **原子占位 → 执行 → 写入结果** | 「先存后执不行」（要存「处理中」状态，否则并发双执行）；占位超时的键允许重试，返回可恢复错误而不是静默成功 |
| **保留期** | 按次计费 ≥ 24 小时（覆盖客户端超时重试窗口 + 人工排查）；支付类 ≥ 7 天 | |
| **与订单表联动** | 幂等记录与 `orders` 表的 `order_id` 必须一致 | 复用既有设计，**不另造** |

#### 3.10.3 复用既有资产，以及一处必须修正的冲突

`orders` 表已有幂等设计：`db/001_platform_schema.sql:95` 有 `idempotency_key TEXT` 列，`:107` 有 `CREATE UNIQUE INDEX idx_orders_out_trade_no ON orders(out_trade_no)`，`:108` 有 **`CREATE UNIQUE INDEX idx_orders_idempotency ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL`**；另有独立的 `idempotency_keys` 表（`:131-140`，`key` 为 PRIMARY KEY、`scope` / `user_id` / `request_hash` / `response_body` / `expires_at`）。

**必须修正的一处冲突**：`idx_orders_idempotency` 是**全局唯一**（只对 `idempotency_key` 列本身建唯一索引），而 MCP 侧要求的幂等作用域是 `principal + operation + key`。若直接把客户端的 key 原样写进 `orders.idempotency_key`，**A 用户的 key 会挡住 B 用户的合法请求**。

因此规定：

- `orders.idempotency_key` 存**合成串**：`mcp:<user_id>:<operation>:<client_key>`；
- `idempotency_keys` 表用 `key` = 同一合成串，`scope` = `mcp:<operation>`，`user_id` = principal，`response_body` = 首次执行的完整结果；
- 检索时用**合成串**做主键命中，**不使用**客户端原始 key。

> **约束呼应（一致性席 CF-10 落点）**：MCP 按次计费若另起订单表或另写权益写入路径，即为**第三个 `entitlements` 真相源**，违反决策 #40。MCP 侧的订单与幂等必须写进既有 `orders` / `entitlements` / `idempotency_keys` 三张表，**不新增表**（详见 §5.6 CF-10 行）。

#### 3.10.4 门禁断言

| 编号 | 断言 | 失败形态 |
|---|---|---|
| **G-M9 → G13a** | 同一 `idempotency_key` **并发 10 次** `tools/call` → `orders` 表新增行数 **必须 == 1**，且返回结果一致 | 行数 ≠ 1 → 退出码 1 |
| **G-M10 → G13b** | **超时后重放**场景（服务端已提交但响应丢失）→ 返回**首次结果**，不新建订单 | 订单数 ≠ 1 或结果不一致 → 退出码 1 |

### 3.11 门禁与 CI

#### 3.11.1 本轮已落地：鉴权作用域覆盖门禁（before / after 硬证据）

MCP 席 S-09 是**实测**发现，不是推演：`tools/check-middleware-order.mjs` 判定「是否在鉴权之后」**只比较行号**，从不比较挂载前缀是否落在鉴权作用域内。于是 `app.use("/api", …authMiddleware…)` + `app.use("/mcp", mcpRouter)` 会被判成 PASS——而 `/mcp` 根本不在 `/api` 作用域内，**整条 MCP 暴露面完全未鉴权**（`review/09-mcp-security.md:338-391`）。这是 F-0（`analysisRouter` 整组挂在鉴权之前）的**同型复发**，只是换了个前缀。

业主方交叉裁决第三节记录了本轮实际落地的修复（`review/10-adversarial-verdict.md:86-114`）：

| | 旧版门禁 | 新版门禁 |
|---|---|---|
| 输出 | `✅ :11 mcpRouter —— 在鉴权之后` | `❌ :11 app.use("/mcp", mcpRouter);`<br>`挂载前缀 "/mcp" 不被任何鉴权作用域覆盖` |
| 退出码 | **0（PASS）** | **1（FAIL）** |

本轮落地的六项：

1. `trialroom/tools/check-middleware-order.mjs` 重写：新增**鉴权作用域覆盖**判定（前缀相等 / 前缀在鉴权作用域之下才算覆盖；根级鉴权覆盖全部）、**输入集合完整性自检**（找不到鉴权挂载点 → 退出码 2）、**注释剥离自保断言**（剥离后必须仍能定位 auth 调用，否则退出码 2）。实现见 `tools/check-middleware-order.mjs:157-190`（`authScopes` / `coveredBy` / 作用域覆盖判定）。
2. `tryout_pr_src/Tryout-fix-83-issues/server/scripts/check-middleware-order.mjs` 同步（CI 真正跑的就是这份）。
3. **`tools/count-routes.mjs` 补上失败出口**——它此前**零非零退出路径，永远绿**。现新增：未覆盖前缀检测、analysisRouter 早于鉴权检测、路由总数下限（默认 70，`--expect N` 可调），见 `tools/count-routes.mjs:129-174`。
4. 新增 `tools/gate-bypass-regression.test.mjs`：用 **5 个合成样本（①–⑤）** 固化检测能力（作用域绕过 / 经典 F-0 / 子路由未覆盖前缀 / 无鉴权点应退出码 2 / 干净服务端应判绿防「永远红」），外加 **⑥ 元门禁自检**——verify-all 登记的每个门禁脚本都必须有非零失败出口（样本清单见 `tools/gate-bypass-regression.test.mjs:17-23`）。
5. `tools/verify-all.mjs` 新增 **G10**（`tools/verify-all.mjs:105-111`）；`trialroom/.github/workflows/ci.yml` 元门禁清单同步补入新脚本。
6. **验收**（本轮实测复跑）：`node tools/verify-all.mjs` → **10/10 全绿**（原 9/9）；`node tools/gate-bypass-regression.test.mjs` → **21/21 全绿**。

> **⚠ 前置条件口径修订（吸收核验报告 verify-platform 第 3 条严重项）**：本节早期稿写「本轮方案『线上 MCP 骨架』的前置条件已从『1.5 人日补门禁』降为 **0**（已完成）」。**该表述不完整**：MCP 席 §3.9 的六条子门禁里，**G-M0a（作用域覆盖判定）与假门禁自检已完成**，但 **G-M0b / G-M0c（期望集合与 `--prefix`）/ G-M0d（route-scanner 前缀泛化 + e2e `unresolved` 必须失败）/ G-M1（`/mcp` 401 断言）仍未落地**——`route-scanner.mjs:88,145` 的 `"/api"` 硬编码仍在，`config/auth-exempt-mounts.json` 与 `config/expected-routes.json` 不存在。**修订后的表述**：前置条件剩余约 **1 人日**，**必须先于 MCP 骨架落地**。子门禁状态对照：

| MCP 席 §3.9 子门禁 | 内容 | 状态 |
|---|---|---|
| G-M0a | 鉴权作用域覆盖判定 | ✅ 已落地（本轮） |
| G-M0b | 期望路由集合 + `--prefix` 参数 | ❌ 未落地 |
| G-M0c | 期望集合的完整形态 | ❌ 未落地 |
| G-M0d | route-scanner 前缀泛化 + e2e `unresolved` 必须失败 | ❌ 未落地 |
| G-M1 | `/mcp` 401 断言 | ❌ 未落地 |
| 假门禁自检 | 每个门禁必须有非零失败出口 | ✅ 已落地（G10） |

**顺序不可颠倒**：G-M0a / G-M0c / G-M0d 必须**在** MCP 骨架之前落地。否则新暴露面一落地就是盲区，之后再补门禁要回头给新端点补断言——**而那正是 P0-1 当初发生的事**。

#### 3.11.2 门禁设计原则

`tools/verify-all.mjs:39` 已经写下了原则：**「每个门禁都必须能独立失败 —— 不允许出现「`|| true`」式的软失败」**。本节新增的每一条 MCP 门禁都必须满足三段式：**① 命令可执行；② 期望输出可判定（退出码 / 具体字段 / 具体返回码）；③ 失败后果可验证（构建变红 → PR 不能合）**（MCP 席 §6.3，`review/09-mcp-security.md:639-645`）。

#### 3.11.3 MCP 侧新增断言清单

| 编号 | 断言 | 失败输入（能独立失败） | 期望退出码 / 输出 |
|---|---|---|---|
| **G11** | `tools/call` 正负例矩阵：每个工具 × 每个 scope 组合 | 对每个工具，用**不含**该 scope 的 token 调用 → 必须拒绝；用含该 scope 但**资源不属于该 principal** 的 token 调用 → 必须 **404**；用**完全无 scope** 的 token 调用 → 必须拒绝 | 1；输出列出「工具 × scope」中被放行的组合 |
| **G11b** | 拒绝响应**不得泄露工具是否存在** | 无 scope token 调一个**不存在**的工具名 vs 调一个**存在但无权限**的工具名 → 两者错误码与错误文本必须**一致**（统一 `-32602 Unknown tool` 语义） | 1 |
| **G12a** | `tools/list` 按 scope fixture **分片**快照 | 为 `trialroom:read` / `trialroom:join` / `trialroom:advance` / `trialroom:self_review` / `evidence:read` / 无 scope 各存一份快照，hash 独立比对 | 1；输出指出哪一片片漂移 |
| **G12b** | 每份快照 `cacheScope === "private"` | 任一快照 `cacheScope != "private"` | 1 |
| **G12c** | `ttlMs === 0` 或 `ttlMs <= 5000` | 任一快照 `ttlMs > 5000` | 1 |
| **G12d** | 工具列表顺序**确定** | 同一 fixture 连续两次 `tools/list` 的工具名序列不同 → 失败 | 1 |
| **G12e** | 哈希范围包含 `annotations + inputSchema + description + title` | 只改一个工具的 `destructiveHint`（或 `description`）→ 快照 hash 必须变化 | 1 |
| **G13a** | 幂等键：并发 10 次同一 `idempotency_key` → `orders` 新增行数 == 1 | 并发 10 次 | 1；输出实际行数 |
| **G13b** | 幂等键：超时后重放返回**首次结果** | 模拟「服务端已提交、响应丢失」后重放 | 1；输出订单数或结果差异 |
| **G13c** | 幂等键作用域 = principal + operation + key | A 用户用 key `K`，B 用户用**同一** `K` → B 必须成功下单 | 1；输出「跨用户被挡」 |
| **G14a** | `Mcp-Method` 与 body 的 JSON-RPC `method` 不一致 → **400 + -32020** | 头 `Mcp-Method: tools/call`，body `method: tools/list` | 1；断言 HTTP 400 且 body 含 `-32020` |
| **G14b** | `Mcp-Name` 与 body 的 `params.name` 不一致 → **400 + -32020** | 头 `Mcp-Name: list_rooms`，body `params.name: ask_next_question` | 1 |
| **G14c** | 反代配置中**不存在**任何按 `Mcp-Name` 做授权的规则 | nginx 配置里出现基于 `mcp_name` 的 `if` / `map` 授权分支 | 1 |
| **G15** | `Origin` 白名单：恶意 Origin → **403** | `Origin: https://evil.example` | 1；断言 403 |
| **G15b** | 不带 `Origin` 的非浏览器客户端 → **放行且被记录** | 无 Origin 头 | 断言 2xx 且审计里有一条 origin-missing 记录 |
| **G16a** | `_meta` 提权字段被忽略 | `_meta` 里塞 `{"user_id":"someone_else","role":"admin"}` → 返回结果必须与不带 `_meta` 时**逐字节一致** | 1；输出两个响应体的 diff |
| **G16b** | `_meta` 只白名单取 2 个键 + 限长 4KB | `_meta` 体积 > 4KB 或含非白名单键被读取 | 1 |
| **G16c** | `MCP-Protocol-Version` 头与 `_meta` 版本不一致 → **400** | 头 `2026-07-28`，`_meta` 写 `2025-11-25` | 1 |
| **G17a** | B1：`x-mcp-header` 不在 secretish 属性上 | 某工具把 `x-mcp-header` 挂在名为 `api_token` 的属性上 | 1（构建失败） |
| **G17b** | B2：`x-mcp-header` 只在白名单属性上，且白名单带 `maxLength` + `pattern` | 白名单外的属性声明 `x-mcp-header`；或白名单项缺 `pattern` | 1 |
| **G17c** | B3：`Mcp-*` 头的值不进入日志 | MCP 请求日志里出现 `mcp-param-` / `Mcp-Name` 的值 | 1 |
| **G17d** | B4：头/体不一致被拒（对 `x-mcp-header` 声明的属性） | `Mcp-Param-Room-Id` 与 body 的 `room_id` 不一致 | 1；断言 400 |
| **G18** | token class 双向隔离（F1） | 用 `user_sessions` 的 token 打 `/mcp` → **401**；用 `mcp_tokens` 的 token 打 `/api/*` → **401** | 1；输出哪一侧没拦住 |
| **G19** | `/mcp` 不被 SPA fallback 吞 | HTTP 探针 `GET /mcp` → 断言响应 `Content-Type` **不含** `text/html` | 1 |
| **G20** | `Mcp-*` 头逐跳存活 | 经反代发一个带四个 `Mcp-*` 头的请求 → 断言服务端收到的头值**大小写与内容完全一致** | 1；输出收到的 vs 发送的 |
| **G21a** | `requestState` 篡改 → 拒绝 | 改一个字节的 `requestState` | 1 |
| **G21b** | `requestState` 跨用户 → **404**（不是 403） | A 用户的 `requestState` 交给 B 用户 | 1；断言 404 |
| **G21c** | `requestState` 一次性消费 | 同一 `requestState` 用两次 → 第二次被拒 | 1 |
| **G21d** | `requestState` 不进日志 | 日志全文搜索 `requestState` 的原始值 | 1 |
| **G22** | A4：评分 prompt 组装点不含原始证据字段 | 在评分 prompt 组装函数的实际目录里出现 `evidence.raw` / `byo.*raw` / `searchResult.content`；**或该目录不存在 / 为空** | 1（构建失败）/ **2**（目录缺失） |
| **G22b** | A6：`stripInvisibleChars` 存在且归一化零宽 / RTL / BOM / 同形字 | `server/services/materialBoundary.js` 不存在，或对样本字符不归一化 | 1 |
| **G23** | A5–A7：抽取器输出过 schema 校验 + 二次消毒 + 指令句式丢弃 | 构造一条含零宽字符与「忽略以上指令」的证据 → 断言输出被消毒、该条事实被丢弃并记审计 | 1 |
| **G24** | 工具总数 ≤ 12 | `config/mcp-tools.json` 工具数 > 12 | 1 |
| **G25** | 出网请求不透传入站 token（F3） | 在出网层（`server/llm.js` 的 fetch、`server/services/byoEvidence.js` 的 fetch）注入探针：断言出网请求的 `Authorization` **不等于**入站 `Authorization` | 1；输出入站 / 出网头对比 |
| **G26** | 限流按 principal（F7） | 同 IP、**不同 token** → 各自独立配额 | 1 |
| **G27** | 审计留痕（F8）：allow 与 deny 都写 | 一次被拒的 `tools/call` → 断言 `mcp_audit` 有一行 `decision='deny'` | 1 |
| **G28** | `tools/list` 响应不含 `room_code` | 任一 scope fixture 的列表结果里出现 6 位房号 | 1 |
| **G29** | `room_id` 格式约束 + 独立熵源 | `room_id` 不满足 `^rm_[A-Za-z0-9]{22}$`；或 `room_id` 与 `room_code` 用同一个 PRNG 输出 | 1 |
| **G30** | 按 `room_code` 维度的失败限流 | 同一 `room_code` 连续失败达阈值 → 锁定 | 1 |
| **G31** | `server/discover` 不声明 roots / sampling / logging | `discover` 响应里出现这三个能力位 | 1 |

**MCP 侧的落点建议**：新增 `tools/check-mcp-contract.mjs`（承载 G11–G13、G15–G18、G21、G26–G28 的纯 HTTP / 纯逻辑断言）+ `tools/check-mcp-surface.mjs`（承载 G12、G14、G17、G19、G20、G22、G22b、G24、G29–G31 的静态与配置断言），并在 `tools/verify-all.mjs` 的 `GATES` 数组中登记（登记时必须走 `tools/gate-bypass-regression.test.mjs` 的元门禁自检，脚本必须存在且有非零失败出口）。

#### 3.11.4 S-16 落点（吸收核验报告 verify-platform 第 14 条，P0 级缺失）

MCP 席 S-16 是本节早期稿**唯一一条 P0 级空白**：业主方裁决把它列在「MCP 席其余 P0（全部有效，尚未修）」表内，裁决语为「做三方裁决（08 产能账 × 本轮清单 × 施工图 §六 A 期表）→ 合并 v3 排期；**在此之前第 2 项不得开工**」。

**本稿的处置**：§5（第四节）承接 S-16。§5.2.2 给出三方裁决的显式算术（v3 净需求 89.7 vs 供给 64.0 / 106.0），§5.3 给出 W1–W16 合并排期，§5.4.3 给出等量置换表，§5.4.4 给出情景 A / B 两条分支，§5.6 给出 CF-10 编号错配的修正。**因此本节不得单独开工**这一前置条件由 §5 承接，S-16 闭合。

### 3.12 降级方案：OAuth 2.1 走不完时的最小可用形态

#### 3.12.1 致命点与九条最小门禁

终稿写「如果 44 天内 OAuth 2.1 走不完，宁可先出一个只有 Bearer token 加 per-tool scope 的版本，也不要交一个半成品 OAuth」（终稿 `:116`）。方向复核**成立**，但降级方案本身有一个具体致命点和一批缺失项（S-08，`review/09-mcp-security.md:300-334`）。

**致命点：audience 校验在同源部署下不起作用。** 规范要求「Validate the access token's audience」（RFC 8707 resource indicator 的理由），但 Trialroom 的 MCP 端点与 Web API **同源**——`https://trialroom.example/mcp` 与 `https://trialroom.example/api/*` 的 audience 在很多实现里是同一个值域。于是：**一个为 Web API 签发的 token 也能被拿去调 `/mcp`；一个为 MCP 签发的 token 也可能被拿去调 Web API。** audience 校验本身防不住这个——除非严格区分 `aud` 的字符串值。

**所以在同源 + 同一 issuer 的现实下，隔离必须靠 token class，而不是 audience。** 这正是 §3.5 的 `mcp_tokens` 独立表存在的理由。

三条最坏被利用场景：

| # | 场景 | 机制 | 后果 | 缓解 |
|---|---|---|---|---|
| **X-1** | **令牌混淆（token confusion）** | 用户网页端登录拿到的会话 token 直接放进 MCP 客户端的 `Authorization` 头即可调用 `/mcp`；若降级方案用同一套 token 存储，per-tool scope **无处判断**（会话 token 里没有 scope 字段） | 任意注册用户 = 任意 MCP 调用方 | 独立 token class；`mcp_tokens` 与 `user_sessions` 物理分表，**任何一边都不得读另一边** |
| **X-2** | **Token passthrough（令牌透传）** | 规范明令禁止 token passthrough。平台处理 MCP 调用时把客户端的 Bearer token 原样转发给下游（模型供应商 / BYO endpoint / 支付网关） | 用户的 Trialroom token 泄漏给用户的第三方服务；第三方凭证进了我们的出网流量 | 出网请求的 `Authorization` **只能**来自服务端密钥表（门禁 F3 / G25） |
| **X-3** | **吊销不生效（TTL 缓存）** | `tools/list` 的 TTL 内被吊销的 scope 仍在客户端目录里；若服务端把 scope 判定也做成「读一次缓存」，吊销窗口 = TTL | 被封用户 / 离职者的 token 在 TTL 内继续可用 | 授权判定**只**在 `tools/call` 实时做；`ttlMs ≤ 5000`；吊销即刻生效 |

**降级方案的 9 条最小门禁（可直接进 CI）**：

| # | 门禁 | 断言 |
|---|---|---|
| **F1** | token class 隔离 | `mcp_tokens` 与 `user_sessions` 无交叉读取路径；用 `user_sessions` 的 token 打 `/mcp` → **401**；用 `mcp_tokens` 的 token 打 `/api/*` → **401**（e2e 双向负例） |
| **F2** | scope deny-by-default | 对**每个**工具 × 每个 scope 组合跑 `tools/call` 负例：无 scope / scope 不足 → 必须拒绝；**且拒绝响应不得泄露该工具是否存在**（统一 `-32602 Unknown tool` 语义） |
| **F3** | token passthrough 负例 | 在出网层注入探针：断言出网请求的 `Authorization` **不等于**入站 `Authorization` |
| **F4** | 过期与吊销实时生效 | 构造已过期 token + 已吊销 token → `/mcp` 必须 **401**，且**不受 `ttlMs` 影响** |
| **F5** | 错误 `aud` 拒绝 | token 的 `aud` 与服务自身 `MCP_RESOURCE` 不一致 → 401 |
| **F6** | `_meta` 不信 | `_meta` 里塞 `{"user_id":"someone_else"}` / `{"role":"admin"}` → 服务端以 token 身份为准，且结果与不带 `_meta` 的请求**完全一致** |
| **F7** | 限流按 principal | 限流键必须是 **token/user 维度**，不能只按 IP（nginx 的 XFF 替换模式下 IP 会被共享网关折叠，`docker/nginx.conf:20-23`）；断言：同 IP 不同 token 各自独立配额 |
| **F8** | 审计留痕 | 每次 `tools/call` 写一条审计：`token_id / user_id / tool / room_id / 决策(allow\|deny) / 耗时`；**deny 必须留痕** |
| **F9** | 幂等键 | 计费类 `tools/call` 携带 `idempotency_key`；同键重放 → **返回首次结果、不重复扣费**；断言：重放 10 次，订单数 == 1 |

#### 3.12.2 同源部署下 audience 校验需要什么额外手段

既然 audience 在同源下防不住串用，必须用额外手段把「Web API 的 token」与「MCP 的 token」在**物理上**分开。四条，按性价比排序：

1. **token class 物理分表**（`mcp_tokens` vs `user_sessions`）+ **双向 e2e 负例**（F1）——这是**主手段**，其余三条是补充。
2. **`aud` 用严格区分的字符串**（`https://trialroom.example/mcp` vs `https://trialroom.example/api`），并把 `aud` 写进 F5 断言。它在「同一 issuer 签发了两类 token」的场景下有效，是纵深而非主防线。
3. **中间件互斥断言**：`server/auth-mcp.js` 与 `server/auth.js` **互相不可见**——不是靠约定，是靠「`auth.js` 的 `loadTokens()` 不读 `mcp_tokens` 表、`auth-mcp.js` 不读 `data/.api_token` 文件与 `INTERVIEWX_API_TOKEN` env」的静态扫描断言 + e2e 双向负例。**并且 `/api` 挂载点不得接受 `mcp_tokens`**（当前 `auth.js` 只认 `data/.api_token` 与 env，天然满足，但必须用断言钉住，防止将来有人「顺手」把两套 token 合并成一个加载器）。
4. **未来拆分 issuer / 域名时的迁移路径**：若将来 MCP 走独立域名或独立 issuer，`aud` 校验自动升级为强边界——所以**从第一天起就把 `aud` 字段建进表里**（DDL 已含），不要等到需要时才加。

#### 3.12.3 降级方案必须向客户端宣告自己不是 OAuth 资源服务器

规范自述「Authorization remains one of the least interoperable parts of remote MCP. Test it against real clients instead of stopping after a successful token request in one development harness.」——**规范自己都在说「别做半成品」**。

半成品 OAuth 的真正危害不是评审扣分，是**它会让客户端误以为拿到了标准授权，从而走通「token 透传」路径**。所以降级方案必须：

- 在响应头里明确宣告自己不是 OAuth 资源服务器：
  `WWW-Authenticate: Bearer realm="trialroom-mcp", scope="trialroom:read trialroom:join trialroom:advance trialroom:self_review evidence:read"`
  —— **不要**发 `resource_metadata` 指向一个不存在的授权服务器；
- 在 `server/discover` 的 `instructions` 里写明「本 server 使用 Trialroom 自有 token，非 OAuth 2.1 资源服务器」；
- **说清楚比藏着好**——藏着会被当成半成品 OAuth。

### 3.13 威胁与对策总表

| # | 威胁 | 触发面 | 对策 | 落点 | 门禁 |
|---|---|---|---|---|---|
| T-01 | `/mcp` 完全无鉴权 | 挂载在 `/api` 作用域外 | `/mcp` 挂载点**自带** `mcpAuthMiddleware` | §3.5.3 | G18 / 已落地 G1·G2·G10 |
| T-02 | 全局 token 打进 `/mcp`（任何注册用户天然持有） | 挂在 `/api/mcp` 继承 `auth.js` | 独立 `mcp_tokens` 表 + token class 物理隔离 | §3.5.2 | G18（F1） |
| T-03 | 客户端忽略工具列表、越权调用 | `tools/call` 无 scope 判定 | deny-by-default 判定 + 每次实时重鉴 | §3.2 | G11 |
| T-04 | 吊销不生效（列表缓存 TTL） | `tools/list` 缓存 | 授权只在 `tools/call` 实时做；`ttlMs ≤ 5000`；`cacheScope=private` | §3.2.2 / §3.7 | G12b·G12c |
| T-05 | `trialroom:advance` 推进任意房间 | scope 与房间无关 | 判 `room_seats.is_host=1`；handle 绑定 principal+tenant | §3.4.3 | G11 |
| T-06 | 6 位房号枚举 → 越权进房 | `room_code` 出现在 MCP 返回值 | 返回值剔房号 + 独立熵源 + 按房号限流锁定 | §3.4.4 | G28·G29·G30 |
| T-07 | 越权返回 403 泄露存在性 | 房号空间 10⁶ | 越权一律 404 | §3.4.3 | G11（断言 404） |
| T-08 | protocol-confusion bypass（头体不一致） | 网关按 `Mcp-Name` 授权、后端按 body 执行 | 授权只在 body 解析后；头体一致性 400 + -32020 | §3.7.1 | G14a·G14b·G14c |
| T-09 | `_meta` 身份提权 | 调试期代码从 `_meta` 取用户 | 只白名单取 2 键；身份只来自 token | §3.7.2 | G16a·G16b·G16c |
| T-10 | 跨站请求 / DNS rebinding | 预发公网可达 + `HOST=0.0.0.0` | Origin 白名单 + 预发绑回环 | §3.7.3 | G15·G15b |
| T-11 | `requestState` 篡改 / 重放 / 跨用户 | MRTR 新有状态面（B 期） | HMAC + principal/operation/expiry 绑定 + 一次性消费 + 不入日志 | §3.7.4 | G21a–G21d |
| T-12 | 密钥经 `Mcp-Param-*` 头泄漏 | `x-mcp-header` 镜像 | B1–B4 四条断言 | §3.7.5 | G17a–G17d |
| T-13 | 抽取器把注入结构化后仍进 prompt | 抽取器 = 模型调用 | A4 静态门禁（含目录存在性元断言）+ A5–A7 校验消毒 + 事实≠结论边界句 | §3.6 | G22·G22b·G23 |
| T-14 | 重复扣费（超时重放） | 按次计费 + `idempotentHint` 误导 | 服务端幂等键（principal+operation+key），提交即存结果 | §3.10 | G13a–G13c |
| T-15 | token passthrough | 下游为用户可控 BYO endpoint | 出网 `Authorization` 只来自服务端密钥表 | §3.12.1 | G25 |
| T-16 | 限流被共享网关折叠 | XFF 替换模式 | 限流键按 principal，不只按 IP | §3.12.1 | G26 |
| T-17 | `/mcp` 被 SPA fallback 吞 | nginx `location /` | 独立 `location /mcp/` + HTTP 探针 | §3.9 | G19 |
| T-18 | `Mcp-*` 头被反代改写 | 头部大小写规范化 | 显式 `proxy_set_header` + 逐跳审计 | §3.9.3 | G20 |
| T-19 | 平台代跑用户进程 | BYO stdio 直连 | 只接受远程 HTTP；pull 形态 bridge | §3.8.1–§3.8.3 | 设计评审（非门禁） |
| T-20 | SSRF / 元数据凭证 | BYO 出网 | 复用 `server/llm.js` / `server/ssrf-shared.js` + 私网禁绝 + 出口 IP 登记 | §3.8.4 | B 期门禁 |
| T-21 | BYO 模型进入评分维度 | 用户自带模型 | BYO 只用于体验层；评分模型必须能出具 κ | §3.8.5 | 设计约束 |
| T-22 | 工具面膨胀成注入面 | 按表生成工具 | 工具总数 ≤ 12 门禁 | §3.3.4 | G24 |
| T-23 | `tools/list` 单一快照哈希无意义 | 列表随授权变化 | 按 scope fixture 分片 + 4 条附带断言 | §3.11.3 | G12a–G12e |
| T-24 | `room_id` 无格式约束 / 与 `room_code` 同熵源 | schema 无约束 | schema 加 `^rm_[A-Za-z0-9]{22}$`；独立 PRNG | §3.4.4 | G29 |
| T-25 | roots / sampling / logging 悬空 | 2026-07-28 废弃期 | `server/discover` 显式不声明三个能力位 | §3.7.7 | G31 |

---

## 四、第二节 · 评分内核、人工校准与达标判定

> 本节改写的对象：研究终稿 `final_turn_001.md` §三「评分指标的量纲与人工校准」与 §七「参赛维度上的得失」，以及 `Trialroom-全量设计方案.md` §4.4.4 的达标判定四条件。上游依据：AI 质量席报告 `review/09-ai-quality.md` 的 J-01…J-28，以及业主方裁决 P0-3 与 R-10~R-13。
> **本节不新增任何未经标注来源的数字。** 凡出现百分比、κ 值、样本量、置信区间，均带来源与标注。

### 4.1 判据层级的重写：从「四条件」到「三条件 + 一道发布门禁」

#### 4.1.1 终稿把 κ 放错了层级（P0-3）

研究终稿第 183 行（终稿节内标注为 163，行号换算见 §4.13.3）把达标判定的第三条件改写为「judge-κ ≥ 0.70」。这句话有两处硬伤。

**第一处是量纲。** κ 是**语料级 × 版本级**统计量：给定一批 (题 × 答 × 维) 的标注标签、给定一个被评模型版本、给定一次运行，算出**一个数**。它描述的是「这个模型版本在这批语料上，与这批人工标签的一致程度」。它**不是**「某一条答案的某个属性」。`consistency.ts` 里的评分一致率是另一类量——它是**逐次调用**的量：同一份 (题, 回答) 跑 N 次，数有多少对给出相同分数，因而可以在**每一次评分时**就地算出来（`web/src/lib/evaluation/consistency.ts:39-52` `dimensionConsistency(scores)`）。κ 没有这个性质：一条答案既算不出 κ，也证明不了 κ。

**第二处是后果。** 把一个语料级常数塞进逐题运行时的 AND 条件，只有两种结局：

- 若 `passed` 的表达式里写的是「本次运行的语料级 κ ≥ 阈值」，而 κ 在运行**之前**就已确定，那这个条件要么恒真、要么恒假——**又是一个死条件**，而且比原来那个「一致率」死得更隐蔽：原死条件至少还会在 `consistency.ts` 里留下一个可被调用的函数，这个死条件连函数都没有。
- 若要让这个条件随每条答案重新求值，就要求**生产环境持续人工标注**——每判一条答案，配两个人标一条。而这正是 §4.4 闭环（设计文档 `:729-731`）在本周零实现的产物（J-09 实测：`replay_attempts` 在 `server/` 与 `web/src/` 中**业务代码零命中**，唯一的文本命中是 `data/questionbank-src/qa.ts` 里的一道题面）。

**第三条路是唯一正确的路**：κ 从逐题条件里**移出去**，移到**发布门禁**层。逐题运行时保留一条**真正逐题**的守卫——但这条守卫不能是 κ，也不该是「重复评 N 次的一致率」（那会把 judge 的 token 成本乘 N 倍，见 §4.10）。

#### 4.1.2 改写后的达标判定三条件（全文）

以下文本是**唯一真相源**，需同时写入 `Trialroom-全量设计方案.md:777-783`（替换现有四条件代码块）、`db/001_platform_schema.sql:250` 的注释、以及新建的 `web/src/lib/evaluation/qualification.ts`（J-16 要求两处规格同改，否则同一件事有两个互相矛盾的规定）。

```
passed = 1  当且仅当
  ①  score_after >= 岗位基准线（岗位域 + 难度档位，可编辑）
  ②  该题涉及的**判定维度**上，after 的均值 >= before
  ③  单答案稳定性守卫（逐题可判定，不依赖任何语料级常数）：
      对该题涉及的每个判定维度，取该维度在本答案上的两次独立评分
      （首评 + 仅对临界维度的复评）的锚点标签；
      该维度同时满足「有依据」（evidence 非空 且 confidence != "low"）
      与「两次锚点之差 <= 1 档」时，判为「稳定」；
      判定维度中「稳定」的比例 >= 0.60（可编辑，缺省 0.60）
  AND（若存在个人历史且样本量足够）score_after >= 个人同难度 P60
```

关于 ③ 的三点说明：

1. **「判定维度」不是六个维度。** 按 §4.9 的降级路径，参与判定的维度是技术深度 / 逻辑思维 / 问题解决三维；沟通表达 / 抗压能力 / 文化匹配三维**只给提示不给判定**，不进入 ②③ 的分母。这与 `aggregateScores` 现有的六维聚合口径不同，需要在 `qualification.ts` 里显式传一个 `judgingDimensions` 参数，而不是复用 `EVALUATION_DIMENSIONS` 全量。
2. **复评只发生在临界维度。** ③ 的两次评分中，第二次（复评）只在条件 ① 的差值落在 **±0.5 档**以内时触发——即「刚好压线」的那一维。其余维度不重复计费。这把 ③ 的成本从「每题 × 6 维」压到「每题 × 0–2 维」。这个模式还有一个附带好处：复评只发生在判定的边界上，不会让绝大多数题的评分结果因为「多跑一次」而漂移。
3. **「有依据」用的是现成字段。** `DimensionScore` 已经有 `evidence: string[]`（`scoringEngine.ts:49`）与 `confidence: Confidence`（`scoringEngine.ts:52`），`noEvidence: boolean`（`:53`）——这三个字段已经在生产链路上产出，**不需要任何新调用**。

#### 4.1.3 条件改写对照表

| # | 终稿 / 设计文档原文 | 层级是否成立 | 改写后 | 落点 |
|---|---|---|---|---|
| 条件 ① | `score_after >= 岗位基准线` | ✅ 成立 | 不变。但**必须补一句**：岗位基准线是**可编辑默认值**，不是统计基准——`baseline.ts` 的注释已写明「我们没有任何真实面试数据，任何声称『同岗位平均』的数字都是编的」（`baseline.ts:8-10`）；`08-final-plan.md` P2-11 复核后成立：116 题摊到 16 域 × 5 档，每格约 1.4 题，**校准集与岗位基准线都无统计基础**。材料里要写「本次用的是可编辑默认线」 | `Trialroom-全量设计方案.md:779`；`qualification.ts` 入参 `bar` 增 `barIsEditableDefault: true` |
| 条件 ② | `该题涉及的维度上，after 均值 >= before` | ✅ 成立 | 不变，但**分母收窄为判定维度**（三维，不是六维） | `qualification.ts` |
| 条件 ③（旧） | `评分一致率 >= 阈值（避免随机高分）` | ❌ **死代码**：`consistency.ts` 生产零引用（唯一 import 点是 `web/scripts/eval-ab.mjs:53` 的字符串拼接 + 单测）；且口径本身算错（§4.7） | **删除**，替换为上面的「单答案稳定性守卫」 | `consistency.ts` 标 `@deprecated`；新守卫写进 `qualification.ts` |
| 条件 ③（终稿改写） | `judge-κ >= 0.70` | ❌ **层级错**：语料级常数进逐题 AND 条件 ⇒ 恒真或要求生产持续人工标注 | **从逐题条件中移除**，改为发布门禁（§4.2.6） | `Trialroom-全量设计方案.md:781`、`db/001_platform_schema.sql:250` 注释同步 |
| 条件 ④ | `（若存在个人历史）score_after >= 个人同难度 P60` | ⚠️ **双重不可实现**（J-17） | 保留但**改实现**：`baseline.ts:33-55` `computePersonalBaseline` 取的是**中位数**、`minSamples=3`、入参 `DimensionScoreInput[][]` **没有 difficulty 字段**；`db/000_base_schema.sql:84-85` 的难度枚举是 `easy/normal/hard/extreme/hell`，与题库 L1–L5 是**两套枚举**；`rooms.difficulty`（`db/001_platform_schema.sql:160`）才是 L1..L5 | `baseline.ts` 增 `computePersonalPercentile(history,{dim,difficulty,q:0.6})`；`DimensionScoreInput` 增 `difficulty`；**统一难度枚举**（会话难度与题库难度分离命名，如 `session_level` vs `question_level`）；冷启动返回「不适用」而非「通过」 |
| 条件 ⑤（终稿新增） | `judge-κ >= 0.70` 作为**发布门禁** | ⚠️ 二值门禁在 n=40–60 上不可达 | 改为**双阈值 + 报区间**（§4.2） | 新建 `db/004_calibration_schema.sql` + `tools/calibrate-judge.mjs` + CI 断言（G14） |
| 冷启动声明 | 「这是你的第一场，本次用岗位基准判定」 | ✅ 成立 | 补一句：「本次判定只覆盖 3 个维度」 | `Trialroom-全量设计方案.md:789` |

### 4.2 双阈值、区间化与 κ 的计算单元

#### 4.2.1 三条禁令

在写任何门禁之前，先把三条禁令写死。这三条都是**从已有数据里复算出来的**，不是偏好。

**禁令一：禁止在任何门禁里写 `judge-κ >= 0.70` 这样的绝对点估计。**
本轮独立复算（零依赖脚本，潜变量复制模型，边际 A .30 / B .30 / C .25 / D .10 / E .05）：当真实 `κ_JH = 0.70` 时，n=40 的点估计 `κ̂_JH` 超过 0.70 的概率是 **49.9%**（n=60 时 49.0%）——**等于抛硬币**。同一场景下真实 κ=0.825 时通过率 88.9%，真实 κ=0.429 时通过率 2.1%。绝对门禁在 n=40 上对「刚好达标」这一情形毫无分辨力。
> 复算口径：三方联合潜变量模型（真值 z ~ 边际；H1、H2 各以概率 p1 复制真值；Judge 以概率 p2 复制真值），按目标 κ_HH 与 κ_JH 反解 (p1, p2)，每格 1500 次模拟。

**禁令二：禁止报告单一合并 κ。**
`引用`（AI 席 `review/09-ai-quality.md` §3.2.4 J-19）：若把 6 维合成一个 κ，CI 宽度从逐维的 0.478 缩到 0.198（看起来精确 2.4 倍），但 min 维 κ 均值只有 0.526，且 75.3% 的抽样里最差维 κ < 0.60。合并会**精确地掩盖最不能用的那个维度**。门禁用 `min(逐维 κ)`，报告用「六维全表 + min / 中位」。

**禁令三：禁止只报 κ 不报 AC1 与边际分布。**
`引用`（AI 席 J-20）：同一原始一致率下，κ 随边际在 0.775–0.825 间变动，AC1 在 0.743–0.799 间变动。
`实测`（本轮独立复算，脚本 `/tmp/kr2/verify.mjs`）：固定精确一致率 85%，边际取 `[.30,.30,.25,.10,.05]` → κ=0.7987；`[.20,.20,.20,.20,.20]` → κ=0.8125；`[.50,.20,.15,.10,.05]` → κ=0.7778；`[.35,.30,.20,.10,.05]` → κ=0.7959。**跨度 0.035**。κ 是「在这个样本的分数分布下」的值，不是一个 judge 的固有属性，单值不自描述。

> **⚠ 可审计性标注（吸收核验报告 verify-scoring R4）**：§4.2.2 表中「G1（绝对地板）」行与 n=300 行的数字，其复算脚本随 `/tmp` 消失，**当前不可复现**。两条处置路径：(a) 把 `verify.mjs` / `gate2.mjs` 落盘到 `trialroom/tools/calibration/`（零依赖）并接进 `verify-all.mjs`；(b) 若不补脚本，则把该两行显式降级为「`推算`（口径未完全披露，读者不可复现）」，并把 §4.2.2 的结论句从「**绝对地板才是承重的那一条**」改为「**在本轮复算下绝对地板是承重的那一条**」，同时把复算的**完整规格补进 §4.2.1 口径注**（权重矩阵、`p_e` 用经验边际还是真边际、κ_HH 与 κ_JH 的反解关系 `κ_HH=p1²` / `κ_JH=p1·p2`、模拟次数、随机种子）。**本稿采用 (a)+(b) 并行写法：结论句加限定词，脚本落盘列入 W1 的 N3 交付物。**

#### 4.2.2 双阈值

研究终稿的 0.70 无出处（`final_turn_001.md:81` 只写「首轮阈值 0.70」），而它引用的 ELBench（arXiv 2608.09548）附录 F 原文明确要求「以人类天花板为参照」：

> 引用（ELBench 附录 F，AI 席 `review/09-ai-quality.md` J-02 转录）：this level of human-human agreement establishes a **ceiling against which the judge-human agreement below should be read**

终稿把「以天花板为参照」抄成了「阈值 0.70」，**丢掉了参照物本身**。因此门禁写成**双阈值**：

```
发布门禁（每次发版 / 每次换模型版本 / 每次改 rubric 或 prompt）：
  对每个判定维度 d ∈ {技术深度, 逻辑思维, 问题解决}：

    G1（绝对地板）  κ_JH(d) >= 0.60
    G2（相对天花板） κ_JH(d) >= 0.85 × κ_HH(d)
    G3（相对回归）   κ_JH(d) 的 95% 自助区间下界 >= 上一版同维度区间下界 − 0.05
    G4（天花板自检） min_d κ_HH(d) >= 0.50

  任一条不满足 ⇒ 该 judge 版本不许上线，构建变红；不得以「仅换模型」绕过。
```

四条里 **G1 与 G2 不是冗余的**——这是本轮复算得出的一个反直觉结论，值得单独说明：

| 门禁 | 真实 κ_JH=0.70（提案情形） | 真实 κ_JH=0.825（ELBench 情形） | 真实 κ_JH=0.429（Geometry 情形） | 判别力 |
|---|---|---|---|---|
| 仅 G1（绝对 ≥0.60） | 79.4% | 96.1% | **10.1%** | 有绝对地板时判别力强 |
| 仅 G2（相对 ≥0.85·κ_HH） | 62.7% | 84.9% | **29.6%** | **单独用会误放 29.6% 的坏情形** |
| G1 ∧ G2（联合） | 58.1% | 84.4% | **7.5%** | 联合后误放率降到 7.5% |
| 仅 G1（绝对 ≥0.70） | **49.9%** | 88.9% | 2.1% | 对「刚好达标」是抛硬币 |

> `实测`，n=40，每格 1500 次模拟，模型与假设同 §4.2.1。

**结论**：**相对判据单独用会放过最坏情形的近三成**——一个真实 κ_JH 只有 0.43 的 judge，因为人类天花板本身也只有 0.61，`0.43 ≥ 0.85 × 0.61` 在 29.6% 的抽样里成立。**绝对地板才是承重的那一条**（在本轮复算下）；相对判据的价值不在于「筛掉坏的」，而在于**给出「相对人类还差多少」的可解释读数**。所以 G1 是硬门，G2 是硬门但同时是对外叙述的锚，两者缺一不可。

#### 4.2.3 为什么放弃二值门禁、为什么 n≥300 才谈得上绝对数字

「报区间不报二值」的依据是分辨率，不是修辞。

| n | 零假设（两人独立随机抽同一边际）下 κ̂ 的 95% 区间宽度 | 提案情形下 κ̂ 的 SD | 提案情形下 κ̂ 的偏差（点估计 − 真值） |
|---|---|---|---|
| 40 | **0.615**（区间 [−0.303, 0.312]） | 0.124 | κ_HH −0.009 / κ_JH −0.007 |
| 60 | **0.493**（区间 [−0.238, 0.255]） | 0.098 | κ_HH −0.004 / κ_JH −0.005 |
| 300 | 0.231 | 0.043 | κ_HH −0.000 / κ_JH −0.002 |

> `实测`，本轮独立复算，零依赖脚本 `/tmp/kr2/verify.mjs`（区间宽度用 4000 次/格零假设模拟）与 `/tmp/kr2/gate2.mjs`（SD 与偏差用 1500 次/格替代情形模拟）。
> `引用`（AI 席 `review/09-ai-quality.md` J-03）：蒙特卡洛 6000 次/格给出零假设区间宽 0.615（n=40）/ 0.499（n=60）；即使真 κ 恰为 0.70，P(95%CI 下界 ≥ 0.70) 仅 0.2% / 0.6%。**本轮独立实现复现了 0.615 / 0.493 两个数，与 AI 席的 0.615 / 0.499 一致**（n=60 的 0.006 差异来自模拟次数与随机种子不同）。SD 差异同源：AI 席 κ_HH SD 为 0.118(n=40) / 0.097(n=60)，本轮复算为 0.124 / 0.098。

三点推论：

1. **n=40–60 上，二值绝对门禁对「刚好达标」这一情形是抛硬币**（49.9% / 49.0%）。
2. **n=40–60 上，「把 CI 下界写进门禁」几乎必然变红。** 提案情形下 CI 下界 ≈ 点估计 − 1.96 × 0.124 ≈ 点估计 − 0.24；即使真实 κ=0.70，CI 下界也在 0.45 附近，离 0.60 差得远。因此**门禁的判定用点估计，区间作为强制输出项与「是否值得扩样本」的判据**——把 CI 下界写进门禁不是更严谨，是**写了一个永远红的门禁**。
3. **若坚持要一个可判定的绝对数字，n ≥ 300。** n=300 时 κ̂ 的 SD 降到 0.043，提案情形的绝对门禁通过率 98.7%、ELBench 情形 100.0%、Geometry 情形 0.2%（`实测`）。这是「n ≥ 300 才有把握」的量化依据。但 A 期拿不到 n=300，**所以 A 期的交付物是「带区间的测量 + 相对门禁」，不是一个绝对达标声明**。

> **⚠ 口径对齐（吸收核验报告 verify-scoring R1）**：§4.11.1 L1 行的「n=300 能把区间宽度压到 0.17 以内」与本表 n=300 的 **0.231** 不一致（0.17 对应 n≈500）。本稿统一为：「n=300 能把 95% 区间宽度从 0.615 压到 **0.231**（约 ±0.12），要再压到 0.17 以内需要 **n≈500**——那是 B 期的事」。

#### 4.2.4 量纲对齐：κ 只能定义在 (题 × 维) 的有序类别标签上

终稿 §三 的隐含前提是「六维 0–100 分」，这在本项目不成立。实测本项目的量纲链是：

| 环节 | 量纲 | 落点 |
|---|---|---|
| 维度定义 | 6 维，每维**只有两端锚点** `{1, 5}` | `web/src/lib/evaluation/starEvaluator.ts:15-58` |
| 锚点 ID | `A, B, C, D, E`（降序字母表，ADR-003） | `starEvaluator.ts:64` `ANCHOR_IDS = ["A","B","C","D","E"]` |
| 锚点 → 分数 | A=5 … E=1 | `starEvaluator.ts:68-72` `anchorIdToScore` |
| 逐维均值 | 1–5 | `scoringEngine.ts:559` `const avg5 = sum / n;` |
| 汇总 | 1–10，保留一位小数 | `scoringEngine.ts:560` `Math.round(avg5 * 2 * 10) / 10` |

**κ 是为类别标签设计的统计量，不能定义在连续分数上。** 本项目的 κ 单元因此固定为：

> **κ 的单元 = (题 × 维) 的 A–E 标签对。** 每个维度单独算一个 κ_QW（象限加权，r=5），报 min / 中位 / 全表。**禁止**把 6 维合成单一 κ（禁令二）。

计算方式（写进 `tools/calibrate-judge.mjs` 的实现规范）：

```
对每个判定维度 d：
  单位 = (题 × 维) 的一个 item，即一条答案在该维度上的一个 A–E 标签
  观测矩阵 P[i][j] = (裁判1 给 i, 裁判2 给 j) 的 item 比例，  i,j ∈ {A,B,C,D,E}

  象限权重      w_ij = 1 − ((|i−j|)/4)²           （r=5，两端 w=1，相邻 w=0.9375，最远 w=0）
  观察一致度    p_o  = Σ_ij w_ij · P[i][j]
  期望一致度    p_e  = Σ_ij w_ij · (Σ_k P[i][k]) · (Σ_k P[k][j])
  κ_QW          = (p_o − p_e) / (1 − p_e)

  同时输出：
    AC1          用线性权重 w_ij = 1 − |i−j|/4  同法计算（偏斜下更稳健，作为交叉验证）
    raw_agree    = Σ_i P[i][i]                     （精确一致率，用于旧→新换算）
    prevalence   = 五个边际分布 P_A..P_E           （κ 不自描述，必须随附）
    区间          item-level bootstrap 10,000 次重采样，取 2.5 / 97.5 分位
```

bootstrap 口径用 **item-level**（对 item 重采样，不对标签重采样），10,000 次，取 2.5/97.5 分位——这是 ELBench 附录 H 的口径（`引用`，AI 席 §4 第 11 条转录：「最关键的附录 H 统计口径（item-level bootstrap, 10,000 resamples, 取 2.5/97.5 分位）」）。**为什么不用正态近似**：AI 席在 n≥40 处验证过正态近似与 bootstrap 一致，但 5 分类 + 偏斜边际下 κ̂ 的分布不对称，正态近似会给出偏窄且可能越界的区间。

**与被引文献的一致性**：ELBench 自己用的就是象限加权 Cohen's κ（`引用`，AI 席 §4 第 10 条：「We measure inter-annotator agreement with quadratic weighted Cohen's κ (Cohen 1960) averaged over annotator pairs」）。**统计量的选择与被引文献是一致的；错的是阈值、样本量与闸门位置，不在「选 κ」这一步。**

**参考集的选择（J-28，必须照做）**：只有 2 名标注者时，**分别算 κ(judge, H1) 与 κ(judge, H2)**，各自对着**单个真人**报告；**禁止把两人取平均当参考**。`引用`（Geometry 论文摘要，AI 席 J-28 转录）：a judge and a held-out rater are scored against the same two-rater mean, since an averaged reference otherwise flatters judges by several degrees。**用两人均值当参考会系统性虚高 κ_JH。**

#### 4.2.5 κ_HH：零额外成本的天花板

κ_HH 是**两名标注者之间**的 κ。它**零额外成本**——H1、H2 的标签本来就要标，κ_HH 是同一次标注的副产品，不多标一条。

它的两个用途：

1. **门禁 G2 的分母**：judge 达到人类标注者之间一致性的百分之多少。
2. **天花板自检 G4**：`min_d κ_HH(d) >= 0.50`。若人类标注者之间的一致性本身就低于 0.50，说明**这批题的这套 rubric 不可判**，此时任何 κ_JH 数字都没有意义——先修 rubric，不是先修 judge。

**必须同时报两个口径**：

- **双盲口径 κ_HH**：只用 H1、H2 独立打的标签，不含共识轮。
- **共识口径 κ_HH**：用共识轮的最终标签。

两者的差就是**分歧被共识吸收了多少**，它同时也是标注流程本身的信噪比指标。

#### 4.2.6 落库表结构

新建 `db/004_calibration_schema.sql`（四张表；沿用 `trialroom/db/` 已有 schema 的 SQLite 方言与 `datetime('now')` 时间戳风格，参照 `db/000_base_schema.sql:155-176`）：

```sql
-- 校准 item：一条 = 一个 (题, 维, 回答)
CREATE TABLE IF NOT EXISTS calibration_items (
  item_id       TEXT PRIMARY KEY,
  question_id   TEXT NOT NULL,
  dimension_key TEXT NOT NULL,       -- technical|logic|problemSolving|communication|resilience|culture
  answer_text   TEXT NOT NULL,
  question_text TEXT NOT NULL,
  industry      TEXT,
  difficulty    TEXT,                -- 题库 L1..L5
  q_type        TEXT,                -- technical|behavior|system-design|situational|coding
  answer_len    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 标注：rater_id ∈ ('h1','h2','h1_consensus','h2_consensus','judge')
-- 只存锚点标签，不存换算后的分数（分数由 anchorIdToScore 统一换算，避免人自己换算出错）
CREATE TABLE IF NOT EXISTS calibration_labels (
  item_id    TEXT NOT NULL REFERENCES calibration_items(item_id),
  rater_id   TEXT NOT NULL,
  anchor_id  TEXT NOT NULL,          -- A..E
  comment    TEXT,
  labeled_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, rater_id)
);

-- 一次运行的可复现指纹（J-27：缺了这 5 个字段，κ 掉了都不知道是谁的锅）
CREATE TABLE IF NOT EXISTS calibration_runs (
  run_id         TEXT PRIMARY KEY,
  model_version  TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  prompt_hash    TEXT NOT NULL,
  temperature    REAL,
  votes          INTEGER DEFAULT 1,
  started_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 结果：逐维，不合并（禁令二）
CREATE TABLE IF NOT EXISTS calibration_results (
  run_id        TEXT NOT NULL REFERENCES calibration_runs(run_id),
  dimension_key TEXT NOT NULL,
  n             INTEGER NOT NULL,
  kappa_qw      REAL,
  kappa_ac1     REAL,
  kappa_hh      REAL,               -- 双盲口径
  kappa_hh_consensus REAL,         -- 共识口径
  raw_agree     REAL,
  prevalence    TEXT,
  ci_lo         REAL,
  ci_hi         REAL,
  PRIMARY KEY (run_id, dimension_key)
);
```

**为什么 `calibration_runs` 必须有这 5 个字段**：`引用`（AI 席 J-27 + `08-final-plan.md` P2-10）。`db/000_base_schema.sql:155-167` 的 `evaluations` 表已有 `model_version`（`:159`）先例；`evaluation_dimensions`（`:169-176`）只有 `score / weight / comment`，**无任何版本 / 置信度 / 锚点列**。A 期不需要给 `evaluation_dimensions` 加列（那是生产表），但**校准表必须自带指纹**，否则模型升级后 κ 漂移无法归因。

**门禁断言**：`tools/calibrate-judge.mjs` 产出的 JSON 必须含 `ci_lo` / `ci_hi` / `kappa_hh` / `prevalence` 四个键，缺一即退出码 1。这条断言进 `tools/verify-all.mjs`（门禁 G14 `check-calibration-gate.mjs`）。

#### 4.2.7 κ 测量流程

| 阶段 | 动作 | 产出 | 成本 | 负责人 |
|---|---|---|---|---|
| **S0 前置**（阻塞） | ① `aggregateScores` 改 fail-open：`scoringEngine.ts:543-555` 的 `else` 分支现在把缺失维度记 **0 分**、`:558-559` 的 `avg5 = sum / n` 又按**全部 6 维**做分母、`:564` 还把 0 分算进 `weaknesses` —— 限流或截断产生的 0 分会**直接污染 κ**（κ 测的就不是 judge，是限流）。② 参考答案裁剪接线：`scoringEngine.ts:140-142` 调 `buildReferenceBlock` 前接入 `referenceAdapter.ts` 的 `adaptReference`（`:56-84`）与 `extractScoringHints`（`:90-113`） | 单次调用 2050 → 约 1750 token（`引用`，AI 席 P1-4） | 0.5 人日 | 工程 |
| **S1 落库与工具** | 建 `db/004_calibration_schema.sql`；写 `tools/calibrate-judge.mjs`（零依赖，与 `questionbank/scripts/*` 同风格）：读 item → **调用生产同一个 `buildDimensionPrompt`** → `parseDimensionScore` → 落 `calibration_labels(rater_id='judge')` → 算逐维 κ_QW / AC1 / κ_HH / 原始一致率 / 边际 → item-level bootstrap 10,000 次出 2.5/97.5 分位 → 输出 `qa/calibration/<run_id>.json` 与 `.md` | 工具 + 四张表 | 0.5 人日 | 工程 |
| **S2 样本设计** | 40 题 × 3 判定维度 = **120 item**。分层按 `difficulty × type`（不按 industry——116 题摊到 16 域每格约 1.4 题，抽不匀）。排除：`answer_len > 2500` 字符的样本（避免截断污染）。**排除英文题**：AI 席 P1-6 建议排除 `companySignal: 外企-英文面试` 的题——`实测`：**Pro 题库 50 个 `companySignal` 取值中无该值**，该规则在本库上落空；改为按 `title`/`content` 的中英字符比判定（题库硬约束「全部用简体中文输出」，`plans/questionbank-batch1.yaml:231`） | 120 item 清单 | 0.25 人日 | AI 席 + 工程 |
| **S3 人工标注** | 三阶段（详见 §4.4）：培训对齐轮 30 min/人 → 双盲独立轮约 2–2.5 h/人 → 共识轮 30 min/人 | `calibration_labels` 120 × (h1 + h2 + judge) 行 | 2 人 × 3.5 小时 | 2 名标注者 |
| **S4 判据** | 跑 `calibrate-judge.mjs` → 产区间 → 套 §4.2.2 的 G1–G4 → 出 `qa/calibration/<run_id>.json` | 逐维 κ 全表 + 区间 + 相对比例 | 0.25 人日 | 工程 |
| **S5 出材料** | 按 §4.11 的措辞写参评材料段落 + 旧→新换算表 | 材料段落 | 0.25 人日 | PM |

**总量**：3.5 人日（2 人并行 ≈ 2 天）+ 2 × 3.5 小时人工标注。与业主方裁决 §七本周清单第 2 项的「0.75 人日」相比，本节给出的 3.5 人日是**更真实的估计**：0.75 只覆盖了「跑一次算个 κ」，没有覆盖 S0 前置、S1 工具与 S3 的三阶段标注。

> **⚠ 验收判据补齐（吸收核验报告 verify-scoring R8）**：S0 行的产出栏补「**验收：连续 20 次真实调用的 `usage.prompt_tokens` 均值 ≤ 1850**」（或「取一次真实 run 的 usage 落库为基线，后续 run 与基线偏差 > 5% 即红」）。

#### 4.2.8 统计方案表（汇总）

| 决策点 | 终稿 / 原方案 | 本节定案 | 依据 |
|---|---|---|---|
| κ 的层级 | 逐题运行时 AND 条件 | **发布门禁**（语料级 × 版本级） | J-01；量纲不可混用 |
| 门禁形态 | 单一绝对点估计 `κ ≥ 0.70` | **双阈值**：`κ_JH ≥ 0.85 × κ_HH` 且 `κ_JH ≥ 0.60`，判据用点估计、**强制输出区间** | J-02/J-03；本轮复算 |
| 是否报单一合并 κ | 未规定 | **禁止**；用 `min(逐维 κ)`，报告六维全表 + min / 中位 | J-19 |
| 参考集 | 未规定 | **κ(judge,H1) 与 κ(judge,H2) 分别报**，禁止取两人均值当参考 | J-28 |
| 附带统计量 | 只报 κ | κ_QW + AC1 + raw_agree + 边际分布 + 95% 自助区间 | J-20；本轮复算边际敏感性 0.778–0.813 |
| 置信区间口径 | 未规定 | **item-level bootstrap 10,000 次，2.5/97.5 分位** | ELBench 附录 H（引用） |
| 投票 | 照搬 ELBench N=9 | **1 票，与生产同构**（J-26：投票几乎不改变分数离散度，却把成本乘 9） | J-26 |
| 样本量 | 40–60 | **40 题 × 3 维 = 120 item**（不取 60：n=60 的分辨率只比 40 好 0.12，不值当） | J-03 |
| 分层维度 | 按 industry × difficulty | **按 difficulty × type**；industry 不分层（每格约 1.4 题） | 上轮 P2-11 |
| 校准用哪套 rubric | 未规定 | **与生产完全同构**（同一 `buildDimensionPrompt`，含 §4.5 的 rubricHints 接线） | J-26 |

### 4.3 「换了一把更严的尺」的换算表

终稿把「一致率 ≥ 85%」替换成「κ ≥ 0.70」，并把它叙述成「更严谨的指标」。**方向性结论是反的。**

#### 4.3.1 换算表

`引用`（AI 席 `review/09-ai-quality.md` §3.2.5 J-04，本轮蒙特卡洛 `/tmp/kr/sim3.mjs` 输出）：

| 精确相等一致率 | 象限加权 κ | 加权一致率 |
|---|---|---|
| 56.0% | 0.409 | 0.905 |
| 63.7% | 0.506 | 0.920 |
| 70.6% | 0.610 | 0.936 |
| **77.3%** | **0.691** | 0.949 |
| **85.3%** | **0.794** | 0.966 |
| 88.8% | 0.840 | 0.974 |
| 93.0% | 0.899 | 0.984 |
| 96.5% | 0.951 | 0.992 |

`实测`（本轮独立复算，脚本 `/tmp/kr2/verify.mjs`，同一潜变量复制模型、同一组边际，与 AI 席实现相互独立）：

| 关系 | 本轮复算值 | AI 席值 | 差异来源 |
|---|---|---|---|
| κ_QW = 0.70 ⟺ 精确一致率 | **77.7%** | 77.3% | 边际与误差模型的细节差异；**两者一致指向「77%–78%」** |
| 精确一致率 = 85% ⟺ κ_QW | **0.7987** | 0.794 | 同上；**两者一致指向「≈0.79–0.80」** |

**口径提醒（必须随数字一起引用）**：κ 与「精确一致率」的换算依赖噪声模型与边际分布，**任何具体数字都要标注模型假设**；但 κ 对一致率是**单调**的，所以「85% ⇒ κ > 0.70」这个方向性结论在任何合理模型下都成立。

#### 4.3.2 因此：目标值定在 κ ≥ 0.79，目标不是 0.70

- 旧门槛「单维一致率 ≥ 85%」≈ **κ 0.79**（本轮复算 0.7987）。
- 新门槛「κ ≥ 0.70」≈ **精确一致率 77%**。
- **门槛从 85% 掉到 77%。**

所以本节定的目标是：**目标值 κ ≥ 0.79（即不低于旧门槛的等价值）**，门禁地板仍取 0.60（那是「不许上线」的红线，不是「达标线」）。两者不是一回事：

| 数字 | 角色 | 出现位置 |
|---|---|---|
| **0.79** | **目标值**（与旧门槛等价的等价值） | 参评材料；发版后验检查 |
| **0.60** | **门禁地板**（绝对红线，低于此不许上线） | CI 门禁 G1 |
| **0.85 × κ_HH** | **相对判据**（相对人类天花板） | CI 门禁 G2；材料的主口径 |
| 0.70 | **不再使用**。它既不是旧门槛的等价值，也低于 ELBench 全部五个候选 judge 的成绩（`引用`，AI 席 J-23：Qwen3.6 0.825 / Kimi-2.6 0.798 / MiniMax-M3 0.784 / Grok-4.3 0.772 / **Llama-4 0.751**——0.70 连文献里被淘汰的候选都能过，不是一个有区分度的门） | **从材料与代码中一并删除** |

#### 4.3.3 旧→新换算表（参评材料必放）

参评材料里必须出现下面这张表，**并且明确写出「这是降标不是升标」**：

| 我们过去用的口径 | 等价的象限加权 κ | 等价的精确一致率 | 我们现在用的口径 |
|---|---|---|---|
| 单维一致率 ≥ **85%** | **κ ≈ 0.79–0.80** | **85%** | 逐维 κ_QW **≥ 0.79**（目标值）+ 95% 自助区间 + 与人类天花板的比例 |
| — | κ ≈ 0.70 | ≈ 77% | ⚠️ **这一行是反例，说明「κ ≥ 0.70」实际比旧门槛松** |
| — | κ ≈ 0.61 | ≈ 70.6% | — |

配套的一句话（可直接抄进材料）：

> 换指标不是换了一把更严的尺。我们把旧口径「单维一致率 ≥ 85%」换成了逐维象限加权 Cohen's κ，**等价值是 κ ≈ 0.79**——门槛没有放松，也没有假装收紧。之所以仍然换，是因为旧口径测的是「模型跟自己有多一致」，而**一致率高本身可能是共享盲点的证据**，不是可靠性的证据。我们把测量对象换成了「模型与人工标注有多一致」，同时把样本量、门槛与置信区间全部写清楚。

#### 4.3.4 与项目自有文献的冲突必须处理

`引用`（`starEvaluator.ts:12-13` ADR-002 逐字）：只锚两端时人机一致性 **QWK = 0.59**，优于把锚点摊到 1/3/6 档的 0.39。且每档 1 个锚点 ≈ 每档 3 个（**QWK 0.65**），中间档用梯度插值即可。

QWK 与象限加权 κ 同族。**0.70 的目标比项目自己引用的 0.59 高出 0.11，比 ADR-002 给出的「加锚点后可达」的 0.65 高 0.05。** 在**没有改动锚点设计**的前提下要求一个比现状文献值高 0.11 的数，门槛与能力之间没有桥。

**处理办法不是调阈值，是补锚点**——而锚点素材已经在题库里（§4.5）。§4.5 的接线正是 ADR-002 自带的路径：「每档 1 个锚点 ≈ 每档 3 个（QWK 0.65）」，而 `rubricHints` 提供的是**比「每档 3 个」更强的东西**：每题每维的判分要点。**不要用阈值去补锚点的债。**

`引用`（`starEvaluator.ts:60-62` ADR-003）：量表用 0-5 而非 1-10/1-100 —— arXiv:2601.03444 实测人机 ICC：0-5 为 **0.853**，0-100 为 0.840，0-10 为 **0.805**。

本项目的汇总分跑在 1–10（`scoringEngine.ts:560`），**而 1–10 正是三个候选量纲里人机一致性最差的**。这不一定要改（1–10 对用户可读性好），但**必须在参评材料里主动说**（§4.11）——否则等于把一把已知偏钝的尺子当尺子用而不说。

### 4.4 人类天花板的资历偏差与三阶段标注治理

#### 4.4.1 天花板锚在了错误的人群上

终稿把「团队 2 人（开发者）」当「人类」，而它引用的文献对标注者有明确资历门槛。

`引用`（ELBench 附录 G，AI 席 J-05 转录）：The expert annotators hold advanced degrees in computer science or educational technology and have experience in NLP, AI safety, or **educational assessment**. Annotation proceeds in **three stages**: a training and calibration round on shared examples to align on the rubric; **independent double-blind annotation** of the gold set; and **consensus meetings** to resolve disagreements.

对照本项目的实际方案（「40–60 条回答由**两人**独立打分 **1 轮**」），差异有三处，**每一处都在削弱天花板**：

| 维度 | ELBench | 本项目 | 后果 |
|---|---|---|---|
| 标注者资历 | CS / EdTech 学位 + 评估经验 | **2 名开发者** | 天花板本身可能就不代表目标人群 |
| 阶段数 | 三阶段（培训对齐 → 双盲独立 → 共识会议） | **1 轮** | 连「分歧怎么合」都没定义 ⇒ **κ_HH 没有定义** |
| 标注单位 | 300 条 × 3 人 | 40 题 × 3 维 = 120 item × 2 人 | 样本小 + 标注者少 |

**这一条不能靠改标注者解决（44 天内招不到有资历的评估专家），只能承认它、并用相对判据把它的影响隔离掉。**

#### 4.4.2 方案里其实有三种「人」

`引用`（AI 席 J-05 展开）：方案里至少有**三种「人」**：真人面试官、开发者标注者、用户本人历史。而 κ 测的是第二种，达标判定用的是第一和第三种。**这三者不是同一个分布。**

| 「人」 | 在本方案中扮演什么角色 | 本项目里由谁代表 | κ 测的是谁 |
|---|---|---|---|
| 真人面试官 | 达标判定条件 ① 的参照（「这个岗位要的是不是这种答案」） | **没有代表**——岗位基准线是可编辑默认值（`baseline.ts:8-10` 明写没有任何真实面试数据） | ✗ |
| 开发者标注者 | 校准集的人工金标 | 2 名团队成员 | ✓ **κ 测的就是这一种** |
| 用户本人历史 | 达标判定条件 ④ 的参照 | 用户自己的历史分位（`baseline.ts`） | ✗ |

**这个区分必须在材料里说清楚**，否则「κ 达到人类标注者一致性的 X%」会被误读成「达到真人面试官水平的 X%」——**这是事实错误**：标注者是开发者，不是面试官。

#### 4.4.3 三阶段标注治理（本节定案）

**这是必须补上的一步，也是 κ_HH 有意义的前提。**

| 阶段 | 做什么 | 时长 | 产出 | 为什么必须有 |
|---|---|---|---|---|
| **阶段 1 · 培训对齐轮** | 两人**共同**标 **5 道校准题**（取自 40 题之外，不计入 120 item），当场讨论分歧并**记录判分规则**。重点对齐三件事：① 「有依据」与「无证据」的界线（决定 `noEvidence` 标得一致）；② 「精确但空泛」vs「粗但有取舍」在 C 档与 B 档之间的分界；③ 每题的 `rubricHints` 判分要点怎么用 | 30 min/人 | 一份 5 题的判分规则纪要 | ELBench 附录 G 第一阶段；**这是把「两人对 rubric 的理解差异」从 κ 里扣掉的唯一办法** |
| **阶段 2 · 双盲独立轮** | 120 item × 30–45 秒 ≈ 1–1.5 小时；加读题、读 rubric、记录理由，留 2–2.5 小时。**只标锚点 A–E + 一句理由，不标分数**（分数由 `anchorIdToScore` 统一换算，避免人自己换算出错） | 2–2.5 h/人 | `calibration_labels(rater_id='h1'/'h2')` | 保持独立，否则 κ_HH 测的是「两人商量后的结果」 |
| **阶段 3 · 共识轮** | 只处理两人分歧的 item（预计 < 15 个），产出**共识标签** | 30 min/人 | `calibration_labels(rater_id='h1_consensus'/'h2_consensus')` | ELBench 附录 G 第三阶段；**这一步是 κ_HH 有意义的前提** |

**κ_HH 必须报两个数**：

- **κ_HH（双盲口径）** = 只用阶段 2 的独立标签算 ⇒ 这是「两名标注者在没有商量的情况下有多一致」，是门禁 G2 里**该用的那个**。
- **κ_HH（共识口径）** = 用阶段 3 的最终标签算 ⇒ 这是「经共识裁决后剩下的分歧有多大」。

两者的差 = **分歧被共识吸收了多少**。若两者接近，说明分歧本来就在噪声级；若差距很大，说明 rubric 的可操作性有问题（该修 rubric，不是该修 judge）。

**标注者界面的一条硬约束（上轮 P1-5 尚未修，被本轮放大）**：人工标注工具必然要把「参考答案 + 候选人回答」同屏呈现给标注者 —— **这是一条新的泄漏通道**。因此标注界面**必须不展示参考答案全文**。只展示 `rubricHints` 的判分要点（这正是 §4.5 要接线的东西，它本来就是判分要点而非范文范例）。若无法保证这一点，则整个校准流程**只在离线本地跑**，不部署为服务。

#### 4.4.4 主口径：相对判据

在承认「天花板锚在错误人群」之后，**唯一能把锚点偏差隔离掉的读法就是相对判据**：

> κ_JH / κ_HH ——「我们的判分模型达到了**两名标注者之间**一致性的百分之多少」

这个比值的三个优点：① 它不声称达到任何外部标准；② 它的分母与 judge 面对的是**同一批题、同一批人**，口径对齐；③ 它随 rubric 改动而漂移，可被 §4.7 的回归监控捕捉。

**它的边界也必须写出来**：分母 κ_HH 自身在 n=40 上的 SD 是 0.124（`实测`），所以**比值的不确定度比单个 κ 更大**。本轮复算的相对门禁通过率（62.7% / 84.9% / 29.6%，见 §4.2.2 表）就是这一不确定度的直接体现。

### 4.5 `rubricHints` 的接线方式与零泄漏边界

#### 4.5.1 素材盘点（`实测`，本轮）

`questionbank/SCHEMA.md:29` 定义：`rubricHints` 是「3–5 条，**评分锚点，对应 Tryout 现有 6 维 rubric**（技术深度／沟通表达／逻辑思维／问题解决／抗压能力／文化匹配）」。`questionbank/validate.mjs:165` 强制长度 3–5 且必填。

本轮对 `questionbank/data/` 全部 16 个源文件（14 个行业文件 + 2 个标杆文件）统计，**116 道题全部带 `rubricHints`**：

| 指标 | 实测值 | 落点 |
|---|---|---|
| 题目总数 | **116** | `node questionbank/validate.mjs` 输出「校验通过」；题型分布 technical 73 / behavior 22 / system-design 10 / situational 6 / coding 5 |
| `rubricHints` 条数分布 | **3 条 ×1 题、4 条 ×55 题、5 条 ×60 题**（合计 523 条，与 `verify-no-leak.mjs` 报告的「rubricHints 523 条特征串」完全一致） | 本轮统计脚本 |
| 难度分布 | L1 15 / L2 18 / L3 41 / L4 26 / **L5 16**（L4+L5 = **42/116 = 36.2%**，L3+ = 83/116 = 71.6%） | 本轮统计脚本；与 `08-final-plan.md` M-21 引用的「L4+L5 = 42/116」一致 |
| 带 `trap` 的题 | **75/116**（format_conflict 30 / vague_numbers 21 / ai_slop 20 / over_rehearsed 4） | 本轮统计脚本；与 `08-final-plan.md` M-16 的「75 题带 trap」一致 |
| `referenceAnswer` 长度 | min 628 / p50 1050 / max 1907 —— **全部超过 `referenceAdapter.ts:16` 的 `DEFAULT_MAX = 500`** | 本轮统计脚本；M-16 的核心事实 |

**逐维覆盖度（本轮统计，是本节最重要的一组数）**：

| 维度 | 有 rubricHint 的题数 | 覆盖率 |
|---|---|---|
| 逻辑思维 | 114 | **98.3%** |
| 问题解决 | 110 | **94.8%** |
| 技术深度 | 104 | **89.7%** |
| 抗压能力 | 78 | 67.2% |
| 沟通表达 | 68 | **58.6%** |
| 文化匹配 | 47 | **40.5%** |

> **⚠ 数值修正（吸收核验报告 verify-scoring R5）**：逻辑思维 115→**114 / 99.1%→98.3%**；技术深度 105→**104 / 90.5%→89.7%**；`companySignal` 取值数 56→**50**。连带修正三处下游表述：§4.5.1 末段「三个判定维度的覆盖是 90%–99%」→**「89.7%–98.3%」**；§4.9.2 技术深度行「覆盖 90.5%」→**「覆盖 89.7%」**；§4.11.2 第三段「这三个维度的覆盖率是 90%–99%」→**「89.7%–98.3%」**。其余四维（问题解决 110 / 抗压 78 / 沟通 68 / 文化 47）与问题解决 94.8% **经核验完全一致**。

**这组数独立支撑了 §4.9 的降级路径**：把「沟通表达 / 抗压能力 / 文化匹配」三维降为「仅提示不判定」，不只是因为它们主观、难校准、有合规风险，**还因为连人工锚点素材都只覆盖了 40%–67%**。而三个判定维度（技术深度 / 逻辑思维 / 问题解决）的覆盖是 89.7%–98.3%——**素材在哪儿，判定就在哪儿**。

#### 4.5.2 为什么 judge 在 κ 比较里是结构性劣势

`实测`（本轮检索）：`rubricHints` 在 `web/src` 与 `server` 中**零命中**。具体地：

| 环节 | 状态 |
|---|---|
| `questionbank/SCHEMA.md:29` | 定义为「评分锚点，对应 Tryout 现有 6 维 rubric」 |
| `questionbank/validate.mjs:165` | 强制 3–5 条、必填 |
| `questionbank/scripts/verify-no-leak.mjs:217-221` | `rubricHints` 整条作为**泄漏特征串**参与子串级检测 |
| `questionbank/scripts/verify-no-leak.mjs:57-64` | `rubricHints` 在 `FORBIDDEN_FIELDS` 里 —— **公开产物里连字段名都不许出现** |
| `web/src/lib/evaluation/scoringEngine.ts:30-41` | `QuestionReference` 接口 = `{ keyPoints, referenceAnswer, questionType }` —— **没有 `rubricHints`** |
| `web/src/lib/evaluation/scoringEngine.ts:90-115` | `buildReferenceBlock` 只用 `keyPoints`（`:111`）与 `referenceAnswer`（`:112`） |
| `web/src/lib/evaluation/starEvaluator.ts:91-102` | `buildRubricBlock` 只给**与题目无关的通用两端锚点**：「A(5) = 能主动指出方案的技术前提和失效边界…」 |
| `server/services/questionBank.js:110-129` | `getReferenceForScoring` 返回 `{ referenceAnswer, keyPoints, type }` —— **不含 `rubricHints`** |

**推论（这是本节的关键论证）**：judge 现在判「这道题的技术深度几分」时，**手上只有一条通用维度锚点**，完全不知道这道题期望的技术点是什么（`keyPoints` 会以「考察方向：…」的形式出现在参考块里，但那是**不分维度的**事实点清单，且位置在判据之后）。而两名人类标注者判**同一道题**时，几乎必然会用**这道题的**具体期望来对照。

**所以在 κ 比较里，judge 是结构性劣势——不是模型能力问题，是它看到的 rubric 比人看到的少。** 这是 §4.3.4 里「不要用阈值去补锚点的债」的具体含义：接线（§4.5.3）比调阈值便宜得多，且**零新增标注成本**。

#### 4.5.3 接线落点（文件:行号级）

| # | 落点 | 改动 | 成本 |
|---|---|---|---|
| 1 | `web/src/lib/evaluation/scoringEngine.ts:30-41` | `QuestionReference` 增 `rubricHints?: string[]` | — |
| 2 | `web/src/lib/evaluation/scoringEngine.ts:121-197` `buildDimensionPrompt` | 在 `buildRubricBlock(dim)`（`:131`）之后、题面之前插入「本题本维度的判分锚点」块。**只喂本维度那一条**：`rubricHints` 是 `维度名:内容` 字符串，需解析出与 `dim.name` 匹配的那条；解析失败就跳过，不报错（`rubricHints` 只有 40%–98% 的逐维覆盖，缺维度是常态而非异常） | — |
| 3 | `server/services/questionBank.js:110-129` `getReferenceForScoring` | 把 `rubricHints` 一并透传（与 `keyPoints` 同样做逐项清洗与空值剔除） | — |
| 4 | `web/src/lib/evaluation/scoringEngine.test.ts` | 新增单测：`buildDimensionPrompt` 输出**包含本维度**对应的 rubricHint，且**不包含其它维度**的 rubricHint（防串味，与 ADR-01 的隔离铁律一致） | — |
| 5 | `trialroom/tools/` | 新增零依赖门禁 `verify-rubric-hints-wiring.mjs`：断言 (a) `scoringEngine.ts` 的 `buildDimensionPrompt` 源码含 `rubricHints` 消费路径；(b) `questionBank.js` 的 `getReferenceForScoring` 返回体含 `rubricHints`；(c) **公开产物 `questionbank-pro.json` 与 `questionbank-pro-index.json` 中 `rubricHints` 零命中**（防止接线时顺手把它放进公开产物） | — |
| 6 | `trialroom/tools/verify-qualification-spec-sync.mjs` | **新增（吸收核验报告 verify-scoring R7）**：断言 (a) 设计文档 `:777-783` 的四条件代码块已不含 `评分一致率` 且不含 `judge-κ`；(b) `db/001_platform_schema.sql:250` 注释已同步；(c) `qualification.ts` 导出的三条件签名与设计文档文本一致 | — |
| 合计 | — | 1 个接口字段 + 1 个函数改动 + 1 处透传 + 1 条单测 + 2 个门禁 | **0.5 人日，零新增人工标注** |

> **门禁 5(c) 去重说明（吸收核验报告 verify-scoring R9）**：5(c) 的「公开产物 `rubricHints` 零命中」**与既有 `questionbank/scripts/verify-no-leak.mjs` 重复**（该脚本已在做这件事：3585 条特征串、公开产物 0 命中、6 处共享标识符豁免）。修订口径：**复用 `verify-no-leak.mjs` 的既有断言**，新增门禁只做 (a)(b) 源码路径断言，避免两份会漂移的同义检查。

**收益（按 ADR-002 自引文献）**：人机一致性 QWK 从 0.59 档位往 0.65 档位抬（`引用`，`starEvaluator.ts:12-13`）。**这是把 judge-κ 从「不可控」推向「可测」的最短路径。**

**一个必须避开的错误**：接线时**不要顺手把 `referenceAnswer` 也改成 rubricHints**——那会让 judge 看不到事实基准，是另一个方向的错。`referenceAnswer` 的问题（太长、格式污染）由 §4.2.7 的 S0（`adaptReference` + `extractScoringHints`）单独处理，两件事都在 `buildDimensionPrompt` 附近，**但不是同一处改动**。

#### 4.5.4 不破坏零泄漏的边界

`rubricHints` 是**答案材料本身**——`verify-no-leak.mjs:30` 明写「keyPoints / rubricHints 是答案材料本身, 不做这个豁免」。所以它接进评分器的每一步都必须守住泄漏边界。

**边界一：`rubricHints` 永远不进公开产物。**
`实测`：当前 `web/public/questionbank-pro.json`（116 题）与 `questionbank-pro-index.json` 中，`rubricHints` / `keyPoints` / `referenceAnswer` **三个字段全部零命中**。导出脚本 `questionbank/scripts/export-pro-questionbank.mjs` 用 `PUBLIC_FIELDS` 白名单（`id / industry / type / difficulty / title / content / tags / estimatedMinutes / sourceType`）控制产出，并在导出前跑一次子串级泄漏自检，有命中就中止导出。**接线时不得改动这个白名单，也不得把 `rubricHints` 加进去。** 门禁 5(c) 就是守这一条。

**边界二：`rubricHints` 不进面向前端的题库响应。**
`实测`（本轮读取 `server/services/questionBank.js:81-87`）：

```js
export function toLite(q) {
  if (!q) return null;
  const { referenceAnswer, ...rest } = q;
  void referenceAnswer; // 显式丢弃
  return rest;
}
```

`toLite` **只丢弃 `referenceAnswer`**，`keyPoints` / `rubricHints` / `trap` / `companySignal` 都不在丢弃名单里。当前之所以安全，**只是因为服务端的 `server/data/questionbank.json` 里本来就没有这些字段**（存量 808 题库无 `referenceAnswer` 键，Pro 116 题走的是另一条导出链）。一旦把 Pro 题库接进服务端题库，**`toLite` 会把 `rubricHints` 一起端到浏览器**。

**因此接线必须同批做的一处加固**：`toLite` 的丢弃名单改为显式白名单（只允许 `id / industry / type / difficulty / title / content / tags / estimatedMinutes / sourceType`），而不是「只丢 referenceAnswer」。这是**白名单 vs 黑名单**的方向性修正，成本 < 0.1 人日。

**边界三：`rubricHints` 不进标注者界面的「答案侧」。**
§4.4.3 已述：标注界面不展示 `referenceAnswer` 全文。`rubricHints` 应当展示——它是判分要点，是标注者**需要的**东西，且它本来就是「答案材料」而非「答案原文」。展示它不构成泄漏（泄漏的方向是「让答题者看到判分依据」；标注者是评分侧，不是答题侧）。**但标注界面必须离线本地跑或严格鉴权**，不能是一个公开页面。

**边界四：`rubricHints` 只喂本维度，且只以「判分要点」的形式喂。**
`rubricHints` 是逐维的（每条带 `维度名:` 前缀）。若整包喂进 prompt，会同时违反两条：① ADR-01 的隔离铁律「任何一次调用的上下文中不得出现其他维度的分数」（`scoringEngine.ts:11-13`）；② 单测门禁 4。所以是「解析出本维度那一条，只喂这一条」。

**零新增标注成本的两种用法**（这是「免费午餐」的完整含义）：

| 用法 | 成本 | 效果 | 落点 |
|---|---|---|---|
| **用法一 · 喂 judge** | 0（素材已存在）+ 0.5 人日接线 | 把 judge 从「只有通用两端锚点」升级到「有本题本维度的判分要点」；直接命中 ADR-002 的 QWK 0.59→0.65 路径 | §4.5.3 表 |
| **用法二 · 喂标注者** | 0 | 两名标注者与 judge 看到**同一份**判分依据 ⇒ κ 比较的公平性提升（当前是人看得多、judge 看得少，κ 系统性低估 judge）；同时让阶段 1 培训轮的「对齐判分规则」有了具体抓手 | §4.4.3 阶段 1 + 标注界面 |

**用法二是更值钱的一半**：κ 比较之所以能说明问题，前提是**人与 judge 面对同一份 rubric**。当前不是。人看到题面 + 参考答案 + 通用维度锚点，judge 只看到通用维度锚点。接上 `rubricHints` 之后，两侧对齐，κ 才有解释力。

### 4.6 评分架构的如实描述

终稿第 70 行（终稿节内标注为 50）的论证句是：「试镜间现有的『六维隔离 + 多模型投票』架构解决的是评分请求之间互相污染，不解决判断维度与人类轴的错位」。

**前半句的前提是虚构的。**

`实测`（本轮检索）：`投票|多模型|仲裁|ensemble` 在 `Trialroom-全量设计方案.md` 与 `Trialroom-模型接入矩阵与抗退役路由层.md` 中**零命中**（设计文档里出现的 5 处「集成」是「集成商/集成能力」等常用词，与模型集成无关）。

**实际架构（逐条核实）**：

| 终稿的描述 | 实际是什么 | 落点 |
|---|---|---|
| 「六维隔离」 | ✅ **存在**。一次评分 = 6 次独立请求，每次只评一维；不复用对话上下文 | `Trialroom-全量设计方案.md:522`「评分（隔离式 6 次请求）」；`:1617` ADR-01「一次只评一个维度，6 次独立请求」；`scoringEngine.ts:447` `DEFAULT_SCORING_CONCURRENCY = detectConcurrencyCap(3)`（CPU 感知，1 核 → 1）+ `:463-466` `createLimit(concurrency)` 与 `Promise.all(dims.map(...))`（隔离式评分**已实装**） |
| 「多模型投票」 | ❌ **不存在**。实际是**单 provider + 故障降级链** | `Trialroom-模型接入矩阵与抗退役路由层.md:160`「**候选链按优先级排序，位置 0 是首选，后面是降级**」；`:163`「只有可用性故障才降级」；`:180`「不要写 `catch (e) { tryNext() }`」；`db/000_base_schema.sql:186-202` 的 `providers` 表有 `in_failover_queue` / `failover_priority` —— **这是故障切换的字段，不是投票的字段** |

**改写后的论证句**：

> 试镜间现有的「六维隔离」架构（一次评分 = 6 次独立请求，每次只评一个维度）解决的是评分请求之间的互相污染，**不解决判断维度与人类评价轴的错位**。我们也没有多模型投票——路由层是**单 provider + 故障降级链**（候选链按优先级排序，位置 0 是首选，后面是降级），降级发生在**可用性故障**时，而不是为了聚合判断。因此换模型能改变的东西比「集成投票」更少，**做人工校准不是退而求其次，是唯一还剩的路**。

**这个修正反而让结论更强**：终稿用「ensemble 会收敛到 judge 的共同轴」来论证不该靠投票（`引用`，Geometry 论文：Ensembles converge on the judges' shared axis rather than the human one），但既然连 ensemble 都没有，这条论证的前提就不成立——**结论（换模型不能替代人工校准）保留，论证基础要换**。

**对 κ 的三条连带影响**：

1. **κ 的估计量就是「这个 provider 的标签」**，不是「集成后的标签」。若日后真上多模型投票，κ 必须重算，且材料里必须写清是哪一个估计量。
2. **降级链会污染校准。** 若校准跑的过程中发生了 provider 降级（`failover_priority` 切到位置 1），那一轮 run 的 `model_version` 就不是同一个模型 —— **必须逐 item 记实际 provider 与 model**，`calibration_runs` 的 5 个指纹字段不够，还要在 `calibration_labels` 上加 `model_version`。**门禁断言：一次校准 run 内出现两种 model_version ⇒ 该 run 作废，退出码 1。**
3. **生产恒 1 票（J-26）。** `引用`（AI 席 J-26）：本轮实测投票**几乎不改变分数离散度**（σ_J/σ_H：单次 1.003 → 9 票多数 1.001）；照搬 ELBench 的 N=9 投票进生产会让成本乘 9，并撞 `server/index.js:123` 的 20 次/分限流。**校准必须测「与生产完全同构」的配置**——校准 9 票、生产 1 票，等于测的不是要交付的那个系统。

### 4.7 一致率的回归监控化：先修口径，再降级

终稿说「降级为回归监控项，仍能抓模型升级后的行为突变」。**这句话里没有「监控什么」「阈值多少」「谁看」「告警去哪」中的任何一个。** 监控一个口径错的指标，比不监控更危险——它会产生「红」或「绿」的假信号，而没有人知道它错在哪。

#### 4.7.1 M-15 的三个口径缺陷（`实测`，本轮读取源码逐行核实）

`web/src/lib/evaluation/consistency.ts` 的实际实现：

```ts
// consistency.ts:55-76
export function summarizeRuns(runs: RunResult[]): RunSummary {
  const byDim = new Map<string, number[]>();
  for (const run of runs) {
    for (const [dim, score] of Object.entries(run || {})) {
      ...
      arr.push(score);
      byDim.set(dim, arr);      // ← 只按「维度名」聚合
    }
  }
  ...
  out[dim] = { scores, sampleCount: scores.length,
                consistency: dimensionConsistency(scores), ... };
}
```

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| **D1** | **只按维度名聚合，没有题（case）维度**。6 道不同题目的分数被塞进同一数组 | `consistency.ts:55-76` | 跨题的分数差异被算成「不一致」 |
| **D2** | 在这个混合数组上做两两相等率 | `consistency.ts:39-52` `dimensionConsistency(scores)` | 技术深度在 6 道题上得 5,5,4,5,4,3 且**每题内部完全确定** → 一致率 = 4/15 = **0.267**（5/5/4/5/4/3 共 C(6,2)=15 对，其中相等 3(5)+1(4)+0(3)=4 对），**一个完美稳定的评分器被判为「极不稳定」** |
| **D3** | `overall` 是 6 个维度一致率的**算术平均** | `consistency.ts:106-115`（`shared.reduce((a,d)=> a + summaries.isolated[d].consistency, 0) / shared.length`） | 反向：一个「所有题都给 4 分」的平分器一致率 = 1.0，**拿满分门禁** |

**D2/D3 合起来的后果是：这个指标在数学上奖励「没有区分度」。** 而 PR #1 早已发现「评分器高分档无区分度」——两者互相印证。

> **⚠ 数值修正（吸收核验报告 verify-scoring R6）**：D2 行的「一致率 ≈ 0.4」→ **「一致率 = 4/15 = 0.267」**。方向不变，**实际值比原文更严重**，措辞可更强。

`实测`（本轮读取）：`web/scripts/eval-ab.mjs:224-230` 把 6 道不同题的结果 push 进**同一扁平数组**（`isolatedRuns.push(...iso)`）后交给 `M.summarizeRuns`，是 D1 的上游成因。`consistency.ts` 在生产路径**零引用**（唯一 import 点是 `eval-ab.mjs:53` 的字符串拼接 + `consistency.test.ts`）——这既是 M-08「死代码」的依据，也意味着一旦修口径，改动不会影响任何线上行为，**修起来是安全的**。

#### 4.7.2 修口径（W3，1.0 人日）

| 步骤 | 改动 | 落点 |
|---|---|---|
| ① | 新增 `summarizeRunsByCase(runs: {caseId, dimensionName, score}[])`：先按 `(caseId, dimensionName)` 分组求**组内**两两一致率，再按组内样本量**加权**平均（不是算术平均——各组样本量不等时算术平均会偏） | `consistency.ts` 新增 |
| ② | 旧函数 `summarizeRuns` 标 `@deprecated 口径错误`，保留但不再用于任何门禁 | `consistency.ts:55` |
| ③ | 三个 mock 评分器（平分器 / 稳定但有区分度 / 真随机）必须被判出**三种不同结论**。现有 `consistency.test.ts` 的用例**全部只有单维单题**，杀不掉这类错误 | `consistency.test.ts` |
| ④ | `eval-ab.mjs` 必须记录 `model_version` 到结果文件（现在不记录 → 结果不可复现，P2-10） | `web/scripts/eval-ab.mjs:224-230` 附近 |

**门禁条件从单条改双条**（M-15 的建议 3）：

```
组内一致率 >= 0.70   （不是 0.85 —— 0.85 在 N=3 时只有 1/3、2/3、1 三档，
                       需 --runs >= 7 才有分辨力）
AND 跨题分数标准差 >= 0.5   （区分度护栏）
```

**顺序纪律**：**M-15 的口径修复必须先于（或至少同批于）一致率监控上线。** 否则 M1/M2 会把「有区分度」误判成「不稳定」——这就是第二个死指标。

#### 4.7.3 四个监控信号

| # | 信号 | 定义 | 阈值 | 抓什么异常 | 依赖 |
|---|---|---|---|---|---|
| **M1** | **锚点翻转率** | 同一 (题, 维) 重复评 3 次，3 次里锚点不完全一致的比例 | **> 25% 即红** | 温度 / 模型版本变更导致的输出不稳定；prompt 改动导致的判定漂移 | §4.7.2 ① 必须先落地 |
| **M2** | **跨题分数标准差**（区分度护栏） | 同一批题、逐维分数的标准差 | **< 0.5 即红** | 平分器回归；题库或题面变更导致所有题同分 | §4.7.2 ① 必须先落地 |
| **M3** | **逐维 κ 的相对变化量** | `\|κ_now(d) − κ_prev(d)\|` | **> 0.10 即红** | judge 相对人工的退化 | 需 §4.2.6 的 `calibration_results` 有历史值 |
| **M4** | **parse 失败率** | `missingCount / (题数 × 判定维数)` | **> 3% 即红** | 上游返回结构变化、`max_tokens` 截断、模型换代 | 现有 `AggregateResult.missingCount`（`scoringEngine.ts:513`） |

**M4 的分子分母必须按「判定维度」而不是六维算**——降级为「仅提示不判定」的三维不参与判定，它们的解析失败不构成达标判定的风险；用六维做分母会把监控信号稀释三成。

#### 4.7.4 监控落点与告警去处

「没有人看的监控等于没有监控。」本节的落点写死：

| 项 | 落点 |
|---|---|
| 产物路径 | `trialroom/qa/calibration/YYYY-MM-DD.json`（每日）+ `trialroom/qa/calibration/<run_id>.json`（每次校准） |
| 生成者 | `tools/calibrate-judge.mjs`（校准信号 M3）+ `tools/eval-consistency.mjs`（新增，每日信号 M1/M2/M4） |
| 断言位置 | `tools/verify-all.mjs` 登记为新门禁位（现有 G1–G10 之后追加），四个信号任一越界 ⇒ **退出码 1**，构建变红 |
| 告警去处 | ① CI 构建失败（主）；② `qa/calibration/YYYY-MM-DD.md` 的人读日报（副） |
| 谁看 | 每日 CI 红灯由当日值班人处理；κ 相关的 G1–G4 门禁由评分内核 owner 处理（**门禁必须指名到人，不能指名到角色**） |

**M3 与发布门禁 G3 的分工**：G3 是「不许上线」的硬门（区间下界相对上一版跌超 0.05 ⇒ 构建红）；M3 是「不拦上线、但要有人看一眼」的告警（点估计相对变化超 0.10）。**一个管发布、一个管日常，两者不是同一条线。**

### 4.8 成对比较：形态纠正与分期

#### 4.8.1 终稿的说法与事实

终稿第 74 行（终稿节内标注为 54）：

> 面试复盘里「上一版回答 vs 这一版回答」的对照本身就是一份**带标尺的**成对数据集，不用额外雇人标注，就能拿到比绝对打分更可信的信号。

**三处不成立。**

**第一处：今天有 0 对。**
`实测`（本轮检索）：`replay_attempts` 在 `server/` 与 `web/src/` 的**业务代码中零命中**（唯一文本命中是 `data/questionbank-src/qa.ts` 里的一道题面）。`POST /api/replay/hint`（设计文档 `:729`）不存在，`POST /api/replay/attempts` 不存在，§4.4 闭环六步**零实现**（`08-final-plan.md` P0-1 已证）。表在 `db/001_platform_schema.sql:251-269`，**零行**。

**第二处：「自带标尺」是错的。**
一对 (答案_{n-1}, 答案_n) 里**没有任何「哪版更好」的标签**。唯一可用的标签来源是 **judge 自己**。于是「不可信 judge」被换成了「另一个不可信 judge」，而且是**同一个 judge 评自己出的题**——**自证循环**。

**第三处：「不用额外雇人标注」不成立。**
`引用`（JudgmentBench，arXiv 2605.25240，AI 席 §3.6 转录）：成对判断在排序恢复上把 Spearman 从 0.150 拉到 0.908、win-rate 从 0.542 拉到 0.669，**而标注时间不到一半**——标注时间中位 **1.92 分钟/次** vs rubric **4.74 分钟/次**。
**省的是「人标成对」比「人标 rubric」便宜一半，不是「不用人标」。** 该论文的 1,530 个成对偏好**全部来自执业律师**（≈ $242,000 等值律师工时）。

#### 4.8.2 A 期交付形态（唯一可交付的东西）

> **A 期只做「上一版 vs 这一版」的并排展示，不宣称它是评估信号。**

| 项 | A 期（W3–W4） | 不做 |
|---|---|---|
| 形态 | 双栏并排 + 可选 diff 高亮（diff 是**纯前端计算**，不需要新增存储列） | 不做 |
| 措辞 | 「这是你上一次的答案和这一次的答案，放在一起给你看」 | **不写**「进步了 / 改好了 / 提升」 |
| 是否产生评估信号 | **否**。界面上不出现任何基于两版对比的分数、评级、箭头 | 不做 |
| 数据来源 | 用户**自己**在同一题下的两次作答（需要 `replay_attempts` 落地，见下） | 不从任何「自动生成的更好答法」派生判定 |
| 验收 | 同一 (user, question) 的两次作答能并排渲染 | — |

**A 期的存储前置**：`replay_attempts` 只存**本次**答案（`db/001_platform_schema.sql:258` `answer_text TEXT NOT NULL`），上一版全文要去 `messages` / `answer_recordings` 查，而这三者与 `replay_attempts` **无外键、无共享主键**；`room_answers` 表**尚未建**（`08-final-plan.md` M-10 标为 W2 待建）。
**两种落法**：① `replay_attempts` 增 `prev_attempt_id TEXT`（小改）；② 按 M-10 的 W2 窗口建 `room_answers`。**选 ①**——A 期只做并排展示，不需要房间答案表；② 留给 B 期。

**A 期绝对不能做的三件事**（做了就是自证循环）：

1. ❌ 不让 judge 对两版答案出「哪版更好」的判定并展示给用户。
2. ❌ 不让「辅助官的更好答法」参与任何达标判定。
3. ❌ 不把两版并排的视觉呈现包装成「评分可复核」的卖点。

#### 4.8.3 B 期前置条件（成对评估的四个必要条件）

真正的成对评估**移 B 期**，且必须满足全部四条前置：

| # | 前置条件 | 判据 |
|---|---|---|
| **P1** | **闭环六步全部落地**，且 `replay_attempts` 有真实数据（≥ 一定规模） | `db/001_platform_schema.sql:251-271` 的表有行；`POST /api/replay/hint` 与 `/api/replay/attempts` 存在并被 e2e 覆盖 |
| **P2** | **成对标签来自人，不来自 judge**。标注者只标**方向**（A 更强 / B 更强 / 难分），不标逐维分 | `calibration_labels` 增 `rater_id ∈ ('h1','h2')` 的成对行，`pair_id` 关联同一 (user, question) 的两次 attempt |
| **P3** | **闭环污染已切断**，二选一：① 判定模型与提示模型**不同厂商 / 不同家族**（`providers` 表已有 `in_failover_queue` / `failover_priority`，架构上零成本）；② 判定时**屏蔽 hint 文本**，只对两版答案盲判方向（`replay_attempts.feedback` 存了提示文本，判定时它在上下文里，污染更直接） | 判分 prompt 的输入里不含 `feedback`；或判分 provider ≠ hint provider（断言） |
| **P4** | **成对作为补充维度，不替换 rubric 逐维判定** | 达标判定的条件 ②③ 仍基于逐维 rubric；成对只作为「整体层面的方向」并列展示 |

**P4 的理由（必须写进设计文档，否则会被做成替换）**：`引用`（AI 席 J-12）：§4.4.5① 要「未达标：缺量化结果（扣 12 分）」、§4.4.6 要雷达图双系列——**这两者都需要逐维量值，成对给不了**。JudgmentBench 论文自己点明了这个 trade-off：because pairwise preference judgments are typically aggregated into rankings or latent utility estimates, the corresponding evaluations are **harder to decompose into reusable criteria or audit after aggregation**。成对给方向，rubric 给幅度，**两者不可互换**。

**成本参考（用于 B 期排期）**：成对标注中位 **1.92 分钟/次** vs rubric **4.74 分钟/次**（`引用`，JudgmentBench）。120 个成对比较 × 2 人 × 1.92 min ≈ **7.7 小时**；作为对照，120 个 rubric item × 2 人 × 4.74 min ≈ **19 小时**。**成本减半成立，但前提是有人标。**

### 4.9 不达标的降级路径

终稿全文**没有任何一条**「测出来不达标怎么办」。对一个「44 天要交产品」的计划来说这是最大的结构性缺口：你测出 κ = 0.5 然后呢？方案的回答是「没有然后」。

#### 4.9.1 触发条件与响应

| 测得结果 | 判定 | 响应 |
|---|---|---|
| `min_d κ_JH(d) ≥ 0.79` 且 `min_d κ_HH(d) ≥ 0.79` | 达标（达到旧门槛等价值） | 按 §4.11 的措辞对外表述；三个判定维度全开 |
| `min_d κ_JH(d) ∈ [0.60, 0.79)` | 部分达标 | **三维度判定保留**（≥0.60 过绝对地板）；对外表述必须写「κ 落在 0.60–0.79 区间、**单个维度的点估计标准误约 0.12–0.14、95% 区间宽度约 0.61**」；**不得只报点估计** |
| `min_d κ_JH(d) ∈ [0.50, 0.60)` | **不达标** | 进入 §4.9.2 降级路径 |
| `min_d κ_JH(d) < 0.50` | 严重不达标 | 进入 §4.9.2 降级路径**且**触发 §4.9.4 的产品口径收窄 |
| `min_d κ_HH(d) < 0.50` | **天花板本身塌了** | **这不是 judge 的问题，是 rubric 的问题。** 停止一切 κ 讨论，先修 rubric（题目与 `rubricHints` 的判分要点是否可判），本轮校准结论**作废** |

> **⚠ 口径修正（吸收核验报告 verify-scoring R2）**：「区间宽 0.12–0.14」是 **n=40 时 κ̂ 的 SD（标准误）**，不是 95% 区间宽度（后者是 0.615）。本表已改为「点估计标准误约 0.12–0.14、95% 区间宽度约 0.61」，与 §4.2.3 / §4.11.1 口径统一。

**最后一行是本节新增的**：门禁 G4（`min_d κ_HH(d) >= 0.50`）若不通过，说明**两名标注者在这批题上都无法给出一致的判断**。此时 κ_JH 的任何数值都无意义（分母不稳定），且对外不能声称任何一致性水平。

#### 4.9.2 44 天内可执行的降级

`引用`（AI 席 J-14 / S5）。降级的原则：**不要用阈值去补能力的债；要么把判定范围收窄到能被证据支撑的部分，要么如实说「这一维我们不给判定」。**

| 维度 | 正常态 | 降级态（κ 不达标时） | 依据 |
|---|---|---|---|
| **技术深度** | 保留判定 | **保留判定**（不可降级——它是唯一有完整 rubricHints 覆盖 89.7% 且 ADR-002 路径可直接接的维度） | §4.5.1 覆盖度实测；§4.5.3 接线 |
| **逻辑思维** | 保留判定 | **保留判定**（rubricHints 覆盖 98.3%，是六维里最高的） | 同上 |
| **问题解决** | 保留判定 | **保留判定**（覆盖 94.8%） | 同上 |
| **沟通表达** | 仅提示不判定 | **合并进「表达」类提示，不出分** | `实测` `scoringEngine.ts:176-182` 注释逐字：「R36 用 30 样本 × 6 维的落盘分数测到：『沟通表达』在 20 个样本里反复充当唯一的『例外维度』，5 分只有 1 次而平均分最高 —— **它是系统性的噪声，不是答案质量的信号**」；§4.5.1 实测 rubricHints 覆盖仅 58.6% |
| **抗压能力** | 仅提示不判定 | **合并进「表达」类提示，不出分** | `scoringEngine.ts:191`：「你只能看到这一段书面回答，**没有追问环节**」——锚点以「被追问时…」为前提，而 judge 根本看不到追问。**这是一个 anchor 与可观测事实不匹配的维度，不该判定**；覆盖 67.2% |
| **文化匹配** | 仅提示不判定 | **建议改名「协作行为」，仍只提示不判定** | 上轮 P1-8：就业决策场景的合规偏见风险 + 锚点与维度名不匹配；覆盖仅 40.5%（六维最低）。**降级它同时解掉合规、主观性、校准三件事** |

#### 4.9.3 更严一档的降级（κ_JH < 0.50 时）

如果连三个判定维度的 κ 也只有 0.5，那么**「达标判定」这件事本身就不成立**。此时的可执行降级：

| 措施 | 具体做法 | 对外口径 |
|---|---|---|
| **判定降级为提示** | 不再输出「达标 / 未达标」的二元结论，改为输出「本场得分 + 差距说明 + 下一步建议」 | 「我们这一期**不给出二元达标判定**，给出的是分数与差距说明」 |
| **维度合并** | 三维合并为一条「技术判断力」（等权平均三个判定维度的锚点分），**雷达图保留三个分项但只作展示、不参与判定** | 「达标判定建立在一条综合技术判断力上；三个分项在报告里可见，但它们不单独判定」 |
| **判定条件收缩为二条** | 只保留条件 ①（岗位基准线）与条件 ③（单答案稳定性守卫），去掉条件 ②（after ≥ before）——**进步判定在证据不足时最容易给出虚假的乐观信号** | 不主动展开，被问到时说明「进步判定依赖历史可比性，冷启动与跨题比较不成立」 |
| **对外表述** | §4.9.4 | — |

#### 4.9.4 对外表述（防止被判为夸大）

> **我们把评分范围收窄到能被证据支撑的部分。**
> 技术深度、逻辑思维、问题解决三个维度，我们给「达标 / 未达标」判定——这三个维度有**逐题逐维的人工判分锚点**（我们自建的 Pro 题库 116 道题，每题带 3–5 条人工锚点，这三个维度的覆盖率是 89.7%–98.3%）。
> 沟通表达、抗压能力、文化匹配三个维度，**我们只给提示，不给判定**——因为它们要么依赖面试官追问（我们的判分器看不到追问），要么在我们的实测中表现为噪声，要么在合规上不适合由模型判断。
> **界面上会写明哪些维度参与了判定。**
> 如果我们的校准结果显示模型与人工的一致性达不到门槛，我们会把判定再收窄一档（合并为一条综合技术判断力），**并把这件事写在报告里，而不是把门槛调低到能通过。**

**最后一句是这段话的核心**：它把「阈值」从「用来让门禁变绿的工具」改回「用来决定我们敢宣称什么的工具」。

### 4.10 成本与预算控制

#### 4.10.1 预算的硬约束

`实测`（本轮读取 `server/index.js`）：

- `:941` `const DAILY_TOKEN_BUDGET = Number(process.env.DAILY_TOKEN_BUDGET) || 500000;` —— **全局共享、非按用户**
- `:950-964` 超出即返回 429，`Retry-After` 指向下一个 UTC 零点
- `:123` `app.use("/api/chat", createRateLimiter({ windowMs: 60_000, max: 20, label: "chat" }))` —— 20 次/分

**这意味着：校准跑起来，真实用户的面试会被拒。** 这不是「成本高一点」，是「校准会打断线上服务」。

#### 4.10.2 校准集的一次性成本

| 配置 | 调用次数 | token（按 2050/次） | 占日预算 500000 | 限流墙钟（20 次/分） |
|---|---|---|---|---|
| n=40 × 6 维 × 1 票（终稿口径） | 240 | ≈ 492,000 | **98%** | 12 分钟 |
| n=60 × 6 维 × 1 票 | 360 | ≈ 738,000 | **148%（超支）** | 18 分钟 |
| n=40 × 6 维 × 9 票（ELBench 协议） | 2,160 | ≈ 4,428,000 | **886%** | 108 分钟 |
| n=60 × 6 维 × 9 票 | 3,240 | ≈ 6,642,000 | **1328%** | 162 分钟 |
| **n=40 × 3 判定维 × 1 票（本节定案）** | **120** | **≈ 246,000** | **49%** | **6 分钟** |
| **同上 + S0 裁剪后（1750/次）** | **120** | **≈ 210,000** | **42%** | **6 分钟** |

> `引用`（AI 席 J-15）：单次调用 2050 token 是**推算值**（rubric 200 + 题面 200 + 回答 400 + 参考答案 1050 + 输出 200），来自 `review/02-ai-quality.md` P1-4，**本轮未独立复核**。`实测`（本轮）：Pro 116 题的 `referenceAnswer` 长度 min 628 / p50 1050 / max 1907，**全部超过 `referenceAdapter.ts:16` 的 `DEFAULT_MAX = 500`** ⇒ 「参考答案 1050 token」这一项在 Pro 题库上是**准确的量级**。

**降维的收益是结构性的，不是省一点**：另外三维走「仅提示不判定」，**不需要 judge 判定，也就不需要校准**。这是 §4.9 的降级路径在成本上的额外红利——**降级不只是诚实，是省钱**。

#### 4.10.3 每次发版的回归成本

| 项 | 次数 | token | 说明 |
|---|---|---|---|
| 全量校准（40 题 × 3 维 × 1 票） | 120 | ≈ 210,000（裁剪后） | 42% 日预算 |
| **增量回归（只跑 10 题 × 3 维）** | 30 | ≈ 52,500 | 10.5% 日预算 |
| M1 锚点翻转率（同一 10 题 × 3 维重复评 3 次） | 90 | ≈ 157,500 | 31.5% 日预算 |
| M4 parse 失败率 | 0（复用上两行的结果） | 0 | — |

**发版回归的建议配置**：日常发版跑**增量回归**（10 题 × 3 维，30 次调用，≈52.5k token = 10.5% 预算）；**换模型版本或换 prompt 的发版**跑**全量校准**（120 次，≈210k = 42% 预算）。两者都必须用 §4.2.6 的 `calibration_runs` 记指纹。

#### 4.10.4 运行时 judge token 成本

| 场景 | 调用次数 | token（2050/次） | 占日预算 500000 |
|---|---|---|---|
| 一场 8 题面试（6 维 × 1 票） | 48 | ≈ 98,400 | **19.7%** |
| 一场 8 题面试（**3 判定维 × 1 票**） | 24 | ≈ 49,200 | **9.8%** |
| 一场 8 题面试（3 判定维 + 临界维复评） | ≈ 26（按每题 0.3 维复估） | ≈ 53,300 | **10.7%** |
| 一场 8 题面试（3 判定维，裁剪后 1750/次） | 24 | ≈ 42,000 | **8.4%** |

`推算`：复评维数按「条件 ① 的差值落在 ±0.5 档以内」的比例估为每题 0.3 维——**这个比例是估计值，必须在 S4 拿到真实分布后回填**。本节给出的是量级，不是精确值。

**日预算 500,000 意味着：按 6 维口径，全天只够约 5 场完整会后评估**（`引用`，`08-final-plan.md` M-16）。**按 3 判定维口径，全天约 10 场。** 这是把判定维度收窄的**第二个**成本红利（第一个是省校准，第二个是省运行时）。

#### 4.10.5 控制手段（五条，缺一条就回到「校准打断线上」）

| # | 手段 | 落点 | 断言 |
|---|---|---|---|
| **C1** | **校准跑在独立 provider key / 独立预算桶** | `server/index.js:941` 的 `DAILY_TOKEN_BUDGET` 改为按 provider 或按用途分桶（`calibration` / `production`） | 门禁断言：校准运行期间真实用户会话**不返回 429** |
| **C2** | **校准限流走独立窗口**，不撞 `/api/chat` 的 20 次/分 | `server/index.js:123` | 门禁断言：校准并发 ≤ 独立阈值，且生产限流计数器不受影响 |
| **C3** | **S0 前置必做**：参考答案裁剪 + `aggregateScores` fail-open | `scoringEngine.ts:543-555` / `:140-142` | 门禁断言：S0 未完成 ⇒ S1 不许开始。**理由写进 PR 描述：κ 的可信度不能高于它的输入** |
| **C4** | **prompt 前缀共享**（ADR-06）：把 rubric + 判据 + 题面提到回答之前，同题 3 维共享前缀 | `scoringEngine.ts:127-142` 的 parts 顺序（当前是 rubric → 题面 → 回答 → 参考答案，**判据在用户内容之后**，违反 ADR-06） | 单次 token 从 2050 → 约 1750–1450（`引用`，AI 席 P2-12 的估区间）；与 §4.5.3 的 rubricHints 接线**落在同一处**，一起做 |
| **C5** | **校准用缓存命中**：同一 `prompt_hash` 的重复跑（锚点翻转率的 3 次重复）应当命中 provider 的 prompt cache | 依赖 C4 的前缀顺序 | 计 token 时区分「逻辑 token」与「计费 token」，报告只报后者 |

**C4 与 §4.5.3 的接线必须一起做**：两者都改 `buildDimensionPrompt` 的 parts 顺序与内容，拆成两个 PR 会产生一次无意义的冲突与一次重复 review。

### 4.11 参评材料的诚实表述

#### 4.11.1 三重限制必须同时说

本节的测量处在三重限制之下，材料里**三条都要写**，缺一条都会在评审追问时暴露：

| # | 限制 | 具体表述必须包含 | 追问时的答案 |
|---|---|---|---|
| **L1** | **小样本** | 「40 题 × 3 个维度的自建人工锚定集」；「单个维度的 κ 估计标准误约 **0.12–0.14**（`实测` n=40 时 SD = 0.124）——**这是本次测量的分辨率上限，不是模型的能力上限**」 | 「我们没有把 40 题说成基准；n=300 能把 95% 区间宽度从 0.615 压到 **0.231**（约 ±0.12），要再压到 0.17 以内需要 **n≈500**——那是 B 期的事」 |
| **L2** | **自建锚定集** | 「这是**我们自己建的**人工锚定集，**不是行业基准**」；标注者是 **2 名开发者**，不是有资历的教育测量专家 | 「我们引用文献的天花板（0.856）只作为方法论参照，**没有声称达到**；本项目自身的天花板 κ_HH 就是我们的参照物」 |
| **L3** | **主观 rubric** | 「面试回答（含文化匹配这类软维度）是**主观 rubric**，按已发表规律，judge 与人类的一致率在主观 rubric 上会显著低于可验证 rubric」；「1–10 汇总量纲是本项目测得人机一致性最低的量纲（ICC 0.805，0–5 为 0.853）——我们选择它是因为它对用户可读」 | 「所以我们把判定收窄到三个维度，并且报的是**与人类标注者之间的相对比例**，不是绝对水平」 |

#### 4.11.2 可直接抄进材料的三段

**第一段 · 怎么保证分可信（这是加分位）**

> **我们怎么保证分可信。**
> 我们把「模型跟自己有多一致」这个指标换掉了——一致率高可能只是共享盲点的证据。新的口径是**我们的判分模型与人工标注的一致性**（象限加权 Cohen's κ，按维度逐个算，因为我们的量纲是每维 1–5 档锚点 A–E，不是连续分数）。
> 我们的第一轮基线：在 **40 道题 × 3 个维度**的自建人工锚定集上，由两名标注者独立双盲打分，算得 **κ 中位数 = X，六维范围 A–B（95% 自助区间 [C, D]）**；同一批标注者之间的 κ 中位数为 **Y**，即**我们的模型达到了人类标注者之间一致性的 Z%**（区间 [G, H]）。
> **边界我们写清楚**：这是**我们自建的 40 题小型人工锚定集，不是行业基准**；样本量决定单个维度的 κ 估计标准误约 **0.12–0.14**——**这是本次测量的分辨率上限，不是模型的能力上限**。我们也没有声称达到任何文献水平；相关研究在其自身的教育任务族上报告的是 0.792–0.847，**任务域与我们不同，不可直接比较**。

**第二段 · 换算（这是防「夸大」位）**

> **换指标不是换了一把更严的尺。** 我们过去用的口径是「单维一致率 ≥ 85%」，等价的象限加权 κ 是 **≈ 0.79**。所以我们把目标定在 **κ ≥ 0.79**，不是 0.70。
> （附换算表：精确一致率 85% ≈ κ 0.79；精确一致率 77% ≈ κ 0.70。）
> 我们同时报 **κ + AC1 + 原始一致率 + 分数边际分布**，因为 κ 对边际偏斜敏感，单个 κ 数字不自描述。

**第三段 · 收窄判定范围（这是加分位，且比任何 κ 数字都更能回答「凭什么信你的分」）**

> 我们把评分**范围收窄**到能被证据支撑的部分。技术深度、逻辑思维、问题解决三个维度，我们给「达标 / 未达标」判定，这三个维度有**逐题逐维的人工判分锚点**支撑（我们自建的 Pro 题库 116 道题，每题带 3–5 条人工锚点，这三个维度的覆盖率是 89.7%–98.3%）。沟通表达、抗压能力、文化匹配三个维度，**我们只给提示，不给判定**——因为它们要么依赖面试官追问（我们的判分器看不到追问），要么在我们的实测中表现为噪声，要么在合规上不适合由模型判断。**界面上会写明哪些维度参与了判定。**

#### 4.11.3 位置纪律：什么放哪儿

`引用`（AI 席 §3.8 J-18）：终稿把「诚实标注测量边界」放到了「影响力 20% 的杠杆」上，而 `Trialroom-全量设计方案.md:1974-1978` 已用官方细则原文堵死了这条路——官方对「作品影响力 20%」的原文是「**作品详情页在支付宝 AI 付官网的浏览、点赞、评论等互动量综合评定**」；`:1988`「影响力与商业化必须同源」，影响力 20% + 商业化 25% = **45% 靠真实用户**。**校准集不产生互动量。**

| 呈现位置 | 效果 | 理由 |
|---|---|---|
| **产品 30% 的证据链里**（回答「凭什么信你的分」） | ✅ **加分，且是强加分** | 评审看到「他们知道自己的数字在什么范围内」比「他们报了个 0.87」可信得多。**这是唯一真正的加分位** |
| **作品详情页作为「参评材料清单」的一部分**（§7.2.5 动作 2 明列） | ✅ **加分（间接）** | 它让作品页「值得互动」，进而产生官方口径的影响力。但这是**内容吸引力**，不是影响力机制本身 |
| **作为「影响力 20%」的主要打法** | ❌ **减分** | 评审熟悉官方细则，会发现我们在用一个不产生互动量的动作押 20 分；且与 §7.2.5「不能等到 W6 才发现没做」直接冲突——**本周的阻断项应该花在校准的方法学上，不是花在影响力叙事上** |

**裁决**：终稿 `final_turn_001.md:175`「最有传播力的……公开一份人工校准集和它的 κ 值……**影响力杠杆**」这一表述**删除**，改为「作品页内容之一」。

#### 4.11.4 四个禁用词

| 禁用词 | 为什么 |
|---|---|
| **行业基准** | 事实错误——40 题的自建锚定集不是行业基准 |
| **人类面试官水平** | 事实错误——标注者是 2 名开发者，不是面试官（§4.4.2 的三种「人」） |
| **达到专家水平** | 不可证 |
| **国际领先** | 不可证 |

**评审现场被追问一次就全盘失信。**

**另外两条纪律**：

1. **`引用`（AI 席 §3.8）**：`Trialroom-全量设计方案.md` 全文**未出现「可复现」**（实测 0 命中）。若材料要写「可复现、能反驳」，**得先真的公开校准集 + 脚本 + rubric 版本 + 模型版本 + 温度 + 随机种子**——本节的 §4.2.6 的 `calibration_runs` 五个指纹字段就是为此存在的，否则又是一个新的话术风险。
2. **不写不存在的架构**（§4.6）。材料里出现「多模型投票」会被追问「投票在哪几行代码」，答不上来就是虚构卖点——这与 `08-final-plan.md` M-12 判定的「无障碍门禁」「可视化流程编辑器」是同一类错误：**被证伪比少说更伤**。

#### 4.11.5 一句必须出现的边界声明

> 本轮校准是在**我们自己的题库、自己的 rubric、自己的模型**上测的。它回答的是「在这个系统里，模型与两名标注者有多一致」，**不回答**「这个模型在技术面试上是否达到真人面试官的水平」。后者需要真人面试官参与标注，那是 B 期之后才可能做的事。

### 4.12 AI 席 P0 / P1 / P2 处置索引

#### 4.12.1 P0（11 条，全部有落点）

| 编号 | 问题（AI 席 `review/09-ai-quality.md`） | 本节处置 | 落点 |
|---|---|---|---|
| **J-01** | judge-κ 是语料级 × 版本级属性，被写成逐题运行时 AND 条件 ⇒ 恒真（死条件）或要求生产持续人工标注 | **从四条件中移除，改为发布门禁**；运行时第三条件改为「单答案稳定性守卫」（逐题可判定、零额外调用、复评只发生在临界维度） | §4.1.1–§4.1.3；`qualification.ts`；`Trialroom-全量设计方案.md:777-783`；`db/001_platform_schema.sql:250` |
| **J-02** | 0.70 阈值无出处；被引文献明确要求「以人类天花板为参照」，而天花板没测 | **先测 κ_HH（零额外成本）**；门禁改双阈值 `κ_JH ≥ 0.85 × κ_HH` 且 `κ_JH ≥ 0.60` | §4.2.2、§4.2.5、§4.2.8 |
| **J-03** | n=40–60 的分辨率只有 ±0.30；即使真 κ=0.70，P(CI 下界 ≥ 0.70) 仅 0.2%/0.6% | **放弃二值门禁**：判据用点估计、强制输出区间；把 CI 下界写进门禁在 n=40 上是「永远红的门禁」；n≥300 才谈得上绝对数字 | §4.2.3（本轮复算区间宽 0.615 / 0.493 / 0.231） |
| **J-05** | 人类天花板锚在了错误的人群（2 名开发者 vs 有资历门槛） | **承认为已知偏差**；补**培训对齐轮 + 共识轮**（三阶段）；相对判据 κ_JH/κ_HH 作主口径；材料里区分「三种人」 | §4.4.1–§4.4.4 |
| **J-09** | 成对数据的「天然存在」是空的：今天有 0 对 | **成对比较不作为本周校准集的数据来源**；A 期只做并排展示 | §4.8.1–§4.8.2（实测 `replay_attempts` 业务代码零命中） |
| **J-10** | 「自带标尺」是错的：唯一可用标签还是 judge 自己 ⇒ 自证循环 | **成对标签必须来自人**；「成对标注成本减半」成立，但省的是「人标成对」的时间，不是「不用人标」 | §4.8.1、§4.8.3（P2） |
| **J-11** | 闭环污染：辅助官的「更好答法」由 AI 生成，同一个 judge 既给提示又判「改好了」 | **A 期不做任何基于两版对比的判定**；B 期前置 P3 二选一：异构 provider（`providers` 表已有 `in_failover_queue`/`failover_priority`）或判定时屏蔽 `feedback` 文本 | §4.8.2「A 期绝对不能做的三件事」、§4.8.3 P3 |
| **J-14** | 若 judge-κ 只到 0.5，44 天内没有可执行的补救路径（终稿完全没写） | **降级路径四档**（达标 / 部分达标 / 不达标 / 严重不达标）+ 严一档降级（判定降为提示、三维合并、条件收缩为二条）+ 对外表述 | §4.9.1–§4.9.4 |
| **J-15** | 校准集吃穿全局 token 预算（98%–148%） | **校准集缩到 **40 题 × 3 判定维 = 120 次 ≈ 246k = 49%**；裁剪后 210k = 42%；**独立预算桶 + 独立限流窗口**；运行时 3 维口径从 19.7% 降到 9.8% 预算 | §4.10.1–§4.10.5 |
| **J-16** | 两份规格对第三个条件给出互相矛盾的规定，唯一真相源未改 | **给出唯一改写文本**，并要求同时更新 `Trialroom-全量设计方案.md:777-783`、`db/001_platform_schema.sql:250` 注释、`08-final-plan.md` 对应条目 | §4.1.3 条件改写对照表 + §4.5.3 门禁 6（规格同步断言） |
| **J-18** | §七 把「影响力」押在「公开人工校准集」上，被设计文档 §7.2.5 直接推翻 | 校准集**降级为「作品页内容」**，不再作为影响力杠杆叙述 | §4.11.3（引用 `Trialroom-全量设计方案.md:1974-1978`、`:1988`） |

#### 4.12.2 P1（15 条）

| 编号 | 处置 | 落点 |
|---|---|---|
| **J-04** | 「指标替换」实际是**降标**：旧 85% ≈ κ 0.79，新 κ 0.70 ≈ 77.3% | **目标定在 κ ≥ 0.79**；材料里放旧→新换算表并明说「这是降标不是升标」 | §4.3.1–§4.3.3 |
| **J-06** | 题面「六维 0–100 分」的前提不成立；本项目是 1–5 序数锚点 → 1–10 | **κ 的单元固定为 (题 × 维) 的 A–E 标签**；给出计算式（w_ij / p_o / p_e / κ_QW） | §4.2.4 |
| **J-07** | 「六维隔离 + 多模型投票」架构不存在 | **六维隔离 ✅ 存在**（`scoringEngine.ts:447`、`:463-466`）；**多模型投票 ❌ 不存在**，实际是单 provider + 故障降级链（`模型接入矩阵:160`）。给出改写后的论证句 | §4.6 |
| **J-08** | 一致率降级为回归监控但没定义监控什么/阈值/谁看/告警去哪 | **M-15 口径先修**（3 个缺陷 + 4 步修法 + 3 个 mock 评分器），再落 **4 个监控信号 + 阈值 + 落点 + 告警去处** | §4.7.1–§4.7.4 |
| **J-12** | 成对给方向、不能给逐维幅度，不能替换 rubric 判定 | 成对作为**补充维度**，rubric 逐维判定保留 | §4.8.3 P4 |
| **J-13** | diff 高亮无存储落点 | **diff 是纯前端计算，不需要新增存储列**；但「上一版全文」取不到 ⇒ A 期选 `replay_attempts` 增 `prev_attempt_id`（小改），`room_answers` 留 B 期 | §4.8.2 |
| **J-17** | 条件 4「个人同难度 P60」双重不可实现 | `baseline.ts` 增 `computePersonalPercentile`；`DimensionScoreInput` 增 `difficulty`；**统一难度枚举**（`session_level` vs `question_level`）；冷启动返回「不适用」而非「通过」 | §4.1.3 条件 ④ 行 |
| **J-19** | 单一合并 κ 没有良定义，掩盖最差维度 | **禁止报合并 κ**；门禁用 `min(逐维 κ)`，报告六维全表 + min / 中位 | §4.2.1 禁令二、§4.2.8 |
| **J-20** | κ 对边际偏斜敏感，单值不自描述 | 同时报 κ_QW + AC1 + raw_agree + 边际分布 + 区间；本轮复算边际跨度 0.035 | §4.2.1 禁令三、§4.2.4 |
| **J-21** | 0.70 与项目自有文献冲突（ADR-002 的 QWK 0.59 / 加锚点后 0.65） | **不调阈值，补锚点**——`rubricHints` 接线正是 ADR-002 的路径 | §4.3.4、§4.5.3 |
| **J-22** | 达标判定阈值跑在「人机一致性最差」的量纲上（1–10 的 ICC 0.805） | 达标线定义在 1–10 保留，但**材料里主动说**「1–10 是本项目测得人机一致性最低的量纲，这是保守选择」 | §4.3.4、§4.11.1 L3 |
| **J-23** | 0.825 不能直接套用（胜者诅咒 + 三族均值 + 跨域） | 阈值按域分档；**0.70 甚至低于 ELBench 全部五个候选** ⇒ 从材料与代码中删除 | §4.3.2 |
| **J-24** | 被引论文的对策（few-shot calibration 把模型拉到人类评价轴）被整段丢掉 | **补「修 judge」的一步** = `rubricHints` 接线；「有测量无修复」的缺口补上 | §4.5.3 |
| **J-25** | 最便宜的修法已在题库里但接线为零 | **0.5 人日接线**：接口字段 + 函数改动 + 透传 + 单测 + 门禁；零新增标注成本 | §4.5.1–§4.5.4 |
| **J-26** | 照搬 N=9 投票进生产成本 54×/题，且投票不改变离散度 | **生产恒 1 票，校准测与生产同构的配置**；投票是另一个实验、另一个数字 | §4.6 连带影响 3、§4.2.8 |

#### 4.12.3 P2（2 条）

| 编号 | 处置 | 落点 |
|---|---|---|
| **J-27** | 不记 `model_version` / `rubric_version` / `prompt_hash` / 温度，κ 漂移无法归因 | `calibration_runs` 强制这 5 个字段；另在 `calibration_labels` 记逐 item 的 provider/model（降级链会污染校准） | §4.2.6、§4.6 连带影响 2 |
| **J-28** | κ 的单元（人 vs 人？人 vs judge？双人均值 vs judge？）未定义 | **κ(judge,H1) 与 κ(judge,H2) 分别算、分别对着单个真人报告；禁止把两人取平均当参考**（Geometry 论文警告：平均参考会「讨好 judge 若干度」） | §4.2.4 |

#### 4.12.4 与既有裁决条目的对接

| 条目 | 本节的关系 | 结论 |
|---|---|---|
| **M-08**「达标判定四条件在代码中一行都没有，其依赖的『一致率』是死代码」 | 本节给出**三条件全文 + `qualification.ts` 的签名与 `null` 语义**（条件缺失时返回「无法判定」，绝不返回 `false` —— `false` 会被渲染成「未达标」，是假阴性） | **承接**。本节把 M-08 的「1.5 人日」拆成三块：条件实现（`qualification.ts`，1.0）、稳定性守卫（0.5）、校准工具链（§4.2.7，3.5）。**校准工具链是新工作，不在 M-08 的 1.5 人日里** |
| **M-15**「一致率算错了对象」 | 本节 §4.7 给出 3 个缺陷的行级证据 + 4 步修法 + 3 个 mock 评分器的验收 | **承接并细化**：M-15 的 1.0 人日（`summarizeRunsByCase` + 区分度护栏）**必须先于** §4.7.3 的四个监控信号上线 |
| **M-16**「参考答案裁剪在生产路径是死代码」 | 本节把 M-16 提为**校准的前置（S0）**：裁剪后单次 2050 → 1750 token，120 次从 246k 降到 210k | **承接并前置**。M-16 的 0.5 人日（`adaptReference` + `extractScoringHints` 接线）在本节是 **S0 阻塞项**，不是并行项 |
| **M-19**「评分输入无长度上限，长回答 → 截断 → 记 0 分」 | 本节的 κ 计算里，**parse 失败的维度从 κ 计算中剔除（记为 missing，不是「不一致」）**；校准样本排除 `answer_len > 2500` 字符 | **承接**。这与 §4.2.7 S0 的 fail-open 是同一件事的两面：生产侧 fail-open，校准侧剔除 missing |
| **P2-11**「题库支撑度不足（每域每档约 1.4 题）」 | 本节校准集**按 difficulty × type 分层，不按 industry**；材料里写明「本次校准不覆盖岗位域维度」；岗位基准线保持可编辑 + 理由可见 | **承接** |
| **R-10**（业主方） | = J-07 | §4.6 |
| **R-11**（业主方） | = J-09 + J-10 + J-11 | §4.8 |
| **R-12**（业主方） | = J-08 | §4.7 |
| **R-13**（业主方）「校准集成本仅 0.5–0.75 人日，不砍」 | **本节的真实估计是 3.5 人日 + 2 × 3.5 小时人工标注**（S0 前置 + S1 工具 + S2 样本 + S3 三阶段标注 + S4 判据 + S5 材料）。**0.75 人日只覆盖「跑一次算个 κ」** | **修正业主方的估计**。这个修正必须写进排期，否则校准会在没有工具、没有三阶段标注的情况下被「完成」——那正是 J-01 指出的「更专业的死代码」 |

> **⚠ 跨节口径说明**：§4.12.4 的 3.5 人日是**第二节内部口径**（含 S0 前置 + S1 工具 + 三阶段标注）。§5（排期节）的 N3 按 **1.0 人日**计（决策 #48 把标注素材换成既有 `rubricHints`，零新增人工标注，且把 κ 脚本并入 G14 门禁）。**两者的差额在 §5.2.3 显式化**：一致性席把「人工校准集 + judge-κ 基线」整体估为 1.8 人日（0.6 双人标注 + 0.4 rubric/锚点 + 0.4 κ 脚本 + 0.2 样本 + 0.2 材料），而 §4.2.7 拆出的 3.5 人日中，**标注人工时 2×3.5h ≈ 0.9 人日**、**工具与 S0 前置 ≈ 1.25 人日**、**S4/S5 判据与材料 ≈ 0.5 人日**、**S2 样本设计 0.25 人日**。差异主要来自「工具与 S0 前置」是否单列。**两处不冲突：§5 的 1.0 人日是 W1 增量口径，§4.2.7 的 3.5 人日是完整工作包口径；§5.2.3 的差额表已把两者关系写明。**

---

## 五、第三节 · 赛道路径归位、支付接入与商业化漏斗

> 本节只处理三件事：**作品投哪条赛道、钱怎么接进来、人从哪来。**
> 权威口径一律以官方留存副本为准：`doc_activity-rules.txt`（赛事细则）与 `doc_participation-notice.txt`（活动须知及参赛者承诺），引用一律带行号；官方产品文档（网页应用收款接入指南、Machine Pay 文档、智能收款套件文档）引用本地留存副本的文件名与行号；项目内部文档与源码引用文件路径与行号。
> 本节承接业主方交叉裁决的 P0-1~P0-7 与 R-1~R-5，并对支付与商业化席（`trialroom/review/09-payment-commercial.md`）的 A1~A4、PC-01~PC-18 逐条落点。

### 5.1 赛道路径归位：作品必须落在 Vibe Pay 主赛道

#### 5.1.1 三条原文，锁定赛道边界

**第一，赛道表本身。** 细则 `:42-73` 把赛道分成「主赛道」与「特殊赛道」两栏：

> `:49-56`　主赛道｜**Vibe Pay**｜可接入的 AI 付产品：**Vibe Pay-基础收款能力 / Vibe Pay-智能收款套件**｜作品应用形态：网页应用（包含 web 及 h5）、移动 APP、桌面应用、闪应用（暂仅支持灵光平台）
> `:62-64`　特殊赛道｜**Machine Pay**｜可接入的 AI 付产品：**Machine Pay-AI 按量付费**｜作品应用形态：不限

**第二，计入口径。** 细则 `:164-168` 逐条写明 Vibe Pay 赛道怎么算人数：

> `:164`　Vibe Pay 赛道的参赛作品：
> `:165`　如您接入的是【Vibe Pay 智能收款套件】，作品的累计完成有效交易的去重用户数**可直接计入统计**；
> `:166`　如您接入的是【Vibe Pay 基础收款能力】，需通过以下任意一种方式开通对应的收款产品后，您的参赛作品的累计完成有效交易的去重用户数**才能计入统计**：
> `:167`　方式一：在支付宝 AI 付官网（https://aipay.alipay.com）开通【**网页应用收款**】或【移动应用收款】
> `:168`　方式二：通过【支付宝 AI 付接入 Skill】，在 Agent 调用 Skill 的会话中一站式开通【网页应用收款】或【移动应用收款】

**这两行是本节的第一块基石。** `:165` 与 `:166` 是两条**互斥的计入口径**：接【智能收款套件】直接计入；接【基础收款能力】必须**额外开通**【网页应用收款】或【移动应用收款】才计入。而【Machine Pay】在 `:164-168` 里**一次都没出现**——它不在 Vibe Pay 赛道的计入口径内。

**第三，奖池与获奖上限。** 细则 `:83-96`：Vibe Pay 主赛道一等奖 ¥30,000×1 + 二等奖 ¥15,000×3 + 三等奖 ¥5,000×5 = **奖池 ¥100,000、9 个奖**。细则 `:110-114`：Machine Pay 特殊赛道最佳探索奖 **¥10,000×1**。细则 `:127`：

> `*同一赛道内，一位参赛选手（个人报名）/一个参赛团队（团队报名）最多仅有1个作品可获奖`

细则 `:132`：

> 专业评审团按下表四个维度，对每个提交且通过审核的作品打分，综合得分排序取**TOP30**晋级决赛

**把这三条合起来算，赛道不是「选哪个都行」的字段，而是一笔算得清的账：** 同一赛道最多 1 件获奖，所以多投一件同赛道作品买的不是第二个奖，是 TOP30 的概率冗余；而 Vibe Pay 有 9 个奖、¥100,000 奖池，Machine Pay 只有 1 个奖、¥10,000。**换赛道不是改字段，是换奖池、换概率。**

#### 5.1.2 研究终稿写错在哪，为什么它是最严重的一条

研究终稿 `final_turn_001.md:43` 写：

> 由此得到三条定论：支付只走支付宝 **Machine Pay** 一条轨道；分账本期不做……

`final_turn_001.md:155`（§六 首句）：

> 支付只走支付宝 **Machine Pay** 一条轨道。x402 协议本身是成熟的，但双轨会直接破坏统计口径……

`final_turn_001.md:173`（§七）：

> **支付集成（25%）** Machine Pay 单轨加 MCP 按次计费是官方原生形态，不需要自造协议层。

**同一篇文档里，自相矛盾已经出现**：`:23`（§二 四问定论）写的是

> 我方决断是走「**自建 + 网页应用收款**」

而项目索引与已合并的 08 号方案都站在「自建网页应用收款」这一边（`00-当前状态索引.md` 决策 #13「本轮只做 Vibe Pay 赛道、只交 Tryout 一个作品」）。终稿的主线把 Trialroom 推向了特殊赛道。

**但真正的硬伤不是「文字不一致」，是物理上不成立。** Machine Pay 的完整时序是（`mp_MACHINE_PAY.md:18-20`）：

> 商家服务端返回 `402 Payment Required`，通过 `amtPaymentLink` 响应头传递预下单号。
> 智能体将支付信息交给支付宝支付能力，用户确认后完成付款。
> 智能体携带 `Payment-Proof` 再次请求商家资源，商家调用支付宝接口验证支付凭证。

**买单人的浏览器点击路径在这条链路里不存在。** 由此推出三条连锁后果：

1. **¥0.01 首单 / ¥3.9 单次 / ¥9.9 房间共享包这一整套面向求职者的定价，在 Machine Pay 上无法实现。** 没有「用户在网页上点支付按钮」这一步。
2. **Machine Pay 产生的付费用户是「被 agent 代付的用户」**，而细则 `:152-155` 在商业化成熟度栏评的是「**是否获得真实、有效的付费用户**」。一堆 402 响应在这栏是**减分项**，不是加分项。
3. **支付集成度 25% 的四个评分点被整段绕开。** 细则 `:144-150` 的原文是「用户能否理解『为什么需要付费』」「从用户触达产品 → 体验核心功能 → 发起支付 → 完成付款 → 获取交付物，整条链路是否端到端可用」「支付成功/失败/退款的反馈是否清晰」「付费后用户能否及时获得对应的服务或内容」。这一整栏描述的是**人类用户在网页上的四段链路**，与「agent ↔ 402 ↔ 支付凭证」不构成对应关系。

> **x402 的结构性排除理由（吸收核验报告 verify-payment S5-1 / PC-12）**：x402 的买方是 agent + facilitator，**付款人不是支付宝实名自然人**，在结构上无法进入「累计完成有效交易的去重用户数」；且 x402 本身不是支付宝 AI 付产品，不产生可计入的交易。**因此 x402 不进入本方案**。留的灵活性是：Machine Pay 本身也是 AI 付产品，若将来另立独立作品，x402 式按量付费可作为其技术形态。

#### 5.1.3 归位结论与对照表

**Trialroom 只投 Vibe Pay 主赛道，只接网页应用收款。** 对照表如下：

| 维度 | **Trialroom（本方案唯一参赛作品）** | 第二件作品（可选，本期不做） |
|---|---|---|
| 作品 | Trialroom 试镜间 | Tryout 题目生成 API（索引决策 #9） |
| **赛道** | **Vibe Pay（主赛道）** | Machine Pay（特殊赛道） |
| **支付产品** | Vibe Pay **基础收款能力** → **网页应用收款** | Machine Pay - **AI 按量付费** |
| **买方形态** | **人类求职者**（浏览器内完成支付） | **AI 智能体**（402 → `amtPaymentLink` → `Payment-Proof`） |
| **收款账号** | **报名组长（队长）的支付宝账号** | 同一账号下的独立 `service_id`（服务市场注册） |
| 计入统计的路径 | 细则 `:166-167` **方式一**：在 aipay.alipay.com 开通【网页应用收款】 | 按量付费交易，无额外上架要求 |
| **作品链接** | 独立一条赛道提交 | **不共用 Trialroom 的作品链接** |
| 商业化叙述 | **计入** | **不计入**（agent 付费用户不是「真实、有效的付费用户」） |
| 本方案是否投入 | **是，全量投入** | **否，本期不做**（11/25 止损线后若加投，另立排期） |

**「收款账号」这一列不是可选项，是硬约束。** 细则 `:9`：

> 个人或团队组长需登录支付宝账号完成报名，支付宝账号需完成手机号码绑定且已完成支付宝实人认证

细则 `:17`：

> 请确保您登录报名系统时使用的支付宝账号，与参赛作品中接入AI付产品的支付宝账号为同一账号，以免影响参赛资格校验及作品评选

细则 `:128`：

> `*奖金将发放至报名登录账户内`

细则 `:10` 进一步规定「同一身份证号、同一支付宝账号、同一手机号码、同一设备终端，满足以上任一条件均视为同一参赛选手」。**结论：2 人团队里，只有组长那一个支付宝账号是合法收款主体；队长的账号必须同时承担「报名 + 实人认证 + 接入 AI 付 + 收奖金」四重角色。**

**关于「不共用作品链接」这条的证据等级必须说清楚：** 「同一作品不得跨赛道重复投稿」出自官网「参赛规则」（`官方规则原文与限制清单.md` §1.3 第 2 条），**不在细则留存副本内**，需在控制台复核。即便该条不成立，「Machine Pay 走 402 链路、与 Trialroom 的交付物完全不同」这一点也足以要求两件作品分开陈述——**分开陈述的成本为零，共用链接的成本是作品归属被质疑。**

#### 5.1.4 进参评材料的话术

**一句话版（放在支付集成度 25% 段落的开头）：**

> Trialroom 是一件面向真实求职用户的**网页应用**作品，走 **Vibe Pay 主赛道的网页应用收款**能力（Vibe Pay 基础收款能力 → 官网开通【网页应用收款】）；买方是**真实的人类求职者**，收款账号是**报名组长已完成实人认证的支付宝账号**。Machine Pay 的按量付费属于另一件独立作品，不在本作品的支付链路内，其 agent 付费用户不计入本作品的商业化叙述。

**三句版（支付集成度 25% 段落主体，每句对一条评分点）：**

| 句 | 承接的评分点（细则 `:144-150` 原文） |
|---|---|
| ① **付费点**：¥0.01 首单买到的是**付费档全部权益**（1 场完整模拟 + 逐题复盘报告 + 1 场多人房间 + 达标线自定义 + 历史回放），**不是「多一次练习」**；每人限 1 次，绑定实名 + 手机号 | 「付费点的设计是否与产品价值自然衔接，用户能否理解『为什么需要付费』」 |
| ② **链路**：落地页 → 免费层完整做完 1 场 → 查看复盘 → 付费页 → 支付宝支付 → **异步通知验签 + 四项二次校验** → 权益到账 → 立刻可用 | 「从用户触达产品 → 体验核心功能 → 发起支付 → 完成付款 → 获取交付物，整条链路是否端到端可用」 |
| ③ **交付与退款**：¥3.9 及以上开放退款，**¥0.01 首单因系统原因失败按「不扣次数、当场补发一次」处理**；退款手续费按官方规则不退，已在文案中明示 | 「支付成功/失败/退款的反馈是否清晰」＋「付费后用户能否及时获得对应的服务或内容，交付物是否与承诺一致」 |

**材料里不要出现的话：「Machine Pay 单轨」「按量付费」「分账」「让指标变得干净」。** 最后一句尤其要删——它占用的是一个 25 分的位置，讲的却是数据模型整洁性（详见 §5.7.1）。

#### 5.1.5 赛道归位的两个未闭合项

| # | 未闭合项 | 依据 | 动作 | 负责人 | 截止 |
|---|---|---|---|---|---|
| 1 | 官网「同一作品不得跨赛道重复投稿」是否成立 | `官方规则原文与限制清单.md` §1.3 第 2 条（**不在细则留存副本内**） | 控制台截图复核；无论成立与否，两件作品分开陈述 | 队长 | 10/28 |
| 2 | 「同时接入【智能收款套件】与【网页应用收款】的用户数是否合并统计」 | 索引 §十一·补 官方待确认清单第 3 条 | 官方群提问 | 队长 | 10/28 |

### 5.2 ¥0.01 的依据纠正与首单档位语义

#### 5.2.1 研究终稿把最强的一条依据引到了最弱的产品上

终稿 `:49` 写：

> 间接证据有三条且方向一致：Machine Pay 服务单价区间官方写明 **0.01 元 ≤ 单价 ≤ 50 元**；官方线上验证清单写「可使用小金额如 0.01 元」；官方 Skill demo 的商品价就是 ¥0.01 立即支付。

**「0.01 ≤ 单价 ≤ 50 元」这个区间出自 Machine Pay 文档——但本地留存的官方 Machine Pay 文档并没有写这个下限。** 官方原文是（`docs_ai-receive_api-list_alipay-aipay-agent-payment-precreate.md:25`）：

> | `amount` | 必选 | string [1,32] | 接口付费金额，单位元；**不超过 50 元** | `0.01` |

**只有上限与一个示例值，没有下限。** 唯一写出「0.01 ≤ 元/次 ≤ 50」这句话的是**我们自己的** `Machine-Pay-实现指南.md:77`（服务注册：类型限 Restful 接口或回调接口；服务名 + 服务地址 + 单价（0.01 ≤ 元/次 ≤ 50）+ 描述）——**这是项目内部文档，不是官方原文**，不能拿来当官方依据。

> **唯一性表述修订（吸收核验报告 verify-payment S5-5）**：除项目内部文档 `Machine-Pay-实现指南.md:77` 外，`research/pricing-anchors-2026.md:55` **也把该区间写作「官方口径」**——该表述同样不可用作官方依据，**本稿一并纠正**。

#### 5.2.2 真正写死下限的是网页应用收款

官方《AI 网页应用收款》接入指南，本地留存副本 `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:235`：

> | total_amount | **必填**，订单总金额，单位为元，精确到小数点后两位，**取值范围为 [0.01,100000000]。金额不能为 0。** |

**这才是 ¥0.01 的官方依据，而且它比 Machine Pay 那条硬得多**——它是接口参数表的取值范围，是协议层的硬约束，不是产品介绍里的区间描述。对照表：

| 项 | 研究终稿引的（`final_turn_001.md:49`） | 本节改用的 |
|---|---|---|
| 出处产品 | Machine Pay（`precreate` / `mp_MACHINE_PAY.md`） | **网页应用收款**（接入指南 `:235`） |
| 官方原文 | 「不超过 50 元」+ 示例值 `0.01`（`precreate:25`） | 「取值范围为 [0.01,100000000]。**金额不能为 0。**」 |
| 有无写死下限 | **否**（下限 0.01 是示例值 + 我们自己的实现指南 `:77`） | **是**（协议层参数约束） |
| 结论可依赖性 | 弱（产品介绍口径，且产品本身要移出本作品） | 强（本作品实际使用的通道） |

#### 5.2.3 兜底语义必须重写：没有更低的档

终稿 `:183` 与设计文档 §7.1.4（`Trialroom-全量设计方案.md:1830`）都写了同一句兜底：

> 兜底不变——首单价格写在配置里一处，若确认小额不计即刻切 ¥0.1。
> **兜底条件**：若官方群确认「小额订单不计入有效交易」统计，立即切到 ¥0.1 元……切换成本只有一处配置。

**这句话在「0.01 是通道物理下限」的前提下是错的。** 修正后的语义链是：

1. **¥0.01 是这条通道的物理下限。** `total_amount` 精确到小数点后两位、取值范围 `[0.01, 100000000]`、金额不能为 0 → **不存在「比 0.01 更低但仍合法」的档位**。
2. **所以「切 ¥0.1」不是微调，是首单档位的语义变化。** ¥0.01 在用户心智里是**引流钩子**（「一分钱试一次」）；¥0.1 不是——它是一个**看起来像真实商品价格的低档**。两者的心理预期、点击动机、乃至退款敏感度都不同。
3. **因此需要的是两套首单文案，而不是改一个配置。** 配置改一个数只占工作量的一小部分；文案要改落地页首屏、付费页标题、分享卡文案、小红书选题标题、以及参评材料里描述首单的那句话。

**两套首单文案对照（必须两套都写好，不能等官方答复才动笔）：**

| 要素 | A 案（¥0.01，默认） | B 案（¥0.1，官方确认小额不计后启用） |
|---|---|---|
| 主标题 | 「**一分钱**练一次完整 AI 面试」 | 「**首单体验价 ¥0.1**：1 场完整模拟 + 逐题复盘」 |
| 价值锚点句 | 「一分钱＝一次真实付款的行为证明，不是白嫖」 | 「¥0.1 是一次真实商品的价格，我们用它换你的第一次付费行为」 |
| 交付物列举 | 1 场完整模拟 + 逐题复盘报告 + 1 场多人房间 + 达标线自定义 + 历史回放 | 同左（**交付物一字不改**） |
| 付费页按钮 | 「支付 ¥0.01」 | 「支付 ¥0.1」 |
| 分享卡标题 | 「1 分钱练一次 AI 面试」 | 「首单 ¥0.1 练一次 AI 面试」 |
| 参评材料表述 | 「我们用 ¥0.01 作为首次真实付款的门槛」 | 「我们用 ¥0.1 作为首次真实付款的门槛」 |
| 切换动作 | — | 改 1 处 SKU 配置 + 换 5 处文案 + 更新落地页缓存 + 重发 1 条小红书 |
| 切换成本估计 | — | **0.5 人日**（文案与配置各半），非 0 |

**注意这 0.5 人日的成本不对称性：** 备 B 案要花 0.5 人日，不备要花的风险是「官方答复到达时已经过了 11/12 首单窗口」。**所以 B 案文案必须在 W1 就写好，而不是等群里回话。**

#### 5.2.4 个人收款主体可用

同一份接入指南 `:2`：

> 适用于在商家网页应用中使用支付宝支付功能，**支持个人收款场景**。

（智能收款套件侧的准入条件同样写「支付宝个人账号、支付宝企业账号」，见 `docs_md/docs_vibe-pay_nowpay_nowpay-intro.md:62-64`。）

**这是一个原方案里没有的正面结论：不必为营业执照再耗 1–3 周。** 原先的潜在阻断链是「网页应用收款是否必须有营业执照 → 需要个体工商户 → 办照 1–3 周 → 12/09 之前可能来不及」，这条链**在官方原文层面不成立**。工作分解表里的「开通与签约入驻」因此可以按 **0.5–2 人日**估，而不是「办照 1–3 周 + 开通」。

**但有一个前置仍然成立且不可省：实人认证。** 细则 `:9` 要求报名账号「已完成支付宝实人认证」，且 `:10` 明确「实人认证身份为港、澳、台或外籍身份暂未能报名参与大赛」。**这是报名侧的前置，与收款侧的个人收款能力是两件事，不能互相替代。**

### 5.3 付费真实性：从「刷量无效」到「证据链工程」

#### 5.3.1 原文限定的是统计归属主体，不是用户去重键

终稿 `:57` 写：

> 有效交易是笔数还是去重人数。是去重人数。……统计主体绑定「报名时实人认证的账户」这一条，意味着**小号刷量无效**，中途换号等于前功尽弃。

**前半句对，后半句是把两件事混为一谈。** 细则 `:162-163` 的原文是：

> `:162`　数据统计口径说明：
> `:163`　同一赛道内，按参赛选手（个人/团队）**报名时实人认证的支付宝账户**、在2026年9月21日至2026年12月9日期间的、累计完成有效交易的去重用户数计算，**以主办方关联公司的系统记录及计算口径为准**；

**逐字读一遍这句话：它限定的是「哪一笔交易记在参赛者名下」（统计归属主体 = 报名时实人认证的支付宝账户），它完全没有规定「买方侧的『去重用户数』按什么键去重」。** 全文检索细则与承诺书：「去重」只出现在 `:155` 与 `:163` 的结果表述里；判定标准（退款、异常交易、跨产品重复、同一自然人多账号）**均未披露**。

**唯一的官方间接证据，指向的却是「商户侧」而不是「买方侧」。** 索引 `:144` 记录官方激励计划第 2 期起的合并规则为「**同一实名账号下**按量付费 + 网页应用收款 + 移动应用收款的交易用户可合并统计」——这里的「实名账号」指的是**收款方（参赛者）的实名账号**（因为同一个人在【基础收款能力】、【网页应用收款】、【移动应用收款】下会开多个产品号，要合并的是**他的**交易）。**主办方的数据模型里「实名」是按商户侧理解的；没有任何证据表明买方侧按实名去重。**

**所以终稿那句「小号刷量无效」既没有原文依据，也不是一个安全的假设。** 正确的表述是：

> **去重键未披露。我们不依赖「刷量无效」这一未经验证的假设，而是主动规避——因为刷量是资格级风险。**

#### 5.3.2 刷量的后果是资格级，不是分数级

原方案把刷量当「无效」（= 不加分），这是**降了一个量级**。原文是：

> 细则 `:15`　合规性：不得违反法律法规及支付宝平台规则，**违规、虚假交易及刷量数据将被剔除**。

> 承诺书 `:25`　遵守大赛规则，**不以作弊、恶意刷取数据**、干扰评审、恶意投诉、攻击系统或其他不正当方式影响大赛正常开展。

> 承诺书 `:27`　对于违反本须知、大赛规则或相关法律法规的行为，主办方可根据违规行为的性质、情节及影响程度，采取包括但不限于限制或中止参赛、**取消参赛资格、取消晋级资格、取消获奖资格、追回已发放的奖金**等处理措施。

**风险等级对照：**

| 风险 | 判定依据 | 后果 | 量级 |
|---|---|---|---|
| 刷量被判无效 | 终稿 `:57` 的推论（**无原文依据**） | 不加分 | 分数级 |
| **刷量被查实** | 细则 `:15`「剔除」+ 承诺书 `:25`「不以恶意刷取数据」+ 承诺书 `:27`「取消资格 / 取消晋级 / 取消获奖 / **追回已发放的奖金**」 | **取消参赛资格、取消获奖资格、追回奖金** | **资格级** |

**这两个量级之间隔着的不是分数，是整届参赛资格和已经到手的奖金。**

#### 5.3.3 主动规避的正确形态：证据链工程

既然去重键未披露、刷量后果是资格级，那么我们唯一能控制的变量是**「让主办方在复核时看到的每一笔都是真的」**。这不是侥幸工程，是证据链工程。三段可追溯：

```
orders（谁付的、付了多少、什么时候、走的哪条通道）
   ↓  order_id 外键
entitlements（这笔钱换到了什么权益、消耗了多少、什么时候到期、是否被撤销）
   ↓  交付记录
交付物（用户实际拿到了什么：1 场完整模拟 + 逐题复盘报告 + 权益发放时间戳）
```

**判据：每一笔订单都必须能回答「这个人拿到了什么」。** 答不上来的订单（`orders` 有、`entitlements` 无、或 `entitlements` 有但无交付记录）在日终自查里就是待查项。

**这条链在数据库里已经有一半。** `trialroom/db/001_platform_schema.sql`：`orders`（`:84-105`，含 `out_trade_no` / `amount_cents` / `status` / `channel` / `idempotency_key` / `trade_no` / `refunded_at` / `raw_notify`）、`entitlements`（`:114-126`，含 `order_id` 外键 / `total_uses` / `used_uses` / `revoked_at`）、`idempotency_keys`（`:131-139`）、以及统计视图：

> `:455-465`　`CREATE VIEW IF NOT EXISTS v_paid_user_stats AS SELECT o.user_id, COUNT(DISTINCT o.order_id) AS paid_orders, SUM(o.amount_cents) AS total_cents, MAX(o.paid_at) AS last_paid_at FROM orders o WHERE o.status IN ('paid','delivered') AND o.refunded_at IS NULL GROUP BY o.user_id;`

**这个视图的 `WHERE` 条件本身就是我们的口径声明：有效交易 = 已支付/已交付 + 未退款。** 材料里直接引用这段 SQL，比任何文字声明都硬——「我们的口径就写在这里，主办方可以照着复核」。

**缺口：生产代码里支付实现为零。** 在 `tryout_pr_src/Tryout-fix-83-issues/server/` 全仓检索 `payment|entitlement|alipay|trade|orders|purchase|checkout`（不区分大小写）→ **零命中**。即：表建好了，路由零、服务零、测试零。**§5.5 的全部工作量就是把这个缺口填上。**

#### 5.3.4 《付费真实性内控》要点

**内控文档落点：`trialroom/research/payment-authenticity-controls.md`（新建，0.5 人日），并在 `trialroom/plans/` 的 operating rules 里加一条硬约束。**

| # | 内控项 | 具体要求 | 可验收形式 | 责任人 |
|---|---|---|---|---|
| 1 | **零自购** | 团队成员、亲友、任何与团队有直接或间接利益关系的账号，**不得在生产环境产生任何付费订单**（唯一例外见 §5.6 的首单，且该笔订单在材料中单独标注） | 日终自查：支付人支付宝账号 ∈ 团队成员名单 → 告警 | 队长 |
| 2 | **零互刷** | 不组织任何形式的代付、批量下单、"帮你下一单" | 团队 operating rules 书面一条 | 全员 |
| 3 | **零测试单进生产** | 所有联调在**沙箱**完成；生产环境的每一笔订单都必须对应一次真实练习会话 | `orders` ↔ 会话记录双向可查，缺一即告警 | 队友（支付） |
| 4 | **首单后立刻关闭测试通道** | 首单跑通后 24 小时内关闭沙箱/测试开关，`PAYMENT_ENABLED` 之外不保留任何"测试价"入口 | 关闭操作的时间戳 + 开关日志 | 队友（支付） |
| 5 | **首单例外登记** | 团队成员首单在 `orders` 上打标 `is_internal_verification`，**在参评材料中如实写明**「首笔真实交易由团队成员完成，用于验证链路；正式统计自 11/22 对外开放起算」 | 材料中出现这句 + 订单打标 | 队长 |
| 6 | **同形订单聚类自查** | 每日跑一次：同设备指纹 / 同金额密集 / 同分钟多笔 → 告警人工复核（防无意中形成刷量形态） | 日终自查报告（脚本 0.3 人日） | 队友（支付） |
| 7 | **实名 + 手机号 + 每人限 1 次** | 首单档三重绑定；订单打 `is_first_order` 标记 | 设计文档 §7.1.4 已有两条（`:1832`），接回实现 | 队友（支付） |
| 8 | **首单必须真实交付** | ¥0.01 = 1 场完整模拟 + 逐题复盘报告 + 1 场多人房间 + 达标线自定义 + 历史回放，**不得只发体验券** | 交付物清单与 `entitlements.kind` 对齐 | 队友（支付） |
| 9 | **抽样复核** | 每周抽 10 笔订单人工复核交付证据 | 复核记录表 | 队长 |
| 10 | **对外宣称口径** | 对外公布的付费用户数**一律按「非团队成员的真实付费用户」口径**陈述 | 材料与作品页文案一致 | 队长 |

**第 10 条是这一节最容易被忽略、但对评审最有价值的一条。** 主办方侧我们无法把那 1 笔团队成员订单从系统记录里减掉；我们能控制的是**不夸大**——对外说「≥N 个真实付费用户」时，那 N 个是可逐笔复核的外部用户。**主动交出一个「我们知道这 1 笔存在并且已标注」的事实，远好过让评审自己发现。**

#### 5.3.5 合法拉新 vs 刷量的四档判据

终稿 `:57` 的动作栏写「定价与拉新按人头设计，放弃刷量路径」。**方向对，但这句没有定义什么叫「合法拉新」，导致三种性质完全不同的行为在方案里长得一模一样。**

| 行为 | 是否真实交付 | 是否刷量 | 官方后果 | 我们的处置 |
|---|---|---|---|---|
| N 个**互不相识的真实求职者**，各自注册、各自练一场、各自拿到完整复盘报告、各自付 ¥0.01 | ✅ 有交付 | ❌ | 正常计入 | **这就是我们做的一切** |
| 团队成员 + 亲友 N 人，各自的账号各自付 ¥0.01，拿到完整报告 | ✅ 有交付 | ⚠️ **擦边** | 可能被判「非真实、有效的付费用户」，尤其若被识别为关联账号 | **只允许 1 笔**（首单），当天关闭测试通道，并在材料中标注 |
| 同一自然人 N 个小号 | ❌ 无真实需求 | ✅ **刷量** | 细则 `:15` 剔除 + 承诺书 `:27` 取消资格 / 追回奖金 | **禁止**，内控第 1 条 |
| 团队统一代付他人订单 | ❌ 交付对象错位 | ✅ **刷量** | 同上 | **禁止**，内控第 2 条 |

**写进参评材料的数据说明段（这段话本身就是加分项）：**

> 我们按主办方的口径提交去重人数，不做任何人为放大。我们的每一笔订单在本地都可三段追溯（`orders` → `entitlements` → 交付记录），并保留了 `is_first_order` 标记与交付证据索引，便于贵方复核每一笔订单背后都是一次真实交付。首笔验证交易由团队成员本人完成并已单独标注，正式统计自对外开放之日（11/22）起算。

### 5.4 智能收款套件：问题要问对

#### 5.4.1 官方把两条路分开说，终稿把两句读成了一句

终稿 `:81` 写：

> 官方文档写明「接入方式：智能收款套件暂时仅支持创作者通过合作平台接入」，列出灵光、观猹、WeaveFox、QMuse 四家，同时写明「创作者独立接入能力正在准备中」，没有给出时间表。……智能收款套件则保留为「官方文档说准备中、细则说可直接计入」的并列表述写进方案，不押注。

**两句原文都抄对了，但被读成了同一件事。** 官方留存副本 `docs_md/docs_vibe-pay_nowpay_nowpay-intro.md`：

> `:62`　### 准入条件
> `:64`　[支付宝个人账号](https://opendocs.alipay.com/common/02kg61)
> `:66`　2、接入方式：智能收款套件**暂时仅支持创作者通过合作平台接入**
> `:68`　已合作平台包括 灵光、观猹、WeaveFox、QMuse
> `:75`　创作者可前往上述合作平台了解具体接入方式。
> `:77`　有意向提供智能收款套件的平台，可提交合作申请
> `:81`　创作者独立接入能力正在准备中，敬请期待。

（`doc_vibe-pay.md` §3.2 同口径：「当前暂以合作平台为入口……创作者独立接入能力正在准备中，敬请期待。」）

**逐句拆开：**

- 「创作者**独立**接入能力正在准备中」（`:81`）→ 说的是**独立**（不经过合作平台）这条路在准备。
- 「暂时**仅**支持创作者通过**合作平台**接入」（`:66`）+「已合作平台包括灵光、**观猹**、WeaveFox、QMuse」（`:68`）+「创作者可前往上述合作平台了解具体接入方式」（`:75`）→ 说的是**合作平台这条路是开着的**，而且官方当场给了下一步指引。

**「准备中」标注的是「独立接入」，不是「合作平台接入」。** 终稿把这个词挂在了整个智能收款套件上，于是把一条**现在就能走**的路标成了不可用。

**这为什么重要，有三个具体后果：**

1. **丢掉了一条「直接计入统计」的零额外开通路径。** 细则 `:165`：「如您接入的是【Vibe Pay 智能收款套件】，作品的累计完成有效交易的去重用户数**可直接计入统计**」——**不需要额外开通网页应用收款**。
2. **丢掉了一套能省 6–10 人日的现成商业化基础设施。** 智能收款套件原生提供「下单支付、订单管理、权益管理」（`nowpay-intro.md:51`），这正是终稿决定自建的三块（`final_turn_001.md:43`：「需通过……开通【网页应用收款】」的自建理由之一）。
3. **丢掉了一个商品模型。** 套件原生收费模式：「一次性买断、次数、额度、时长」（`nowpay-intro.md:19`；`vibe.html` 表述为「一次性买断、次数包、积分包、时长包」）。终稿 `:188` 把这套商品模型挂到了 **Machine Pay** 头上——**Machine Pay 没有商品模型，只有 `precreate` 的 `amount`（≤50 元/次）**，这是条目错位。

#### 5.4.2 该问的问题与不该问的问题

| | 问题 | 判断 |
|---|---|---|
| ❌ **不该问** | 「智能收款套件能否**独立接入**？」 | 官方已答：「正在准备中」（`nowpay-intro.md:81`）。再问一遍不产生新信息，只是把「准备中」当成了不可用 |
| ✅ **该问** | 「**合作平台路径现在能否入驻？**（灵光 / 观猹 / WeaveFox / QMuse）；入驻审核周期多久；分类配额多少；作品形态与接入要求是什么？」 | 这是**唯一能解锁一条「直接计入统计 + 内置订单/权益」路径**的问题 |
| ✅ **该问** | 「**通过合作平台接入的套件订单，与自建网页应用收款的订单，用户数是否合并统计？**」 | 索引 §十一·补 待确认清单第 3 条；决定要不要双轨都开 |

**特别提示：观猹是本赛事的联合主办方，同时又是 Vibe Pay 四家合作平台之一**（索引 §十 第 2 条：观猹 = 联合主办方 + 统一登录 + 数十万月活 + Vibe Pay 四家合作平台之一）。索引决策 #7 原本就是「独立自建 + **观猹同步发布**」双轨。**这意味着合作平台路径不只是备选，它同时是获客渠道**（§5.7.2 会用到）。

#### 5.4.3 官方群提问清单（6 问必答 + 3 问本节追加）

**必答 6 问（W1 内一次性发出，10/28 前）**

| # | 问题 | 为什么重要（对应官方原文） | 谁答 |
|---|---|---|---|
| 1 | 「累计完成有效交易的**去重用户数**」的**去重键**是支付宝账号还是实名身份？同一自然人多个账号算几人？ | 细则 `:155`/`:163` 只写结果不写判定；决定我们能否用「一人一号」的假设做内控 | 官方 |
| 2 | 「**¥0.01 是否计入有效交易**」？是否存在最低金额阈值？ | 细则未定义；决定首单档是 ¥0.01 还是 ¥0.1/¥1（语义变化，见 §5.2.3） | 官方 |
| 3 | 「**退款 / 异常交易 / 跨产品重复**」如何影响累计人数？退款是否扣减累计人数？ | 官方激励计划的合并范围（索引 `:144`）只在支付宝产品之间；退款扣减与否直接决定「失败自动退次数」会不会自我抵消（§5.9.3） | 官方 |
| 4 | 「**参赛作品提交并通过审核后**」是否意味着**作品未生效则其交易不计入**？ | 细则 `:155` 字面前置 + 官网「先审核，再公开。报名及作品均须通过安全审核后方可生效」（`官方规则原文与限制清单.md` §1.3 第 4 条）→ **11/22–12/08 这 17 天是否计入，是本方案 18 天窗口的一半**（§5.5.4） | 官方 |
| 5 | 「**合作平台路径（灵光 / 观猹 / WeaveFox / QMuse）现在能否入驻**？入驻审核周期、分类配额、接入要求？」 | `nowpay-intro.md:66-75`：这条路现在是开的，但入驻流程与周期未披露 | 官方 / 合作平台 |
| 6 | 「**先提交作品、后补齐参评材料**是否允许？作品提交表单的完整字段是什么？」 | 细则 `:29-31` 把「提交作品、补齐参评材料」写成一个阶段；先交后补是否允许未披露 → 直接决定「11/22 提交审核」与「12/08 补材料」能不能拆开 | 官方 |

**本节追加 3 问（不替代上面 6 问，可同批发）**

| # | 问题 | 为什么重要 | 依据 |
|---|---|---|---|
| 7 | 「**网页应用收款**的**费率**口径？以及『退款时手续费不退回』（接入指南 `:350`）是否同样适用于网页应用收款？」 | 费率目前只能从智能收款套件 doc 的收单产品费率表（JSAPI 0.6%~1%）借用；`网页应用收款接入指南本身未列费率`。§5.9 的成本表依赖这个数 | 接入指南 `:350`；`nowpay-intro.md:91-98` |
| 8 | 「**首次签约收单产品未满 90 日 / 连续交易未满 30 日 → 次日结算**」这条规则是否同样适用于**网页应用收款**？ | 这条规则写在智能收款套件 doc（`nowpay-intro.md:88`）；若同样适用，我们 11/22 的首笔收入 12/09 仍在结算周期内，对「资金到账即可交付」无影响，但**材料里不能把「实时到账」写成我们的承诺** | `nowpay-intro.md:85-88` |
| 9 | 「**同时接入【智能收款套件】与【网页应用收款】的用户数是否合并统计**？」（索引 §十一·补 第 3 条） | 决定双轨是否值得开 | 索引 `:299` |

#### 5.4.4 双轨预案与 `orders.source` 维度

**如果第 5 问的答案是「可以入驻，1–2 工作日」**，则启动**次卡 / 月包走套件、¥0.01 首单 + 房间共享包走自建**的双轨。实现成本很低，因为架构框已经画好了：

- `orders` 表加一列 `source ∈ {self_built, suite}`（现有 `channel` 列语义是渠道：`:93` `channel TEXT NOT NULL, -- self_hosted|watcha|lingguang|weavefox|qmuse`，可复用，但 `source` 表达的是"订单来自哪个适配器"，语义更准）。
- 套件侧的下单 / 权益由**托管适配器**回调写入本地 `entitlements`（设计文档 §4.6.1 的双适配器框已画好）。
- **`entitlements` 仍是前端唯一真相源**（设计文档 §4.6.1「前端只认 entitlements，不关心钱从哪来」），这条架构决策不破。
- 商品模型四类（一次性买断 / 次数包 / 积分包 / 时长包）在**本地做映射**即可，不必依赖套件原生。

**但双轨有一个必须写进材料的代价**：如果走套件，「订单真相源」在套件侧，本地 `entitlements` 变成**镜像缓存**。此时「我们能提供逐笔交付证据链」这句话的强度会下降一档。**因此本方案的双轨定位是「首单档仍走自建（因为首单是我们商业化叙述的主体）」，而不是「全面切套件」。**

### 5.5 支付接入：工作量重估与工作窗口前移

#### 5.5.1 从「3–5 人日」到「15–25 人日」

**施工图给的数：`Trialroom-完整平台实施与参赛施工图-v2.md:169`**

> 前端只认 `entitlements`，不关心钱从哪来。**工时 3–5 人日**（自建轨）；托管轨适配器 B 期做。

**终稿则根本没有估**（`final_turn_001.md:188` 的第 6 项只写「Machine Pay 接入与商品模型」，无工时）。

**按官方《AI 网页应用收款》接入指南逐条拆解**，支付席给出的分解是 11–19 人日（加「开通与签约入驻」0.5–2 后为 12–21），缺口 8–16 人日。**但支付席的表里漏了三项本节认定必须做的工作**，补上后施工口径取 **15–25 人日**：

| 补项 | 估工 | 为什么必须有 |
|---|---|---|
| 付费真实性内控脚本（同形订单聚类自查 + `is_internal_verification` 打标 + 日终报告） | **0.5** | §5.3.4；PC-02 的落点 |
| 第一单剧本执行（三档金额 + 三处截图 + 错误码分流 + 失败清单） | **0.5** | §5.6；PC-09 的落点 |
| ¥0.01 / ¥0.1 双档位 + 两套首单文案 + 兜底开关 | **0.3** | §5.2.3；PC-08 的落点 |
| 沙箱→生产差异修复与四接口回归（支付席把它放在时间线里，未计入表内工时） | 余量 | 沙箱不校验真实风控 / 实名校验，生产必须重跑 |

**结论：施工口径 = 支付席表内 12–21 + 本节补项 1.3 + 回归余量 → 15–25 人日。** 施工图的 3–5 人日**低估了 3–5 倍**。

**这个缺口的去向必须说清楚：它不能从支付里砍。** 08 号合并方案已算出「committed 64.0 人日 vs 产能 64 人日、**缓冲 0**」，支付席据此指出超载幅度将从 34–48% 扩大到 52–77%。

> **⚠ 归属澄清（吸收 verify-payment S5-2 与元复核 verify-verification V-1 的合并结论）**：支付席 `09-payment-commercial.md:630` 逐字写有「committed 64.0 vs 产能 64、缓冲 0 → 超载将从 34–48% 扩大到 **52–77%**」（`:516` 给的是 48–73%）。**席自身两值不一致**，这才是真缺陷。本稿的处理：**保留 52–77% 这个数**，但把归属写清——「**本节以 15–25 人日口径重算为 52–77%**（支付席 `:516` 口径下为 48–73%；席 `:630` 与 `:516` 两值不一致，本方案采用 15–25 人日的重算值）」。

**本节的处置是「砍范围、砍得准」：**

| 节流手段 | 省下 | 代价 | 出处 |
|---|---|---|---|
| **官方 Skill 代劳开通 / 下单 / 沙箱 / 签约入驻**（`npx -y @alipay/alipay-aipay@latest install` 一条命令） | **4–8 人日** | 无 | 接入指南 `:17-19`「Agent 快速集成（推荐）……完成沙箱测试，并完成签约入驻」 |
| 砍范围（广场 / Skill 市场上传 / WebRTC / 用户上传审核流 / 框架大版本升级 / 题库扩量） | 按索引 §八·补 可砍顺序 | 已在 08 号方案的「明确不做」清单内 | 索引 `:182` |
| 绝不砍 | — | **支付、获客** | 索引 `:182`「房间轮次制、复盘回溯、多用户、支付四项在任何情况下都不砍」 |

> **⚠ 人日—窗口对账（吸收核验报告 verify-payment S3）**：支付工作由**队友 1 人全职**承担，但**扩到 3 人的决策日是 10/30**（§6.2 决策 2）。据此给出两套数：**悲观 15–25 人日（Skill 不代劳）/ 现实 11–21 人日（Skill 代劳开通 + 下单 + 沙箱 + 入驻）**，**排期按 11–21 人日编制，15–25 作为上界风险口径**。窗口对账：
>
> | 里程碑 | 起止 | 可用人日（工作日 × 投入人数） | 悲观口径（25 人日） | 现实口径（21 人日） | 缓解手段 |
> |---|---|---|---|---|---|
> | 沙箱全链路 | 10/27 → 11/06 | 9 工作日 × 1 人 = 9.0 | ❌ **不可达** | ⚠️ 勉强（需 Skill 代劳） | 10/30 扩编到 3 人 → 9 × 3 = 27 人日；或把沙箱验证挪到 W1 与支付契约并行 |
> | 生产第一笔可计量交易 | 10/27 → 11/12 | 12 工作日 × 1 人 = 12.0 | ❌ **不可达** | ✅ 可达 | 同上 |
> | 生产上线 | 10/27 → 11/22 | 19 工作日 × 1 人 = 19.0 | ❌ **不可达** | ✅ 贴边（19 < 21） | 10/30 扩编到 3 人后 57 人日，充裕 |
>
> **因此：§5.5.3 倒排时间线的日期成立，条件是「10/30 扩编通过」或「Skill 代劳到位」。** 若两者都不成立，**必须把 §5.5.3 的日期标为「取决于 10/30 的扩员决策」**，而不是确定语气。

#### 5.5.2 九行工作分解表

| # | 工作项 | 官方接口 / 约束（出处） | 估工（人日） | 不可压缩的原因 | 验收物 |
|---|---|---|---|---|---|
| 1 | **开通与签约入驻** | 细则 `:167`（方式一）/ `:168`（方式二）；接入指南 `:19`「完成沙箱测试，并完成签约入驻」 | 0.5–2 | 审核周期不可控，必须留缓冲 | 控制台**开通**截图 + 日期 + 账号；开通后 48h 内复查一次 |
| 2 | **下单** | `alipay.trade.page.pay`（接入指南 `:49`），RSA2 签名，SDK 生成自动提交表单 | 1–2 | 密钥管理与 `out_trade_no` 幂等规则（`:59`「商家端保证不同次支付 out_trade_no 不可重复」） | 沙箱下单成功 + `out_trade_no` 唯一性断言 |
| 3 | **异步通知 + 验签 + 四项二次校验 + 幂等** | 接入指南 `:57-59`「必须通过验签」「务必核对 `app_id`、`out_trade_no`、`total_amount`」「根据 `trade_status` 处理」；`:240-248` 验签示例 | 2–3 | **这是唯一能证明钱到账的凭证，不可省** | 验签通过日志 + 四项不一致的负例被拒 + 重放不重复发货 |
| 4 | **补偿查询** | `alipay.trade.query`（`:52`「支付结果必须以异步通知或查询接口返回为准」；`:250` 调用示例） | 1–1.5 | 通知丢失必须有兜底 | 模拟通知丢失 → 查询补单演练通过 |
| 5 | **超时关单** | `alipay.trade.close`（`:546`） | 0.5–1 | 否则产生悬挂单与重复支付 | 超时单自动转 `closed`（状态机已有该态：`001_platform_schema.sql:92`） |
| 6 | **退款 + 退款查询 + 权益撤销** | `alipay.trade.refund`（`:329`）、`alipay.trade.fastpay.refund.query`（`:340`）、退款周期 **12 个月**（`:348`）、总退款额 ≤ 实付（`:352`）、**退款时手续费不退回**（`:350`） | 1.5–2.5 | 支付集成度 25% 明评「支付成功/失败/退款的反馈是否清晰」 | 退款三态截图 + `entitlements.revoked_at` 置位 + 12 个月周期在文案中说明 |
| 7 | **对账** | `alipay.data.dataservice.bill.downloadurl.query`（`:632-647`） | 1–2 | **每日累计曲线就是商业化 25% 的证据** | 每日账单与本地 `orders` 对平，差异 < 0 |
| 8 | **前端付费页 + 成功/失败/退款三态反馈 + 交付即时可用 + 并发排队文案** | 细则 `:149`「支付体验：调用支付宝 AI 付的接入是否规范、支付流程是否顺畅；支付成功/失败/退款的反馈是否清晰」；细则 `:148` 链路完整性 | 2–3 | **直接就是支付集成度 25% 的评分点**，不是加分项 | 三态可复现截图；排队时显示「排队中，第 N 位」而不是裸 429 |
| 9 | **沙箱→生产切换 + 密钥管理 + 第一单剧本执行** | 接入指南 `:17-19` | 1–2 | 首单必失败若干次（见 §5.6） | 三处截图（含 `out_trade_no` / `trade_status`）+ 失败清单 + 测试通道关闭证据 |
| | **合计（支付席表内）** | | **11–19**（含第 1 项 → 12–21） | | |
| | **合计（施工口径 = 表内 + §5.5.1 四项补项 + 回归余量）** | | **15–25** | | |

#### 5.5.3 倒排时间线：解决三个互斥的支付日期

**矛盾原文。** 三份文件给出三个互斥日期：

| 文件 | 原文 | 日期 |
|---|---|---|
| `00-当前状态索引.md` §八 W3 行（`:158`） | 「沙箱联调 + 签名与履约校验 + 权益校验接入前端……**支付跑通**」 | **11/10–11/16** |
| `00-当前状态索引.md` §八 分工建议（`:169`） | 「**队友做支付（11/18–12/3，纯工程）**」 | **11/18 开始** |
| 索引决策 #37（`:202` 止损线） | 「**收款生产上线**（不是 12/01）」 | **11/22** |

**按 15–25 人日算，支付负责人 11/18 开工 → 11/22 上线 = 4 天做 15–25 人日，不可达。** 因此支付窗口必须前移到 **10/27**。

**倒排时间线（T-pay = 统计意义上的上线 = 第一笔可计量的真实交易落库；T-demo = 演示意义上的上线 = 房间 + 分享卡 + 供应商卡齐备）**

| 行标 | 日期 | 硬动作 | 负责人 | 验收物 |
|---|---|---|---|---|
| **T-44** | 10/26 | ①**拍板 A1**（对照表 §5.1.3）②**发出官方群 9 问**（§5.4.3）③启动**域名 + ICP 备案提交**（索引 §八·二 第 1 条：1–3 周，全程最长前置）④**两套首单文案**（A/B 案）写完 ⑤ 控制台申请 `service_id`（若做 Machine Pay 独立作品） | 队长 | 问题清单发出截图 + 文案稿 |
| **T-43 ~ T-36** | **10/27 – 11/02（W1）** | ①**报名**（团队报名、组长代报、实人认证 + 手机号绑定，细则 `:9`）②**报名当日抄作品提交表单全字段**（影响力 20% 的准绳）③**开通【网页应用收款】**（是「开通」，不是「核对」；细则 `:167` 方式一）④**支付适配器开工（10/27）**⑤付费真实性内控文档定稿 | 队长 + 队友 | 报名成功截图 + **开通截图** + 表单字段清单 + 内控文档 |
| **T-35 ~ T-30** | 11/03 – 11/05 | 订单状态机（`created/pending/paid/delivered/refunded/closed/failed`，`001_platform_schema.sql:92` 已有定义；**`refunding` 为本节新增的中间态，需在 `:92` 的注释中补上**）+ `orders`/`entitlements`/`idempotency_keys` 写入 + `alipay.trade.page.pay` 下单 + **验签与四项二次校验** + 前端付费页骨架；**11/05 落地页 + 免费层上线（蓄水开始）+ 小红书第一篇发布** | 队友（全职） | 沙箱下单成功截图 + 落地页可访问 + 首篇发布截图 |
| **T-29 ~ T-25** | 11/06 – 11/09（W2） | **沙箱全链路 11/06 前跑通**：下单 → 支付 → 异步通知 → 验签 → 幂等 → 权益发放 → `trade.query` 补偿 → 退款 → 退款查询 → 关单；并发排队文案；「失败不产生退款流水」版退次数逻辑 | 队友 | **沙箱全链路录屏（≤5 分钟，一镜到底）** |
| **T-24 ~ T-20** | 11/10 – 11/13 | 沙箱→生产差异修复（沙箱不校验真实风控 / 实名校验）+ 正式密钥切换 + 退款/回调/关单/查询四接口回归 + `PAYMENT_ENABLED` 开关演练；**11/12 生产第一笔可计量交易（团队成员真实账号 ¥0.01 首单）→ 24h 内关闭测试通道** | 队友 + 队长 | **三处截图 + 失败清单 + 测试通道关闭证据** |
| **T-19 ~ T-17** | 11/14 – 11/21 | 漏斗六事件埋点可按日导出 + 同形订单聚类自查上线；落地页文案定稿；房间轮次制 v1 + 分享卡；**获客第一波复盘 + 第二波投放（按真实单篇 UV 换素材 / 观猹上架确认 / 校园群铺开）**；**11/22 生产上线（对外收费）** + **同步提交作品版本进安全审核**（使「作品已生效」与收款同日成立） | 全员 | 上线截图 + **提交回执** + 埋点导出 + 渠道真实数据回填表 |
| **T-16 ~ T-9** | 11/22 – 12/01 | 获客第三波（校园/求职群 + 观猹 + 「付费入口开放」传播素材）；增量文案迭代；**12/01 报名截止（细则 `:26`）+ 人数快照（≥20）** | 全员 | 人数快照 + 各渠道真实投放数据 |
| **T-8 ~ T-2** | 12/02 – 12/07 | **T-demo 上线**（房间 + 分享卡 + 供应商卡齐备）；参评材料；作品页素材；作品页提交；**12/07 人数快照（≥30）**；若 < 20 → 材料切方案 B | 全员 | 完整演示 + 材料包 |
| **T-1** | 12/08 – 12/09 | 最终回归 + 提交；**统计窗口 12/09 23:59:59 关闭**（细则 `:30`） | 全员 | 提交回执 + 最终累计曲线（`v_paid_user_stats`） |

**这张表与原计划的关键差异有四条：**

1. **支付窗口从 11/18 前移到 10/27**（PC-05）。理由是 15–25 人日 + 三个互斥日期。
2. **报名从「11/15 前」提前到 W1（10/27–11/02）**。索引 `:143`（决策 #38）已记「报名是控制台开通能力的前置」，而开通还有未知的签约入驻 / 审核周期；把报名压在 11/15，等于把 18 天窗口押在一个 3 天动作 + 一段未知审核上。
3. **新增 11/12「生产第一笔可计量交易」这个里程碑**，与 11/22「生产上线」分开定义。
4. **落地页 / 免费层从 W5（11/23–11/30）前移到 11/05**（理由见 §5.7.3）。

#### 5.5.4 「作品已生效」这个字面前置，必须绑进上线定义

细则 `:155` 的整句是：

> 参赛作品**提交并通过审核后**，统计自2026年9月21日至2026年12月9日期间，通过支付宝AI付达成的累计完成有效交易的去重用户数。

细则 `:132` 同样写「对每个**提交且通过审核的**作品打分」。官网另注「先审核，再公开。报名及作品均须通过安全审核后方可生效」（`官方规则原文与限制清单.md` §1.3 第 4 条）。

**这条前置有两种读法，且不由我们决定：**

| 读法 | 含义 | 后果 |
|---|---|---|
| (a) 计数发生在提交并通过审核**之后**，窗口固定为 9/21–12/09 | 窗口内全部交易都算 | 11/22 上线即赚 17 天 |
| (b) 「提交并通过审核后」是**计数的资格前提** —— 作品未生效则其交易无法归属到「参赛作品」 | 11/22–12/08 的交易存在不被计入的风险 | **11/22–12/08 这 17 天可能拿不到**，接近 18 天窗口的全部 |

**在读法 (b) 下，最优策略不是「早收款」，而是「让作品生效的时刻与收款上线的时刻对齐」。** 因此：

1. **「上线」的定义从「收款可用」改成「作品已生效 ∧ 收款可用」**（PC-07）。
2. **在 11/22 上线日同步提交一个可用的作品版本进安全审核**，使两个条件同日成立（时间线 T-17 行已写入）。
3. **「12/08 补齐最终参评材料」与「11/22 首次提交审核」拆开**——细则 `:29-31` 把「提交作品、补齐参评材料」写成一个阶段，先交后补是否允许**未披露**，已列入官方群第 6 问。
4. **兜底**：若控制台确认「必须作品生效后才开始计」，则首次提交审核日期就是统计起点，收款上线必须不早于它 → **两者绑成一个动作，同日执行**。

#### 5.5.5 窗口账：每提前一天 = 多一天累计

| 口径 | 区间 | 天数 | 依据 |
|---|---|---|---|
| 官方统计窗口 | 2026-09-21 ~ 2026-12-09 | **79 天** | 细则 `:155`、`:163` |
| 官方自述「45 天」 | — | 官方文档自己的算术不对 | 索引页眉 / 08 号方案 M-64 已记录 |
| 已丢失 | 9/21 ~ 10/27 | **36 天** | 不可追回 |
| **我们能吃到的（11/22 上线）** | 11/22 ~ 12/09 | **17 天** | 决策 #37 |
| **我们能吃到的（11/12 首单起算）** | 11/12 ~ 12/09 | **27 天** | 本节建议 |

> **⚠ 算术闭合修订（吸收核验报告 verify-payment S4-1）**：「11/22 上线」段由 18 天改为 **17 天**，使 36 + 26 + 17 = 79 闭合。§5.5.4 读法 (a) 行的「11/22 上线即赚 18 天」同步改为 **17 天**。§5.5.5 末段「早 10 天的收益（27 天 vs 17 天 ≈ +59%）」「晚 10 天的损失（17 天 vs 7 天 ≈ −59%）」**已使用 17，无需改动**。

**「每提前一天 = 多一天累计」是本项目唯一的时间换分数杠杆**，但边际效率递减：早 10 天的收益（27 天 vs 17 天 ≈ +59%）远大于晚 10 天的损失（17 天 vs 7 天 ≈ −59%）。**这也正是 §5.6 要求把生产首单压到 11/12 的原因：11/12 那笔虽然只有 1 个人，但它把「我们已经在跑真实交易」这件事提前了 10 天，而 10 天后如果第一单暴露了问题，我们还有时间修。**

### 5.6 第一单剧本

#### 5.6.1 问题的形状：四个新变量同时出现

**2 人团队、零真实用户、零历史交易**的第一笔付款，同时踩四个新变量：

| # | 新变量 | 含义 | 为什么危险 |
|---|---|---|---|
| 1 | **新收款账户** | 新商户、新签约主体 | 首次签约的商户在很多规则上被区别对待 |
| 2 | **新设备** | 我们的服务域名、我们的 Web 环境 | 设备 / 环境指纹 |
| 3 | **新买家** | 第一次给这个商户付款的人 | 新客风控 |
| 4 | **新金额** | ¥0.01 这种极端小额 | 最容易被"金额异常"类规则命中 |

**证据边界必须先说清楚：** 本地留存的官方文档中 `ACQ.MERCHANT_RISK_LIMIT` **零命中**，「风控」「限额」在官方产品文档侧同样零命中。**因此「¥0.01 会不会被风控拦」这件事，本节既不能证实也不能证伪。** 终稿 `:49` 给的三条间接证据（价格区间含 0.01、官方验证清单写「可使用小金额如 0.01 元」、官方 Skill demo 商品价 ¥0.01）方向一致，它们证明 **0.01 是被支持的正常价格**，但**不证明新商户的第一笔 0.01 订单一定能过**。所以下面是一份**失败预案**，不是一份「一定顺利」的剧本。

#### 5.6.2 五步剧本

| 步 | 动作 | 为什么 |
|---|---|---|
| **0** | **先用团队成员本人的支付宝账号完成首单**（队长的账号 = 收款账号 = 报名账号，三重合一，把「新买家 + 新设备」压成一个变量） | 官方文档给的验证清单做法本就是「小金额试一笔」；且这一笔同时把 `out_trade_no`、`trade_no`、验签链路、幂等链路一次性打通 |
| **1** | **准备三档金额**：`0.01`（探底）/ `1.00`（兜底）/ `3.90`（正常价锚） | 一旦 0.01 被规则命中，1 元通常可过；3.90 是真正要验证的产品形态（¥3.9 单次，见 §5.9） |
| **2** | **付款页 + 支付宝返回页 + 回调日志三处截图**，必须含 `out_trade_no` 与 `trade_status` | 事后自证；同时这组截图是参评材料「一笔真实订单的完整链路」的原始素材 |
| **3** | **失败时按错误码分流**（见 §5.6.3） | 避免把「等一天」误判成「等官方回复」 |
| **4** | **如实记录前 N 次失败并写进材料** | 「首笔真实交易因风控被拦，改用 X 后于 T 日跑通」比「一切顺利」更可信；同时它与细则 `:15` 的「虚假交易」形成对照——**我们不是刷出来的** |

#### 5.6.3 错误码分流表

| 现象 | 判定 | 动作 | 禁止的动作 |
|---|---|---|---|
| 风控拦截 / 风险提示 / 提示需更换付款账号 | **风控** | 换付款人（换一位团队成员的真实账号）或**隔日**重试；**同一付款人最多重试 2 次** | 连续快速重试（会累积风控计数） |
| 参数错误 / 商户号不匹配 / 金额与 `total_amount` 不一致 | **参数** | 改配置：`app_id`、`out_trade_no` 生成规则、金额精度到分（接入指南 `:235`） | 把参数错误当风控去等 |
| 额度上限 / 类目不符 / 签约未生效 | **开通** | 问官方群；核对签约入驻状态与商品类目；需要时按接入指南 `:19` 走 Skill 重新签约入驻 | 反复下单试探 |
| 付款页正常、但回调未达 | **通知** | 走 `alipay.trade.query` 补偿（接入指南 `:52`）——**不要重新下单** | 重新下单（会造成两笔支付） |
| 回调到了但验签失败 | **验签** | 检查签名串拼接（空值 key 的 `&` 处理）与密钥是否已切生产 | 直接信任通知内容 |

**这张表同时是研发用的验收清单**：每一行都应该在沙箱里被主动演练过一次，尤其是「回调未达 → 走 query 补偿」和「重复通知 → 幂等不重复发货」两条。

#### 5.6.4 首单之后立刻关闭测试通道

**这是 PC-02 的硬落点。** 时间线 T-24~T-20 行写明：**11/12 首单跑通 → 24 小时内关闭测试通道。**

关闭的具体含义（不是「不再测了」，是「系统里不再有能产生订单的测试入口」）：

| # | 关闭项 | 验收 |
|---|---|---|
| 1 | 沙箱 / 生产双通道切换开关收敛为单一生产态 | 配置项只剩生产态 |
| 2 | 任何"测试价""0 元单""内部账号"入口从产品路径移除 | 全站路径巡检无残留入口 |
| 3 | 内部账号（团队成员）被排除在首单档之外 | 团队成员账号在首单档不可下单（**首单那一笔是人工开的一次性通道，用后即焚**） |
| 4 | 首单订单打 `is_internal_verification` 标记 | 该标记进材料的数据说明段 |
| 5 | 关闭操作留时间戳与操作人 | 内控台账 |

#### 5.6.5 首单失败记录进材料：写法模板

> **首笔真实交易记录（技术验证）**：本作品的第一笔生产环境真实支付由团队成员本人完成（金额 ¥0.01），用于在下单、异步通知验签、四项二次校验、幂等、权益发放全链路上做端到端验证。此前共出现 N 次失败，原因是 ____，于 ____ 调整后于 11/12 跑通。该笔订单在数据中标记为内部验证，**不计入我们对外宣称的付费用户数**；对外统计自 2026-11-22 对外开放之日起算。

**这段话同时做到四件事**：① 展示工程严谨性；② 呼应细则 `:15`「虚假交易」——我们恰恰是最经得起查的那一类；③ 主动交出对自己不利的事实（这在评审那里是信誉）；④ 保护商业化 25% 的数字不被这 1 笔污染。

### 5.7 商业化 25% 的真计划

#### 5.7.1 缺口定位：这个维度在本轮方案里整体消失

**支付席 PC-06 的核验结果（可复现）：**

```bash
grep -n "获客\|漏斗\|UV\|小红书\|渠道" final_turn_001.md   # → 0 命中
```

**零命中。** 而终稿 `:173`（§七 商业化 25%）整段写的是：

> **商业化（25%）** 分账不做、统计口径统一到支付宝一处，反而让"累计有效交易去重用户数"这个指标变得干净。¥0.01 首单负责拉新与破冰，房间共享付费负责客单价，两条产品化路径都清晰。

**三处错位：**

1. **讲的是 0 分的内容。** 细则 `:152-155` 在这一栏评的是「**是否获得真实、有效的付费用户**」。「指标干不干净」是数据模型整洁性，**若付费用户数 = 0，指标干不干净都不影响得 0 分。**
2. **没有数字。** 全文最硬的证据项（一个 N 与一条日累计曲线）在这 25 分的段落里**一个字都没有**。
3. **「两条产品化路径都清晰」是自评。** 路径清晰 ≠ 有人来。评审问的是「这些人从哪来」。

**更严重的是工程侧：终稿 `:181-189` 的本周开工清单 7 项里没有一项是商业化的**（校准集 / MCP 骨架 / CI 门禁 / BYO / 代码提问演示 / Machine Pay 接入 / 核对收款开通状态）。**唯一无法靠写代码提升的维度，被从清单里整体删除了。**

#### 5.7.2 获客渠道清单与 UV 分解

**渠道清单来自索引 §十（`:268-275`），本节补上「起投日 / UV 贡献估算 / 责任人 / 依据 / 风险」五列；各渠道对应的落地页埋点事件见 §5.7.6。**

| # | 渠道 | 起投日 | UV 贡献估算（累计至 12/07）| 责任人 | 依据 | 风险 |
|---|---|---|---|---|---|---|
| 1 | **小红书**（主引擎） | **11/05** | **900 – 1400** | 队长 | 索引 §十 1：「AI 面试」「1 分钱练一次」「简历隐私」「AI 岗 JD」都是能起量的选题；分数卡 + 「简历全程在你自己电脑上」标签天然可晒；2027 届秋招尾声 + 提前批春招启动 | **最不乐观的一个数**：0 star、0 存量用户、无赛道排名的产品。§7.3.2.1 行动项 2 明确要求「用真实发布数据校准」 |
| 2 | **观猹**（次引擎） | 11/10（审核 1–2 工作日） | **150 – 300** | 队长 | 索引 §十 2：联合主办方 + 统一登录 + 数十万月活 + **Vibe Pay 四家合作平台之一**；分类限 3 个 | 审核可能退回；占用一个分类位 |
| 3 | **校园 / 求职群**（高转化） | 11/12 | **150 – 250** | 全员 | 索引 §十 5：秋招季 | 依赖团队人脉，天花板明显 |
| 4 | **即刻 / V2EX / 掘金 / GitHub**（长尾） | 11/17 | **80 – 200** | 队友 | 索引 §十 3：技术岗聚集地；README 挂参赛链接 + 互推 | 技术岗人群对「1 分钱练面试」不敏感，转化率低 |
| 5 | **魔搭 / 秒哒 / 百炼社区**（长尾） | 11/24 | **50 – 120** | 队友 | 索引 §十 4：用百炼才有官方权益与曝光 | 需先用百炼才拿权益 |
| | **合计** | | **1330 – 2270** | | | **见下方诚实性声明** |

**诚实性声明（必须写进方案，不能藏）：** 全部渠道都做到下沿时合计 **1330 < U0 目标 1920**，**验算式不闭合**；做到区间中位（约 1800）仍差 120 UV；闭合依赖小红书「单篇 800 UV」这个项目假设成立（设计文档 §7.3.2.1 路径 A 的推导口径：「靠『每周 3–5 篇小红书』拿 4000 UV = 单篇 800 UV」）。**§7.3.2.1 对这个数自己的评价是「这是整个方案里最不乐观的一个数」——本节沿用这个评价，不粉饰。**

**因此本节把小红书从「渠道」升级为「需要实测校准的假设」**：11/05 起投后**第一篇发布的数据必须在 11/09 前回填到本表**，并据此在 11/12 checkpoint 上重新解一次验算式。**如果单篇 UV < 300，则必须立即切换到「校园/求职群为主 + 观猹为主」的组合，并接受 12/07 人数目标下调。**

#### 5.7.3 分母写死的验算式

**设计文档 §7.3.2.1 已经指出原指标表算术不闭合**（`Trialroom-全量设计方案.md:2044-2061`）：

```
落地页 UV                    2000
  × 落地页→开始练习 25%     →  500  开始练习
  × 完成首次练习 60%        →  300  完成
  × 首次→查看复盘 50%       →  150  看了复盘
  × 首次→首次重答 30%       →   90  重答过

练习→首次付费 5%：
  分母取「开始练习 500」 →  25 人
  分母取「完成 300」     →  15 人
  分母取「重答 90」      →  4.5 人
房间邀请转化 8%：
  30 个加入者            →  2.4 人
                              ─────────
最宽松口径合计                27.4 人  <  目标 30
```

**本节的修法：把每个转化率的分母逐个写死，并把主链与房间支链分列，然后反推需要的 U0 与 J。**

**【主链】**（分母逐级写死）

```
落地页 UV = U0
  × 25%   （落地页 → 开始练习，分母 = U0）
= 开始练习 S = 0.25 · U0
  × 60%   （完成首次练习，分母 = S）
= 完成练习 C = 0.15 · U0
  × 5%    （练习 → 首次付费，分母 = S）
= 付费用户 P_main = 0.0125 · U0
```

**【房间支链】**

```
房间加入者 = J
  × 15%   （加入者 → 独立付费，分母 = J）
= 付费用户 P_room = 0.15 · J
```

> **⚠ 15% 的归因修订（吸收核验报告 verify-payment S5-3）**：25% / 60% / 5% 出自分层指标表（`Trialroom-全量设计方案.md:2020-2038`）；**15% 不是既有目标值——设计文档基线是 8%（`:2038`），15% 是 §7.3.2.1 路径 C 的收口条件（`:2076`，且以「加入者达 50+」为前提）**。**风险**：若 15% 不成立（回到 8%），U0 需求从 1920 升到 **2200**，已占渠道上限 2270 的 **97%**。

**【合计】**

```
P = 0.0125 · U0 + 0.15 · J − 重叠（两条链都付费的自然人按去重取并集，此处已留 5% 折损）
```

**【反推式】**（要在某日达到 N 个付费用户，需要多少 U0 与 J）

```
U0 需求 = (N − 0.15 · J + 0.05 · N) / 0.0125
```

**【代入四个目标点】**

| 目标日 | 目标付费用户 N | 需要的 U0 | 需要的 J | 代入验算 |
|---|---|---|---|---|
| **11/12** | **1**（团队成员首单，人工通道） | 200（**蓄水**目标，非反推所得） | 10 | 蓄水口径的潜在付费 = 0.0125×200 + 0.15×10 = 2.5 + 1.5 = **4.0**；但**此时支付尚未对外开放，实际付费数 = 1**（首单）。这 4.0 是为 11/22 蓄的力 |
| **11/22** | **≥ 10** | 600 | 20 | 0.0125×600 + 0.15×20 = 7.5 + 3.0 = **10.5**；扣 5% 重叠 = 10.5 − 0.5 = **10.0 ≥ 10** ✓ |
| **12/01** | **≥ 20** | 1260 | 35 | 0.0125×1260 + 0.15×35 = 15.75 + 5.25 = **21.0**；扣 5% 重叠 = 21.0 − 1.0 = **20.0 ≥ 20** ✓ |
| **12/07** | **≥ 30**（承诺值） | 1920 | 50 | 0.0125×1920 + 0.15×50 = 24.0 + 7.5 = **31.5**；扣 5% 重叠 = 31.5 − 1.5 = **30.0 ≥ 30** ✓ |

**四个转化率（25% / 60% / 5% / 15%）全部来自项目内部设定的目标值**（`Trialroom-全量设计方案.md:2020-2038` 的分层指标表 + `:2072-2077` 的三条闭合路径），**不是官方数据、不是实测数据**。材料里必须这样标注。

**这张表比 §7.3.2.1 温和得多（U0 1920 vs 4000），因为它把房间支链兑现了。** 代价是：**房间支链（J = 50、加入者→独立付费 15%）目前完全没有埋点设计**（§7.3.2.2 已明确指出这条缺口）——而 §7.3.2.2 同时指出解法需要「入座时签发的匿名 session ticket，在用户注册/付费时归并到实名账号」，归属 **W2（入座 ticket）+ W4（漏斗埋点）**。

**因此本节把一条原本属于「漏斗」的事项升级为支付同批次的工程项：`session_ticket` 必须在 W2（11/03–11/05）落地页上线之前设计好，否则 11/05 开始的蓄水流量无法归并到实名账号，房间支链的 J 永远算不出来，验算式就塌了一半。**

**UV 速度校核**（12/07 目标 1920，从 11/05 落地页上线算 32 天 → 日均 60 UV/天）：

| 区间 | 天数 | 累计 U0 | 日均 UV |
|---|---|---|---|
| 11/05 – 11/12 | 7 | 200 | 28.6 |
| 11/12 – 11/22 | 10 | 600 | 40.0 |
| 11/22 – 12/01 | 9 | 1260 | 73.3 |
| 12/01 – 12/07 | 6 | 1920 | 110.0 |

**付费速度校核**：11/22–12/01 需 1.11 人/天；12/01–12/07 需 1.67 人/天。**两者都在支付席并发敏感性分析「保守情形 1.7 人/天」的包络内**（§5.9.3）。

**最后 6 天需要 110 UV/天，这是整条漏斗里最陡的一段**（前 7 天只要 28.6）。它之所以陡，是因为 **11/22 支付上线本身是一次「可分享事件」**——付费入口开放是可传播的素材（§5.7.2 渠道 1 的选题里就有「1 分钱练一次」）。**如果 11/22–12/01 的 UV 没起来，第一反应应该是「付费入口开放这个传播点没做起来」，而不是「再加投放」。**

#### 5.7.4 三个 checkpoint 的人数目标

**官方激励门槛是 10 人（去重）**（索引 `:144`：激励计划第 2 期起，同一实名账号下按量付费 + 网页应用收款 + 移动应用收款的交易用户可合并统计，门槛为「累计有效交易用户数 ≥ 10 人」，10 人档对应 10 元 Token 包）。**内部目标必须比它更激进，否则「商业化 25%」和「影响力 20%」都没有抓手。**

| Checkpoint | 日期 | 内部目标 | 对照官方门槛 | 同期必须达成的其他条件 | 不达标的动作 |
|---|---|---|---|---|---|
| **CP-1** | **11/12** | **付费 ≥ 1**（团队成员首单）<br>**蓄水 U0 ≥ 200、开始练习 ≥ 50、完成练习 ≥ 30** | — | 沙箱全链路已跑通（11/06）；生产首笔可计量交易已落库；漏斗六事件可按日导出 | U0 < 120 → 小红书发布密度加倍 + 观猹提前提交 + 校园群全面铺开；**并重算 12/07 目标** |
| **CP-2** | **11/22** | **付费 ≥ 10** | **= 官方激励门槛（跨过）** | 生产上线（对外收费）已生效；作品版本已提交安全审核；第一波投放已跑满 2 周并回填真实单篇 UV | < 10 → 全面转 1 分钱策略（切 B 案文案）+ 换渠道；把落地页 CTA 提到首屏 |
| **CP-3** | **12/01** | **付费 ≥ 20** | 2× | 报名截止（细则 `:26`）；第二波投放已跑满 | < 20 → 接受商业化 25% 丢分假设，资源全砸 75 分可控区（产品 30 + 支付 25 + 影响力 20），材料切方案 B |
| **终局** | **12/07** | **付费 ≥ 30**（承诺值） | 3× | T-demo 上线；参评材料完成 | < 20 → 材料不出现「付费用户数」字段，改用方案 B 素材（§5.7.7） |

**这三个 checkpoint 与索引 §九 止损线（`:195-204`）的关系：** 索引原有「11/15 付费 < 5 → 全面转 1 分钱策略」「11/25 付费 < 20 → Vibe Pay 只做 1 件」「12/1 付费 < 30 → 接受商业化 25% 丢分」。本节的 CP-2（11/22 ≥ 10）与 CP-3（12/01 ≥ 20）把索引的两条阈值**按时间前移并对齐**——因为 T-pay 从 11/12 首单起算、对外收费从 11/22 起算，11/15 这个日期落在「支付未对外开放」的区间里，用它做付费人数阈值没有意义。

#### 5.7.5 去重人数与实名账户的关系

**这是本节最容易被误读的一条规则，必须分两层讲。**

**第一层：买方侧的去重键未披露。** 细则 `:155` 与 `:163` 两次写「累计完成有效交易的**去重用户数**」，`:163` 补「以主办方关联公司的系统记录及计算口径为准」，但**判定标准（去重键、退款、异常交易、跨产品重复）全文未披露**。唯一的官方间接证据（索引 `:144`）里的「同一实名账号」出现在**收款方语境**。

**所以：不能推断「一个自然人多个支付宝账号算多人」或「算一人」中的任何一个。** 我们的做法是 **不依赖这个未披露口径**——§5.3.4 的内控十条 + §5.3.5 的四档判据，就是为了在两种读法下都安全。

**第二层：报名侧的实名是硬约束，且它决定我们的收款账号。** 细则 `:9`（报名账号需手机号绑定 + 实人认证）、`:10`（同一身份证号/支付宝账号/手机号/设备终端任一满足即视为同一参赛选手）、`:17`（报名账号 = 接入 AI 付产品的支付宝账号）、`:128`（奖金发放至报名登录账户内）。

**这两层合起来，得出一个必须在材料里说清的事实：**

> **我们的收款账号是报名组长（队长）的支付宝账号，已完成实人认证；作品内所有付费交易都归集到这一个实人主体名下统计；而买家侧的去重口径由主办方掌握，我们按主办方口径提交去重人数，并主动提供逐笔交付证据链供复核。**

#### 5.7.6 六个埋点事件

**必须可按日导出**（这是 §5.7.3 验算式的输入，也是「商业化 25%」那一栏能拿出实物的前提）。

| # | 事件 | 触发点 | 关键字段 | 用途 |
|---|---|---|---|---|
| 1 | `landing_uv` | 落地页曝光 | `ts` / `session_id` / `source`（渠道标记） | 验算式最上游 **U0**；渠道效果归因 |
| 2 | `practice_start` | 开始一次练习 | `ts` / `user_id` / `session_id` | **S = 0.25·U0** 的分子 |
| 3 | `practice_complete` | 完成一次练习 | `ts` / `user_id` / `room_id` | **C = 0.15·U0**；也是「真实交付」的第一段证据 |
| 4 | `review_view` | 查看复盘报告 | `ts` / `user_id` | 「用户感知到价值」的信号；付费转化率的前置指标 |
| 5 | `first_redo` | 首次重答 | `ts` / `user_id` | 产品价值被感知的证据（设计文档 §7.3.1 北极星指标） |
| 6 | `first_pay` | 首单支付成功 | `ts` / `user_id` / `order_id` / `amount_cents` | **P 的来源**，与 `orders` 表一一对应 |

**外加两个房间支链事件（否则 J 算不出来）：** `room_join`（入座，含 `session_ticket`）与 `room_paid_by_invitee`（被邀请者独立付费）。

**归并规则（必须写进设计）：** `session_ticket`（匿名入座身份）在用户注册 / 付费时归并到实名账号；否则 `landing_uv → practice_start` 这条链在匿名流量上断掉，U0 与 S 无法对应。

**导出物：** `v_paid_user_stats` 视图（`001_platform_schema.sql:455-465`）每日导出 + 一条日累计曲线 + 六个事件的按日表。**这三样东西合起来就是参评材料「商业化 25%」那一栏的全部内容。**

> **⚠ 导出物补齐（吸收核验报告 verify-payment S5-3 连带项）**：§5.7.6 的导出物清单须包含**一笔真实订单的四联截图**（付款页 / 支付宝返回页 / 回调日志 / 权益到账）与**退款演示截图**，这两项与 §5.6.2 的「三处截图」合并为同一套素材。

#### 5.7.7 方案 B 备料（12/01 仍不达标时）

**触发条件：** 12/01 CP-3 < 20。

**材料改法（不是临时编，是提前写好）：**

| 项 | 方案 A（达标） | 方案 B（不达标） |
|---|---|---|
| 那一栏的标题 | 「真实付费用户数与日累计曲线」 | **不写「付费用户数」这个字段** |
| 展示物 | `v_paid_user_stats` 导出曲线 + 逐笔订单截图 | 「内测 N 人 + 完整订单链路录屏 + 生产凭证 + 渠道投放数据」 |
| 叙述重心 | 规模 | **链路质量与履约证据**（这恰好是支付集成度 25% 的料） |
| 顺序 | 先数字后链路 | **只讲链路** |

**原则：宁可少讲一栏，不可被证伪。** 一个能被追问「这 30 个人是谁」而答不上来的数字，比没有数字更糟。

### 5.8 分账本期不做

#### 5.8.1 结论与论证的重写

**「本期不做分账」复核后成立**（支付席 §4.5）：当前收入模型是**单边**的——用户付费 → 平台交付 → 用户获得权益（设计文档 §4.3.4、索引决策 #18「房主付费、被邀请者免费」），**平台不向用户付款，因此不需要任何分账能力。**

**但论证必须重写。** 终稿 `:159` 把五条硬约束列出来当「与商业模型不匹配」的证据，逻辑是反的：

| 原论证的问题 | 修正 |
|---|---|
| 「单笔订单分账比例上限 30%」被列为「不匹配」的证据 | **30% 是「你能分给对方的比例上限」，不是「平台能留下的比例下限」。** 拿它当不匹配的证据，方向是反的 |
| 五条约束（实名 / 30% / 退分账不支持个人 / 30 秒等待 / 365 天 / 二清风险）被逐条列举 | **这五条与结论无关**，评审真正会问的是「用户贡献了题库、做了陪练，你打算怎么分钱给他们」——30% / 30 秒 / 365 天都不回答这个问题。**多列无关约束 = 多送几个可被追问的破绽** |
| 引文不可复核 | 五条约束引自 `opendocs.alipay.com/open/01n2xi` 与 `/solution/0hb278`，**本地无留存副本**（PC-17）。要么本地留存一份，要么把分账段落压到两句 |

#### 5.8.2 五条硬约束与它们各自约束什么

> **出处声明**：以下五条来自终稿 §六（`final_turn_001.md:159`）对支付宝开放平台两份文档的引用，**本地无留存副本（PC-17 未闭合）**。本地可复核的只有 `trialroom/Trialroom-完整平台实施与参赛施工图-v2.md` 语境下的部分；正式引用前必须本地留存一份。

| 约束 | 它约束的是什么 | 本期是否相关 |
|---|---|---|
| 分账接收方必须实名认证 | 接收方资格 | ❌ 本期没有接收方 |
| 单笔订单分账比例上限 30% | 分账的**上限**（分给对方多少） | ❌ 本期不分账 |
| **退分账不支持接收方为个人**；个人接收方需先在商家平台开启「分账回退授权」 | 退款的回收通道 | ⚠️ **这才是将来真正的坑**（见 §5.8.4） |
| 确认结算后需等 30 秒才能发起分账 | 时序约束 | ❌ |
| 分账有效期 365 天 | 有效期 | ❌ |
| 直接对接需自担二清风险（稳妥做法是接入持牌机构做清分主体） | 合规主体 | ❌ |

**正确的表述（可直接进参评材料）：**

> **本期不做分账，是范围选择，不是能力缺失。** A 期收入模型是单边的：用户付费 → 平台交付 → 用户获得权益；**平台不向用户付款，因此不需要任何分账能力** —— 我们把工程量全部留给「支付链路端到端可用」这 50% 的权重（支付集成度 25 + 商业化 25）。
>
> **并且，即使将来要付钱，分账也不是对的工具**：它是为「平台从交易收入里分一部分给第三方」设计的（接收方须实名、比例上限 30%、直接对接需自担二清风险、官方建议接持牌机构做清分主体），不适合「平台向个人付劳务对价」。届时我们要做的是**结算 / 提现能力**（含坏账与合规设计），不是分账。
>
> **本期对贡献者用非现金激励**：作品页署名 + 房间优先权 + 题库作者徽章；把「何时引入现金分润」写成一个明确的触发条件（例如「贡献者 ≥ 30 人时立项结算能力」）。

#### 5.8.3 30% 上限的经济学：即使分满也不致命

**单场单位经济（保守口径：费率 1%、模型成本 5× 放大 0.60 元/场）**

| 情形 | 计算 | 平台净利 | 毛利率 |
|---|---|---|---|
| 不分账 | 3.90 − 0.039 − 0.60 | **¥3.26** | **83.6%** |
| 分出 30%（¥1.17/单） | 3.90 − 0.039 − 1.17 − 0.60 | **¥2.09** | **53.6%** |

**结论：即使把 30% 全部分出去，平台每单仍赚 ¥2.09（分满 30% 的保守口径），不分账为 ¥3.26。** 而一次真人 1v1 面试辅导的市场价是 **¥240–1400/次、中位约 ¥600**（`research/pricing-anchors-2026.md` §1.4 `:113-122`）——**¥1.17/单的上限完全够用**（一个贡献者写 3 条题就能拿到 ¥3.5）。

> **⚠ 数值修订（吸收核验报告 verify-payment S5-1 / S5-6）**：原文的「¥30–240」**不成立**，正确区间是 **¥240–1400/次、中位约 ¥600**；「平台每单仍赚 ¥2.09–2.39」应收敛为「**¥2.09**（分满 30% 的保守口径），不分账为 **¥3.26**」。

**所以「30% 上限」根本不是拒绝分账的理由。真正的理由是工具类别不对。**

#### 5.8.4 分账在什么时候才成为必需，而那时真正的坑在哪

**分账只在平台开始向用户付钱时必需**（贡献题库、做了陪练、组织了场次）。**而那时最硬的约束恰恰是「退分账不支持接收方为个人」**——个人接收方需先在商家平台开启「分账回退授权」，否则平台对个人用户的多余分润**没有回收通道**。

**把分账提前设计掉，等于给自己挖一个坏账坑。** 这句话（终稿 `:161`）是对的，但它的正确用法是「**不做**」，而不是「**我们研究过了所以做了**」。

#### 5.8.5 本期贡献者激励与立项触发条件

| 阶段 | 激励形式 | 说明 |
|---|---|---|
| 本期（A 期） | 作品页署名 + 房间优先权 + 题库作者徽章 | 非现金；不涉及任何资金流出，不需要任何结算能力 |
| 触发条件 | **贡献者 ≥ 30 人** | 届时立项的是**结算 / 提现能力**（含坏账与合规设计），**不是分账能力** |
| 材料写法 | 「贡献者激励本期用非现金形式；现金分润的立项条件已写明」 | 这句话同时回答了「商业闭环在哪一站」和「为什么这一站还没到」 |

### 5.9 成本与定价的自洽

#### 5.9.1 单场单位经济

**成本口径来源：`research/pricing-anchors-2026.md` §5.1（`:334-349` 区间）——** 单场模型成本 **0.05–0.12 元**（输入 ~1 元/百万、输出 ~4.4 元/百万；全场输入 20–36k、输出 8–12k，再加一次复盘生成 3k in / 1k out）；**保守放大 5 倍 → 0.30–0.60 元/场**（重试、模型路由降级、上下文冗余、并发排队、失败重跑）；**ASR 走本地 SenseVoice，边际成本 ≈ 0**。

**费率口径来源：`docs_md/docs_vibe-pay_nowpay_nowpay-intro.md:91-98` 的收单产品费率表——JSAPI 支付 **0.6%~1%** + 即刻收商品经营 0.4%。⚠️ **这条费率表写在智能收款套件文档里；网页应用收款接入指南本身未列费率**，已列入官方群第 7 问。本表按 0.6%（下限）与 1%（上限）双口径计算。

| 项 | ¥3.90 单次 | ¥0.01 首单 |
|---|---|---|
| 收入 | 3.900 | 0.010 |
| 支付费率（0.6% / 1%） | −0.0234 / −0.039 | −0.00006 / −0.0001（≈ 0） |
| 模型成本（实测 0.05–0.12） | −0.05 ~ −0.12 | −0.05 ~ −0.12 |
| 模型成本（保守 5×：0.30–0.60） | −0.30 ~ −0.60 | −0.30 ~ −0.60 |
| ASR（本地，边际成本） | ≈ 0 | ≈ 0 |
| **净利（实测成本口径）** | **+3.741 ~ +3.827** | **−0.040 ~ −0.110** |
| **毛利率（实测成本口径）** | **96.0% ~ 98.1%** | 负（每单） |
| **净利（保守 5× 口径）** | **+3.261 ~ +3.577** | **−0.290 ~ −0.590** |
| **毛利率（保守 5× 口径）** | **83.6% ~ 91.7%** | 负（每单） |

> **⚠ 数值修订（吸收核验报告 verify-payment S4-2）**：净利与毛利率区间按费率 0.6% / 1% 双口径重算。原文写「+3.757~+3.827 / 96.3%~98.1%」与「+3.261~+3.561 / 83.6%~91.3%」，本表按最低费率端（0.6%）计算下限，故**下限略低**。

**结论一：定价完全不是成本问题。** ¥3.9 单次在 2 核机上完全覆盖成本，保守口径毛利率仍有 83.6%。这复核了终稿「评审数人头 → 降价换人头」的底层推理。**把价格从 ¥49.9 降到 ¥3.9，损失的是 ARPU（少 92%），换来的是可能多一个数量级的付费人头——而评审只数人头。**

**结论二：首单 ¥0.01 每单亏损 ¥0.04–0.59。30 个首单的总亏损上限 = 30 × 0.59 = ¥17.7（保守口径）。** 三重对冲：① 官方激励计划 ≥10 个有效交易用户即有 10 元 Token 包（索引 `:144`）；② 个人开发者使用【AI 按量付费】0 费率至 2026-12-31（索引 `:143`，**注意：只适用按量付费，网页应用收款仍是 JSAPI 0.6%~1%**）；③ 严格限制每人一次，不会出现亏损放大。

#### 5.9.2 去重人数目标与单次成本的关系

**这是本节要把两个口径彻底分开的核心。** 评审数人头（商业化 25%），我们数毛利（公司账）。同一个动作在两个口径下符号相反：

| 场景 | 评审口径（人数） | 财务口径（净利） |
|---|---|---|
| 一个人付 ¥0.01 | **+1 人** | **−¥0.04 ~ −0.59** |
| 一个人付 ¥3.9 | **+1 人** | **+¥3.26 ~ +3.83** |

**30 人全部只买首单：** 收入 30 × 0.01 = ¥0.30，成本 30 × 0.60 = ¥18.00 → **净亏 ¥17.70**，而商业化 25% 拿到的是满额人头分。

**30 人中 k 人只买首单、其余买 ¥3.9**（保守口径）：

| k | 净利 | 说明 |
|---|---|---|
| 0 | **+¥97.8** | 全部买 ¥3.9 |
| 10 | **+¥59.3** | 20 × 3.26 − 10 × 0.59 |
| 20 | **+¥20.8** | 10 × 3.26 − 20 × 0.59 |
| 30 | **−¥17.7** | 全部只买首单 |

**由此得出三条必须写进方案的结论：**

1. **首单档必须限量。** 每人 1 次 + 绑定实名 + 手机号 + `is_first_order` 标记（设计文档 §7.1.4 `:1832` 已有这两条，本轮方案丢了，需接回）。**否则亏损随人数线性放大，而人数分的边际收益是常数。**
2. **人均消费次数比首单占比更重要。** 30 人 × 1 场 = 30 场（成本 ¥18）；若人均 3 场 = 90 场（成本 ¥54），仍低于 30 人 × ¥3.9 的收入 ¥117。**也就是说「复购」在财务上比「首单占比」更能决定盈亏**——但复购不增加去重人数，所以它服务的是留存与影响力，不是商业化 25% 的计分。**两个口径在材料里必须分开讲，不能混。**
3. **¥0.01 的正确定位是「一次真实付款的行为证明」，不是商品。** 这与调研 `pricing-anchors-2026.md` §5 的判断一致（调研原话：0.01 会被用户归类为「广告/引流」，「支付按钮的点击率会低于 1 元档」；解法不是「别用 0.01」，而是「把它从『薅羊毛入口』重新定义为『第一次真实付款』」）。**这一条同时是财务结论和产品结论。**

#### 5.9.3 并发上限与它的反噬链

**约束点（实测代码位置）：**

> `tryout_pr_src/Tryout-fix-83-issues/server/services/asrGuard.js:32-34`
> ```
> const DEFAULT_MAX_CONCURRENT = 2;
> const DEFAULT_QUEUE_TIMEOUT_MS = 15_000;
> const DEFAULT_MAX_QUEUE = 32;
> ```
> `:74-77`
> ```
> const CPU_BASED_DEFAULT = Math.min(DEFAULT_MAX_CONCURRENT, availableCpus());
> const MAX_CONCURRENT = envInt("ASR_MAX_CONCURRENT", CPU_BASED_DEFAULT);
> ```

**2 核机上 ASR 并发上限 = 2；1 核容器（compose 里 server `cpus:'1.0'`）实际上限 = 1**（索引修复项 23 已把固定 2 改为 CPU 感知）。一场面试 = 1 条持续 ASR 流 × 8–12 题 × 20–30 分钟（`pricing-anchors-2026.md` §5.1 的形态假设）→ **最大同时面试数 = 2，队列 15 秒超时即 429。**

**敏感性分析三档：**

| 情形 | 到达率 | 需要并发 | 2c2g 是否够 | 结果 |
|---|---|---|---|---|
| 保守（目标 30 人 / 18 天） | ≈ 1.7 人/天 | ≤ 1–2 | ✅ 富余（即使 24h 满载也有 ~115 场/天） | **约束不在并发** |
| 目标（30 人 + 20% 复购 = 36 单） | ≈ 2 单/天 | ≤ 2 | ✅ 够 | **约束不在并发** |
| 冲击（小红书单篇爆了，10 人同时到） | 瞬时 10 并发 | 10 | ❌ **不足（容量 2、需求 10，缺 8 个并发位 = 需求的 5 倍）** | 8 人 15s 超时 → 429 → 失败 → 退次数 → 退款流水 |

> **⚠ 措辞修订（吸收核验报告 verify-payment S4-3）**：原文「缺 8 倍」方向易误读，现改为「**容量 2、需求 10，缺 8 个并发位 = 需求的 5 倍**」。

**反噬链（本节最重要的一条因果链）：**

```
并发 2 → 排队 15s 超时 → 429 → 失败自动退次数 → 产生真实退款流水
  → 若主办方口径是「退款的用户从累计有效交易去重用户数中扣掉」
    （口径未披露 → 官方群第 3 问）
  → 低价拉新在统计口径上自我抵消：你拉来 10 个人，其中 8 个体验失败并退款，
    净计入可能只有 2 个
```

**对策（低成本且严格优于原方案）：**

> **¥0.01 首单因系统原因失败时，按「不扣次数、当场补发一次」处理，不产生真实退款流水。**
> 理由：① 决策 #30 之所以把「失败自动退次数」列为必做，是针对「低价档退款一旦积压 = 支付宝 120 小时投诉处理时限的定时炸弹」——**「不产生退款流水」比「产生退款再处理」更好地满足这条约束**；② 对用户而言体验等价（次数不扣、立刻可再试）；③ 对统计而言，**不产生退款 = 不可能被判「无效交易」**。

**配套三条：**

| # | 措施 | 落点 |
|---|---|---|
| 1 | 真实退款通道**只对 ¥3.9 及以上档位**开放；首单档不开放主动退款，改用「人工补偿一次练习」 | 工作分解表第 6 项 + 前端文案 |
| 2 | 并发排队必须有**前端文案**（「排队中，第 N 位，预计等待 X 秒」），而不是裸 429 | 工作分解表第 8 项（直接是支付集成度 25% 的「反馈是否清晰」） |
| 3 | 退款手续费**不退回**（接入指南 `:350`）必须在退款文案中明示 | 工作分解表第 6 项 |

#### 5.9.4 定价表与最终稿的一致性修正

**终稿 `:183` 的定价行引入了设计文档里不存在的第三档价**（PC-15）：

> 终稿：¥0.01 首单、¥3.9 单次、**¥9.9 五次**、¥49.9 二十次、¥29.9 三十天、¥9.9 房间共享
> 设计文档 §7.1.3（`:1767-1775`）：¥0.01 首单、¥3.9 单次、**¥19.9 / 5 次**、¥49.9 / 20 次、¥29.9 / 30 天、¥9.9 房间共享

**调研明确否决过 ¥9.9/5 次**（`pricing-anchors-2026.md` §5.2：「调研建议从 ¥9.9/5 次上调……¥9.9/5 次 = 1.98 元/次，**折扣 49%** 远深于行业惯例 7%–35%，会把价格锚永久钉在『两块钱一次』」）。

**处置：本节采用设计文档 §7.1.3 的逐字版本，¥19.9 / 5 次。** **参评材料里的价格表必须与定价页、后端 SKU、数据库 `product_code` 三处一致**——三处不一致是评审一眼能看出的破绽。

### 5.10 Machine Pay 技术形态（附录 · 不属于 Trialroom 的支付链路）

**本节内容可以保留在附录，但必须带一句定性：** **以下技术形态属于另一件独立作品（Tryout 题目生成 API，索引决策 #9），不属于 Trialroom 的支付链路，其 agent 付费用户不计入 Trialroom 的商业化叙述。**

| 维度 | 内容 | 出处 |
|---|---|---|
| 核心机制 | 基于 **HTTP 402 Payment Required** 的 A2M 方案 | `mp_MACHINE_PAY.md:7` |
| 时序 | 请求 → 预下单 → **402 + `amtPaymentLink` 响应头** → 智能体把支付信息交给支付宝 → 用户确认 → 智能体携带 **`Payment-Proof`** 再次请求 → 服务端调 `alipay.aipay.agent.payment.verify` 验凭证 → 返回资源内容 | `mp_MACHINE_PAY.md:18-20`、`:33`、`:137` |
| 响应头前缀 | 官方出现过两种：`amtpp_v1_xxx` / `amt_pre_pay_id` → **以控制台实际返回为准** | 索引 `:140` |
| 落库时机 | 官方时序第一步是「**固定本地订单**」→ **precreate 之前就要落库**（第二次请求只带 Payment-Proof，无 `out_trade_no`，只能靠 verify 响应反查） | 索引 `:141` |
| 服务类型 | 仅限 **Restful 接口** 或 **回调接口** | `Machine-Pay-实现指南.md:77`（**项目内部文档**） |
| 单价区间 | 官方只写「**不超过 50 元**」，示例值 `0.01`（`precreate:25`）；**下限 0.01 出自我们自己的实现指南 `:77`，不是官方原文** | `docs_ai-receive_api-list_alipay-aipay-agent-payment-precreate.md:25` |
| 结算 | 官方原始表述：「首次签约收单产品且未满 90 日或连续交易未满 30 日的商家，次日结算到收款账户」——**该句写在智能收款套件文档**，是否同样适用于按量付费需确认 | `docs_md/docs_vibe-pay_nowpay_nowpay-intro.md:88` |
| 落地前提 | `service_id` 服务市场注册，**需审核**，审核周期未知 → W1 申请 | `Machine-Pay-实现指南.md:97`、索引 `:302` |
| 获客 | 官方文档里**没有「上架/目录」这一环** → 拿不到平台流量，只能靠自有 Agent 生态 / 外部目录 / 合作平台分发 → **必须问官方群** | 索引 `:142` |
| 费率 | 个人开发者用【AI 按量付费】**0 费率至 2026-12-31** | 索引 `:143` |

**「必须问官方群」的 Machine Pay 两问**（保留在问题清单里，但**不阻塞 Trialroom 主线**）：① 服务发现机制（`service_id` 分配后如何被 Agent 发现，有无服务目录）；② `service_id` 审核周期。

**为什么必须把它从 Trialroom 的支付链路里摘出去，一句话：** 它的买方是 agent 不是人，它产出的付费用户进不了细则 `:152-155`「真实、有效的付费用户」这一栏，它的链路对应不上细则 `:144-150` 的四个评分点，而它所在的赛道只有 1 个 ¥10,000 的奖。

### 5.11 支付与商业化席处置台账

#### 5.11.1 P0：PC-01 ~ PC-07 与 A1 ~ A4

| 编号 | 级别 | 问题摘要 | 本节落点 | 状态 |
|---|---|---|---|---|
| **PC-01** | P0 | 「支付只走 Machine Pay 一条轨」与自身决断矛盾；Machine Pay 物理上无法为普通网页用户收款 | §5.1（赛道归位 + 七列对照表）、§5.10（降入附录并标注不属于本作品）、§5.1.2（x402 结构性排除理由） | ✅ 已改写 |
| **PC-02** | P0 | 「小号刷量无效」过度解读；刷量后果被低估为分数级 | §5.3.1（限定的是统计归属主体）、§5.3.2（资格级风险对照表）、§5.3.4（《付费真实性内控》十条） | ✅ 已改写 |
| **PC-03** | P0 | 「智能收款套件暂不可用」建立在误读上 | §5.4.1（两句分开读）、§5.4.3（必答第 5 问）、§5.4.4（双轨预案 + `orders.source`） | ✅ 已改写 |
| **PC-04** | P0 | 网页应用收款自建轨工作量低估 3–5 倍 | §5.5.1（推导 15–25 人日 + 人日—窗口对账）、§5.5.2（九行工作分解表）、§5.5.1（节流三手段） | ✅ 已重估 |
| **PC-05** | P0 | 三份文件三个互斥支付日期 | §5.5.3（倒排时间线，支付窗口 10/27 起；里程碑收敛为 4 个） | ✅ 已统一 |
| **PC-06** | P0 | 商业化 25% 在本轮方案里整体消失 | §5.7 全节（获客渠道 + 验算式 + 三 checkpoint + 埋点 + 方案 B） | ✅ 已补 |
| **PC-07** | P0 | 「作品提交并通过审核后」的字面前置被忽略 | §5.5.4（上线定义改为「作品已生效 ∧ 收款可用」+ 11/22 同步提交审核 + 官方群第 4 问） | ✅ 已补 |
| **A1** | P0 | 支付轨道归位 | §5.1.3 对照表 + §5.1.4 话术 | ✅ |
| **A2** | P0 | 智能收款套件的准入问题换成正确的问题 | §5.4.2 / §5.4.3 第 5 问 | ✅ |
| **A3** | P0 | 工作量重估 + 窗口前移 | §5.5.1 / §5.5.2 / §5.5.3 | ✅ |
| **A4** | P0 | 商业化补一条真计划 | §5.7 全节 | ✅ |

#### 5.11.2 P1 / P2：PC-08 ~ PC-18

| 编号 | 级别 | 问题摘要 | 本节落点 | 状态 |
|---|---|---|---|---|
| **PC-08** | P1 | 「¥0.01 下限」引到错误产品；兜底语义错 | §5.2.1（错引对照表）、§5.2.2（`total_amount` 原文）、§5.2.3（无更低的档 + 两套文案 + 切换成本 0.5 人日） | ✅ 依据升级、兜底重写 |
| **PC-09** | P1 | 第一笔真实付款的失败面无预案 | §5.6 全节（五步剧本 + 错误码分流表 + 证据边界声明） | ✅ 已补 |
| **PC-10** | P1 | 30% 上限用法逻辑倒置；五条约束与结论无关 | §5.8.1 / §5.8.2 / §5.8.3 | ✅ 论证重写 |
| **PC-11** | P1 | 成本侧从未测算；并发上限的反噬链 | §5.9.1（单场单位经济）、§5.9.3（并发敏感性 + 反噬链 + 三条对策） | ✅ 已补 |
| **PC-12** | P1 | x402 排除的第二条理由是传闻 | §5.1.2（结构性排除：买方不是支付宝实名自然人，结构上进不了「真实、有效的付费用户」；留的灵活性是 Machine Pay 本身也是 AI 付产品） | ✅ 理由升级 |
| **PC-13** | P1 | 本周清单第 6 项把商品模型挂到 Machine Pay 上 | §5.4.1（商品模型归套件/自建）、§5.4.4（本地映射）、§5.5.2 第 8 项 | ✅ 已拆 |
| **PC-14** | P1 | 「核对」降级为「检查」；索引已列的本周必做被删 | §5.5.3 T-44 行（新增 `service_id` 申请）+ T-43~T-36 行（报名 + **开通** + 表单字段 + ICP 备案） | ✅ 已恢复 |
| **PC-15** | P1 | 引入设计文档不存在的第三档价 ¥9.9/5 次 | §5.9.4（改回 §7.1.3 的 ¥19.9/5 次 + 三处一致要求） | ✅ 已对齐 |
| **PC-16** | P1 | 商业化段落讲的是 0 分的内容 | §5.7.1（三处错位）+ §5.7.6（六事件 + `v_paid_user_stats` + 一笔真实订单四联截图 + 退款演示） | ✅ 已重写 |
| **PC-17** | P2 | 分账 5 条约束引文不可复核 | §5.8.2 出处声明（**本地无留存副本**）+ 压到两句 + 要求本地留存一份 | ⚠️ 待补留存副本 |
| **PC-18** | P2 | 「44 天」措辞未修 | §5.5.5 窗口账（官方 79 天 / 我们 17 天 / 11/12 起 27 天） | ✅ 已统一 |

#### 5.11.3 T 系列：倒排时间线行标的逐条落点

**说明**：裁决文件 §〇 编号对照表中支付席一栏记为「A1–A4、PC-01…PC-18、**T-1…T-19**」；核对其出处，`T-` 系列是支付席 §3.7.3 倒排时间线的**行标**（T-44 → T-1，**共 13 行**），并非 19 条独立发现。本节 §5.5.3 已把整张表重排并逐行给出落点，下表为行标 → 落点对照，确保无一行遗漏。

| 行标 | 原行要点 | 本节落点 | 状态 |
|---|---|---|---|
| T-44 | 决定 A1 / 发官方群 4 问 / 域名 + ICP | §5.5.3 T-44 行（扩为 9 问 + 两套文案 + `service_id` 申请） | ✅ |
| T-43 ~ T-36 | 报名 / 表单字段 / 开通 / `service_id` / 支付适配器开工 | §5.5.3 同名行（支付开工前移到 **10/27**） | ✅ 已前移 |
| T-36 ~ T-29 | 建表 + 下单 + 验签 + 前端付费页骨架 | §5.5.3 **T-35 ~ T-30**（11/03–11/05）+ 新增落地页上线 | ✅ |
| T-29 ~ T-22 | 沙箱全链路 | §5.5.3 **T-29 ~ T-25**（**11/06 前跑通**） | ✅ 已前移 |
| T-21 ~ T-19 | 沙箱→生产差异修复 + 密钥 + 四接口回归 | §5.5.3 **T-24 ~ T-20** + **11/12 生产首笔可计量交易** | ✅ 已拆 |
| T-19 | 第一单剧本执行 | §5.5.3 T-24~T-20 行 + §5.6 全节 | ✅ 已补 |
| T-17 | T-pay 上线 | §5.5.3 T-19 ~ T-17 行（11/22）+ **同步提交作品审核** | ✅ 语义前移 |
| T-14 ~ T-10 | 房间 + 分享卡 + 落地页 + 获客第一波 + 埋点 | §5.5.3 拆为 T-19~T-17（落地页/埋点/投放提前）与 T-16~T-9（第二波） | ✅ 已调整 |
| T-9 | 12/01 报名截止 + 第一次止损点 | §5.5.3 T-16 ~ T-9 行 + §5.7.4 CP-3 | ✅ 阈值已改为 ≥20 |
| T-8 | T-demo 上线 + 参评材料 + 作品页提交 | §5.5.3 T-8 ~ T-2 行 | ✅ |
| T-2 | 12/07 第二次止损点 | §5.5.3 T-8 ~ T-2 行 + §5.7.7 方案 B 触发条件 | ✅ |
| T-1 | 12/08–12/09 最终回归 + 提交 + 窗口关闭 | §5.5.3 T-1 行 | ✅ |

---

## 六、第四节 · 44 天施工排期 v3、门禁验收与止损点

> 本节产出物是一份**可被逐行核账的 44 天排期**、一份**可被逐条打勾的本周清单**、一张**可被按时执行的止损点表**、一套**方案要点 → 门禁 → 失败后果**的验收矩阵，以及许可证与 MIT 义务的落地判据。
> 上游依据（全部只读引用，不改源码）：`trialroom/review/10-adversarial-verdict.md`（业主方交叉裁决，最高权威）、`trialroom/review/09-consistency-feasibility.md`（一致性席）、`trialroom/review/09-integration-license.md`（许可席）、`trialroom/review/08-final-plan.md`（69 条裁决与产能账）、`trialroom/review/09-payment-commercial.md`（支付席）、`trialroom/review/09-mcp-security.md`（MCP 席）、`trialroom/research/platformization-report-20261026.md`（本轮终稿）、`/workspace/mcd-contest/alipay/Trialroom-商业版平台化升级方案.md`（§六 A 期表）、`trialroom/Trialroom-完整平台实施与参赛施工图-v2.md`、`trialroom/Trialroom-全量设计方案.md`、`/workspace/mcd-contest/alipay/00-当前状态索引.md`。
> **口径声明**：本节所有「人日」= 1 人 1 个工作日；「供给」= 该周在册人力 × 5 天，并按 `08-final-plan.md:1120` 的口径对第三名成员按**边际有效产能 8 人日/周**计（而非名义 15）；「计划」= 已承诺并带验收判据的工作量；「余量」= 供给 − 计划，**不是缓冲，是尚未分配的可支配产能**。本表不存在「计划 > 供给」的周。

### 6.1 三份互斥排期的并存事实

#### 6.1.1 本轮平台化路线在既有基线里的词频为零

本轮平台化方案（`trialroom/research/platformization-report-20261026.md`）在业主方裁决里被采纳为方向，但它**不是对既有裁决的修订，而是账外新增**。证据是词频，不是判断：

| 关键词 | `08-final-plan.md` | `00-当前状态索引.md` | `Trialroom-全量设计方案.md` | `Trialroom-完整平台实施与参赛施工图-v2.md` |
|---|---|---|---|---|
| `MCP` | **0** | 7 | **0** | **0** |
| `平台化` | **0** | 4 | 1 | **0** |
| `校准` | **0** | 3 | 2 | **0** |
| `人工标注` | **0** | **0** | **0** | **0** |
| `BYO` | **0** | 1 | **0** | **0** |
| `OAuth` | **0** | 1 | **0** | **0** |
| `分账` | **0** | **0** | **0** | **0** |
| `x402` | **0** | **0** | **0** | **0** |

（实测复算，2026-10-27。索引里的 7 次 `MCP` 全部来自本轮 2026-10-27 新增的决策 #49 / #52 / #53 与修复清单，与 08 号方案无关。）

一致性席把这条写成结论 C-1 组的前置判断：「本轮方案的整条平台化路线是『账外新增』，不是『对既有裁决的修订』。它既没有推翻任何已生效决策，也没有继承任何产能排期——它被写成了一份**与基线平行的方案**」（`09-consistency-feasibility.md:22-23`）。MCP 席独立复核出同一件事，并补了最尖锐的一句：「平台化报告**没有进入** `08-final-plan.md` 的七源合并输入（§0.1），也**没有进入** `Trialroom-商业版平台化升级方案.md` 的 A 期表（§六，该文档同样零 MCP）。也就是说：**三份主文档目前对『平台化做什么』给出三套答案**，而 08 是被标为 ⭐ 最终方案的那份——**评审现场如果翻 08，会看不到任何 MCP 内容**」（`09-mcp-security.md:507`）。

#### 6.1.2 三份排期的逐项对撞

| 维度 | 08 产能账（`08-final-plan.md:530-688`） | 本轮终稿 §八 7 项（`platformization-report-20261026.md`） | 商业版平台化升级方案 §六 A 期表（`Trialroom-商业版平台化升级方案.md:368-382`） | 冲突判定 |
|---|---|---|---|---|
| A 期总量 | **committed 64.0 人日 = 产能 64 ⇒ 缓冲 0**（`:502`、`:619`） | 7 项新增 **15.7–20.9 人日**（一致性席 `09-consistency-feasibility.md:108`） | **约 42 人日**，自称「与 40 人日可用工时基本吻合」（`:382`） | 🔴 三个互不相容的口径。64 vs 42 vs 64+15.7~20.9 |
| 支付沙箱 | W2 末（11/08，`08-final-plan.md:559`） | 本周开工即做 | W3（11/10–11/16）「支付宝沙箱联调」 | 🔴 同一里程碑三个日期 → **裁决为 11/06**（§6.1.3） |
| 收款生产上线 | **11/22**（W4，决策 #37，`08-final-plan.md:582`） | 未进 7 项（只在叙述里） | W4「正式环境支付联调」+ W6「云端部署 + 定价灰度」 | 🔴 上线日分裂在 11/22 与 12/01 之间 → **裁决为 11/22** |
| 支付负责人窗口 | T 全周在支付（W2），M-05 在 W4 | 「无依赖，本周就做」 | 未指派 | 🔴 索引 §八 分工建议写「队友做支付（**11/18–12/3**）」（`00-当前状态索引.md:169`）——**与 11/22 上线直接矛盾** → **裁决为 10/27 起** |
| MCP | **零行**（`08-final-plan.md` §4.3 台账无 MCP） | 第 2 项，2 人日切片，自估「一到两周」（`:182`） | **零行** | 🔴 影子工程：无台账、无周次、无验收 → **§6.11 文档补齐清单第 13 项补台账** |
| 题库承诺 | 116 题，扩量移 B 期 W16 | 「不追题量」 | W5「题库补 50–80 道 L3–L5」 | 🔴 施工图 v2 `:339` 仍写「12-09 前扩到 300+」、`:319` 仍写「800+ 题库（第一批）」（CF-16 / G-14） |
| 隔离口径 | 70 条 HTTP 路由 owner 校验 | MCP 工具表 3 个高敏读工具**零 owner 说明**（CF-07） | 50 条路由 + `scopedDb` 包装 | 🔴 门禁覆盖面与暴露面同时变化，两者都没对齐 |

#### 6.1.3 三个互斥支付日期的裁决

三份文件给出三个互斥的支付日期，且三者不可能同时成立：

- **A：11/08 沙箱 / 11/22 上线**——`08-final-plan.md:559`（W2 末沙箱）、`:582`（W4 M-05 收款生产上线）、决策 #37；依据是统计窗口 2026-09-21 ~ 12-09 固定（`00-当前状态索引.md:207`），每提前一天上线多一天累计窗口。
- **B：11/18–12/03 支付负责人窗口**——`00-当前状态索引.md:169` 的分工建议。按 PC-04 拆解的 15–25 人日，11/18 开工**第 4 天就要上线**（`09-payment-commercial.md:41`）。
- **C：W6（12/01–12/07）云端部署 + 定价灰度**——`Trialroom-商业版平台化升级方案.md:379`。这是原施工图的排法（`Trialroom-完整平台实施与参赛施工图-v2.md:316`），只剩 9 天累计窗口。

**裁决：以 A 为准，B 与 C 作废。** 理由三条：

1. **A 是唯一带「为什么」的日期。** 索引 §九 止损线把 11/22 写成「收款生产上线（不是 12/01）｜没上线 → 累计窗口只剩 17 天，去重付费用户数直接腰斩」（`00-当前状态索引.md:202`），并给出换算「商业化拿不到 = 输 25 分；产品完整度 30% + 支付集成 25% + 影响力 20% = 75 分纯靠执行能拿」（`:213`）。B 与 C 都没有这个论证，只是排期惯性。
2. **B 在物理上不成立。** 15–25 人日的自建轨不可能在 11/18–11/22 四天里完成，而 11/22 是硬约束。
3. **C 是「最后一版原排期」，不是「最优解」。** 商业版平台化升级方案 §六 是一份**总量判断文档**（`:11-23` 把 14 条需求量成 110–155 人日，A 期取 42），它的 A 期表属于「早期容量口径」，未纳入五份评审新增的 P0（挂载顺序、owner 隔离、达标判定、参考答案裁剪、支付重估）。

**落点**：三份主文档必须由 v3 排期**统一取代**，并在 `08-final-plan.md` 的 §4.3 台账里新增 MCP 与合规相关行，否则它们永远是「影子工程」（CF-10 的修复动作）。本节 §6.3 的 W1–W16 表即该取代稿。

#### 6.1.4 「W1 的增量」还是「W1 的替换」

业主方裁决的原文判断是：「方案**被当作「W1 的增量」提出来，实为「W1 的替换」**」（`10-adversarial-verdict.md:31`）。一致性席给出机械证据：本轮 7 项清单里**没有一项**是 W1 的既有 15 项，按字面读是把 W1 整个换掉——**换掉的是 P0 安全修复 + 报名 + ICP 备案**（CF-01，`09-consistency-feasibility.md:39`）。

**本节的处置（对应 G-1）**：v3 排期**显式声明为 W1 的叠加，不是替换**，并给出等量置换表（§6.4.3）。W1 的 15 项既有工作**一项不减**；本轮新增全部由三条合法来源支付：① 08-final-plan §3.2 已列 B 期项的追加移出；② §3.3 降级池 7.0 人日（预启动，触发条件见 §6.6）；③ **10/30 扩到 3 人**（`10-adversarial-verdict.md:135`：11/09 决策太晚，报名表须 11/15 前改）。

### 6.2 产能账 v3：供给、需求与缺口

#### 6.2.1 供给侧：3 人不是「多 15 人日/周」

| 周 | 窗口 | 在册人力 | 名义产能 | 计入供给 | 余量（供给 − 计划） |
|---|---|---|---|---|---|
| W1 | 10/27–11/02 | 2 人 | 10 | **10.0** | 0.50 |
| W2 | 11/03–11/09 | 3 人（第三人 11/03 到岗） | 15 | **18.0** | 1.90 |
| W3 | 11/10–11/16 | 3 人 | 15 | **18.0** | 1.20 |
| W4 | 11/17–11/23 | 3 人 | 15 | **18.0** | 0.50 |
| W5 | 11/24–11/30 | 3 人 | 15 | **18.0** | 5.00 |
| W6 | 12/01–12/07 | 3 人 | 15 | **18.0** | 7.20 |
| 提交 | 12/08–12/09 | 3 人 × 2 天 | 6 | **6.0** | 0.00 |
| **合计** | | | | **106.0** | **16.30** |

供给口径三条硬规定：

- **W1 仍按 2 人计**。10/30 拍板不等于 10/30 到岗；新成员还要 1 周磨合，且报名表须 11/15 前改（`08-final-plan.md:1120` 的「报名表 11/15 前改才有意义」）。
- **第三人按 8 人日/周计，不是 15**。依据 `08-final-plan.md:1120`：「新成员边际有效产能约 8 人日/周（磨合 + 沟通），不是 15」。因此 3 人周供给 = 10 + 8 = **18.0**，不是 15。
- **提交窗口按 3 人 × 2 天 = 6.0**。第三人在提交窗口的职责被单独定义（N18 独立交叉验收、N19 降级预案执行），见 §6.3.7。

#### 6.2.2 需求侧：基线、顺延与真新增

| 口径 | 人日 | 说明 |
|---|---|---|
| **08 台账逐行相加** | **64.2** | `08-final-plan.md:530-619` 的 80 行逐行相加结果。⚠️ 该表周小计栏写 9.5 / 10.5 / 11.0 / 10.5 / 9.0 / 9.5 / 4.0 = 64.0，**但逐行相加是 64.2**——W1 少 0.2（逐行 9.3 vs 标 9.5）、W2 多 0.4（逐行 10.9 vs 标 10.5），净差 +0.2。v3 取逐行口径 64.2，并把这 0.2 显式化 |
| W1 顺延（周次调整，非新增） | 0.0 | PR#1 合并回归 1.0 → W2；M-53 `models.yaml` 1.0 + M-37/M-52 0.3 → W3；M-35 / M-28 / M-43 三项自 W3 → W5。**这三笔总量不变，只是周次搬家，不计入 25.5** |
| **本轮真新增（25.5 人日）** | **25.5** | 见下方分解 |
| **v3 A 期净需求** | **89.7** | 64.2 + 25.5 |

真新增的 25.5 人日分解（每一项都带裁决落点）：

| 编号 | 新增项 | 人日 | 周次 | 依据 |
|---|---|---|---|---|
| N8 | **支付自建轨净增**（`trade.query` 补偿 / `trade.close` 关单 / `trade.refund` + `fastpay.refund.query` / 前端付费页三态 / 沙箱→生产密钥 / 离线对账） | **8.0** | W2–W5 | PC-04（`09-payment-commercial.md:40`）：自建轨真实工作量 15–25 人日。08 台账已隐含 9.3 人日支付行，故净增 = 15 − 9.3 ≈ 5.7 至 25 − 9.3 ≈ 15.7，**v3 取 8.0 并保留上界吸收空间** |
| N11 | **MCP 前置**（`mcp_tokens` 独立 token class / scope 绑房间 / 越权返 404 / nginx `/mcp/` location / 头体一致 / `_meta` 白名单 / Origin / 幂等键） | **3.9** | W2–W4 | S-02、S-03、S-10 ~ S-15（`10-adversarial-verdict.md:143-154`） |
| N12 | **MCP 最小切片**（5 个房间与面试工具 + 1 个只读证据工具 / 每工具×每 scope 正负例矩阵 / `tools/list` 分片快照 / 证据抽取器对照） | **3.3** | W3–W6 | 裁决 §七 第 6 项（切片成本 2）+ S-18（`:157`）职责分离可见演示所需 |
| N13 | **MCP 门禁接入**（`check-mcp-gates.mjs` / 注册进 `verify-all.mjs` 的 `GATES` / 变异测试 / 输入集合完整性自检） | **1.9** | W3–W5 | CF-05（`09-consistency-feasibility.md:56`）、CF-16（`:67`）、M-32 验收标准（`08-final-plan.md:218`） |
| N3 | **κ_HH + κ_JH 校准 + 双阈值门禁接线** | **1.0** | W1 | 裁决 §七 第 2 项（0.75）+ 门禁化接线（0.25）。**低于一致性席的 1.8 人日**，因决策 #48 把标注素材换成既有 `rubricHints`（`00-当前状态索引.md:381`）。**与 §4.2.7 的 3.5 人日完整工作包口径的差额，见 §4.12.4 末段的口径说明** |
| N4 + N5 | **MIT 义务收口 + 题库来源合规门禁** | **1.3** | W1 | L-06 ~ L-12、许可席 C2/C3（`09-integration-license.md:25-26`） |
| N18 + N19 | **提交窗口：第三人独立交叉验收 + 降级预案执行** | **2.0** | 提交 | 08-final-plan §6.5 提交前 48 小时时间盒（`:974-988`）的第三人位 |
| N9 | **第一单剧本 + 生产第一笔可计量交易** | **0.9** | W3 | PC-09（`09-payment-commercial.md` 第一单剧本）+ R-3（11/12 硬约束） |
| N10 | **获客与漏斗作战表**（分母写死 + 三 checkpoint 人数目标） | **0.5** | W2 | 裁决 §七 第 5 项 / PC-06 |
| N7 | **CI 既有红修复** | **0.5** | W2 | CF-06（`09-consistency-feasibility.md:57`） |
| N14 | **职责分离可见演示** | **0.8** | W5 | S-18 |
| N17 | **影响力物料收口**（首单有效交易截图 + 复盘 diff 截图 + 作品页首屏联动） | **0.5** | W6 | §7.1.3 候选 ②③ |
| N1 + N2 | **赛道路径归位 + 报名完成 + 开通网页应用收款** | **0.4** | W1 | 裁决 §七 第 3 / 9 项 |
| N6 | **MCP 边界补进主设计文档** | **0.3** | W1 | 裁决 §七 第 10 项 |
| N15 | **「面试官问你的代码」设计稿**（实现移 B 期） | **0.2** | W5 | CF-14（`09-consistency-feasibility.md:65`） |
| **合计** | | **25.5** | | |

#### 6.2.3 缺口：显式算出来的三个数

| 口径 | 数字 | 算式 |
|---|---|---|
| **v3 净需求** | **89.7 人日** | 64.2（08 台账逐行）+ 25.5（本轮真新增） |
| **供给（2 人，不扩编）** | **64.0 人日** | 6 周 × 10 + 提交窗口 4 |
| **缺口（不扩编）** | **25.7 人日 = 产能的 40.2%** | 89.7 − 64.0 |
| **供给（3 人，10/30 决策后）** | **106.0 人日** | 10 + 5×18 + 6 |
| **余量（扩编后）** | **16.3 人日** | 106.0 − 89.7 |
| **返工容差（扩编后）** | **3.26 人日/周** | 16.3 ÷ 5 周（W2–W6）。对比基线「任何一次超过 **0.5 人日/周**的返工都会击穿 12-09」（`08-final-plan.md:508`）——**容差提高 6.5 倍** |
| **一致性席的独立测算** | **净增 15.7–20.9 人日，缺口 ≈ 18 = 产能 28%** | `09-consistency-feasibility.md:108-110` |
| **发布席的第二口径** | **67–89 人日 vs 60，超载 12%–48%** | `08-final-plan.md:504` |

**v3 的净需求（89.7）比一致性席的上界测算（64 + 20.9 = 84.9）高 4.8 人日，差额来自两处补漏、一处修正：**

1. **+8.0 支付自建轨净增（补漏）**——一致性席的 15.7–20.9 清单里**没有支付重估**（它是 10/27 之后才由支付席 A3/PC-04 提出的）。这是必须补的，因为它直接决定 11/22 能不能上线。
2. **+1.3 MCP 前置与门禁的显式化（补漏）**——一致性席把 MCP 估为「骨架 4.5–6.0（收缩为 3 只读工具）」+「CI 门禁 1.2」，未把 S-02 / S-03 / S-10 ~ S-15 的实现成本与 CF-16 的输入集合自检、变异测试、分片快照计入。v3 把它们摊开，因为「切片 2 人日」这个数字只覆盖切片本身。
3. **−4.5 κ 校准（修正）**——一致性席把「人工校准集 + judge-κ 基线」整体估为 **1.8 人日**（0.6 双人标注 + 0.4 rubric/锚点 + 0.4 κ 脚本 + 0.2 样本 + 0.2 材料，`09-consistency-feasibility.md:100-101`）；v3 改用既有 `rubricHints` 作 κ_HH 素材、零新增标注成本，且把「κ 脚本」并入 G14 门禁，**该 1.8 人日的整块在 v3 中不成立，v3 只计校准计算与报告 1.0 人日**。

> **⚠ 差额算术的显式化（吸收核验报告 verify-schedule R4）**：上表第 3 项写「−4.5」，而 ① +8.0 与 ② +1.3 合计 +9.3，**+9.3 − 4.5 = +4.8**，与「89.7 − 84.9 = 4.8」一致。**但 4.5 这个数本身没有单点出处**——它不是「1.8 → 1.0」的差额（那只有 0.8）。因此本稿的规范表述改为：**「一致性席上界 20.9 人日中含 4.5 人日的独立 κ 校准块（其自身估为 1.8 人日，见 `09-consistency-feasibility.md:100-101`；本轮按决策 #48 改用既有 `rubricHints`，该块在 v3 中不成立，只计 1.0 人日，另 3.5 人日为口径差异的合并计）——v3 与一致性席的差额因此为 +4.8 人日，落在 §4.12.4 末段所述的「完整工作包 3.5 人日 vs W1 增量 1.0 人日」的口径差上。」** 两种表述必居其一，不得保留原来那个不自洽的写法。

**结论一句话**：在**不扩编**情景下，这个方案在数字上就是「不可能」（缺口 40.2% ≫ 0.5 人日/周的击穿阈值）；在**扩编**情景下，它第一次有了余量。**10/30 的扩编决策不是「加不加人」，是「做不做这条腿」。**

### 6.3 v3 合并排期（W1–W16）

#### 6.3.1 W1 · 10/27–11/02 · 止血 + 身份起手 + 支付开工 + 校准 + 合规

**供给 10.0｜计划 9.5｜余量 0.5｜本周必须做**：是（截止 10/31 的报名与开通收款在第 5 个工作日）

| # | 项 | 人日 | 角色 | 依赖 | 验收判据（可机器判定或可截图判定） |
|---|---|---|---|---|---|
| 1 | M-01 挂载顺序移动 + `analysis.js` 加 `router.use(authMiddleware)` | 1.0 | M | PR#1 | 无 `Authorization` 访问 `/api/sessions/<任意id>/answers/score` → **非 2xx**；`check-middleware-order.mjs` 退出码 0 |
| 2 | M-41 `e2e-auth-routes.mjs` 改用 `route-scanner.mjs` | 0.5 | M | 项 1 | `count-routes.mjs` 输出 **70 条 / 50 路径**（改完 7 条路由进入鉴权测试视野，测试会立刻失败——**这正是要的**） |
| 3 | M-27 `user_sessions` + `login/logout/me` + `auth.js` 改查表（W1 段 1.0 / 全量 1.5） | 1.0 | M | — | 令牌哈希入库；过期与吊销生效 |
| 4 | M-30 CI 拆 `fast`/`full` + e2e 拆 3 job；M-31 限流 `windowMs` 可注入（480s→30s） | 1.5 | T | — | fast 档 CI ≤ 12 分钟；限流可注入 |
| 5 | M-40 ASR 2c2g 实测（延迟/RSS/并发） | 0.5 | M | — | `research/asr-benchmark-2c2g.md` 含实测四指标；**独立预算，不进多任务清单** |
| 6 | M-04 报名材料 + 实人认证前置 + 官方群 9 问 | 0.5 | T | — | 官方群提问留痕（**问死「有效交易是笔数还是去重人数」「小额是否计入」两条口径**） |
| 7 | 域名 + ICP 备案提交 | 0.5 | T | 注册商 | 备案提交回执号（1–3 周，**全程最长前置**） |
| 8 | M-58 `server/package.json` 补 `"private": true` + M-64 统计窗口口径统一 | 0.3 | T | — | 窗口口径写进材料（79 天官方窗口 vs 可累计窗口） |
| 9 | 支付适配器接口契约（`orders` / `entitlements` / `idempotency_keys`）+ 自建轨 9 行工作分解表 | 0.7 | T | — | 三写入路径契约文档 + 9 行分解表逐行有验收点 |
| 10 | **N1 赛道路径归位对照表** | 0.2 | T | 组长拍板 | 一页七列：作品 → Vibe Pay → 网页应用收款 → 人类买方 → 报名人支付宝账号 → 计入路径 → 作品链接归属 |
| 11 | **N2 报名完成 + 开通【网页应用收款】**（**10/31 硬门槛**） | 0.2 | T | 实人认证 | 控制台「网页应用收款 = 已开通」截图 + 日期（**不开通则商业化 25% 直接归零**） |
| 12 | **N3 κ_HH + κ_JH 校准 + 双阈值门禁接线**（素材 = 116 题 `rubricHints`） | 1.0 | M | `rubricHints` | 见 §6.5.2 判据（**三条硬约束**：κ 从四条件移除改为发布门禁 / 双阈值 / 报区间）+ 复算脚本落盘 `trialroom/tools/calibration/` |
| 13 | **N4 MIT 义务收口** | 0.5 | T | — | About 页 MIT 全文 + 两镜像 LICENSE 与 label + 构建产物 `licenses/` + 闭源仓第三方声明（见 §6.11） |
| 14 | **N5 题库来源合规门禁** `verify-source-hygiene.mjs` | 0.8 | T | — | 门禁能独立失败（制造一条越界 source → 退出码非 0）；116 题现有全绿 |
| 15 | **N6 MCP 边界补进主设计文档** | 0.3 | M | — | `Trialroom-全量设计方案.md` 新增「线上 MCP 暴露面与权限边界」一节（**主文档目前零 MCP 内容**） |
| | **W1 小计** | **9.5** | | | 供给 10.0，余量 0.5 |

**W1 是全表最薄的一周**（余量 0.5 = 击穿阈值本身）。处置规则：**W1 一旦超 0.5 人日，立即把 10/30 的扩编决策提前到 10/29**，并把 N5 / N6 各 0.3 顺延 W2——但**项 10–15 一项都不许砍**（κ、合规、开通收款是本轮唯一的净增量，它们不进 A 期则整个 25.5 人日白花）。

#### 6.3.2 W2 · 11/03–11/09 · 数据模型定死 + 隔离启动 + 支付沙箱 + MCP 前置

**供给 18.0｜计划 16.1｜余量 1.9**

| # | 项 | 人日 | 角色 | 依赖 | 验收判据 |
|---|---|---|---|---|---|
| 1 | `db/001_platform_schema.sql` 全量执行（15 张 + `room_answers` + 3 视图 + users 增量） | 0.8 | M | — | `migrate.mjs --check` 退出码 0，二次执行无错 |
| 2 | M-02 5 张关键表 owner 条件 + `requireUser` + 4 处 INSERT 参数化 + 去 4 处 `DEFAULT 'default'` | 2.2 | M | — | 源码无 `'default'` 字面量；`check-owner-isolation.mjs` 报出已覆盖路由 |
| 3 | M-02 `002_user_backfill.sql` + `003_not_null.sql` + 存量归「公共只读区」 | 1.2 | M | 项 2 | 存量行 owner 非空 |
| 4 | M-10 `room_answers` 表 + 2 索引 + 房间规范 §1.5 同步 | 1.0 | M | 项 1 | 表与索引存在；规范文档与 SQL 逐字一致 |
| 5 | M-23 `token_usage.user_id` + JOIN 回填 | 0.5 | M | — | 无空 `user_id` |
| 6 | M-24 删 `users.plan` + 视图调整 | 0.3 | M | — | `plan` 命中 0；`v_user_entitlements` 在位 |
| 7 | M-22 题库 `pro` 标记 + 非 pro 题不挂达标线 | 0.4 | M | — | 116 题标记正确；达标线只按岗位域 |
| 8 | M-03 token 预算原子条件扣减 + 429 统一 + M-29 analysis 10 次/分独立桶 | 0.8 | T | — | 并发超限返 429 且不超发 |
| 9 | M-32 `check-observability-privacy.mjs` + `check-owner-isolation.mjs` 就位 | 0.5 | T | — | 两道门禁进入 `verify-all.mjs` 的 `GATES` |
| 10 | 支付适配器实现（`alipay.trade.page.pay` 下单 / 回调 / 验签 / 幂等 / 订单落库） | 2.0 | T | W1 契约 | 沙箱下单返回 `out_trade_no`；重复回调不重复发货 |
| 11 | **支付沙箱 ¥0.01 全链路**（**11/06 硬门槛**） | 1.0 | T | 沙箱账号 | 下单 → 跳转 → 支付 → 回调验签 → 订单「已支付」→ 权益已发放 → 失败自动退次数，**全过程截图存 `research/`** |
| 12 | PR#1 合并 + 全量回归（自 W1 顺延，附 `migrate-font-scale.mjs` 执行记录与 597 处替换的回归截图） | 1.0 | M | PR#1 | 全量门禁绿 + 字号回归截图（G-15 / CF-23） |
| 13 | **N7 CI 既有红修复** | 0.5 | T | — | `platform-gates` job 绿：要么补第二个 checkout（`repository:` + `path: ../tryout_pr_src/...`），要么把 G1/G8b 移出商业仓 `verify-all`（CF-06）。**另须解决 CF-06b（`web` job 同样必红，§6.9.1）** |
| 14 | **N8a 支付净增**：`alipay.trade.query` 补偿 + `alipay.trade.close` 超时关单 | 1.5 | T | 项 10 | 主动查单能把「已付未回调」补成已支付；超时订单可关 |
| 15 | **N10 获客与漏斗作战表** | 0.5 | T | — | 漏斗式分母写死（UV → 落地页 → 入座 → 练习 → 付费，每环转化率有基准）；11/12 / 11/22 / 12/01 三个人数目标 |
| 16 | **N11a MCP 前置**：`mcp_tokens` 表（token_hash / scopes / aud / expires_at / revoked_at）+ scope 绑定房间 + 越权返 **404** | 1.9 | C | M-02 收口 | 跨 principal 调用返 404（不是 403）；`trialroom:advance` 不能推进非本房间 |
| | **W2 小计** | **16.1** | | | 供给 18.0，余量 1.9 |

**W2 是「不可能周」被解开的第一周**：08 号方案把 W2 判为需要 15–16 人日、产能 10（`08-final-plan.md:515`）。v3 的解法是**在 W2 之前就把支付适配器契约与 9 行分解表做完**（W1 第 9 项 0.7 人日），并**把 MCP 前置放在 W2 而不是 W3**（前置一旦晚一周，MCP 切片与门禁的 4 周窗口就不够）。

#### 6.3.3 W3 · 11/10–11/16 · 隔离收口 + 评分可信度 + 报名完成 + MCP 切片

**供给 18.0｜计划 16.8｜余量 1.2**

| # | 项 | 人日 | 角色 | 依赖 | 验收判据 |
|---|---|---|---|---|---|
| 1 | M-02 隔离收口（剩余写路径 owner 条件 + 越权返回 404） | 1.5 | M | W2 | `check-owner-isolation.mjs` 覆盖 **70 条**且 CI 必过 |
| 2 | M-09 聚合层 fail-open + 弱项过滤 + 失败原因分类 | 1.0 | M | — | mock provider 第 k 次返 429 → `overallScore` 不低于未失败的 90% |
| 3 | M-08 `qualification.ts` 达标判定三条件 + 冷启动 `null` 语义 | 1.5 | M | — | 三条件是纯函数；**κ 不得出现在 `passed` 的布尔表达式里**（见 §6.5） |
| 4 | M-15 一致率口径重构（`summarizeRunsByCase`）+ 区分度护栏 | 1.0 | M | — | 6 道不同题不再进同一数组；压平分数不再得一致率 = 1.0 |
| 5 | M-16 参考答案裁剪接线 + M-21 prompt 顺序修正 | 0.5 | M | — | 参考答案的**格式**不再被当质量信号 |
| 6 | M-19 评分输入预算 + 截断降权 | 0.5 | M | — | 截断不导致维度全 0 |
| 7 | M-14 `materialBoundary`（`stripInvisibleChars` + `wrapAsData`） | 0.5 | M | — | 简历/JD/题目/答案进 LLM 带角色边界标记。**⚠ 见 §3.6.2 的诚实性标注：`stripInvisibleChars` 在基座全仓 0 命中，本项含「新建 `server/services/materialBoundary.js`」** |
| 8 | M-27 `user_sessions` 尾段 | 0.5 | M | W1 | 会话全链路通 |
| 9 | 基线 W1 顺延：M-53 `models.yaml` 8 角色定稿 1.0 + M-37/M-52 决策表重写 0.3 | 1.3 | T | — | 8 角色定稿并回改两份文档；决策表重写 |
| 10 | M-04 报名完成（**11/15 硬门槛**）+ 开通【网页应用收款】+ `service_id` 申请 | 1.0 | T | 实人认证 | 报名完成截图 + 团队 2 人信息；控制台截图「网页应用收款 = 已开通」；`service_id` 申请回执号 |
| 11 | M-03 失败自动退次数 + 退款当日处理 | 1.5 | T | — | 人工触发一次失败 → 次数自动退回 + 退款单生成。**⚠ CF-10 落点：退次数口径须覆盖按次计费（按次计费移 B 期，故本期不适用，须在台账写明）** |
| 12 | M-32 门禁变异测试 + 接 CI 必过 | 0.5 | T | — | 每道新门禁有变异测试（杀一次自己变红） |
| 13 | M-33/M-34/M-56 `/api/log` 脱敏 + 独立桶 + `maskIp` + `X-Request-Id` 校验 | 0.7 | T | — | C1/C2/C4 全绿 |
| 14 | **N8b 支付净增**：`alipay.trade.refund` + `alipay.trade.fastpay.refund.query` 真接口 | 1.5 | T | 项 11 | 退款单可发起、可查询、可对账 |
| 15 | **N9 第一单剧本 + 生产第一笔可计量交易**（**11/12 硬门槛**） | 0.9 | T | 生产环境 | 剧本四步：团队成员本人账号先付 → 三档金额 0.01 / 1.00 / 3.90 → 三处截图 → 按支付宝错误码分流（风控 / 参数 / 额度）；**失败的那几笔也写进材料** |
| 16 | **N12a MCP 最小切片**：5 个房间与面试工具 + 1 个只读证据工具的定义与接线 | 1.0 | C | N11a | 5 个工具的注解四写（`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`）；`submit_self_review` 标 `idempotentHint: true` |
| 17 | **N13a MCP 门禁脚本骨架** `tools/check-mcp-gates.mjs` | 1.4 | C | N12a | 四条断言可执行；**缺脚本 = BROKEN = 失败**（`verify-all.mjs:129-135`） |
| | **W3 小计** | **16.8** | | | 供给 18.0，余量 1.2 |

#### 6.3.4 W4 · 11/17–11/23 · 复盘 v2 + **收款生产上线（11/22）** + MCP 门禁收口

**供给 18.0｜计划 17.5｜余量 0.5｜全表第二紧的一周**

| # | 项 | 人日 | 角色 | 依赖 | 验收判据 |
|---|---|---|---|---|---|
| 1 | M-39 复盘 v2（双栏并排 + diff 高亮 + 达标判定 + 扣分三件套 + 达标线可编辑保守版） | 2.5 | M | M-08 | §10.1「复盘｜六步全通」逐条走通并录屏；扣分三件套（证据 / 判据 / 改法）**同屏**可见 |
| 2 | M-20 `culture` → 「协作行为」改名 + 移出总分 + i18n | 0.5 | M | — | `grep -rn "文化匹配" web/src` 命中 **0** |
| 3 | 房间轮次制前端（建房 / 6 位房号 / 席位 / 状态机 UI / 房主微调 / AI 补位） | 1.5 | M | — | 真人答案默认对其他参与者不可见（`room_seats.visibility` 默认 `private`） |
| 4 | M-09 批量评估分批（每批 ≤ 15） | 0.5 | M | — | 前端有进度条；无 429 尖峰 |
| 5 | 生产部署（域名 + 证书 + 反代 + `scripts/backup.sh`） | 1.5 | T | 备案通过 | 备案未过则用 IP + 临时域名兜底（**不影响支付**） |
| 6 | **M-05 收款生产上线（最小可付版本）** | 2.0 | T | 项 10（W3） | **11/22 生产环境第一笔 ¥0.01 真实订单落库**；订单 + 权益 + 订单截图三件套 |
| 7 | M-62 `/api/metrics`（A 期 6 条）+ 外部告警 | 0.5 | T | — | 返回 6 个指标名；告警通道实测触发一次 |
| 8 | 定价灰度开关（¥0.01 ↔ ¥0.1） | 0.3 | T | — | 一处切换，不需重新构建镜像 |
| 9 | M-38 漏斗埋点 6 事件落库 + 可按日导出 | 0.7 | T | — | 六个事件可按日导出 |
| 10 | M-49 漏斗闭合路径选一条并落到埋点 | 0.5 | T | — | 路径唯一且有埋点 |
| 11 | **N8c 支付净增**：前端付费页（成功 / 失败 / 退款三态反馈）+ 沙箱→生产密钥管理 + 离线对账 | 4.0 | T | 项 6 | 三态反馈各自有截图；沙箱与生产密钥分离配置；`bill.downloadurl.query` 对账脚本可跑 |
| 12 | **N11b MCP 前置**：nginx 独立 `location /mcp/` + `Mcp-Method`/`Mcp-Name` 头体一致校验 + `_meta` 白名单 + Origin 白名单 + 服务端幂等键 | 2.0 | C | N12a | `/mcp` 不再被 SPA fallback 吞成 `index.html`；头体不符返 `-32020`；`_meta` 只白名单取 2 键 |
| 13 | **N12b MCP 正负例矩阵 + `tools/list` 按 scope 分片快照** | 1.0 | C | N12a | 每工具 × 每 scope 的正负例矩阵全绿；分片快照哈希 + `cacheScope`/`ttlMs`/顺序/注解四条附带断言 |
| | **W4 小计** | **17.5** | | | 供给 18.0，余量 0.5 |

#### 6.3.5 W5 · 11/24–11/30 · 房间完整 + 分享获客 + 参评材料 + 影响力物料

**供给 18.0｜计划 13.0｜余量 5.0**

| # | 项 | 人日 | 角色 | 依赖 | 验收判据 |
|---|---|---|---|---|---|
| 1 | 房间后端 + 基础状态机 + 权限模型 + M-11 枚举落地 | 2.0 | M | W4 | 建房 → 房间码加入 → AI 补位 → 房主换题 / 跳过 / 推进 → 逐题评分 → 复盘 全流程可演示 |
| 2 | ASR 逐题转写 + 识别失败立即降级打字 | 1.0 | M | M-40 | 识别失败时 **3 秒内**出现打字输入框，日志里有「识别失败」事件，**无静默** |
| 3 | M-12 参评材料去虚（删「无障碍门禁」「可视化流程编辑器」） | 0.3 | M | — | 材料 §四 无任何「当场点不到」的功能名或数字 |
| 4 | M-36 空档真伪复核表 + §4.3.6 表述改写 | 0.5 | M | — | 复核表逐行有出处 |
| 5 | M-38 支付四段链路勾选项 + 模糊表述换量词 | 0.3 | T | — | 四段链路与实现逐项对齐 |
| 6 | M-54 ADR-01/03/08/09 补备选与翻案条件 | 0.4 | T | — | 每条 ADR 有翻案条件 |
| 7 | **M-51 分享卡片 3:4（两版）+ 落地页 `/l/:shareToken` + 落地页验收清单** | 2.0 | T | 生产环境 | 分享链接点开 → 零注册 → 答 1 题 → 看到 AI 点评，**全程 ≤ 60 秒**；两张卡的二维码分别指向官网作品页与落地页 |
| 8 | M-37 对外文案统一 + §2.12 禁用词清单 | 0.5 | T | — | 文案一次性定稿（**M-37 已重写过一轮，第三次改稿边际成本更高**） |
| 9 | M-66 短版定位（≤20 字，3 候选）+ 渠道文案映射 | 0.3 | T | — | 3 候选 + 映射表 |
| 10 | M-65 免费/付费重答口径统一 | 0.2 | T | — | 口径一处定义 |
| 11 | M-57 MIT `NOTICE` + 第三方许可清单 + 双版本隔离 | 0.5 | T | — | 见 §6.11 |
| 12 | 参评材料 + 作品视频初稿 | 1.0 | T | — | 初稿 |
| 13 | M-35 未注册访客能力矩阵 + M-28 音频 TTL 清理 + M-43 `migrate --check` 收尾（自 W3 顺延） | 1.0 | T | — | 未注册访客能力矩阵定稿；音频 TTL 生效；`--check` 干净 checkout 不崩 |
| 14 | **N8d 支付净增**：对账脚本收口 + 退款当日处理收口 + 付费页缺陷修复 | 1.0 | T | W4 项 11 | 对账脚本与退款链路可跑 |
| 15 | **N12c MCP 证据抽取器对照演示**（同一份证据走两条路） | 0.5 | C | N12b | **可演示的对照**：同一份证据走「直接进评分 prompt」会失真、走「经抽取器」不失真 |
| 16 | **N14 职责分离可见演示** | 0.8 | M | 项 15 | 演示可外部播放；职责分离从「架构主张」变成「看得见的对照」 |
| 17 | **N15 「面试官问你的代码」设计稿** | 0.2 | M | — | 设计稿 + 判据三条（源码行号引用 / no-spoilers 约束 / 三段闭环截图）；**实现移 B 期 W16** |
| 18 | **N13b MCP 门禁接入**：注册进 `verify-all.mjs` 的 `GATES` + 变异测试 + 输入集合完整性自检 | 0.5 | C | N13a | `grep -c "G11" tools/verify-all.mjs` ≥ 1；故意删一个工具 → 门禁必须变红 |
| | **W5 小计** | **13.0** | | | 供给 18.0，余量 5.0 |

**W5 是全表余量最大的一周（5.0 人日），这是刻意留的**：它是 **12-01 23:59:59（官方报名截止，细则 `:26`）** 前的最后一道核对（W5 末 = 11/30；**11/30 是内部缓冲日，不是官方截止日**），也是影响力物料（M-51 分享卡、落地页）和参评材料成稿的周。**这 5.0 人日不是「可以再加功能」，是「11/30 前的机动位」**——因为 11/12 / 11/22 / 12/01 三个商业化 checkpoint 都会把结果推回来，需要有人手改渠道。

#### 6.3.6 W6 · 12/01–12/07 · 收口 + 提交演练 + 影响力物料

**供给 18.0｜计划 10.8｜余量 7.2**

| # | 项 | 人日 | 角色 | 依赖 | 验收判据 |
|---|---|---|---|---|---|
| 1 | 终版回归与缺陷修复 | 2.0 | M | W5 | 全量门禁绿 |
| 2 | M-12 参评材料最终去虚核对 + 「参评材料 → 验收项」对照表 | 0.5 | M | — | §10.1 全表逐行验收；房间行标「部分达成：2 席位 + 轮次制」；广场行标「平台期」；评分行标「6 维」 |
| 3 | 演示脚本（5 分钟讲完「同场 / 可判 / 可重来」） | 0.5 | M | — | 脚本 |
| 4 | M-63 备份恢复演练（恢复到临时目录并校验会话数） | 0.5 | M | — | 临时库会话数与生产一致 |
| 5 | M-38 统计口径验证行 + 作品页自查行 | 0.3 | M | — | 支付宝后台「有效交易」截图已存档 |
| 6 | M-51 作品页首屏（封面 + 视频 + 简介） | 0.5 | M | — | 作品页由非本人账号打开可正常访问 |
| 7 | M-64 + M-66 终版文案与 i18n 校对 | 0.4 | M | — | 校对无错字 |
| 8 | M-49 漏斗闭合路径复核 + 指标实数替换 | 0.3 | M | — | **指标实数替换**（不允许出现占位数字） |
| 9 | 提交前安全回归 + 渗透自测（F-0 复测 / IDOR 抽样 / 上传校验复测 / 签名幂等复测） | 1.0 | T | — | 四项各有记录 |
| 10 | 作品提交演练（表单字段逐条抄录 → 预填 → 截图） | 0.8 | T | 报名后控制台可见 | **12/09 只需点提交** |
| 11 | 参评材料定稿 + 作品页封面 | 0.8 | T | — | 定稿 |
| 12 | M-57 参赛作品著作权声明页 | 0.4 | T | — | 声明页上线 |
| 13 | M-38 A/B 两套真实数据材料择一 | 0.5 | T | — | 方案 B 里**不出现「付费用户数」这个字段** |
| 14 | M-62 监控数据核对 + 提交证据截图 | 0.5 | T | — | 12 条阈值实数核对 |
| 15 | 渠道二次投放 | 0.5 | T | — | 投放记录 |
| 16 | **N12d MCP 端到端验收 + 演示录屏** | 0.8 | C | N13b | 房间与面试工具 + 只读证据工具的端到端演示录屏；每工具 × 每 scope 的负例矩阵全绿 |
| 17 | **N17 影响力物料收口**：首单有效交易截图 + 复盘 diff 截图 + 作品页首屏联动 | 0.5 | T | W4/W5 | 三张物料齐备并可归因到官网作品页 |
| | **W6 小计** | **10.8** | | | 供给 18.0，余量 7.2 |

#### 6.3.7 12/08–12/09 · 提交窗口

**供给 6.0｜计划 6.0｜余量 0.0**

| # | 项 | 人日 | 角色 | 验收判据 |
|---|---|---|---|---|
| 1 | 最终回归 + 提交操作 + 证据截图 | 2.0 | M | 提交成功截图（含提交时间 < 12/09 23:59:59）；全量门禁绿 |
| 2 | 监控与数据核对 + 提交操作 + 回滚预案确认 | 2.0 | T | `v_paid_user_stats` 导出 + 订单截图；回滚预案已确认 |
| 3 | **N18 第三人独立交叉验收**（一人演一人挑刺） | 1.0 | C | 全部 ⬜ → ✅，**第三人是本轮扩编带来的唯一确定性收益** |
| 4 | **N19 降级预案执行**（`PAYMENT_ENABLED=false` 或材料改写） | 1.0 | M/T | 12/08 22:00 判定点执行记录（`08-final-plan.md:987`） |

#### 6.3.8 W7–W16 · B 期（12/10 起，2 人名义产能 100 人日）

| 周 | 主题 | 基线人日 | v3 新增 | v3 合计 | 供给（2 人 / 3 人） | 关键交付物与验收 |
|---|---|---|---|---|---|---|
| W7 | 评分内核升级 + 房间完整化 | 10.0 | — | 10.0 | 10 / 18 | M-21 2026 五维 + M-18 表达力对齐；11 维可见；ADR-001 本地复现报告 |
| W8 | 广场第一批 + 内容台账 | 10.0 | **1.5**（BYO 证据区表 + 抽取器原型） | 11.5 | 10 / 18 | 证据区表并入 W2 已定死的 schema，**W3 之后不得加表**（决策 #28 的一次到位原则） |
| W9 | WebRTC + 能力探针 | 10.0 | **1.0**（BYO 远程 HTTP 端点接入） | 11.0 | 10 / 18 | BYO 只接远程 HTTP（**自建 / 动态 IP / 无 HTTPS 用户用不了，材料不得暗示是普适能力**，CF-07 附注） |
| W10 | 房间第二批 + 监控补齐 | 10.0 | — | 10.0 | 10 / 18 | 房主实时语音插追问；`/api/metrics` 返回 12 个指标名 |
| W11–W12 | 商业闭环 | 20.0 | **2.5**（MCP 写工具 + 按次计费 402 中间件 1.5 / OAuth 2.1 资源服务器备选 1.0） | 22.5 | 20 / 36 | 双轨共存写同一套 `entitlements`；**计费作为装饰器接入，不改 MCP 调用链**（R-19 的顺序约束） |
| W13–W14 | 上传与安全 | 20.0 | — | 20.0 | 20 / 36 | 上传 11/11；通用 `scopedDb` 全量覆盖 20 张存量表 |
| W15 | 前端与框架 | 10.0 | — | 10.0 | 10 / 18 | 首屏 chunk 下降；`text-xs` 命中 0 |
| W16 | 题库第二批 + 资产决策 | 10.0 | **3.3**（「面试官问你的代码」实现 2.0 / `v_calibration_pairs` 视图 + 标注者间 ICC 0.8 / 题库 116→200 口径统一 0.5） | 13.3 | 10 / 18 | 400+ 题；「岗位基准线」每格 ≥ 4 题且标注者间 ICC ≥ 0.6；**M-60 题库公开取舍写入设计文档** |
| **合计** | | **100.0** | **8.3** | **108.3** | 100 / 180 | 2 人情景缺 8.3 人日 → 从 B 期原 100 中置换或待第三人到岗；3 人情景余量 71.7 |

**B 期明确不做（五项，写进材料口径）**：

- **OAuth 2.1 资源服务器**——本轮从「本周清单」删除（裁决 §七末段：「44 天走不完就别写进清单，写进去会让整套判据体系失真」）。A 期用 Bearer + per-tool scope；OAuth 2.1 留作 B 期 W11–W12 的**备选**，不作为本作品的依赖。
- **BYO 远程 endpoint 接入**——移 B 期 W9（CF-13：方案 §一 自己把它定义为「另一条腿」，且它需新增证据区表，破坏决策 #28 的 DDL 一次到位）。
- **分账**——不排期。理由是收入模型单边（用户付费 → 平台交付 → 用户得权益，平台不向用户付款），因此不需要分账能力（PC-10）。**并且参评材料不写「分账」两个字**。
- **x402**——不排期，理由换成结构性表述（PC-12）：x402 的买方是 agent + facilitator，**付款人不是支付宝实名自然人**，在结构上无法进入「累计完成有效交易的去重用户数」。
- **Machine Pay**——不进入本作品排期。决策 #43 已定：Machine Pay 是独立特殊赛道，若要做**必须另立独立作品**，不共用作品链接，其 agent 付费用户**不计入 Trialroom 的商业化叙述**。

### 6.4 取舍建议：砍什么、保什么、什么必须移 B 期

#### 6.4.1 不可砍四项

`00-当前状态索引.md:175-180` 定的四条：**多用户隔离**（合规底线，也是「接支付」的前置）、**支付与权益**（评分的 25%）、**复盘回溯**（付费理由，竞品完全没有）、**品牌与文案**（对外第一印象）。`08-final-plan.md:421` 追加一句：「房间轮次制、复盘回溯、多用户、支付四项在任何情况下都不砍。」

#### 6.4.2 保：最小不可砍集（砍伐时从这张表的**外面**开始砍）

| 保什么 | 最小可交付 | 人日 | 为什么不能砍 |
|---|---|---|---|
| **支付与权益**（含 N8 净增 8.0） | 下单 / 回调验签 / 四项二次校验 / 幂等 / `trade.query` 补偿 / `trade.close` 关单 / `trade.refund` + `fastpay.refund.query` / 前端付费页三态 / 沙箱→生产密钥 / 离线对账 + 11/22 上线 + 支付宝后台「有效交易」截图 | ≈ 9.3（台账）+ 8.0（净增） | 支付集成度 25% + 商业化 25% 共 50 分，且**唯一不能靠写代码补救**。PC-04 明写：差额「**不能从支付里砍**」 |
| **多用户隔离** | M-02 的 5 张关键表 + `requireUser` + 4 处 INSERT 参数化 + 去 4 处 `DEFAULT 'default'` + `002_user_backfill.sql` + `003_not_null.sql` + `check-owner-isolation.mjs` 覆盖 70 条 + 跨用户返 404 + **MCP 工具纳入 owner 门禁扫描范围** | 4.9 + 0.3 | 合规底线；且**MCP 是新增攻击面，门禁不扩 = 隔离结论对新面无效**（CF-07） |
| **复盘回溯** | M-39 W4 版（双栏并排 + diff + 达标判定接线 + 扣分三件套 + 达标线可编辑保守版）+ `v_calibration_pairs` 视图（0.3，B 期 W16） | 2.5 + 0.3 | 付费理由；竞品完全没有；**κ 的第二数据源** |
| **品牌与文案** | M-66 短版定位 3 候选 + M-37 禁用词清单 + 分享卡 / 落地页**一次性定稿** | ≈ 3.0 | 对外第一印象；**影响力 20 的唯一入口** |
| **κ 校准（1.0）** | 报区间 + 双阈值 + κ 从四条件移除改为发布门禁 | 1.0 | 见 §6.6.3 的止损规则豁免：**它用 1 人日换掉一整类评审质疑，性价比高于任何 P0 评分升级** |
| **MIT 义务 + 来源合规（1.3）** | About 页 MIT 全文 + `THIRD_PARTY_LICENSES/` + 两镜像 LICENSE 与 label + `verify-source-hygiene.mjs` | 1.3 | **设计方案的验收标准当前是假的**（`Trialroom-全量设计方案.md:2369` 写「第三方声明页含 MIT 全文与各依赖许可」，实际 0 命中）。「不做就欠着债、做了直接加分」 |
| **获客与漏斗（0.5）** | 分母写死的验算式 + 三 checkpoint 人数目标 | 0.5 | 商业化 25% 是**唯一无法靠写代码提升的维度**（索引 `:209`），零动作 = 25% 默认归零 |

#### 6.4.3 砍 / 移 B 期：等量置换表（G-1 要求的「新增 ↔ 置换」）

新增 25.5 人日的合法支付来源只有三类（`09-consistency-feasibility.md:339` 的 G-1）：**§3.2 已列 B 期项 / §3.3 降级池 7.0 / 扩到 3 人**。

| # | 置换来源 | 释放人日 | 置换掉的新增项 | 代价（必须写进参评材料） |
|---|---|---|---|---|
| ① | **扩到 3 人**（10/30 决策，11/03 到岗） | **+42.0**（供给侧：W2–W6 每周 +8，提交窗口 +2） | 覆盖 N11 MCP 前置 3.9 + N12 MCP 切片 3.3 + N13 MCP 门禁 1.9 + N8 支付净增中的 4.0 | 新成员边际有效产能 8 人日/周而非 15；报名表须 11/15 前改；决策 #3「作品数 3 件」会复活（但决策 #13「只交一件」已定，不追加） |
| ② | **降级池 7.0**（预启动，触发条件见 §6.6） | **7.0** | 覆盖 N14 职责分离演示 0.8 + N17 影响力物料 0.5 + N18/N19 提交窗口 2.0 + N9 第一单 0.9 + N6 设计文档 0.3 等 | M-62 metrics 12→6 条；M-38 埋点 10→6 事件；M-09 批量分批挪 W4；M-32 变异测试挪 W3；M-28 音频分区目录并入 M-02；M-13 上传 5→3 道；M-33 `stack` 截断（**最后才砍**，砍了失去隐私门禁 C4） |
| ③ | **追加移 B 期**（在 §3.2 的 20 项之外新增） | **8.3** | BYO 证据通道 2.5 → W8（1.5）/ W9（1.0）；MCP 写工具与按次计费 2.5 → W11–W12；「面试官问你的代码」实现 2.0 + `v_calibration_pairs` 与标注者间 ICC 0.8 + 题库 116→200 口径统一 0.5 = 3.3 → W16 | 参评材料**不得暗示**实时通话、BYO 普适可用、按次计费已落地 |
| ④ | **08-final-plan §3.2 已列 B 期项的既有释放** | **20.4** | 不直接置换本轮新增，但**腾出 A 期产能**（广场 22–32、WebRTC 18–24、上传审核流、Skill 市场、团队版发票、题库扩量 30–40、2026 五维 2.5、前端打磨包 3.5、房间完整 5 状态机 3.5、ASR 双通道 1.0、零泄漏运行时收口 1.0、表达力对齐 1.0、能力探针 1.0、`content_purchases` 0.7、skills owner 0.3、上传审计 0.9） | 产品完整度 30% 从「三条主干齐活」降为「练习 + 复盘完整、房间部分达成、广场未上线」，评分内核停在 6 维。**§10.1 有三行必须标「部分达成」，材料里如实写** |
| | **合计 77.7** | | **= ① 供给侧扩编 42.0（覆盖 25.7 缺口并留出 16.3 余量） + ②③④ A 期内部再腾 35.7（情景 B 的二次弹药，④ 不直接置换本轮新增）** | — |

**未置换的 25.5 人日中，有 9.1 人日是 MCP 块**。若 10/30 扩编未通过，MCP 整块（前置 3.9 + 切片 3.3 + 门禁 1.9）**必须移 B 期**——这与 08-final-plan 的「只做一条腿」原则一致（`09-consistency-feasibility.md:104`、`:251`）。

#### 6.4.4 两种情景与两条分支

| | **情景 A：10/30 扩编通过** | **情景 B：10/30 不扩编** |
|---|---|---|
| 供给 | 106.0 人日 | 64.0 人日 |
| 需求 | 89.7 人日 | 89.7 人日 |
| 缺口 | 0（余量 16.3，返工容差 3.26 人日/周） | **25.7 人日 = 产能的 40.2%** |
| MCP 块 9.1 | 保（A 期交付，演示「统一权限模型」） | **整块移 B 期**（→ 需求 80.6，仍缺 16.6） |
| 再砍 | — | 职责分离演示 0.8 + 影响力物料 0.5 + 设计稿 0.2 + 降级池 7.0 → **72.1，仍缺 8.1** |
| 再砍 | — | M-39 复盘 v2 降为 v1（−1.5）+ 房间轮次制前端（−1.5）+ M-53 `models.yaml`（−1.0）+ M-08 达标判定（−1.5）→ **66.6，仍缺 2.6** |
| 结论 | v3 排期可执行 | **已触及「不可砍四项」与 P0 的底线**。剩余唯一可行路径是**接受 12/01 上线**（统计窗口 17 天 → 9 天，商业化 25% 的杠杆折半）+ **砍掉评分可信度块**（产品完整度 30% 的「凭什么准」当场塌掉） |
| 决策人 | 组长 | **必须在 10/30 当天拍，不允许拖到 11/09** |

**给业主方的一句话**：情景 B 不是「紧张」，是「不可能」。而 10/30 这个日子是**不可移动的**——报名表须 11/15 前改（`08-final-plan.md:1120`），11/09 决定只剩 4 个自然日走完改表 + 新成员加入，实务上不可行（CF-02 / `09-consistency-feasibility.md:136-137`）。

### 6.5 本周清单 v3

> 终稿 §八 的 7 项已被业主方裁决 §七的 10 项取代（`10-adversarial-verdict.md:175-188`；索引 `:409-411` 同步记录了这次取代）。本节把 10 项**重排为可执行顺序**，并为每一项补齐「前置 / 判据 / 失败时怎么办」。本节的 10 项即本方案 §7 的本周开工清单。

#### 6.5.1 执行顺序（按「能不能不做就归零」排序，不按技术难度排序）

| 序 | 事项 | 成本（人日） | 前置 | 完成判据（可验收） | 不做 / 失败时 |
|---|---|---|---|---|---|
| **1** | **报名完成 + 开通【网页应用收款】** | 0.2 | 实人认证 | 控制台「网页应用收款 = 已开通」截图 + 日期 + 账号；**10/31 前** | **不做则商业化 25% 直接归零**（`00-当前状态索引.md:199`）。这是全清单**最便宜且唯一非代码**的前置，必须排第一 |
| **2** | **赛道路径归位** | 0.2 | 组长拍板 | 一页七列对照表：Trialroom → **Vibe Pay 主赛道** → **网页应用收款** → 人类买方 → 报名人支付宝账号 → 计入路径 → 作品链接归属；**Machine Pay 一栏写「另立独立作品，不共用作品链接」** | 不做 = 作品被判投特殊赛道，与决策 #13 冲突，且 `:127`「同一赛道内最多 1 个作品可获奖」意味着换赛道就是换奖池 |
| **3** | **κ_HH + κ_JH 校准**（素材 = 116 题 `rubricHints`，零新增标注） | 1.0 | 无（素材已在库） | **见 §6.5.2 的三条硬约束，全部满足才算完成** + 复算脚本落盘 `trialroom/tools/calibration/` | 不做 = 参评材料在「凭什么准」这一问上无实物可举；且 κ 门禁无法接线 |
| **4** | **MIT 义务 + 题库来源合规** | 1.3 | 无 | About 页 MIT 全文 + `THIRD_PARTY_LICENSES/` + 两镜像含 LICENSE 与 `org.opencontainers.image.licenses` + 构建产物含 `licenses/` + `verify-source-hygiene.mjs` 能独立失败并接进 CI + `SCHEMA.md:60` 措辞已改 | 不做 = **当前状态下设计方案的验收标准是假的**（合规行 0 命中）；且 GPL-3.0 仓库已在 `source` 字段里，只差一次手滑 |
| **5** | **支付接入开工**（窗口 10/27 起） | 台账 9.3 + 净增 8.0（分 4 周） | 第 1 项 + 支付适配器接口契约（W1） | 支付窗口 **10/27 起**；沙箱全链路 **11/06** 前跑通；生产第一笔可计量交易 **≤ 11/12**；**第一单剧本**四步（成员本人账号 → 三档 0.01/1.00/3.90 → 三处截图 → 错误码分流） | 11/22 上线不可达 → 统计窗口 17 天 → 9 天 → **商业化 25% 的唯一杠杆折半** |
| **6** | **获客与漏斗作战表** | 0.5 | 无 | 漏斗式**分母写死**（UV → 落地页 → 入座 → 练习 → 付费，每环有基准转化率）+ 11/12 / 11/22 / 12/01 三个 checkpoint 人数目标 + 六个埋点事件按日可导出 + **方案 B 备料**（若 12/01 仍 < 5 人，材料改用「内测 N 人 + 完整订单链路录屏 + 渠道投放数据」，**不出现「付费用户数」这个字段**） | 不做 = 25% 默认归零；且 12/01 止损点无判据 |
| **7** | **CI 既有红修复 + MCP 边界补进主设计文档** | 0.5 + 0.3 | 无 | `platform-gates` job 绿（第二个 checkout 或 G1/G8b 归位）+ **`web` job 前提解决（CF-06b）**；`Trialroom-全量设计方案.md` 新增「线上 MCP 暴露面与权限边界」一节 | 不做 = 「失败能让构建变红」这句话无从验证（因为构建本来就是红的）；且**评审翻主文档看不到任何边界设计** |
| **8** | **MCP 最小切片**（**前置：§6.4.4 情景 A 成立 + N11 前置完成**） | 切片 3.3 + 门禁 1.9 | N11 前置（M-02 收口） | 5 个工具 + 1 个只读证据工具；**每工具 × 每 scope 的正负例矩阵全绿**；`tools/list` 按 scope 分片快照（分片 + `cacheScope`/`ttlMs`/顺序/注解四条附带断言）；**全部由 `tools/verify-all.mjs` 一条命令触发，任一失败退出码非 0**；工具注解四写；`submit_self_review` 标 `idempotentHint: true` | 前置未完成则不得开工（S-16：「在此之前第 2 项不得开工」）。情景 B 下整块移 B 期 |
| **9** | **把「职责分离」做成看得见的演示** | 0.8 | 第 8 项 | 同一份证据走两条路的对照演示（直接进评分 prompt 会失真 / 经抽取器不失真）**在 A 期外部可见** | 不做 = 统一权限模型只是一句主张，评审看不到；且 S-18 的「职责分离在 A 期外部完全不可见」问题未解 |
| **10** | **「面试官问你的代码」设计稿**（实现移 B 期） | 0.2 | 无 | 判据三条：① 每个问题带**源码行号引用** ② 提问受 **no-spoilers** 约束（只回题干与分级提示、不回答案、**不执行用户代码**）③ 回答进评分 → 达标判定 → 复盘重答三段各有截图 | 本周客观不可实现（依赖 M-39 复盘 W4，CF-14）。**参评材料不得出现「别人问不了你的代码」**——至少 6 个产品在做这件事（L-14） |

#### 6.5.2 第 3 项（κ 校准）的完成判据：三条硬约束，缺一不可

终稿把这一项的完成判据写成「算出 κ 值」——**这是一个没有验收力的判据**（算出任何数都算完成，包括算错）。AI 席与业主方裁决给出的正确形态是三条，v3 把它们写死为**可验收条款**：

> **判据 A（层级归位）**：κ **从达标判定的四条件中移除**，改为**发布门禁**——校准集 κ 达不到门槛，该 judge 不许上线；运行时第三条件保留「单答案稳定性」，即 M-15 修好口径后的 `consistency.ts`（组内一致率 + 区分度护栏）。
> 验收：`Trialroom-全量设计方案.md:777-783` 的四条件块已改写，**`passed = 1 当且仅当 …` 的布尔表达式里没有 κ**；`qualification.ts` 中 κ 只出现在发布检查路径上。**依据**：`10-adversarial-verdict.md:68-70`（κ 是语料级 × 版本级统计量，不是单条答案级谓词；放进逐题判定里要么恒真、要么要求生产环境持续人工标注）。
>
> **判据 B（双阈值）**：先测 **κ_HH**（两名标注者之间的 κ，零额外成本），门禁写成**双阈值**：`κ_JH ≥ 0.85 × κ_HH`（相对）**且** `κ_JH ≥ 0.60`（绝对地板）。
> 验收：报告里同时有 `κ_HH`、`κ_JH`、两个阈值与两者的比较结果；CI 里有一条断言在 κ_JH 低于任一阈值时**退出码非 0**。**依据**：`10-adversarial-verdict.md:74`（0.70 这个阈值没有出处；ELBench 要求「以人类天花板为参照」，而我们连天花板没测）、决策 #47（`00-当前状态索引.md:380`）。
>
> **判据 C（报区间，不报二值）**：**放弃二值门禁**，报 **κ 的 95% 区间 + 相对回归门禁**；若坚持要一个绝对数字，n ≥ 300。
> 验收：报告给出 n、逐维 κ、95% 区间、以及「区间下界低于阈值」的三条分支处置；**材料里同时给出旧→新换算表**（旧口径「一致率 ≥ 85%」≈ κ 0.79；「κ ≥ 0.70」≈ 精确一致率 77.3%），并主动说明「**这不是换了一把更严的尺，是降标**」。
> 验收（诚实性）：n = 40–60 时零假设下 κ̂ 的 95% 区间宽 **0.615（n=40）/ 0.493（n=60）**，即使真 κ 恰为 0.70，P(下界 ≥ 0.70) 仅 **0.2% / 0.6%**——材料必须写出这个区间宽度。**依据**：`10-adversarial-verdict.md:75-76`；AI 席 J-02/J-03/J-04。

**素材来源（零新增标注成本）**：116 道 Pro 题每题带 3–5 条逐题逐维人工锚点 `rubricHints`（`questionbank/SCHEMA.md:29`：「评分锚点，对应 Tryout 现有 6 维 rubric」），而 `web/src` 与 `server` **全仓对 `rubricHints` 零命中**——它被校验、被要求、被文档承诺，但**评分器从来没读过它**（`10-adversarial-verdict.md:163`）。用既有锚点当 κ_HH 的标注素材，顺手修掉一个「文档承诺 vs 实现」的老洞。

#### 6.5.3 从本周清单里删掉的三项

| 删掉 | 理由 |
|---|---|
| **OAuth 2.1 资源服务器** | 44 天走不完就别写进清单，写进去会让整套判据体系失真（裁决 §七末段）。A 期用 Bearer + per-tool scope；OAuth 2.1 降为 B 期 W11–W12 备选（§6.3.8） |
| **BYO 远程 endpoint 接入** | 移 B 期（CF-13）。且只接远程 HTTP = **要求用户有公网可达回调地址**，2c2g 自建 / 动态 IP / 无 HTTPS 的用户用不了——这条腿做出来是「演示专用」而非「可用功能」，参评材料不能暗示它是普适能力 |
| **「达标判定第三条件改写为 κ ≥ 0.70」** | 层级错（κ 不是逐题谓词），已由第 3 项替代（§6.5.2 判据 A） |

### 6.6 止损点与倒排

#### 6.6.1 合并后的止损点表（9 个主止损点 + 2 个 08 号原有止损点 + 1 个新增）

既有 6 个（`00-当前状态索引.md:195-204`）+ 本轮新增 3 个（`:413-419`）合成下表。每行写明：**检查什么 / 阈值 / 不通过时砍什么、保什么、找谁**。

| # | 日期 | 检查什么 | 阈值（判定口径） | 不通过时：砍什么 | 不通过时：保什么 | 找谁 |
|---|---|---|---|---|---|---|
| **1** | **10/30** | **扩到 3 人的决策是否已决** | 报名表须 11/15 前改 → 10/30 是最后可动日 | MCP 块 9.1 人日整块移 B 期；N6 设计文档 0.3 移 W2 | κ 1.0 + 合规 1.3 + 支付净增 8.0 + 不可砍四项 | 组长（拍板）+ M（重排 v3 情景 B）+ T（通知报名表改动） |
| **2** | **10/31** | **报名完成 + 【网页应用收款】已开通** | 控制台截图「已开通」；个人收款主体可用（决策 #45） | **无（本项不可砍）**——它是商业化 25% 的唯一非代码前置 | 一切 | **T（当天完成）**；未完成则当天在官方群报备并问「个人主体入驻的最短路径」 |
| **3** | **11/06** | **支付沙箱全链路是否跑通** | 沙箱 ¥0.01 订单 + 回调验签 + 权益发放 + 失败自动退次数，**四件齐** | ① M-12 2026 五维（已在 B 期）② M-62 metrics 12→6 条 ③ M-38 埋点 10→6 事件 ④ M-13 上传 5→3 道 ⑤ 房间轮次制 UI（保 W5 后端最小版） | **支付全链路**；**κ 校准（豁免，见 §6.6.3）**；M-08 达标判定（最低可付版本依赖它） | T 主责，M 转去补 M-02 隔离收口 |
| **4** | **11/08（对外复述 11/06 判定，非新增里程碑）** | **支付通了吗**——**判定事件与止损点 3 同一件，唯一里程碑日 = 11/06** | 同止损点 3 的四件齐 | 见 §6.6.3 的改写规则 | 见 §6.6.3 | T |
| **5** | **11/09** | **上线周实际消耗** | > 10.5 人日/周（**2 人口径**）→ 立即启动降级池 7.0 | 降级池按序砍（`08-final-plan.md:454`） | 降级池用尽后仍不够 → 唯一剩下的手段是**延后收款上线** | M |
| **6** | **11/12** | **生产第一笔可计量交易是否完成 + 付费人数 vs checkpoint 目标** | 订单落库 + 权益到账 + 三处截图 | ① 立即上报官方群 ② 11/22 上线不可达 → **接受统计窗口从 17 天掉回 9 天**，商业化预期下调 ③ 渠道全开（校园/求职群优先，小红书降权） | 支付链路；分享卡与落地页（引流入口不能砍） | T（支付）+ M（渠道与材料改写） |
| **7** | **11/15** | **报名完成**（控制台开通能力前置）+ 付费用户数 | 报名完成截图 + 团队 2 人信息；付费用户 < 5 | 全面转 1 分钱策略（若 M-07 口径未明先切 ¥0.1）+ 换渠道 + 分享落地页改最轻版本（只问 1 道题） | 一切；**「若仍无 `service_id` → 接受放弃商业化 25%」**（`08-final-plan.md:1135`） | T |
| **8** | **11/22** | **收款生产上线了吗** | 生产第一笔 ¥0.01 真实订单落库 + 订单/权益/订单三件套截图 | 砍房间与分享卡片，优先把「练习 + 复盘 + 付费」做透 | 支付、复盘、达标判定 | T |
| **9** | **11/25** | **付费用户数** | < 20 → **Vibe Pay 只做 1 件**（Tryout 打透），砍 mcode-theme | 不再追加任何作品、不再开新功能线 | 决策 #13「只交 Tryout 一个作品」 | M |
| **10** | **12/01 23:59:59** | **报名是否已提交并通过审核**（平台硬截止） | 控制台报名状态 = 已提交 + 提交时间 ≤ 12/01 23:59:59 | ① 立即上报官方群问「晚交是否可补」② 启动 M-06 兜底（组长代报 + 团队 2 人信息） | 支付、作品提交 | T |
| **11** | **12/01** | **付费用户数** | < 30 → 接受商业化 25% 丢分，资源全砸 75 分可控区 | — | 产品完整度 30 + 支付集成 25 + 影响力 20 | M |
| （附）**12** | **12/07** | **提交就绪度** | §10.1 / §10.2 / §10.3 逐行可勾 | 只修 P0；标注「部分达成」项（房间行 / 广场行 / 评分维度行） | **不虚报任何能力** | M |

（止损点 12 是 `08-final-plan.md:972` 原有、索引未列；止损点 5 是 `08-final-plan.md:967` 的 11/09，与索引 §九 的 6 个不重合，故一并列上。**支付里程碑日收敛为 4 个：10/27 开工（窗口起算，非里程碑）/ 11/06 沙箱 / 11/12 首笔 / 11/22 上线**；11/08 降级为对外复述。）

#### 6.6.2 倒排的关键路径

```
10/27 ─ M-01 修复 ─┐
                    ├─► 11/06 沙箱通 ─► 11/12 第一笔生产交易 ─► 11/22 收款上线 ─► 11/30 报名完成（**内部缓冲日**，出自本项目自定清单 `官方规则原文与限制清单.md:214` 第 7 条，**非官方规则**；官方硬截止 12-01 23:59:59，见细则 `:26`） ─► 12/09 提交
10/27 ─ M-02 隔离 ─┘      │                  │                     │
                           └─ 10/30 扩编决策  └─ 11/08 止损判定      └─ 11/25 / 12/01 人数判定
                              │
                              └─ 11/03 第三人到岗 ─► W3–W6 MCP 块交付 ─► W6 端到端验收
```

三条被 v3 改写的依赖：

1. **10/30 扩编决策 → 11/03 第三人到岗 → W3–W6 的 MCP 块**。前置决策必须比它的前置依赖更早（CF-02 的原话）。
2. **10/27 支付接口契约 → W2 支付适配器实现 → 11/06 沙箱**。契约在 W1 而不是 W3，是为了让 W2 的支付工位不被 MCP 抢走（CF-19）。
3. **MCP 前置（M-02 收口）→ MCP 切片 → MCP 门禁 → MCP 端到端验收**。MCP **不得早于 M-02**（CF-07 的硬顺序）。

#### 6.6.3 11/08 止损规则的改写（原文 → 改写后）

**冲突所在**：状态索引 §九 第 2 行原文是——

> | **11/8** | 支付通了吗 | 没通 → **立刻砍所有 P0 评分升级**，全力保支付 |

而本轮第 3 项（κ 校准）**就是一块 P0 评分升级**（它落在 W3 的评分可信度块里，M-08/M-09/M-15/M-16/M-19/M-14 = 5.0 人日，`08-final-plan.md:516`、`:562-568`）。一致性席 CF-03 的判断是：「现状是『阻断项』却落在『第一批被砍的块』里，方案自相矛盾」（`09-consistency-feasibility.md:54`）。

**为什么 κ 不该被砍**（三条，全部可核对）：

1. **成本不对称**：κ 校准 1.0 人日（= 裁决 0.75 + 门禁化接线 0.25），而「P0 评分升级块」是 5.0 人日。κ 用 1 人日换掉的是**一整类评审质疑**（「凭什么你的分比它准」），性价比高于任何一项评分升级。
2. **它独立成立**：κ 不依赖支付链路、不依赖生产环境、不依赖真实用户——素材是既有的 `rubricHints`，在 W1 就能做完。砍支付不影响 κ 的可执行性。
3. **它已经是「前置可信项」不是「阻断项」**：κ 的定位是发布门禁（这一版 judge 敢不敢上线），不是达标判定的运行时条件。**它已经做完（或在 W1 做完），11/08 时它不在「待砍的块」里**——这是本节把 κ 前移到 W1 的直接理由。

**改写后的止损规则原文（逐字照用）**：

> | **11/08** | **支付沙箱全链路是否跑通**（沙箱 ¥0.01 订单 + 回调验签 + 权益发放 + 失败自动退次数，四件齐） | 没通 → ① **立刻砍 W4 的房间前端**（保 W5 的后端最小版），T 全职保支付；② **砍伐顺序固定为**：M-62 `/api/metrics` 12→6 条（−0.5）→ M-38 埋点 10→6 事件（−0.5）→ M-09 批量评估分批挪 W4（−0.5）→ M-13 上传 5→3 道（−1.5）→ M-28 音频分区目录并入 M-02（−0.5）→ M-33 `stack` 截断（**最后才砍**，砍了失去隐私门禁 C4）；③ **κ 校准（1.0 人日 = 裁决 0.75 + 门禁化接线 0.25，W1 已完成）不在砍伐范围内**——理由：它用 1 人日换掉一整类评审质疑，性价比高于任何 P0 评分升级；它独立成立、不依赖支付链路，且它是发布门禁不是运行时条件；④ **M-08 达标判定三条件保留**（最低可付版本依赖它产出「达标」结论）；⑤ 若 11/12 仍未见生产第一笔可计量交易 → 转 §6.6.1 止损点 6 的处置 |

**这条改写同时解决了另一个隐患**：原止损规则「立刻砍所有 P0 评分升级」是一句**不可执行的口号**——它没说砍哪些、保留哪些、谁拍板、什么时候复评。改写后它是一串有顺序、有金额、有豁免项、有责任人的动作清单，且与 §6.3 的降级池 7.0 严格对齐（`08-final-plan.md:454`）。

#### 6.6.4 止损点与 v3 周次的对齐检查

| 止损点 | 落在 v3 的哪一周 | 该周的余量 | 该止损点触发时本周还能不能吸收 |
|---|---|---|---|
| 10/30 扩编 | W1 | 0.5 | **不能**——必须当天拍板，靠余量吸收不了 |
| 10/31 开通收款 | W1 | 0.5 | 不能（硬门槛） |
| 11/06 沙箱 | W2 | 1.9 | 能（N9 第一单剧本在 W3，还有缓冲） |
| 11/08 支付（复述） | W2 | 1.9 | 能 |
| 11/09 消耗 | W2 | 1.9 | 能（降级池 7.0 可启动） |
| 11/12 第一笔生产交易 | W3 | 1.2 | 勉强（若不达标则按止损点 6 直接进入 12/01 上线情景） |
| 11/15 报名完成 | W3 | 1.2 | 能 |
| 11/22 收款上线 | W4 | **0.5** | **不能**——这是全表第二紧的一周，触发即意味着砍房间与分享卡 |
| 11/25 人数 | W5 | 5.0 | 能（渠道动作不需要开发工时） |
| 12/01 人数 | W6 | 7.2 | 能 |
| 12/07 提交就绪 | W6 末 | 7.2 | 能 |

**三处余量为 0 或近 0 的周（W1 0.5 / W4 0.5 / 提交 0.0）就是本方案的三个事故点**，必须在 W1 的第一次站会上逐条念一遍。

### 6.7 评审问答演练（10 问）

> 规则：每题给出**可直接说出口**的回答，并**诚实标出当前答不上来的部分**。分类：**A = 方案里根本没有**、**B = 方案里有但实物不存在**、**C = 有实物但会被追问穿**。

**Q1. 这是给谁用的？**
> ✅ **可答**：「技术岗与 AI 岗求职者，在自己的服务器上，和真人或 AI 同场练一场面试，会后逐题重答，看自己有没有达标。」
> 依据：决策 #5 收窄受众（`00-当前状态索引.md:22`）；设计的 §1.1/§2.12 定位四处逐字一致（M-66 复核通过，是 69 条裁决里唯一无问题的维度）。
> ⚠️ **C（会被追问穿）**：本轮平台化叙事把重心挪到「让外部 agent 消费我们的房间」。**同一产品对两个受众讲两套故事**，评委问「到底给谁用」时答案必须锁定求职者侧（CF-20）。**双受众分层，不许混讲**：对外（作品页 / 落地页 / 分享卡）讲**求职者**故事；对决赛评委讲**平台 / 协议**故事。
> ❌ **A（当前完全答不上来）**：「**那你的 agent / 开发者用户呢？**」——agent 侧的 ICP 是什么、为什么愿意付费，本轮方案没有一句。**这一条不能靠工程补，它是定位问题**（CF-05 汇总表第 4 行：「不能」）。v3 的处置：在材料里明确写「**平台化是能力，不是第二条用户故事**」。

**Q2. 和职悟空 / 鹅来面 / 牛客 AI 面试的差别是什么？**
> ✅ **可答，且这是本方案最强的一段**：「**能做群面不是空白**——Candaigo 已经做 2–10 人群面，Swanx 已做多 AI 人格房间。所以我们的差异化不在『能做群面』，在两件事：**一是可判**（它们把评分做成黑盒，我们有岗位基准 + 达标判定 + 扣分三件套 + 新旧并排 diff）；**二是同场可含真人**（它们全是 AI 扮演 AI，我们允许席位坐真人或 AI）。」
> ✅ **补一刀**：「而且我们把题库从零重制，116 题带参考答案、零泄漏——存量 808 题连 `referenceAnswer` 键都没有。」
> ✅ **成本对比可用**：牛客 20 元、智面官 49 元、鹅来面 49 元（`05-product-commercial.md:94`），我们的首单是 **¥0.01**。
> ⚠️ **C**：「你怎么保证 Candaigo 真的能做群面？」→ 必须能说出可查证的差异（Swanx 的房间级五维：stakeholder recognition / authority routing / constraint tracking / commitment consistency / coalition use）。
> ❌ **A（这一刀会真的砍进来）**：「**你们的达标线和岗位基准，116 题摊到 16 域 × 5 档、每格 1.4 题，这个基准有统计基础吗？**」——M-22 已判定「每格 1.4 题不构成基准」，处置是「A 期达标线只按岗位域、不按难度档」。**参评材料必须照实写，不要写「按 L1–L5 给出基准线」。」

**Q3. 凭什么你的分比它准？**
> ✅ **v3 给了实物之后的答案**：「一致率高不是可靠性的证据。三篇 2026 年的独立工作都指向同一件事——LLM judge 之间的相关（r_LL≈0.35）高于 judge 与人类的相关（r_LH≈0.27–0.32）；judge 的评价轴与人类轴夹角 87°–89°，比人类彼此之间的 78°–81° 还大。所以我们不测自一致，我们测 **judge 与人工锚定集的一致性**，用象限加权 Cohen's κ，并且**公开这份人工锚定集和它的 κ 区间**。」
> ✅ **而且我们把边界先说了**：「这是我们自建的**小型**人工锚定集，**不是行业基准**。n 的限制导致 κ 的区间很宽，我们报区间不报单值。」
> ⚠️ **C（会被追问穿）**：「用两个人标 40–60 条就敢叫锚定集？」→ 2 位标注者无法把标注者噪声与 judge 偏差分离。**必须主动先说边界**（AI 席 R-6 保留的克制）。
> ⚠️ **C（最致命的一条）**：「**你们旧指标就写错了，现在又说新指标也还没测 —— 那凭什么信？**」——**必须先承认并修掉 M-15 的口径错误**（现在代码里 6 道不同题的分数被塞进同一数组算一致率，`:55-76`）。本轮方案曾写「此前记录的一致率口径错误在这里被真正修掉」——**这句是假的，一行未改**（CF-10）。v3 把 M-15 排进 W3（1.0 人日），**要么改掉这句，要么在材料里写明「W3 已修口径」**。
> ❌ **B（v3 落地前）**：κ 的实物在 W1 之前不存在。**问「κ 是多少」，v3 落地前的答案只能是「还没测」**；W1 完成后才可以报区间。
> ✅ **行业参照系（要主动给）**：judge-to-human κ > 0.6 可接受 / > 0.8 强；TestGorilla 公开的相关性是 **0.84**（许可席 L-15、L-22）。**把 0.84 写进材料当参照系，显得懂行而不是自说自话**。

**Q4. 接了多少东西？**
> ✅ **答案必须换框**：「**接多少不是我们的主张**。我们借的是三样机制，都不复制代码：AIMLInterviews 的 no-spoilers（取题只返回题干与分级提示）、interviewer-mcp 的跨会话弱点记忆、Swanx 的房间级分析维度命名。第三位我们明确**不接**——Candaigo 有现成 API 和 Skill，但接竞品做引擎意味着数据出境 + 评估黑盒 + 评审看到核心是别家的产品。」
> ⚠️ **C**：「那你自己实现了几个集成？」——实际集成数是 **0 个外部系统**（1 个自建 MCP server + 2 个机制借鉴）。这一问本轮方案是主动放弃的。
> ✅ **正确的转身**：「我们做的是**权限模型**，不是**集成清单**。所有不在我们控制范围内的调用方——外部 agent 和用户自带的工具——统一收敛到一个出口：**只能供给证据，不能参与出题、评分与复盘结论的生成**。」
> ✅ **许可上的诚实（v3 新增，可加分）**：「我们做了逐仓库实测，许可证表 **6 行里错了 4 行**，而且错的方向全是**过度限制**——把本来可商用的仓库判成不可用。我们把判定改成**三档**（确定可用 / 需补确认 / 不可用）+ 第 ⑤ 步『授权是否覆盖目标内容』，因为我们在一个 MIT 仓库里发现了 license laundering：作者声明了 MIT，但里面的题库派生自 CC BY-NC-SA 的上游。**这不是我们在贬低竞品，这是我们自己的题库也必须查的原因。**」

**Q5. 你的分怎么算出来的？**
> ✅ **可答（这是产品线，不是 AI 线）**：「达标判定是**三条件**的纯函数（`qualification.ts`，W3 交付）：① 分数 ≥ 岗位基准线（岗位域 + 难度档位，可编辑）② 该题涉及维度上 after 的均值 ≥ before ③ 单答案稳定性（M-15 修好口径后的组内一致率 + 区分度护栏）。冷启动时只判 ①②③，界面必须写清『**这是你的第一场，本次用岗位基准判定，没有你的历史基线**』。κ 不在这三条里——它是**发布门禁**，不是逐题条件。」
> ✅ **扣分三件套同屏可见**：证据（引用原话）/ 判据 / 改法示范——这是竞品完全没有的。
> ✅ **和复盘联起来**：逐题重答后做双栏并排 + diff，用户看得见「我改了什么」。
> ❌ **C（会被追问穿）**：「你这一维度是怎么打的？」→ 隔离式评分架构是**已实现、A 期未接线**的状态（决策 #42 修复清单 #25：`scoreAllDimensions` 生产零调用方）。**对外只能说「隔离式评分架构已实现、A 期未接线」**，不能说「我们有隔离架构」。

**Q6. 会不会泄题？**
> ✅ **可答，且有门禁**：「公开产物走**零泄漏门禁**——3,585 条特征串在 2 个公开产物中均无命中（G7）；导出走 **9 字段白名单**（G8），参考答案根本不在导出字段里；公开产物里只有一个枚举型 `sourceType`，原始 URL 都不进。」
> ✅ **边界先说**：「我们**不宣称『答案绝对不可见』**——A 期只做静态产物 + 运行时探针，reference 端点改服务端代理在 B 期 W8。材料里的话术是『**公开产物零泄漏 + 逐题私有拉取**』。」
> ❌ **C**：「那用户是不是能看到答案？」→ 登录用户目前仍可逐题拉答案全文（M-17 移 B 期）。**这个问题必须自己先说，不要等被问**。

**Q7. 会不会跑我的代码？**
> ✅ **可答，而且是安全加分项**：「**不会。** A 期只做**静态代码评估**——AI code review + 复杂度 / 边界分析，**不执行用户代码**。上传走 11 道校验（魔数优先、文件名与存储名分离、SSRF 防护），A 期先收到 5 道、完整治理在平台期。」
> ✅ **面试官侧的约束**：「提问受 **no-spoilers** 约束——只回题干与分级提示、**不回答案、不执行提交的代码**。」
> ✅ **边界**：「W5 只有**设计稿**，闭环实现在 W4–W5 与复盘同周、B 期收尾；**参评材料不得写『别人问不了你的代码』**——至少 6 个产品在做这件事，其中 2 个是 MIT 且中文（MemCoach、interviewer-mcp）。我们写『**别人做了但没闭环**』：我们有源码证据 + 有评分 + 有达标线 + 有复盘重答，MemCoach 的项目分析『只到报告生成就停了』。」

**Q8. 花了多少钱？**
> ✅ **可答，三段**：
> ① **单场成本**：「单场模型成本 **0.05–0.12 元**，保守放大 5× 后 **0.3–0.6 元**；ASR 本地跑**边际成本 ≈ 0**。所以**定价不是成本问题**——¥3.9 一单在 2c2g 上完全覆盖成本，毛利 **83.6–91.7%**（保守口径）。」
> ② **硬件**：「1 核 / 1.5G 的 server + 0.5 核 / 256M 的 web（**不是「2 核 2G」**）。真实约束是 **ASR 并发上限 = 2**（`asrGuard.js:32-34` 硬编码 `DEFAULT_MAX_CONCURRENT = 2`，2 核机上并发上限 = 2），排队 15 秒超时 → 429 → 失败自动退次数 → 产生真实退款流水 → **若退款扣减累计有效交易用户数，低价拉新在统计口径上自我抵消**。对策：**¥0.01 首单因系统原因失败时按「不扣次数、当场补发一次」处理，不产生真实退款流水**；真实退款通道只对 ¥3.9 及以上档位开放。」
> ③ **亏损上限**：「30 个首单的总亏损上限 **¥17.7**，且有三重对冲（激励计划 Token 包、个人开发者按量付费 0 费率至 2026-12-31、每人限 1 次）。」
> ❌ **A（当前答不上来，必须承认）**：「**服务器一个月多少钱？域名多少？备案多少？**」——**成本侧从未被测算过**（PC-11 的原话是「成本侧从未被测算，且被误认为『不是约束』」，指的是**模型成本**；云主机与域名的月付成本在本轮所有文档里**没有实测数据**）。**v3 的处置**：W5 之前由 T 补一张「基础设施成本表」（云主机月费 / 域名年费 / 证书 / 备案 / 对象存储 / 短信），并在 W6 的材料里填实数。**在拿到这张表之前，评审问到基础设施成本只能答「模型成本与单场成本」，不能编一个服务器月费。**

**Q9. 你们现在有真实用户吗？**
> ❌ **A（当前完全答不上来，且是资格级）**：08 号方案 §8.1 拍板项 #8 已定「Tryout 现有真实用户数……**无论多少都按 0 处理**」（`08-final-plan.md:1127`）。参评材料里的「付费用户数」字段如果编了，是**资格问题不是分数问题**（细则 `:15` 违规、虚假交易及刷量数据将被剔除；承诺书 `:27` 刷量 → 取消资格 + 追回奖金）。处置：走 M-38 方案 B（**材料里不出现「付费用户数」这个字段**），渠道从零起算。

**Q10. 12-09 到底能演示什么？**
> ⚠️ **B（部分能）**：复盘与达标判定能（M-39 / M-08 在排期内）；κ 能（W1 交付后）；**MCP 不能**（A 期只到最小切片 + 门禁，无生产级 MCP server）；基础设施成本表能（W5 前补）；支付全链路能（11/22 上线后）。

**答不上来的五条汇总（诚实清单）**：

| # | 问题 | 类别 | 根因 | 12-09 前能否补上 |
|---|---|---|---|---|
| 1 | agent / 开发者侧的 ICP 与付费理由 | **A** | 平台化叙事的 ICP 从未定义 | **不能**（不是工程量问题，是定位问题）→ 只能改口径：平台化是能力，不是第二条用户故事 |
| 2 | 基础设施成本（服务器 / 域名 / 备案） | **A** | 全轮文档无实测数据 | **能**，0.2 人日，W5 前补一张成本表 |
| 3 | 「你们旧指标是不是错的」 | **C** | M-15 未修；本轮方案曾声称已修（不实） | **能**，1.0 人日（W3），但**必须与 κ 打包做** |
| 4 | 真实用户数 | **A（资格级）** | 08 号方案已定「无论多少都按 0 处理」 | **不能**（只能走方案 B：材料不出现该字段） |
| 5 | 12-09 到底能演示什么 | **B（部分能）** | MCP 只到最小切片 | **部分**——MCP 那一格答「A 期只有最小切片 + 门禁，无生产级 MCP server」 |

### 6.8 影响力产出物候选排序

#### 6.8.1 口径纠正

官方影响力 20% 的原文（`doc_activity-rules.txt:157-160`）：「作品影响力｜20%｜是否获得用户的有效点赞、评论和交流反馈｜**参赛作品详情页在支付宝AI付官网的浏览、点赞、评论等互动量综合评定**」。索引文档层修正 #4 已把这条口径写进设计文档 §7.2.5（`00-当前状态索引.md:258`）。

**推论：影响力 20 分不是「我们能晒出什么」，而是「有多少人访问了我们的官网作品页并互动了」。** 终稿把最有传播力的定为「公开人工校准集和 κ 值」，但许可席指出「可判」叙事已被同行部分占据（TestGorilla「fully transparent」+ 相关性 0.84、北森「人机一致性 > 90%」、Kaairo「引用候选人原话」、Matchscope「marked hit/partial/missed with a quote of your own words」、海纳「高低分示例」、Synchroni「rubric 校准 + 审计轨迹」，L-15）。**公开一个数据集本身不构成差异化——六家都宣称透明评分。** 把校准集发到 GitHub 对官网互动量的直接贡献 **≈ 0**（一致性席 §7.1 同结论）。

#### 6.8.2 候选排序（按「可晒性 × 成本 × 与已有资产匹配度」）

| 排名 | 候选 | 可晒性 | 成本 | 与已有资产匹配度 | 对官网互动量的贡献 | 结论 |
|---|---|---|---|---|---|---|
| **🥇 1** | **可截图传播的复盘 diff 界面**（上一版回答 vs 这一版回答 + 雷达双系列 + 达标徽章从灰变绿） | **最高**：before/after 结构天然可传播；「变好了没有」直接回应「AI 面试评分不可信」这个痛点 | **0.8**（截图 + 排版） | **极高**：M-39 复盘 v2 在 W4（已排 2.5 人日）+ N17 影响力物料收口 0.5（已在 W6） | **间接但强**：截图可带作品页水印 | **选第一名。** 理由：① 它是竞品**完全没有**的能力（决策 #23 不可砍项之一「复盘回溯」，竞品雷达里 0 命中）；② 它直接演示**付费理由**（用户为什么付 ¥3.9 再重答一次）；③ 它的成本已经付过了——M-39 在 W4 是不可砍项，**边际成本只有 0.8 人日的截图与排版**；④ 许可证席 L-15 指出「可判」叙事已被同行部分占据，而**「可重来 + 看得见变好」没有被占据** |
| **🥈 2** | **「1 分钱练一次」首单截图 + 支付宝后台「有效交易已计入」截图（双图成对）** | 中高：便宜、可信、可复现 | **0.3**（素材 + 截图） | 极高：11/22 上线即产出；M-38 的统计口径验证行已在 W6 | **直接**：卡上带官网作品页链接 / 二维码，每张卡 = 一次可归因的引流 | 排第二的理由不是传播性，是「**一份素材同时服务两个维度（25 + 20）**」——这是终稿完全没利用的杠杆。⚠️ **前提**：11/22 必须真上线，且必须有**后台计入截图**。**没有这张截图，晒 1 分钱只会引来「你的单子算不算有效交易」的追问** |
| **🥉 3** | **校准集 + κ + 参照物「三件套」**（人工锚定集 + κ 区间与双阈值 + 行业参照系 0.6/0.8 与 TestGorilla 0.84） | **中**：技术圈强，求职者圈弱 | **1.0**（已付）+ 0.3（对外整理） | 高：素材是既有 `rubricHints`；但**不是已有资产，是本轮新建** | **≈ 0**（GitHub ≠ 官网作品页） | **不作为影响力主线。** 重新定位为：① **产品完整度 30 的佐证物**（放在作品详情页的「方法说明」区 + 参评材料里）；② **决赛 10 分钟路演「可判」的唯一实物**（Q3 那一问）；③ 顺手投技术长尾（掘金 / 即刻 / V2EX）拿技术评审口碑分 |
| 4（降级） | **公开一次可复现的对比实验** | 中高 | **1.5–2.0**（要造一个可复现 harness + 公开脚本） | **低**：全案没有任何现成 harness；A 期没有稳定模型链路 | 间接 | **本次不做。** 三条理由：① 「可复现」是**最强**的一手影响力材料（许可席 L-22 引的 CC0 复现包含一键脚本 + DOI），但它要求一条**稳定的评分链路 + 可公开的数据集 + 可复现的脚本**，A 期没有；② 它的成本（1.5–2.0）在 44 天里挤不掉任何不可砍项；③ 它的产出物形态是 GitHub 仓库，不是能引流到官网作品页的东西。**降级为 W16 的题库第二批同周候选** |
| 5（否决） | **岗位评分基准榜** | 低 | — | **不存在**：116 题摊到 16 域 × 5 档，每格 1.4 题，M-22 已判定「每格 1.4 题不构成基准」 | — | **否决。** 做出一个基准榜需要每格 ≥ 4 题且标注者间 ICC ≥ 0.6，这是 **W16 的判据**（`08-final-plan.md:703`）。在 W6 做榜 = 做一张**我们自己都不信**的榜。**本轮不出现「榜单」两个字** |

#### 6.8.3 第一名的理由（写给拍板人）

选 **可截图传播的复盘 diff 界面** 的三条理由，按权重排序：

1. **它占的是一个没人占的位置。** 许可席实测：至少 6 家已宣称透明评分 / 证据链 / 人工覆盖（L-15），但**没有一家提供「你上一版和这一版的并排 diff + 达标徽章从灰变绿」**。终稿把「可判」当差异化，而「可判」已经被占了；**「可重来且看得见」还没被占**。
2. **它的成本已经付过了。** M-39 复盘 v2 在 W4 是不可砍项（2.5 人日，已在 committed 64.2 里）。复盘 diff 界面本身**不需要额外工程量**，只需要 **0.8 人日**的截图与排版（落在 N17 影响力物料收口，W6）。**边际成本 0.8 人日买 20 分维度的主线产出物，这是全案性价比最高的一笔。**
3. **它同时打两个痛点。** before/after 结构直接回应「AI 面试评分不可信」；达标徽章从灰变绿直接回应「我到底有没有达标」。这两个是求职者侧的痛点，**与影响力 20 的计分位置（官网作品页互动量）同向**。

**但它有一个前置条件必须写死**：M-39 复盘 v2 在 W4，**如果 W4 因 11/22 收款上线而挤爆、砍掉了复盘 v2，第一名自动变成第二名**（首单双图）。这个依赖必须写在风险登记里（见 §6.12 的 R-11）。

### 6.9 门禁与验收体系

#### 6.9.1 现状：10 道门禁 + 21 项绕过回归 + 两条 CI 链

| 项 | 现状 | 出处 |
|---|---|---|
| 门禁总验收 | `tools/verify-all.mjs` 的 `GATES` 数组登记 **10 道**：G1 中间件挂载顺序 / G2 路由清单完整性 / G3 模型退役检查 / G4 迁移链校验和 / G5 房间四表 DDL 同步 / G6 题库结构校验 / G7 题库零泄漏 / G8b 可观测性隐私 / G8 题库导出自检 / G10 门禁绕过回归 | `tools/verify-all.mjs:41-112` |
| 总验收的失败语义 | 门禁脚本**不存在 = BROKEN = 失败**；任一失败 → 整体退出码 1 | `tools/verify-all.mjs:129-135`、`:167-179` |
| 绕过回归 | `tools/gate-bypass-regression.test.mjs`：**21/21 全绿**。5 个合成样本固化检测能力（鉴权作用域绕过 / 经典 F-0 / 子路由未覆盖前缀 / 无鉴权点应 exit 2 / 干净服务端应判绿防「永远红」）+ **元门禁自检**（`verify-all.mjs` 登记的每个门禁脚本都必须有非零失败出口） | `tools/gate-bypass-regression.test.mjs:1-30`；`00-当前状态索引.md:398` |
| OSS CI 链 | `tryout_pr_src/Tryout-fix-83-issues` 自有 workflow（`:84` 行调用 `check-middleware-order.mjs`） | `10-adversarial-verdict.md:108` |
| 商业 CI 链 | `trialroom/.github/workflows/ci.yml`：`platform-gates` job 跑 `node tools/verify-all.mjs`（`:33-34`）+ 元门禁（`:38-60`）+ 迁移链干净库跑通（`:65-71`）；`web` job 跑 `tsc --noEmit` / `vitest` / `build`（`:74-92`） | `ci.yml:21-92` |
| 本轮已实测 | `node tools/verify-all.mjs` → **10/10 全绿**（原 9/9）；`node tools/gate-bypass-regression.test.mjs` → **21/21 全绿** | `00-当前状态索引.md:399` |

**三条已知缺陷（必须先修，否则下面所有门禁都是空转）**：

- **CF-05：元门禁自我满足。** `ci.yml:52` 的判定是 `grep -q "$(basename "$f")" .github/workflows/ci.yml`——**被检字符串就出现在这段 shell 自己的列表里**，断言自我满足，它实际只验证「文件存在」。而且**没有任何东西检查 `tools/verify-all.mjs` 的 `GATES` 数组**——而那才是「CI 到底跑哪些门禁」的唯一真相源（`verify-all.mjs:41-105`）。按现状，新增 `tools/check-mcp-gates.mjs` 并写进 ci.yml 的元门禁列表 → 元门禁绿，但门禁**永不执行**。
- **CF-06：商业 CI 现在就是红的。** `platform-gates` job 只 `actions/checkout@v4` 检出 trialroom 本仓（`ci.yml:26`），而 `verify-all.mjs:30` 的 `OSS = ROOT/../tryout_pr_src/Tryout-fix-83-issues` 在 CI 上不存在 → G1/G8b 判 `BROKEN` → `verify-all.mjs:167-172` `exit(1)` → **每次推送必红**。**「失败能让构建变红」这句话在修好之前无从验证**——因为构建已经是红的，新门禁的红与既有的红不可区分。
- **CF-06b：商业 CI 的 `web` job 同样必红，且与 G1/G8b 无关。** `ci.yml:74-92` 的 `web` job 以 `working-directory: web` 运行 `npm ci` → `npx tsc --noEmit` → `npx vitest run` → `npm run build`，但商业仓 `trialroom/web/` **只有 `public/`（两个 json），没有 `package.json` / `src/` / `vite.config.ts` / `dist/`**（前端源码与构建在开源基座仓 `tryout_pr_src/Tryout-fix-83-issues/web/`）。→ **即使补了第二个 checkout，`platform-gates` 转绿，CI 整体仍红。**

#### 6.9.2 门禁矩阵：方案要点 → 对应门禁 → 失败后果

**（a）已有门禁覆盖的方案要点**

| 方案要点 | 对应门禁 | 门禁的判定口径 | 失败后果 |
|---|---|---|---|
| 子路由不得挂在鉴权之前（F-0） | G1 `check-middleware-order.mjs` | 前缀相等 / 前缀在鉴权作用域之下才算覆盖；根级鉴权覆盖全部；找不到鉴权挂载点 → **exit 2**；注释剥离后必须仍能定位 auth 调用 → 否则 exit 2 | 整组端点无需 token 即可读写他人数据（F-0：7 条端点） |
| 鉴权作用域绕过（`app.use("/mcp", X)` 不在 `/api` 作用域内） | G10 `gate-bypass-regression.test.mjs` | 合成样本 `/tmp/mcpgate`：`❌ 挂载前缀 "/mcp" 不被任何鉴权作用域覆盖`，**退出码 1**（旧版门禁判 PASS / 退出码 0） | 整条 MCP 暴露面完全未鉴权 |
| 路由清单不得静默漏扫子路由（R21） | G2 `count-routes.mjs` | 未覆盖前缀检测 + analysisRouter 早于鉴权检测 + 路由总数下限（默认 70，`--expect N`） | 「63 条」是漏扫产物；隔离结论对新路由无效 |
| 假门禁自检 | G10 元门禁自检 | `verify-all.mjs` 登记的每个门禁脚本都必须有非零失败出口 | 门禁**永远绿** = 没有门禁（`count-routes.mjs` 曾零非零退出路径） |
| 迁移链校验和 + 已应用状态 | G4 `migrate.mjs --check` | 干净库端到端跑通（`ci.yml:65-71`）+ 校验和比对 | 改过的已应用迁移仍绿灯 |
| 房间四表 DDL 与设计文档逐字一致 | G5 `check-room-ddl-sync.mjs` | 以 `db/001_platform_schema.sql` 为唯一规范源 | 文档与实现分叉 |
| 题库结构校验（19 项 + 难度分布硬约束） | G6 `questionbank/validate.mjs` | 结构 / 分布 / 空话黑名单 / 查重 | 反向测试曾捕获 18 条 ERROR |
| 题库零泄漏（参考答案不得随公开产物分发） | G7 `verify-no-leak.mjs` | 3,585 条特征串在 2 个公开产物中均无命中 | 参考答案泄漏 = 题目壁垒归零 + 商业化失据 |
| 公开产物与源数据逐字段一致 | G8 `export-pro-questionbank.mjs --check` | 9 字段白名单 + 磁盘漂移检测 | 公开产物漂移 |
| 可观测性隐私（白名单 / 脱敏 / 掩码 / 限流 / 文档措辞） | G8b `check-observability-privacy.mjs` | C1/C2/C4 全绿 | `/api/log` 绕过 `redactPii` |
| 硬编码模型名 | G3 `check-model-retirement.mjs` | 覆盖 8 个角色 | 2026 年一天退役 4 个模型，技术栈里最短命的依赖 |
| 多用户隔离（70 条路由 owner 校验） | M-32 `check-owner-isolation.mjs`（W2 就位） | 覆盖 70 条路由 + 源码无 `'default'` 字面量 + 跨用户返 404 | 不同用户的会话与素材静默混在同一个 `default` 用户下，**越权不报错、不会被任何现有门禁发现** |
| 静态门禁的输入集合完整性 | G10 + 决策 #42 | 提取不到结果就判失败（不得 `|| true`、不得静默跳过） | F-0 漏扫 7 条子路由的同构错误重演 |

**（b）本方案要点目前**没有**门禁保护的（这是缺口，不是已完成）**

| # | 方案要点 | 现状 | 缺什么 | 建议门禁 | 成本 | 落地周 | 失败后果 |
|---|---|---|---|---|---|---|---|
| **1** | **MCP 的 `tools/call` deny-by-default 与 scope 绑定** | **零门禁**。`/mcp` 端点不存在，鉴权作用域覆盖问题刚在本轮修好（`check-middleware-order.mjs` 已能判 `/mcp` 不被覆盖），但**没有任何门禁断言「MCP 工具的实际调用被拒绝」** | 每工具 × 每 scope 的正负例矩阵；越权返 404；`Mcp-Method`/`Mcp-Name` 头体一致校验（`-32020`）；`_meta` 白名单；Origin 校验；幂等键 | `G11 tools/check-mcp-gates.mjs` | 1.4 + 0.5 | W3–W5 | 整条 MCP 暴露面未鉴权 / 越权读取他人面试记录 → **产品 30 + 支付 25 一票否决** |
| **2** | **题库 `source` 字段的来源合规** | **零门禁**。`SCHEMA.md:60` 写着「**优先引用**公开可查的面经」，且**没有任何门禁检查「改写」是否发生**；`source` 里已有一个 GPL-3.0 仓库与两个无许可仓库，另有 100+ 条专有 UGC URL | 来源域白名单 + 12-gram 重合度检查 + `sources-license.json` 登记与实况复核 | `G12 tools/verify-source-hygiene.mjs` | 0.8 | W1 | GPL-3.0 复制件进闭源产品 → **全产品 copyleft 义务 + 参赛资格** |
| **3** | **MIT 分发义务（构建产物 / 镜像 / 第三方声明）** | **零门禁**。9 项承诺 0 项落地（见 §6.11） | `web/dist` 必含 MIT 全文与依赖许可清单；两镜像必含 LICENSE 与 `org.opencontainers.image.licenses`；`THIRD_PARTY_LICENSES/` 与第三方声明页存在；年份一致 | `G13 tools/check-license-distribution.mjs` | 0.5（并入 N4） | W1 | MIT 分发义务未履行；设计方案的「合规」验收行是假的 |
| **4** | **κ 校准门禁（`κ_JH ≥ 0.85×κ_HH` 且 `≥ 0.60`）** | **零门禁**。κ 在代码里一次都没算过 | 校准报告存在 + 双阈值断言（低于任一阈值 → 退出码非 0）+ **κ 不得出现在 `passed` 的布尔表达式里**（静态断言） | `G14 tools/check-calibration-gate.mjs` | 0.25（并入 N3） | W1 | 「凭什么准」被追问时无可验收的实物；且 κ 又被误写回逐题条件 |
| **5** | **「门禁写了但没接线」**（CF-05 的根） | `ci.yml:52` 的元门禁自我满足；`GATES` 数组无断言 | `tools/` 与 `scripts/` 下每个 `*.mjs` 都必须出现在 `verify-all.mjs` 的 `GATES` 数组里（**改断言对象，不改被检字符串**） | 改写 `ci.yml:38-60` 的元门禁 + G10 的元门禁自检扩面 | 0.3（并入 N7） | W2 | 门禁永远绿 = 没有门禁；全部红线失效 |
| **6** | **商业 CI 的第二个 checkout**（CF-06） | CI 必红 | `ci.yml` 加 `actions/checkout@v4` with `repository:` + `path: ../tryout_pr_src/Tryout-fix-83-issues`，**或**把 G1/G8b 移出商业仓 `verify-all`、回归开源仓自己的 workflow | 修 `ci.yml` | 0.2（并入 N7） | W2 | 「失败能让构建变红」无法验证 |
| **6b** | **商业 CI 的 `web` job 前提**（CF-06b） | `web` job 必红 | 二选一：① 前端构建迁入商业仓（把 `web/src` + `vite.config.ts` + `package.json` 纳入 `trialroom/`）；② `web` job 改为在 OSS 仓的 workflow 里跑，商业仓 `ci.yml` 删除 `web` job | 修 `ci.yml` | 0.2（并入 N7） | W2 | G13 判据 ①②（`web/dist/` 根含 MIT 全文 + `licenses/`）无从验收；CI 整体恒红 |
| **7** | **题库 `rubricHints` 被评分器真的读取** | `web/src` 与 `server` 全仓零命中——被校验、被要求、被承诺，但评分器从来没读过它 | 静态断言：评分链路上存在对 `rubricHints` 的读取点 | 并入 G6 或 G14 | 0.1 | W1–W3 | κ 的公平性前提被破坏（人看得多、judge 看得少） |
| **8** | **新增运行时依赖的许可义务** | 无快照比对 | `package.json` 的 `dependencies` 段在 CI 里做快照比对，变化即需 PR 说明许可（许可席 §7.3） | 并入 G13 | 0.1 | W1 | 每加一个依赖就新增一处违规 |
| **9** | **首单剧本的失败分流（风控 / 参数 / 额度）** | 无 | 人工剧本 + 三处截图 + 失败笔数也入材料 | 无需门禁（**人工判据**，写进 W3 的验收清单） | 0 | W3 | 首单失败时无分流依据；材料缺可证过程 |
| **10** | **基础设施成本表** | 无 | W5 前补一张表（云主机月费 / 域名年费 / 证书 / 备案 / 对象存储 / 短信） | 无需门禁（人工判据） | 0.2 | W5 | 评审问成本时只能承认「没测过」 |
| **11** | **三处规格同步**（J-16 的同型病） | 无机制验证三处真的一致 | 断言设计文档四条件块 + `db/001_platform_schema.sql:250` 注释 + `qualification.ts` 签名三者一致 | `verify-qualification-spec-sync.mjs` | 0.1 | W1–W3 | 同一件事有两个互相矛盾的规定 |

**（c）v3 落地后的门禁全景**：**14 道**（现有 10 道 + G11 / G12 / G13 / G14；四道新门禁 id 与现有 10 道无重复，不存在去重）。全部由 `node tools/verify-all.mjs` 一条命令触发，任一失败退出码非 0，缺脚本 = BROKEN = 失败。

> **⚠ 计数修订（吸收核验报告 verify-schedule R3）**：原文写「13 道（10 + G11 / G12 / G13 / G14 去重后为 13）」——去重算错了，**四道新门禁 id 与现有 10 道无任何重复，落地后是 14 道**。本稿统一为 14 道。

#### 6.9.3 门禁矩阵的验收判据（新增四道的写死判据）

| 门禁 | 触发时机 | 判据 | 变异测试（必须能杀一次自己） |
|---|---|---|---|
| **G11 `check-mcp-gates.mjs`** | W3 骨架 / W5 接入 | ① 每工具 × 每 scope 的正负例矩阵全绿；② 越权调用返 **404**（不是 403）；③ `Mcp-Method`/`Mcp-Name` 与请求体不符 → `-32020`；④ `_meta` 只白名单取 2 键，其余丢弃；⑤ 非白名单 Origin → 拒绝；⑥ 重放同一幂等键 → 返回存量结果，不重复扣费；⑦ `tools/list` 按 scope fixture **分片**快照 + `cacheScope:"private"` / `ttlMs` / 顺序 / 注解四条附带断言；⑧ **`server/discover` 必须实现且可枚举**（调用层用 deny-by-default 决定授权，不依赖 `tools/list`）；⑨ **无会话**：不得出现 `initialize` / `Mcp-Session-Id`，有状态对象一律用显式 handle；⑩ `requestState` 必绑 principal + operation + expiry + HMAC 签名 + 一次性消费 + 不进日志；⑪ `x-mcp-header` 仅允许 schema 声明的白名单键 + 值类型限定 + 日志脱敏 + 网关侧不可写死 | 删掉一个工具 → 门禁必须变红；放宽一个 scope → 必须变红；带 `Mcp-Session-Id` 的请求 → 门禁变红；`requestState` 换 principal 重放 → 门禁变红 |
| **G12 `verify-source-hygiene.mjs`** | W1 | ① `source` 域白名单：禁止牛客/知乎/掘金/CSDN/搜狐/LeetCode Discussions/Reddit/Blind 与任何无许可或 GPL/CC-BY-NC 仓库；② 允许逐字来源的仓库须在 `questionbank/data/sources-license.json` 登记，且登记的许可与实际 LICENSE 文件一致；③ 题面与源文本的 12-gram 重合度 ≥ 6 个连续命中 → 退出码 1；④ 现有 116 题全绿 | 把某题的 `source` 改成 GPL 仓库 → 必须变红 |
| **G13 `check-license-distribution.mjs`** | W1 | ① `web/dist/` 根含 MIT 全文 + `licenses/` 目录；② `web/dist/assets/*.js` 含第三方许可 banner；③ 两镜像 Dockerfile 含 `COPY LICENSE` 与 `LABEL org.opencontainers.image.licenses="MIT"`；④ `trialroom/LICENSE` 与 `THIRD_PARTY_NOTICES.md` 存在且后者收录 Tryout 的 MIT 全文与版权行；⑤ About 页与 `LICENSE` 的版权年份一致 | 删掉 `web/public/LICENSE` → 构建必须红 |
| **G14 `check-calibration-gate.mjs`** | W1 | ① 校准报告存在且含 `κ_HH`、`κ_JH`、n、95% 区间；② `κ_JH ≥ 0.85×κ_HH` 且 `κ_JH ≥ 0.60`，否则退出码非 0；③ 静态断言：`qualification.ts` 的 `passed` 表达式里**不出现** κ；④ `rubricHints` 在评分链路上有读取点 | 把 `κ_JH` 改成低于阈值 → 门禁必须变红 |

> **⚠ 落点循环自证的修正（吸收核验报告 verify-schedule R2）**：G11 判据原为 ①–⑦，但 CF-04 / G-4 / 一致性席 R-7 / R-8 / R-9 五条的「落点」全部指向 §6.9.3 的 G11 判据，而 G11 判据里**没有** `server/discover`、**没有** `requestState`、**没有** `x-mcp-header` 白名单、**没有**「无会话 / 显式 handle」断言、**没有** `cacheScope:"private"` 取值。这五个词在原文中只出现在落点表自己身上——**用自己声明的覆盖关系证明自己覆盖**。本稿已把 ⑧–⑪ 四条写进 G11 判据并把 `cacheScope` 取值写死为 `"private"`，使这五条落点**真的落在 G11 里**。

#### 6.9.4 CI 链的改造清单（四项，都是 W2 的 N7）

1. **元门禁改断言对象**（CF-05）：`ci.yml:38-60` 的循环改为「**断言 `tools/` 与 `scripts/` 下每个 `*.mjs` 都出现在 `tools/verify-all.mjs` 的 `GATES` 数组里**」，而不是「出现在本 workflow 里」。**让「漏接线」在结构上不可能**。
2. **补第二个 checkout 或把 G1/G8b 归位**（CF-06）：二选一，必须在 W2 完成，**否则 G11–G14 的「失败能让构建变红」无法验证**。
3. **补 `web` job 的可执行前提**（CF-06b）：二选一——① 前端构建迁入商业仓（把 `web/src` + `vite.config.ts` + `package.json` 纳入 `trialroom/`，与 §6.10 第 25/27 项同一动作）；② `web` job 改为在 OSS 仓的 workflow 里跑，商业仓 `ci.yml` 删除 `web` job。**必须在 W2 完成**，否则 G13 判据 ①② 无从验收。
4. **元门禁清单补入新脚本**：`tools/check-mcp-gates.mjs`、`tools/verify-source-hygiene.mjs`、`tools/check-license-distribution.mjs`、`tools/check-calibration-gate.mjs`。**追加一句**：4 个新脚本在 `trialroom/tools/` 下创建（门禁在商业仓），而 `web/dist/` 与 `docker/` 在开源基座仓 → **G13 判据 ①② 须在 OSS 仓的 workflow 中执行，或先把构建产物搬入商业仓**。

### 6.10 文档补齐清单

> 规则：每份写清**改什么**、**改在哪一节**、**谁改**、**什么时候改完**、**验收判据**。这份清单本身就是 08 号方案 §9.2「覆盖矩阵」的延伸。

| # | 文档 | 改什么 | 改在哪一节 | 责任 | 时限 | 验收判据 |
|---|---|---|---|---|---|---|
| **1** | `trialroom/Trialroom-全量设计方案.md` | **新增一节「线上 MCP 暴露面与权限边界」**：端点清单、`mcp_tokens` 表结构、scope 语义、越权返 404 的理由、`_meta` 信任边界、Origin 校验、幂等键、`/mcp` 的 nginx 路由、ADR-11 | 新章节（建议置于 §5.2 数据模型之后、§5.3 房间状态机之前） | M | **W1（0.3 人日，N6）** | `grep -c "线上 MCP 暴露面" Trialroom-全量设计方案.md` ≥ 1 |
| **2** | 同上 | **改写达标判定四条件**：第三条件由「评分一致率 ≥ 阈值」改为「M-15 修好口径后的单答案稳定性」；**κ 从四条件中移除**，改写为「发布门禁：校准集 κ 达不到双阈值则该 judge 不许上线」 | §4.4.4 四条件块（`:777-783`） | M | W1（随 N3） | `grep -c "judge-κ" Trialroom-全量设计方案.md` = 0 |
| **3** | 同上 | **补「商业化 25% 作战表」**：漏斗式（分母写死）+ 11/12 / 11/22 / 12/01 三 checkpoint 人数目标 + 六个埋点事件 + 方案 B 备料 | §7.3 商业化（新节） | T | W2（随 N10） | 三 checkpoint 目标数出现在设计文档 |
| **4** | 同上 | **改 ADR-03 为「目标态」**：通用 `scopedDb` 包装层移 B 期 W13，A 期只做「5 张关键表 + `requireUser` 中间件」 | §3.3 架构决策 | M | W3 | 文档承诺与实现一致 |
| **5** | 同上 | **改定价档位**：设计文档 §7.1.3 次数包（小）是 **¥19.9 / 5 次**，终稿写的「¥9.9 / 5 次」是**第三档价**，必须删或正面论证 | §7.1.3 定价表（`:1769`）+ 偏离理由表 | T | W2 | `grep -c "9.9" Trialroom-全量设计方案.md` 在定价段 = 0 |
| **6** | 同上 | **补合规行的可执行内容**：验收标准表「第三方声明页含 MIT 全文与各依赖许可」当前是**假的**（0 命中），必须补上具体文件清单与门禁号 | §9 验收标准表（`:2369`）+ §6 许可证承诺（`:1556`、`:1628`） | T | W1（随 N4） | `grep -c "G13" Trialroom-全量设计方案.md` ≥ 1 |
| **7** | `trialroom/Trialroom-完整平台实施与参赛施工图-v2.md` → **v3** | **替换 §三.1 A 期表**为 v3 的 W1–W6 + 提交窗口（逐周交付物 / 人日 / 依赖 / 负责人 / 验收判据 / 余量） | §三.1（`:307-317`） | M + T | W1 末（10/30 前） | 施工图 §三.1 与本方案 §6.3 逐周一致 |
| **8** | 同上 | **改 `:319` 的「800+ 题库（第一批）」**：真实是 Pro 116 题 / 存量 808 题且 808/808 **无 `referenceAnswer` 键** | §三.1 W6 行后「W6 提交时能拿出来的东西」 | M | W1 | `grep -c "800+" 施工图-v3.md` = 0 |
| **9** | 同上 | **二选一处置 `:339` 的「12-09 前扩到 300+」**：撤承诺（推荐）或认这 30–40 人日 | §四 参赛作品的构成（`:339`） | 组长拍板 | **W1（拍板项 17 的前置）** | 拍板记录 |
| **10** | 同上 | **合并 §五 待拍板清单**：与 08 §8.1 的 18 项合并成一张表，**不允许覆盖**；新增「是否扩到 3 人（最晚 10/30）」「11/08 止损规则改写」「题库扩量承诺二选一」 | §五（`:351-362`） | 组长 | W1 | 一张表，无覆盖 |
| **11** | 同上 | **改 §六 下一步**：删除「控制台报名、开通网页应用收款」之外的三件被降级的事（买域名 + ICP 备案 / `service_id` 申请 / 官方群问死定价口径），并把「启动用户表 + 会话令牌 + `scopedDb`」的 `scopedDb` 删掉（A 期只做 5 张关键表 + `requireUser`） | §六（`:364-371`） | T | W1 | 逐条对齐 |
| **12** | `Trialroom-商业版平台化升级方案.md` | **改 §六 A 期表**：42 人日 → v3 的 89.7 人日 / 106.0 供给；并加一句「本文 §六 已与 `08-final-plan.md` §4.3 产能账和本轮终稿 §八 合并，三份排期的互斥项以 v3 为准」 | §六 A 期表（`:368-382`） | M | W1 | 两处数字一致 |
| **13** | `trialroom/review/08-final-plan.md` | **§4.3 A 期工程量台账新增行**：MCP 前置 3.9 / MCP 切片 3.3 / MCP 门禁 1.9 / MIT 义务 0.5 / 来源门禁 0.8 / 支付净增 8.0 / 校准 1.0 / 获客漏斗 0.5 / 第一单 0.9 / 设计文档 0.3 / 提交窗口 2.0 —— **不占周次 = 影子工程**；**并写明「`entitlements.kind` 枚举映射 + 不新增表」的约束（CF-10 落点）** | §4.3 台账（`:530-619`） | M | W1 末 | 台账新增 11 行，且含 `entitlements` 唯一真相源约束 |
| **14** | 同上 | **§4.4 W1–W6 修订排期替换为 v3**；**§6.4 止损点表更新**（10/30 / 11/06 / 11/12 三条新增 + 11/08 规则改写 + 12/01 报名硬截止新增）；**§8.1 拍板项 #1 的最晚决策日 11/09 → 10/30**；**§4.3 台账「支付沙箱 11/08 止损点」改为「11/06 硬门槛，11/08 为对外复述」** | §4.4 / §6.4 / §8.1 / §4.3 | M | W1 末 | 逐条对齐 |
| **15** | `/workspace/mcd-contest/alipay/00-当前状态索引.md` | **新增决策**：#57 v3 排期归位（三份排期以 v3 为准）；#58 10/30 扩编决策（并说明与 #55 的关系）；#59 11/08 止损规则改写（κ 豁免）；#60 κ 双阈值门禁化 + 报区间；#61 许可证三档判定 + 来源合规门禁；#62 基础设施成本表（W5 前补） | §十三·补 之后新增 §十四 | M | W1 末 | 6 条新决策入索引 |
| **16** | 同上 | **更新 §八 分工建议**：删除「队友做支付（11/18–12/3）」——它与 11/22 上线直接矛盾，改为「支付负责人窗口 10/27–11/14；另一人 10/29–11/20 负责评分层与多用户」 | §八（`:169`） | T | W1 | 旧窗口文本 = 0 命中 |
| **17** | 同上 | **更新 §九 止损线**：11/08 行按 §6.6.3 改写；新增 10/30 / 11/06 / 11/12 / 12/01 四行 | §九（`:195-204`） | M | W1 末 | 止损线表逐行对齐 |
| **18** | 同上 | **新增 §十四「v3 排期索引」**：指向本节 §6.3，并注明「基线产能账 64.0 → v3 净需求 89.7，供给 106.0（10/30 扩编后）」 | 新增章节 | M | W1 末 | 索引可跳转 |
| **19** | `trialroom/questionbank/SCHEMA.md` | **改来源措辞**：`:60` 的「**优先引用**公开可查的面经」→ 「**仅作选题灵感来源（topic lead）。禁止逐字引用或近似改写；如确需引用原文，须取得权利人书面授权并在此登记。**」；`:61` 同步 | §来源与原创性（`:60-61`） | T | W1（随 N5） | `grep -c "优先引用" SCHEMA.md` = 0 |
| **20** | 同上 | **加字段 `sourceKind: 'lead' | 'authorized-quote'`**（现有 116 条全部为 `'lead'`）；**加约束「`rubricHints` 必须被评分器读取」** | 字段表 + 约束段（`:29` 附近） | M | W1 | 字段存在 |
| **21** | 同上 | **写明零泄漏管道不受影响**：导出白名单 `PUBLIC_FIELDS` 不含 `source` 原始 URL，只落枚举型 `sourceType` → 新增 `sourceKind` 是纯内部字段 | 同上 | T | W1 | `PUBLIC_FIELDS` 不变 |
| **22** | `trialroom/questionbank/data/sources-license.json` | **新建**：仓库 → 许可的登记映射（允许逐字来源的仓库只有 LICENSE ∈ {MIT, Apache-2.0, BSD-\*, CC0} 的） | 新文件 | T | W1 | 文件存在且 G12 引用它 |
| **23** | `trialroom/LICENSE` | **新建**（专有声明）+ `trialroom/THIRD_PARTY_NOTICES.md`（逐项引用 Tryout 的 MIT 全文与版权行） | 新文件 | T | W1（随 N4） | 两文件存在 |
| **24** | `trialroom/db/000_base_schema.sql` | 头部加注释指向 `THIRD_PARTY_NOTICES.md`（`:3` 已写「源自开源基座 Tryout 的 server/db.js」，`:27`、`:31` 写来源） | 文件头 | T | W1 | 头部注释存在 |
| **25′** | `tryout_pr_src/Tryout-fix-83-issues/web/public/LICENSE` + `web/src/pages/LicensesPage.tsx` + `web/src/App.tsx` | MIT 全文 / 渲染 MIT 全文 + 第三方依赖清单 + 各许可全文 / 加 `/licenses` 路由 + About 页链接。**⚠ 落点在开源基座仓**（前端 bundle 义务落在这里） | 新文件 + 路由表（`:87-102`） | T | W1（随 N4） | `grep -c "Permission is hereby granted" AboutPage.tsx` ≥ 1 |
| **26′** | `tryout_pr_src/Tryout-fix-83-issues/docker/Dockerfile.server` + `docker/Dockerfile.web` | `COPY LICENSE /app/LICENSE` / `COPY --from=web-builder /web/LICENSE .../html/LICENSE` + 两镜像加 `LABEL org.opencontainers.image.licenses="MIT"`。**⚠ 落点在开源基座仓；商业版若出独立自部署镜像，需在 `trialroom/docker/` 新建并同样加 COPY LICENSE + LABEL** | 两个 Dockerfile | T | W1 | `docker history` 显示 LICENSE 层 |
| **27** | `web/vite.config.ts` | 加 rollup banner 或 `vite-plugin-license`，**从 `node_modules/*/LICENSE*` 自动生成 `licenses/`**（手写清单下次 `npm i` 就过期） | 构建配置 | T | W1 | `web/dist/licenses/` 存在且与 node_modules 一致 |
| **28** | `web/src/pages/AboutPage.tsx` | 加「开源许可」可展开区块，内嵌 MIT 全文（含 `Copyright (c) 2025 Tryout Contributors` 与全部授权句）；**年份统一为 2025–2026** | `:38`、`:92`、`:98` | T | W1 | 年份一致 |
| **29** | `trialroom/tools/` | **新建 4 个门禁脚本**：`check-mcp-gates.mjs` / `verify-source-hygiene.mjs` / `check-license-distribution.mjs` / `check-calibration-gate.mjs` | 新文件 | C | W1–W5 | 四个脚本进 `GATES` |
| **30** | `trialroom/.github/workflows/ci.yml` | 元门禁改断言对象 + 补第二个 checkout + 补 `web` job 前提 + 补 4 个新脚本进清单 | `:26`、`:38-60`、`:74-92` | T | W2（随 N7） | CI 整体绿 |
| **31** | `trialroom/review/11-final-plan/` | **本方案归档**为 `merge-final/deliverable.md` + `sections/*.md` | 新增 | M | W1 | 三处副本一致 |
| **32** | `trialroom/tools/calibration/` | **新建**：把 `/tmp/kr2/verify.mjs` / `gate2.mjs` 落盘为仓库内零依赖脚本，并接进 `verify-all.mjs` | 新文件 | M | W1（随 N3） | 复算可复现；退出码即结论 |
| **33** | `trialroom/server/services/materialBoundary.js` | **新建**：`stripInvisibleChars` 的实现（零宽 / RTL override / BOM / 同形字归一化）+ `wrapAsData` | 新文件 | M | W3 | G22b 断言它存在且对样本字符归一化 |

### 6.11 许可证与 MIT 义务

#### 6.11.1 判定框架的替换：五步 + 三档

**「根级无 LICENSE = 无授权」这个框架本身是错的**，它在 6 个样本上错了 4 次（许可席 §2.1 第 2 条，`09-integration-license.md:51`）。错误方向**全部是「过度限制」**——把可商用的判成不可用，等于自己砍掉了三条合法借鉴路径。v3 采用许可席的五步判定 + 三档结论：

```
Step 1  根级任意常见命名的许可文件：LICENSE / LICENSE.txt / LICENSE.md / LICENCE / COPYING / NOTICE
Step 2  包清单字段：package.json → license；pyproject.toml → [project].license；Cargo.toml → license
Step 3  README / CONTRIBUTING / 仓库描述中的明确许可声明（须指名许可 + 适用范围）
Step 4  组织级声明 —— 命中时仍须回到 Step 1–3 确认本仓库是否覆盖
Step 5  ★ 内容范围核对：许可覆盖的是「作者自己的权利」。若目标内容派生自上游，
        上游限制会穿透下来（license laundering）。必须检查目标内容的 source / 归属链。
```

| 档 | 判据 |
|---|---|
| **确定可用** | 存在可验证的、作者明示的授权声明（Step 1–4 任一），且该许可允许闭源商业使用，且 **Step 5 通过**（目标内容不派生自受限上游） |
| **需补确认** | 存在明示授权，但授权范围可能不覆盖我们要用的那部分内容，或授权主体 / 范围需一次人工确认（成本 < 0.5 人日） |
| **不可用** | 无任何授权声明（默认保留所有权利），或授权含 **NC（非商业）/ GPL 类 copyleft / 字段管辖不覆盖目标内容** |

#### 6.11.2 许可证三档判定表

| 仓库 | 实测证据 | **三档结论** | 与原方案的差异 | v3 处置 |
|---|---|---|---|---|
| `alirezadir/AIMLInterviews` ★9,915 | 根级 `LICENSE` = MIT（`Copyright (c) 2021 Alireza Dirafzoon`），另有 `MCP/LICENSE` 亦 MIT；`MCP/package.json` description = "MCP server that turns AI assistants into **spoiler-safe** AI/ML interview tutors"；`MCP/src/catalog.ts` 有 `SOLUTION_HEADING` 剥离答案段落的实现 | **确定可用（MIT）** | 结论一致，但建议从「借机制不复制代码」**升级为「直接复用 MIT 代码」**（`MCP/src/hints.ts` 的 7 area × 3 级渐进提示 + `catalog.ts` 的答案剥离就是我们要的机制实现） | 复用义务：文件头保留 MIT 声明 + 第三方声明页收录 MIT 全文。**A 期不排期**（时间不够），进 B 期 W8 的「Skill / MCP 三件套」参考实现 |
| `girik-chadha/interviewer-mcp` ★1 | `main/LICENSE` = MIT（`Copyright (c) 2026 Girik Chadha`）；8 个工具 `ingest_repo / list_sections / get_code_section / mark_covered / get_interview_targets / log_interview_result / set_job_description / get_progress` | **确定可用（MIT）** | 复核成立，但**低估了重合度**：它不是「记住哪些章节答砸了」，是一整套「仓库 → 可讲章节 → 逐节强度打分 → 下次从最弱点开始」的数据模型，与我们复盘回溯闭环是同一件事的两种实现 | **A 期不复制**；但**它是我们 `weaknessCore` 之后要做的事的参考实现**，B 期 W16 逐行读源码。**注意**：基座 `server/services/weaknessCore.js`（78 行）**已实现跨会话弱项聚合**——「记忆/聚合」这一半是有的，缺的是「按记忆针对性再问」那一半 |
| `datawhalechina/hello-agents` ★84,737 | 根级有 **`LICENSE.txt`**（不是 `LICENSE`），内容是 **CC BY-NC-SA 4.0 全文**；README「## 📜 开源协议」段双重声明 | **不可用（CC BY-NC-SA 4.0）** | 原方案结论对、**理由错**（说的是「根级未找到 LICENSE → 默认保留所有权利」）。**后果比「保留所有权利」更严重**：① NC 明确禁止商业使用（Trialroom 是付费商业产品），任何复制是**可被明确主张的违约**；② SA 要求改编物以同许可发布，与闭源商业产品**不可调和**；③ 权利人是 Datawhale（组织级项目，有 84k star 的社会资本与执行能力） | **全清单里唯一必须零复制的对象。** 且**我们自己的 Pro 题库正在做同一件事**（`source` 指向外部仓库），只是方向相反 → 见 §6.11.3 |
| `HelloGGX/interview-mcp-server` ★9 | 根级**无** LICENSE 文件，但 **`package.json` 有 `"license": "Apache-2.0"`**（另有 `"private": true`，不影响仓库源码授权） | **确定可用（Apache-2.0）** | **推翻原方案的「否」。** 包清单里的 `license` 字段是作者对该仓库源码的明示许可声明，SPDX 表达式是 2026 年的规范载体（PEP 639 / SPDX） | 义务：保留版权声明 + 许可全文 +（若有）NOTICE、标注修改、§3 专利授权与专利终止条款。**它的「工具分层 + 简历解析 + 面试官侧准备工作流」正是我们想借鉴的** → 进 B 期「逐行读过」清单 |
| `Ddhjx-code/agent-interview` ★2 | 根级无 LICENSE，但 **`pyproject.toml:8` 有 `license = "MIT"`**（PEP 621 SPDX）；**关键发现**：`interview_rag_server/data/questions.json` 共 23 题，每题带 `source` 字段，**23/23 全部指向 hello-agents 或 Agent-Learning-Hub**；仓库还打包了 `data/web_sources/`（arXiv 摘要、Google AI 文档、LangChain 博客、Claude 文档的逐份抓取副本） | **需补确认 → 分内容判定**：代码「确定可用（MIT）」；**题库内容「不可用（继承 hello-agents 的 NC/SA）」** | 原方案判「否」——结论偶然对，理由完全错。**这是本次最重要的方法论反例**：它证明「根级有 MIT LICENSE 文件」**同样不等于**「内容可闭源商用」。许可文件声明的是**作者的权利范围**，而作者的权利本身可能来自上游，上游的限制会穿透下来——这就是 **license laundering** | **写成方案里的一条通用警告**（不是只针对这个仓库）：**许可文件声明作者的权利范围，不保证上游权利干净。** 这条警告直接指向我们自己的题库 |
| `fourleafai/clover-public` ★8 | 根级确实有 `LICENSE`（MIT，`Copyright (c) 2026 Four-leaf`）；`package.json` 有 `"license": "MIT"` 且 `files` 数组含 `"LICENSE"`；README `:105` 原文：「The Skill, the per-tool dist pipeline, and the install CLI are **MIT-licensed in this repo**. **The question bank itself lives behind the MCP today**; the open-data play is on the roadmap.」 | **确定可用（MIT），但要按 README 划定的范围用** | **推翻原方案的「否」。** README 三处互证（`:105` / `:114` / `:153-155`） | **它是「借机制、不复制内容」的唯一有作者背书的现成依据**——比任何无出处的论断都强。**A 期材料可引用它的 README 原文作为方法论背书**（1 句话，0 成本） |

#### 6.11.3 真正的商业风险在题库 `source` 字段

**这是本节最容易被低估的一段。** 许可席实测：Pro 题库 116 题的 `source` 字段指向外部 URL（100+ 唯一值）或 `synthetic-2026`，其中 6 条 GitHub 源题涉及的仓库里：

| `source` 指向的仓库 | 实测许可 | 根级证据 |
|---|---|---|
| `mbland/automated-testing-playbook` | **CC0 1.0 Universal** | 根树含 `LICENSE.md` |
| `simota/agent-skills` | **MIT** | 根级 `LICENSE` |
| `proffesor-for-testing/agentic-qe` | **MIT** | 根级 `LICENSE` |
| `6512197/System_design_Questions` | ⚠️ **无任何许可文件** | 根树仅 `Answers/`、`README.md` → 默认保留所有权利 |
| `Aayushdt/system-design` | ⚠️ **无任何许可文件** | 根树仅 `My design/`、`readme.md` |
| `ashishps1/awesome-system-design-resources` | ⚠️ **GNU GPL v3** | 根级 `LICENSE` = GPL-3.0 全文；仓库还带 `diagrams/` |

**当前的实际侵权风险：低。** 许可席逐条读了 6 道 GitHub 源题的 `content` 与 `keyPoints`，**全部是全新编写的场景题**（约束、数字、追问预告、keyPoints 全部原创）。例如 `pro-system-design-006` 引用 GPL-3.0 的 `ashishps1`，但题面是「每天 10 亿条通知，1 秒内要送达，怎么设计？」——与该仓库内容无逐字关系。**今天没有侵权事实。**

**但有三个定时炸弹**：

1. **政策本身在邀请逐字引用。** `SCHEMA.md:60` 写着「**优先引用**公开可查的面经」，`:61` 虽补了「改写成贴近真实面试的表述，不要直接复制」，但**没有任何门禁检查这个「改写」是否发生**。而仓库里已经有成熟的门禁范式（`verify-no-leak.mjs` 的子串级泄漏自检）——**说明这个团队知道怎么写这种门禁，只是没给 source 写**。
2. **专有 UGC 的 ToS 风险比开源仓库大得多。** 那 100+ 条 URL 里，牛客 / CSDN / 掘金 / 搜狐 / 知乎 / LeetCode Discussions 都是**专有 UGC 平台**：内容版权归各作者，平台 ToS 明文禁止未经授权的复制与再发布（LeetCode Discussions 尤其敏感，有独立付费墙与 Terms）。**「改写成贴近真实面试的表述」在著作权上不构成安全港**——只要保护性表达（题目特有的具体表述、案例、数据组合）可被识别，认定为改编 / 侵权是成立的。
3. **GPL-3.0 那个仓库带 `diagrams/`。** 一旦有人「顺手把那张图搬进我们的题库」，就是 GPL-3.0 复制件进入闭源商业产品 —— 触发整个产品的 copyleft 义务。**这是最坏情况，而且只需要一次手滑。**

**落地（0.8 人日，W1）**：

```
① 新增 tools/verify-source-hygiene.mjs，接进 tools/verify-all.mjs 与 CI（能独立失败）
   规则：
   A. source 域白名单：
      允许逐字来源 = 仅 GitHub 上 LICENSE ∈ {MIT, Apache-2.0, BSD-*, CC0} 的仓库
                    （须在 questionbank/data/sources-license.json 登记仓库 → 许可映射）
      禁止来源   = 牛客 / 知乎 / 掘金 / CSDN / 搜狐 / LeetCode Discussions / Reddit / Blind
                   以及任何无许可或 GPL / CC-BY-NC 仓库
   B. 对每条允许的 source：拉取 / 缓存源文本，计算题面与源文本的 12-gram 重合度，
      超阈值（如 ≥ 6 个连续 12-gram 命中）→ 退出码 1
   C. 登记文件本身也要门禁：sources-license.json 里每个仓库的许可必须与实际 LICENSE 文件一致
② questionbank/SCHEMA.md:60 改写：
   「优先引用」→「仅作选题灵感来源（topic lead）。禁止逐字引用或近似改写；
     如确需引用原文，须取得权利人书面授权并在此登记。」
③ questionbank/SCHEMA.md 增字段 sourceKind: 'lead' | 'authorized-quote'
   （现有 116 条全部为 'lead'，export 时可落成枚举，零泄漏策略不变）
```

**为什么零泄漏管道不受影响**：导出脚本 `export-pro-questionbank.mjs` 的白名单是 `PUBLIC_FIELDS = [id, industry, type, difficulty, title, content, tags, estimatedMinutes, sourceType]`，`source`（原始 URL）**本来就不进公开产物**，只落一个枚举型 `sourceType`。**所以新增 `sourceKind` 是纯内部字段，公开产物的零泄漏性质完全不变**（G7 / G8 两道门禁不受影响）。

**L-13：基座 808 题零 provenance。** `tryout_pr_src/.../web/public/questionbank.json` 的 808 题**没有任何 provenance 字段**（`source` 计数器 = {None: 808}，`meta` 只有 industries/questionTypes/difficulties/total）。我们无法证明 808 题是我们原创的，也无法证明它不是从别处来的——**在 MIT 仓库里，这构成「以 MIT 标签发布未经验证来源的内容」的同样 license-laundering 风险**（与 L-04 同型，只是方向是「不明来源」而不是「已知上游」）。
**修复（0.3 人日，B 期 W16）**：给 808 题补 `source` 字段（先统一填 `synthetic-2026` 兜底 + 人工抽检 30 题），并在参评材料中明确写「**基座 808 题为历史题库，Pro 轨 116 题为本次新制、带完整判据链**」。
**A 期必须做的只有一句话**：参评材料里**不把「808 题」说成「我们的 808 题」**。这一句的成本是 0，它是把一条不可辩护的主张变成可辩护的。

#### 6.11.4 MIT 义务：9 项承诺 0 项落地

设计方案的承诺原文：

> `Trialroom-全量设计方案.md:1628`：「**MIT 唯一硬义务**：分发时保留版权声明 + 许可文本。**前端 bundle 发到浏览器即构成分发** → 必须在构建产物保留各依赖 license header，About 页 / 第三方声明页放 MIT 全文；Docker 自部署版镜像内含 LICENSE + `org.opencontainers.image.licenses`」
> `:1556`：「许可证审查 | 引入时同步进 `THIRD_PARTY_LICENSES`，前端 bundle 必须保留各依赖 license header」
> `:2369`（验收标准表 · 合规行）：「无官方示例代码外泄；**第三方声明页含 MIT 全文与各依赖许可**」

**实测差距清单**：

| # | 承诺项 | 实测状态 | 证据 | 差距 |
|---|---|---|---|---|
| **L-06 / G-1** | About 页放 MIT 全文 | ❌ **未实现**。只有两个徽章文字「MIT License」/「Tryout · MIT License」+ 一行 `© 2026 Tryout Contributors`，**没有 MIT 的授权句（"Permission is hereby granted…"）** | `web/src/pages/AboutPage.tsx:38`、`:92`、`:98`；`grep -rn "Permission is hereby granted" web/src/` = **0 命中** | **标签 ≠ 许可声明。** MIT 的条件是「上述版权声明**与本许可声明**应包含在所有副本或实质性部分中」。一个写着「MIT License」的徽章既不是版权声明也不是许可声明 |
| **L-10 / G-2** | 第三方声明页含 MIT 全文与各依赖许可 | ❌ **未实现**。`web/src/pages/` 共 10 个页面，**无第三方声明页**；`App.tsx:87-102` 路由表无对应路由 | `ls web/src/pages/`；`grep -rIl "第三方声明\|Third-Party Notice"` 在代码中 **0 命中** | **验收标准表里的「合规」行当前是假的** |
| **G-3** | `THIRD_PARTY_LICENSES` | ❌ **未实现**。全仓无此文件/目录 | `grep -rIl "THIRD_PARTY_LICENSES"` → 只命中 5 个 .md | 同上 |
| **L-08 / G-4** | 前端 bundle 保留各依赖 license header | ❌ **未实现**。`web/dist/` 根目录 = `assets/ docs/ index.html logos/ manifest.json questionbank.json robots.txt sitemap.xml sw.js`，**无任何 license/notice 文件** | `ls web/dist/`；`find web/dist -iname "*license*"` = 0；`vite.config.ts` 全文无 license 插件、无 rollup banner | 方案的推理（「bundle 发到浏览器即构成分发」）**完全正确**，但结论没落地 |
| **L-07 / G-5** | Docker 镜像内含 LICENSE | ❌ **未实现**。`Dockerfile.server` 只有 `COPY server/ ./`；`Dockerfile.web` 只有 `COPY --from=web-builder /web/dist /usr/share/nginx/html` | 两个 Dockerfile 全文 | 两个镜像都不含许可文本 |
| **L-07 / G-6** | `org.opencontainers.image.licenses` | ❌ **未实现**。全仓 `grep -rIn "opencontainers"` 只命中设计方案文档本身 | 同上 | 镜像标签缺失 |
| **L-11 / G-7** | 各第三方依赖许可 | ❌ **未实现**。web 运行时依赖 9 个直接依赖（recharts / lucide-react / monaco-editor / @monaco-editor/react / react / react-dom / react-router-dom / zustand / dompurify）全部为 MIT/ISC/Apache-2.0 类，均要求保留声明，**bundle 里一个都没有** | `web/package.json` dependencies 段 | 无自动生成机制 → **每加一个依赖就新增一处违规** |
| **L-09 / G-8** | 商业闭源仓的第三方声明 | ❌ **未实现，且有实质性的派生关系**。`trialroom/` **无 LICENSE 文件**；而 `trialroom/db/000_base_schema.sql:3` 写明「基座 schema（**源自开源基座 Tryout** 的 server/db.js，20 张表）」、`:31` 写明来源路径 | `ls trialroom/LICENSE` → No such file；`db/000_base_schema.sql:3/:27/:31` | **MIT 义务在闭源仓里同样成立**：携带 Tryout 的派生内容而不保留 Tryout 的版权声明与许可文本。**这不影响我们闭源**（MIT 允许闭源商用），但**必须保留声明** |
| **L-21 / G-9** | 年份一致性 | ⚠️ **不一致**。About 页 `© 2026 Tryout Contributors`，`LICENSE` 写 `Copyright (c) 2025 Tryout Contributors` | `AboutPage.tsx:98` vs `LICENSE:3` | MIT 的「上述版权声明」指的是 LICENSE 里那一行，两处不一致会让人质疑哪份是真的 |

**结论：9 项承诺，0 项落地。这不是「细节没做完」，而是「一条都没做」**——因为 §八 的开工清单里没有任何一条对应它（许可席 §4.5 结语）。

**v3 的分发边界判定（三条，必须写进方案）**：

| 分发形态 | 是否构成分发 | 义务 | 落点 |
|---|---|---|---|
| **前端 bundle（`web/dist/` 发到浏览器）** | **是** | 构建产物保留各依赖 license header + MIT 全文 + 第三方许可清单 | `web/public/LICENSE`（Vite 自动拷进 dist 根）+ `web/vite.config.ts` 自动生成 `licenses/` |
| **Docker 自部署版镜像（server / web）** | **是** | 镜像内含 LICENSE + `org.opencontainers.image.licenses` | 两个 Dockerfile 各加 `COPY LICENSE` + `LABEL` |
| **闭源商业仓（trialroom/）** | **是**（携带 MIT 派生内容） | `trialroom/LICENSE`（专有声明）+ `THIRD_PARTY_NOTICES.md` 收录 Tryout 的 MIT 全文与版权行；`db/000_base_schema.sql` 头部加指向注释 | 新建两个文件 + 改 schema 头 |

**修复动作（0.5 人日，W1，按性价比排序）**：

```
⚠ 落点分仓：①–⑦ 落在开源基座仓 tryout_pr_src/Tryout-fix-83-issues/，⑧ 落在商业仓 trialroom/，
  N4 的 0.5 人日按两仓分别估。

① web/public/LICENSE                ← 放 MIT 全文（Vite 自动拷进 dist 根）           5 分钟
② web/src/pages/LicensesPage.tsx    ← 渲染 MIT 全文 + 第三方依赖清单 + 各许可全文    2 小时
③ web/src/App.tsx 加 /licenses 路由 + About 页「开源许可」按钮链接                    15 分钟
④ docker/Dockerfile.server 加 COPY LICENSE /app/LICENSE                              2 分钟
⑤ docker/Dockerfile.web    加 COPY --from=web-builder /web/LICENSE .../html/LICENSE   2 分钟
⑥ 两个 Dockerfile 加 LABEL org.opencontainers.image.licenses="MIT"                    2 分钟
⑦ web/vite.config.ts 加 rollup banner 或 vite-plugin-license，生成 licenses/ 目录     1 小时
⑧ trialroom/ 加 LICENSE（专有声明）+ THIRD_PARTY_NOTICES.md（收录 Tryout MIT 全文）  20 分钟
⑨ About 页 © 年份与 LICENSE 统一                                                        2 分钟
```

**⑦ 特别说明**：**不要手写依赖清单**——手写的清单在下一次 `npm i` 之后就会过期，而「过期」正是这类合规项失效的典型方式。用 `license-checker-rseidelsohn` 或 `vite-plugin-license` 从 `node_modules/*/LICENSE*` 自动生成，并把它接进 CI（生成物与入库版本不一致 → 构建变红）。

**为什么这一条值得单列进参评材料**：「**我们把 MIT 义务做全了**」本身就是一个可演示的完成度信号——它证明我们理解「开源 ≠ 可以随便用」，理解「闭源商业版仍然要守上游许可」，而且它和「可判」是同一种思维：**把自己的依据摊开给人看**。成本 0.5 人日（在 v3 的 25.5 人日新增里占 2%），而它在评审现场的观感收益可能高于同成本的任何一个功能。

#### 6.11.5 许可证与 MIT 义务的验收判据

| 项 | 判据 | 失败后果 |
|---|---|---|
| 许可证三档判定已写入方案 | 方案 §五 的许可证表**逐行可查**（文件路径 / 字段名 / 结论三档），并写明五步判定 + 第 ⑤ 步 | 评审现场翻方案发现 4/6 行是错的，且错的方向全把自己可用的路砍了 |
| hello-agents 结论 | 写为「**不可用（CC BY-NC-SA 4.0），且是唯一一条法律上明令禁止复制（非商业 + 相同方式共享）**」 | 商业闭源产品复制 NC 内容 = 可被明确主张的违约 |
| `source` 域门禁 | `verify-source-hygiene.mjs` 能独立失败；116 题现有全绿；`sources-license.json` 存在且登记许可与实际一致 | GPL-3.0 复制件进闭源产品（一次手滑即触发整个产品 copyleft） |
| `SCHEMA.md:60` 措辞 | 改成「仅作选题灵感，禁止逐字或近似改写」 | 政策本身在邀请逐字引用，而无门禁检查 |
| MIT 全文 | `grep -c "Permission is hereby granted" web/dist/index.html web/dist/assets/*.js` > 0 | MIT 义务未履行（分发时未保留许可文本） |
| 第三方声明 | `THIRD_PARTY_LICENSES/` 存在 + `/licenses` 路由可访问 + 第三方依赖许可清单自动生成且与 `node_modules` 一致 | 每加一个依赖就新增一处违规 |
| 镜像 | `docker history` 显示 LICENSE 层 + 两镜像 `LABEL org.opencontainers.image.licenses="MIT"` | 自部署版镜像分发时未保留声明 |
| 闭源仓 | `trialroom/LICENSE` + `THIRD_PARTY_NOTICES.md` 存在，后者逐项引用 Tryout 的 MIT 全文与版权行；`db/000_base_schema.sql` 头部指向它 | 携带 MIT 派生内容而未保留声明 |
| 年份 | About 页与 `LICENSE` 的版权行一致（2025–2026） | 让人质疑哪份版权声明是真的 |
| 题量表述 | 材料里 **116 是裸数字不单独出现**，改用「覆盖矩阵」；「808 题」标明是历史题库 | 不可辩护的主张 + 施工图 `:319` 的旧数残留 |

### 6.12 风险登记

> 影响维度按官方四维权重标注：**产品完整度 30 / 支付集成度 25 / 商业化成熟度 25 / 作品影响力 20**。概率分**高 / 中 / 低**。「责任人角色」用 M（主：评分层 / 多用户 / 前端）、T（队友：支付 / 部署 / CI / 运维）、C（第三人，扩编后）、组长。

| # | 风险 | 触发条件 | 影响维度 | 概率 | 缓解动作 | 责任人 | 兜底方案 |
|---|---|---|---|---|---|---|---|
| **R-01** | **10/30 扩编未通过，缺口 25.7 人日无法消化** | 报名表改不动 / 人选未定 | **产品 30 + 支付 25**（MCP 块与支付净增同时丢） | 中 | 10/30 当天拍板；预案：MCP 整块 9.1 移 B 期 | 组长 | 走 §6.4.4 情景 B：砍到 **66.6 人日，仍缺 2.6**，**接受 12/01 上线**（窗口 17→9 天）+ 砍评分可信度块 |
| **R-02** | **支付自建轨落到 25 人日上界**（v3 只算了 8.0 净增，上界比台账多 15.7） | 退款 / 对账 / 前端付费页三态超预期 | **支付 25 + 商业化 25** | 中 | N8 的 9 行分解表逐行锁验收点；**离线对账可延后到 B 期** | T | 离线对账移 B 期；前端付费页只做「成功 / 失败」两态，退款态延后（**支付集成度会掉分，但不影响收钱**） |
| **R-03** | **11/06 支付沙箱未通** | 沙箱账号 / 验签 / 幂等任一环节卡住 | **支付 25 + 商业化 25** | 中 | W2 第 11 项 1.0 人日独立预算；§6.6.1 止损点 3 的砍伐顺序预置 | T | 砍 W4 房间前端 + 降级池；κ **豁免不砍**（§6.6.3） |
| **R-04** | **11/12 生产第一笔可计量交易未完成** | 风控拦截新客新设备新金额 | **商业化 25**（窗口折半） | 中 | 第一单剧本：团队成员本人账号先付 → 三档 0.01/1.00/3.90 → 三处截图 → 按错误码分流 | T | 上报官方群；接受 12/01 上线；**失败的那几笔也写进材料** |
| **R-05** | **11/15 报名 / 开通【网页应用收款】未完成** | 实人认证未过 / 控制台权限未下发 | **商业化 25 → 直接归零** | 中 | 10/31 前完成（W1 第 11 项 0.2 人日）；个人收款主体可用（决策 #45） | T | 官方群问个人主体入驻最短路径；**这是唯一非代码前置，不允许排到第 7 位** |
| **R-06** | **「作品提交并通过审核后」的字面前置** | 12/08 提交、审核跨过 12/09 | **商业化 25** | 中 | 上线定义改为「**作品已生效 ∧ 收款可用**」；11/22 上线当日同时提交一个可用版本进审核 | 组长 + M | 12/01 首次提交审核 + 12/08 补齐材料（**「先交后补」列入官方待问清单**） |
| **R-07** | **11/22 收款上线未达成** | W4 余量仅 0.5 人日 | **商业化 25**（17 天 → 9 天） | 中 | W4 第 6 项 M-05 单独盯；§6.6.1 止损点 8 的砍伐清单 | T | 砍房间与分享卡片；「练习 + 复盘 + 付费」做透；资源转向 75 分可控区 |
| **R-08** | **付费用户数不足**（11/15 < 5 / 11/25 < 20 / 12/01 < 30） | 获客漏斗算术不闭合（2000 UV → 最多 15–25 人 vs 目标 ≥30） | **商业化 25** | **高** | N10 漏斗表分母写死 + 三 checkpoint 目标；W5 的 5.0 人日余量留给渠道调整 | T + M | 转 1 分钱策略 + 换渠道（校园/求职群优先，小红书降权）+ 落地页改最轻版本；**12/01 用 M-38 方案 B（不出现「付费用户数」字段）** |
| **R-09** | **刷量被判定（资格级风险）** | 任何自购/互刷/测试单进生产 | **参赛资格 + 全部四维** | 低 | 团队内控：零自购、零互刷、零测试单进生产；指定责任人 + 订单抽样复核 | T | 去重键未披露 → **主动规避一切自购/互刷/测试单，并留交付证据链**；刷量定性为资格级风险（取消资格 + 追回奖金），不是分数级 |
| **R-10** | **MCP 越权**：scope 不绑房间 / 鉴权作用域绕过 / `_meta` 信任身份 | 任何外部 agent 持 token 调用 | **产品 30 + 支付 25**（数据泄漏即一票否决） | 中 | N11a/N11b 前置（`mcp_tokens` + scope 绑房间 + 越权 404 + nginx location + 头体一致 + `_meta` 白名单 + Origin + 幂等键）；G11 门禁 | C | deny-by-default：MCP 端点**默认全拒**，逐工具逐 scope 显式开；scope 不绑定即拒绝，不做「宽松降级」 |
| **R-11** | **复盘 v2 被砍 → 影响力第一名的物料不存在** | W4 因 11/22 收款挤爆，M-39 降级为 v1 | **影响力 20** | 中 | M-39 是不可砍项（决策 #23）；§6.8.2 已写明「若 W4 砍掉复盘 v2，第一名自动变成第二名」 | M | 影响力主线切到「首单双图」（候选 ②），成本 0.3 人日 |
| **R-12** | **官网互动量不达标**（影响力 20 的官方口径 = 官网作品页浏览/点赞/评论） | 分享卡与落地页未按时产出 / 渠道投放未启动 | **影响力 20** | **高** | M-51 分享卡两版 + 落地页在 W5（2.0 人日，已在台账）；N17 物料收口 0.5 在 W6 | T | 观猹上架（联合主办方、审核 1–2 工作日、分类限 3 个）+ 小红书主引擎 + 即刻/V2EX/掘金长尾；**把影响力物料做成「一份素材服务 25 + 20」** |
| **R-13** | **题库 `source` 侵权**（GPL-3.0 复制件 / 专有 UGC ToS / license laundering） | 有人「顺手搬一张图」或逐字搬运面经 | **参赛资格 + 产品 30** | 中 | G12 来源合规门禁 + `sources-license.json` + `SCHEMA.md:60` 措辞 | T | 门禁红 → 该题退回重写；**已有 116 题实测全绿，今天没有侵权事实** |
| **R-14** | **MIT 分发义务未履行** | 构建产物 / 镜像 / 闭源仓缺声明 | **产品 30（完成度信号）** | 低 | G13 门禁 + N4 的 9 步修复动作 | T | `web/public/LICENSE` + 镜像 `COPY LICENSE` + `THIRD_PARTY_NOTICES.md` 三件齐 |
| **R-15** | **门禁写了但没接线** / **CI 恒红** | CF-05 元门禁自我满足；CF-06 第二个 checkout 缺失；CF-06b `web` job 前提缺失 | **产品 30（全部红线）** | **高** | N7 在 W2 完成；元门禁改断言对象；G10 元门禁自检扩面到 `tools/` + `scripts/` 全部 `*.mjs` | T | 新门禁**先在 `verify-all.mjs` 的 `GATES` 注册**（唯一真相源），ci.yml 列表只是镜像 |
| **R-16** | **M-15 口径未修 → 「凭什么准」被戳穿** | 声称「已修口径」但一行未改 | **产品 30** | 中 | M-15 排进 W3（1.0 人日）；§6.7 Q3 的话术已写明「要么改掉这句，要么写明 W3 已修」 | M | 参评材料**不出现**「口径已修」的表述；一致率降级为「待修的回归监控项」 |
| **R-17** | **κ 的 n 不足导致区间过宽**（n=40–60 时 95% 区间宽 0.49–0.62；真 κ=0.70 时 P(下界 ≥ 0.70) 仅 0.2%–0.6%） | 只标 40–60 条 | **产品 30** | 中 | 判据 C 强制报区间 + 相对回归门禁；**若坚持要一个绝对数字，n ≥ 300**（不现实） | M | 报区间不报单值；把区间宽度本身写进材料（「诚实标注测量边界比给一个漂亮但说不清的数字更可信」） |
| **R-18** | **2c2g 并发上限 = 2 → 排队 15s 超时 → 429 → 失败自动退次数 → 真实退款流水 → 若退款扣减累计有效交易用户数，则低价拉新在统计口径上自我抵消** | 首单并发涌入 | **商业化 25** | 中 | ¥0.01 首单因系统原因失败时按「不扣次数、当场补发一次」处理，**不产生真实退款流水**；真实退款通道只对 ¥3.9 及以上档位开放 | T | 排队提示 + 降级打字；`/api/metrics` 的 6 条里含并发与队列深度 |
| **R-19** | **ICP 备案未过（1–3 周）** | 提交晚 / 审核慢 | **影响力 20（观感）** | 中 | W1 第 7 项 0.5 人日当天启动（**全程最长前置**） | T | 「服务器 IP + 端口 + 临时域名」做演示，备案过后再切；**不影响支付**（支付不依赖域名） |
| **R-20** | **题库/材料数字残留**：施工图 `:319` 的「800+ 题库」、`:339` 的「12-09 前扩到 300+」、08 台账周小计 64.0 vs 逐行 64.2、终稿的「¥9.9 / 5 次」第三档价 | 评审现场翻材料对数字 | **产品 30（初筛资格项）** | **高** | §6.10 第 8 / 9 / 14 项；§6.2.2 的 0.2 人日差额显式化；§6.11.5 的题量表述 | M | **材料里 116 不单独出现**，改用覆盖矩阵；价格表三处（定价页 / 后端 SKU / 材料）逐字一致 |
| **R-21** | **第三人未到岗 / 到岗后磨合超预期**（边际有效产能按 8 人日/周计，未到岗则 MCP 块失去工位） | 10/31 未报到 / 沟通成本高 | **产品 30** | 中 | 第三人的职责在提交窗口被定义为**独立交叉验收**（N18 1.0）+ 降级预案执行（N19 1.0），**这两项独立于 MCP 块**，未到岗也可由 M/T 兼任 | C + 组长 | MCP 块顺延到 W5–W6；**N18/N19 保留**（它们是提交质量保障，不依赖第三人到岗的增量产能） |
| **R-22** | **门禁扫不存在的目录 → 永远绿**（A4 / G22 的扫描目标 `server/services/scoring/**`、`server/prompts/**` 在基座不存在） | 实现时照抄目录名 | **产品 30（全部红线）** | 中 | 扫描前断言目标路径存在且非空，否则退出码 2 | C | 同 `check-middleware-order.mjs` 的 exit-2 模式；门禁清单登记时逐条核对目标路径 |
| **R-23** | **`stripInvisibleChars` 被当「既有实现」实则不存在**（全仓 0 命中），A5 / A6 / A8 三条断言全挂在它上面 | 实现时假设它已存在 | **产品 30** | 中 | 标为「待实现」，落点 `server/services/materialBoundary.js`（§6.10 第 33 项）+ G22b 门禁 | M | 若 W3 前未实现，A6 断言降级为「人工检查」并在材料里注明；**不得对外宣称已有零宽字符消毒** |
| **R-24** | **κ 复算脚本随 `/tmp` 消失，§4.2.2 表不可复现** | 评审 / 下一位作者要求复现 | **产品 30** | 中 | 脚本落盘 `trialroom/tools/calibration/`（§6.10 第 32 项）+ 接进 `verify-all.mjs` | M | 把该表降级为「`推算`」并把完整规格补进 §4.2.1 口径注 |

**三条风险的优先级重排**：**R-15（门禁没接线）、R-20（材料数字对不上）、R-22（门禁扫不存在的目录）概率最高、成本最低、后果最直接**——这三条不花钱，但一条会让全部红线失效、一条会被现场当场戳穿、一条会让新门禁变成第二个「永远绿」。**它们必须排在 W1、W2 就做掉，而不是排在风险登记表的末尾。**

### 6.13 排期与门禁节的 P0 / P1 落点索引

> ⚠️ **编号撞名警告**：一致性席的 `R-1..R-19` 与业主方裁决的 `R-1..R-14` **同名不同义**（`10-adversarial-verdict.md:23`）。本节凡引一致性席发现，一律写「**一致性席 R-n**」；引业主方动作项，一律写「**裁决 R-n**」。

#### 6.13.1 P0 全集（18 条）逐条落点

| 编号 | 问题摘要 | 本节落点 | 落点形式 |
|---|---|---|---|
| **CF-01** | 本周清单与 W1 的 15 项零重叠，按字面读是**替换** | §6.1.4（显式声明为叠加）、§6.4.3（等量置换表 77.7 人日，来源限 B 期项 / 降级池 7.0 / 扩 3 人） | 声明 + 置换表 |
| **CF-02** | 产能缺口 ≈ 18 人日 = 产能 28%，基线缓冲 0，第二口径超载 12%–48% | §6.2.3（v3 显式算出 25.7 人日 / 40.2%）、§6.4.4（情景 A / B 两条分支） | 三口径对照 + 分支 |
| **CF-03** | 11/08 止损规则会砍掉本轮自己的阻断项 κ | §6.6.3（改写后的止损规则**原文**，含 κ 豁免与三条理由） | 规则改写原文 |
| **CF-04** | MCP 规范两处引用反向（`tools/list` 可随授权变化 / 最小 scope 是规范内建） | §6.9.3 G11 判据 ⑧（`server/discover` 必须实现）+ ⑨（无会话 / 显式 handle）+ ⑪（`x-mcp-header` 白名单）+ ⑦（`cacheScope:"private"`）+ 调用层 deny-by-default | 门禁断言 |
| **CF-05** | 新门禁接不进 CI；元门禁自我满足；无任何东西检查 `GATES` 数组 | §6.9.1、§6.9.4（元门禁改断言对象）、§6.9.3（每道新门禁必须注册进 `GATES`） | 元门禁改写 |
| **CF-06** | 商业 CI 现在就是红的（G1/G8b 指向不存在的 OSS 目录） | §6.9.1、§6.9.4（补第二个 checkout 或 G1/G8b 归位，W2 N7） | CI 改造 |
| **CF-06b** | 商业 CI 的 `web` job 同样必红（与 G1/G8b 无关） | §6.9.1、§6.9.4 第 3 项（前端构建迁仓 / 删 `web` job，W2 N7） | CI 改造 |
| **CF-07** | MCP 工具无 owner 隔离；`check-owner-isolation.mjs` 不扫 MCP 工具 | §6.3.2 N11a（`mcp_tokens` + scope 绑房间 + 越权 404）、§6.9.3 G11（MCP 工具纳入 owner 扫描） | 前置 + 门禁 |
| **CF-08** | 「复盘回溯」零实现却被当作成对数据来源 | §6.4.2（复盘保 `v_calibration_pairs` 视图，B 期 W16）、§6.5.2 判据 C（**报区间不宣称它是评估信号**）、§6.8.2 候选 1（并排展示**不是**评估信号） | 定位降级 |
| **CF-10** | **`entitlements` 唯一真相源有被绕过的风险（决策 #40，P0）**：若 MCP 按次计费另起订单表或另写权益写入路径，即为第三个真相源 | §6.4.2（「`entitlements` 唯一真相源」+ §6.3.2 W2 第 10 项（`orders`/`entitlements`/`idempotency_keys` 三写入路径契约）+ §6.3.3 W3 第 11 项（M-03 失败自动退次数**须覆盖按次计费**，按次计费移 B 期故本期不适用须写明）+ §6.10 第 13 项（08 台账新增行含 `entitlements.kind` 枚举映射与「不新增表」约束） | 台账补行 + 退次数口径扩写 |
| **L-01** | 许可证表 4/6 行错；判定框架「根级无 LICENSE = 无授权」本身错 | §6.11.1（五步判定 + 三档）、§6.11.2（逐仓库实测表） | 方法论替换 |
| **L-02** | hello-agents 实为 CC BY-NC-SA 4.0（NC + SA 双重限制） | §6.11.2（全清单里唯一**必须零复制**的对象）、§6.11.5（验收判据） | 三档结论 |
| **L-03** | HelloGGX 判「否」是过度限制（`package.json` 明示 Apache-2.0） | §6.11.2（改为「确定可用（Apache-2.0）」，义务项：声明/NOTICE/标注修改/专利） | 三档结论 |
| **L-04** | Ddhjx 的 MIT 只覆盖代码，题库 23/23 派生自 hello-agents → license laundering | §6.11.2（分内容判定 + 写成通用警告）、§6.11.3（**警告直接指向我们自己的题库**） | 通用警告 |
| **L-05** | clover-public 根级 LICENSE + package.json + README 三处互证，原观察是错的 | §6.11.2（「借机制不复制内容」的**唯一有作者背书的依据**，A 期材料可引用其 README 原文） | 三档结论 |
| **L-06** | About 页只有 "MIT License" 标签，没有 MIT 许可全文 | §6.11.4（L-06 行）、§6.10 第 25′ / 28 项、G13 门禁 | 修复 + 门禁 |
| **L-07** | 两个 Docker 镜像不含 LICENSE，也无 `org.opencontainers.image.licenses` | §6.11.4（L-07 行）、§6.10 第 26′ 项、G13 门禁 | 修复 + 门禁 |
| **L-08** | 前端构建产物 `web/dist/` 不含任何许可文本 | §6.11.4（L-08 行）、§6.10 第 25′ / 27 项（自动生成 `licenses/`，**不手写**）、G13 门禁 | 修复 + 门禁 |
| **L-09** | 商业闭源仓无 LICENSE、无第三方声明，但 `db/000_base_schema.sql:3` 明写源自开源基座 | §6.11.4（L-09 行）、§6.10 第 23 / 24 项（`LICENSE` + `THIRD_PARTY_NOTICES.md` + schema 头注释） | 修复 + 门禁 |

> **⚠ 编号错配修正（吸收核验报告 verify-schedule R1）**：原 §4.13.1 把 CF-10 写成「平台化路线零行 → 影子工程」，而源定义 `09-consistency-feasibility.md:61` 的 CF-10 = 「**entitlements 唯一真相源有被绕过的风险**（决策 #40，P0）」——**源定义在原文中无任何落点**。本稿已把 CF-10 整行替换为源定义，并**另设内部编号 I-1 承载「平台化路线账外新增 → 影子工程」**（落点：§6.1.1 词频表 + §6.1.4 显式声明为叠加 + §6.10 第 13 项台账补行）。同时 §6.7 Q3 里把引作「一致率口径」的 CF-10 一律改指 **CF-22**。

#### 6.13.2 一致性席 G-1..G-15 与 R-1..R-19

| 编号 | 摘要 | 本节落点 |
|---|---|---|
| **G-1** | 声明 7 项是替换还是叠加 + 等量置换表 | §6.1.4 + §6.4.3 |
| **G-2** | κ 从运行时条件移除，改为发布门禁 + 产品完整度佐证物 | §6.5.2 判据 A + §6.10 第 2 项 |
| **G-3** | 校准集样本来源写死 + 报 6 个逐维 κ + 95% CI + n + 三条分支 | §6.5.2（素材 = `rubricHints`，零新增标注成本） |
| **G-4** | 规范表述改正（删「规范内建」；补 `Mcp-Method`/`Mcp-Name`/`-32020`/`server/discover`/`cacheScope`/`requestState`） | §6.9.3 G11 判据 ③④⑦⑧⑨⑩⑪ 与 §6.3.3 N12a |
| **G-5** | 门禁四步可验证动作 + 先修 CI 既有红 | §6.9.3 + §6.9.4 |
| **G-6** | MCP 工具接入 owner 隔离 + owner 门禁扫描含 MCP + MCP 排在 M-02 之后 | §6.3.2 N11a、§6.3.3 N12a、§6.9.3 G11 判据 ①② |
| **G-7** | 明确 Machine Pay 是同一件还是第二件 + 所有支付轨写同一套 `orders`/`entitlements`/`idempotency_keys` | §6.1.3（裁决）+ §6.3.8（移出本作品）+ §6.4.2（`entitlements` 唯一真相源）+ §6.13.1 CF-10 |
| **G-8** | item 4 移 B 期 / item 5 只留设计稿 / item 6 依赖改 / item 7 提到第一位 | §6.5.1（第 1、10 项）+ §6.5.3（删三项） |
| **G-9** | 影响力主线改为分享卡 + 落地页 + 首单截图 + 复盘 diff；κ 降级为产品佐证物 | §6.8.2（候选排序 + 第一名理由） |
| **G-10** | 扩到 3 人的最晚决策日 10/30 + 拍板表合并不允许覆盖 | §6.6.1 止损点 1、§6.4.4、§6.10 第 10 项 |
| **G-11** | 11/22 前的顺序约束写死（item 6 排在 M-05 之后；11/16 前沙箱未绿即砍） | §6.6.2 关键路径 + §6.6.1 止损点 3 |
| **G-12** | 指标表分「设计意图」与「实现现状」；删过度断言；六维隔离改述为「已实现、A 期未接线」 | §6.7 Q3 / Q5 + §6.10 第 2 项 |
| **G-13** | 校准集落地形态：`v_calibration_pairs` 视图（0.3） | §6.3.8 W16 |
| **G-14** | 施工图 `:319` 的「800+」与 `:339` 的「12-09 前扩到 300+」二选一 | §6.10 第 8 / 9 项 |
| **G-15** | W1 第一件事定为「核实并推送 PR #1」+ 对齐字号分叉 | §6.3.2 第 12 项（PR#1 合并 + 全量回归 + 597 处回归截图） |
| **一致性席 R-1** | 44 天只能做成一条腿 | §6.4.3 + §6.4.4（情景 B 即这条腿的落地） |
| **一致性席 R-2** | 非本系统输入只供给证据 | §6.7 Q4 + §6.3.5 N12c（做成看得见的对照） |
| **一致性席 R-3** | 统一权限模型优于两套架构 | §6.7 Q4 |
| **一致性席 R-4** | 一致率高不是可靠性的证据 | §6.7 Q3 |
| **一致性席 R-5** | 换模型不能替代人工校准 | §6.5.2 |
| **一致性席 R-6** | 诚实标注测量边界 | §6.5.2 判据 C + §6.7 Q3 |
| **一致性席 R-7** | `initialize` / `Mcp-Session-Id` 已移除，有状态对象用显式 handle | §6.9.3 G11 判据 ⑨（无会话、显式 handle） |
| **一致性席 R-8** | `resultType: input_required` + MRTR；`requestState` 必须按攻击者可控输入处理 | §6.9.3 G11 判据 ⑩（`requestState` 绑 principal + operation + expiry + HMAC + 一次性消费 + 不进日志） |
| **一致性席 R-9** | `x-mcp-header` 不能携带密钥 | §6.9.3 G11 判据 ⑪（schema 声明白名单 / 值类型限定 / 日志脱敏 / 网关侧不可写死） |
| **一致性席 R-10** | 工具注解不是安全边界；`idempotentHint` 错误会让客户端放心重放 | §6.3.3 N12a（注解四写 + `submit_self_review` 标 `idempotentHint: true`）+ §6.9.3 G11 判据 ⑥ |
| **一致性席 R-11** | BYO 只接远程 HTTP；产品面窄 | §6.3.8（W9）+ §6.5.3（材料不得暗示普适） |
| **一致性席 R-12** | 许可核验方法论（「README 写 MIT ≠ 存在 MIT 许可文件」） | §6.11.1（五步判定） |
| **一致性席 R-13** | 多人同场不是空白 | §6.7 Q2 |
| **一致性席 R-14** | 支付只走 Machine Pay 一条轨 | §6.1.3 + §6.3.8（**裁决推翻**：本作品走 Vibe Pay 网页应用收款，Machine Pay 移出） |
| **一致性席 R-15** | 分账本期不做 | §6.3.8（不排期 + 论证改为「收入模型单边」） |
| **一致性席 R-16** | 有效交易是去重实名人数 | §6.5.1 第 6 项（漏斗分母 + 三 checkpoint） |
| **一致性席 R-17** | 智能收款套件准入问题要问对 | §6.10 第 30 项旁的官方待问清单 |
| **一致性席 R-18** | 小额订单是否计入有效交易：官方未定义 | §6.5.1 第 6 项 + §6.6.1 止损点 7（口径未明先切 ¥0.1） |
| **一致性席 R-19** | MCP「管计费」形态成立、顺序不成立（依赖倒置） | §6.3.8（W11–W12：计费作为装饰器接入，不改 MCP 调用链） |
| **CF-09 / CF-11 ~ CF-24** | 一致性席其余 15 条 P0/P1 | **部分不适用 / 部分已覆盖**：CF-11~CF-16 与 CF-20 / CF-22 由 §6.4.2 / §6.5.1 / §6.6.1 / §6.7 Q1~Q5 覆盖；CF-17~CF-19 / CF-21 / CF-23~CF-24 属基线既有裁决（`08-final-plan.md` 已闭环），本方案不重复展开 |

#### 6.13.3 许可席 L-10 ~ L-22

| 编号 | 摘要 | 本节落点 |
|---|---|---|
| **L-10** | 无 `THIRD_PARTY_LICENSES`、无第三方声明页（设计方案两处白纸黑字要求，0 命中） | §6.10 第 23 / 25′ 项、§6.11.4 G-2 行、G13 门禁 |
| **L-11** | 第三方依赖许可未随 bundle 分发，且无自动生成机制 | §6.11.4 ⑦（自动生成 + CI 比对）+ G13 门禁 |
| **L-12** | Pro 题库 `source` 指向 GPL-3.0 / 无许可 / 100+ 专有 UGC | §6.11.3 三个定时炸弹 + G12 门禁 + §6.11.5 |
| **L-13** | 基座 808 题零 provenance | §6.11.3（补 `source` + 抽检 30 题 + 材料区分历史题库与 Pro 轨） |
| **L-14** | 「面试官问用户自己的代码」不是空白（至少 6 家在做，2 家 MIT 且中文） | §6.7 Q7（改写为「别人做了但没闭环」）+ §6.5.1 第 10 项（**材料不得出现「别人问不了你的代码」**） |
| **L-15** | 「可判」不是空白（TestGorilla 0.84 / 北森 / Kaairo / Matchscope / 海纳 / Synchroni） | §6.8.1（终稿主叙事必须降级）+ §6.7 Q3（把 0.84 写进材料当参照系） |
| **L-16** | 「同场可含真人」的叙事与施工计划脱节（真人实时推流在 W9–W10，A 期是轮次制） | §6.7 Q2（**A 期成立的是「同一房间、席位可坐真人、AI 面试官同场、评分由平台做」**，不是实时通话）+ §6.3.5（W5 轮次制） |
| **L-17** | 「差异化从来不是题量」与自家施工图 `:339` 直接矛盾 | §6.10 第 9 项（撤承诺 or 认 30–40 人日） |
| **L-18** | 116 题在评审面前的观感（竞品是 500+/300+ 岗位模型/50+ 题库三件套） | §6.11.5 题量表述（116 不单独出现，改用覆盖矩阵） |
| **L-19** | 「借机制」不是法律动作，是四种不同动作 | §6.11.2（借想法 / 借代码 / 借内容 / 借数据分别对应不同义务；AIMLInterviews 是 MIT → **可以复制代码**，不是「不复制代码」） |
| **L-20** | 集成清单未覆盖 6 类必评类别中的 4 类 | §6.7 Q4（**我们做的是权限模型，不是集成清单**）+ §6.3.8 B 期 |
| **L-21** | About 页 © 2026 与 LICENSE © 2025 年份不一致 | §6.11.4 L-21 行 + §6.10 第 28 项 |
| **L-22** | 「可判」的方法论已有公开可复现的先行者，应引用而非自创（CC0 复现包 + DOI；行业阈值 0.6 / 0.8） | §6.7 Q3（0.84 与 0.6/0.8 参照系）+ §6.8.2 候选 4（可复现对比实验降级为 W16 候选） |

#### 6.13.4 业主方裁决 R-1 ~ R-14 的落点（与一致性席编号不同义）

| 编号 | 摘要 | 本节落点 |
|---|---|---|
| **裁决 R-1** | 智能收款套件的准入问题要换成「合作平台路径现在能否入驻」 | §6.10 第 30 项旁的官方待问清单 |
| **裁决 R-2** | 「小号刷量无效」是过度解读；刷量是资格级风险 | §6.12 R-09 |
| **裁决 R-3** | 支付工作量重估 15–25 人日 + 窗口前移到 10/27 + 沙箱 11/06 + 首笔 11/12 | §6.2.2 N8 + §6.3.1–§6.3.4 + §6.6.1 止损点 3/6 |
| **裁决 R-4** | 商业化 25% 补真计划 | §6.5.1 第 6 项 + §6.3.2 第 15 项 + §6.12 R-08 |
| **裁决 R-5** | 「作品提交并通过审核后」是计数的资格前提 | §6.12 R-06 + §6.5.1 第 6 项 |
| **裁决 R-6** | 许可证表 4/6 行错 | §6.11.1 + §6.11.2 |
| **裁决 R-7** | MIT 义务零落实 | §6.11.4 + §6.10 第 23–28 项 |
| **裁决 R-8** | 真正的商业许可证风险在题库 `source` | §6.11.3 + G12 |
| **裁决 R-9** | 「可判」与「面试官问你的代码」已不是空白 | §6.8.1 + §6.7 Q7 |
| **裁决 R-10** | 「六维隔离 + 多模型投票」架构不存在 | §6.7 Q5（改述为「已实现、A 期未接线」） |
| **裁决 R-11** | 「成对数据天然存在」是空的 | §6.4.2 + §6.5.2 判据 C |
| **裁决 R-12** | 一致率降级为回归监控要先修 M-15 口径 | §6.3.3 第 4 项（M-15 在 W3）+ §6.7 Q3 + §6.12 R-16 |
| **裁决 R-13** | 11/08 止损规则会砍掉本轮自己的阻断项 | §6.6.3（**改写后的止损规则原文**） |
| **裁决 R-14** | 扩到 3 人的决策日 11/09 → 10/30 | §6.2.1 + §6.6.1 止损点 1 + §6.4.4 |

---

## 七、跨节一致性说明

> 本节显式列出四节之间可能冲突的地方及**以谁为准**。**发现真冲突不自行调和**——逐条给出「以谁为准 / 建议 / 选另一侧的代价」。

### 7.1 四项真冲突（必须由业主方裁决，本方案不自行调和）

#### 冲突一 · κ 阈值口径：第二节的 3.5 人日 vs 第四节的 1.0 人日

| | 第二节（评分内核）§4.2.7 | 第四节（排期）§6.2.2 N3 |
|---|---|---|
| **口径** | 完整工作包：S0 前置 0.5 + S1 工具 0.5 + S2 样本 0.25 + S3 三阶段标注 0.9 + S4 判据 0.25 + S5 材料 0.25 = **3.5 人日** + 2 × 3.5 小时人工标注 | W1 增量：**1.0 人日**（裁决 0.75 + 门禁化接线 0.25），因决策 #48 把标注素材换成既有 `rubricHints`，零新增标注成本 |
| **落点** | `db/004_calibration_schema.sql` + `tools/calibrate-judge.mjs` + G14 门禁 | W1 第 12 项 |

**这不是真矛盾，是两个口径，但必须写明，否则会被当成算错。** 分解：3.5 人日中，**标注人工 0.9**（= 2 人 × 3.5h）来自既有素材、**不新增标注成本**；**工具与 S0 前置 1.25** 是新的；**S4/S5 判据与材料 0.5**、**S2 样本设计 0.25** 是新的。

**以谁为准**：**以第四节的 1.0 人日排期为准**（它是 W1 的可用产能口径），**第二节的 3.5 人日为准**（它是工作范围的完整口径）。两者相差 2.5 人日，**必须由业主方确认这 2.5 人日从哪里出**（建议：从 N12 MCP 切片 3.3 中划 1.0、从 N13 MCP 门禁 1.9 中划 1.0、或从 W5 的 5.0 人日余量中划 2.5）。

**选另一侧的代价**：若不划这 2.5 人日，**G14 门禁在 W1 交付不出实物**（门禁断言「κ_JH 低于阈值 → 退出码非 0」没有报告可读），κ 校准这一项等于交了一半——而这一项的判据 C 明确要求「材料里同时给出旧→新换算表」，没有真实 run 就没有区间可报。

#### 冲突二 · 支付相关日期：三个互斥日期已裁决，但 §6.6.1 止损点 4 与 §5.5.3 里程碑表仍有两处表述不一致

| 位置 | 表述 | 判定 |
|---|---|---|
| §5.5.3 倒排时间线 | T-29~T-25 行写「**11/06 – 11/09（W2）**」+「**沙箱全链路 11/06 前跑通**」 | ✅ 唯一硬门槛 = **11/06** |
| §6.6.1 止损点 3 | 11/06 沙箱全链路四件齐 | ✅ 一致 |
| §6.6.1 止损点 4（**原写法**） | 11/08「支付通了吗」作为独立里程碑 | ⚠️ **已在本稿改为「11/08（对外复述 11/06 判定，非新增里程碑）」** |
| §5.5.5 窗口账 | 「我们能吃到的（11/22 上线）= 17 天」 | ✅ 已由原 18 天修正为 17（36 + 26 + 17 = 79 闭合） |
| §6.1.3 三个互斥日期裁决 | 以 11/06 沙箱 / 11/22 上线为准，B（11/18）与 C（12/01）作废 | ✅ 裁决层 |
| §6.10 第 14 项 | 08 台账「支付沙箱 11/08 止损点」须改为「11/06 硬门槛，11/08 为对外复述」 | ✅ 文档层落点 |

**以谁为准**：**11/06 是唯一的沙箱里程碑日**；11/08 只是对外复述日。**支付里程碑收敛为 4 个：10/27 开工（窗口起算，非里程碑）/ 11/06 沙箱 / 11/12 首笔 / 11/22 上线。**

**选另一侧的代价**：若保留 11/08 作为独立里程碑，止损点 3 与 4 会指向不同日期，而 11/08 已经落在 11/06 之后——**等于承认「11/06 硬门槛可以不过」**，这会把 §5.5.1 的窗口对账表（「沙箱 11/06 段在悲观口径下不可达」）变成常态。

#### 冲突三 · MCP server 数量：第一节的「1 server + 6 工具」vs 终稿的「先切 1 个」vs §6.13.1 的内部编号 I-1

| 位置 | 表述 | 判定 |
|---|---|---|
| 终稿 `:195` 拍板表 | 「MCP 暴露面先切 1 个还是 2 个 server → 先切 1 个」 | 原表述（工具表里 `evidence.*` 三行属于另一个 server = S-18 判定的自洽性矛盾） |
| §3.3.1 结论 | A 期 = **1 个 server（房间与面试）+ 6 个工具**（5 个房间与面试工具 + 1 个只读证据工具） | ✅ 本方案定案 |
| §3.3.4 | 工具总数 ≤ 12 门禁（G24） | ✅ 上限 |
| §5.3.4 / §5.9 | 支付侧的 `orders.source` 双轨（`self_built` / `suite`）**不是** MCP server 的数量问题 | ✅ 不冲突 |
| §6.3.8 W11–W12 | B 期新增「MCP 写工具 + 按次计费 402 中间件」 | ✅ B 期，不影响 A 期的 1 server |

**以谁为准**：**A 期 1 个 server + 6 个工具**。保留 1 个只读证据工具（`evidence.search`）是**必须的**——若把 `evidence.*` 整体移 B 期，「外部输入只供给证据、不参与结论」在 A 期外部完全不可见，评审看到的就是「把面试 API 包了一层」（S-18）。

**选另一侧的代价**：若按终稿的「先切 1 个」把 `evidence.search` 也移走，**§6.3.5 N12c「职责分离可见演示」就失去被演示的对象**（0.8 人日的对照演示和 2 人日的切片都白花），而这一项是 S-18 判定的**唯一可见性出口**。

#### 冲突四 · 门禁条数：10 + 4 = 14，不是 13

| 位置 | 表述 | 判定 |
|---|---|---|
| §6.9.1 现状 | 现有 **10 道**（G1 / G2 / G3 / G4 / G5 / G6 / G7 / G8b / G8 / G10） | ✅ 实测 |
| §6.9.2 (c) 门禁全景 | **14 道**（原写 13，已修正） | ✅ 本方案定案 |
| §3.11.3 MCP 断言清单 | G11 / G11b / G12a-e / G13a-c / G14a-c / G15 / G15b / G16a-c / G17a-d / G18 / G19 / G20 / G21a-d / G22 / G22b / G23 / G24 / G25 / G26 / G27 / G28 / G29 / G30 / G31 —— **这些是 G11 门禁脚本内部的子断言编号，不是 25 道独立门禁** | ⚠️ **必须写明，否则会被数成 35 道** |
| §6.9.3 | G11 / G12 / G13 / G14 四道新门禁的写死判据 | ✅ |

**以谁为准**：**14 道**（`verify-all.mjs` 的 `GATES` 数组是唯一真相源）。§3.11.3 的 G11–G31 是 **G11 脚本内部的分项断言**，它们全部由 `tools/check-mcp-gates.mjs` + `tools/check-mcp-surface.mjs` 两个文件承载，在 `GATES` 里只登记 2 个条目。

**选另一侧的代价**：若不写明「G11–G31 是子断言」，评审 / 下一位作者会按 35 道门禁去估工作量（每道 0.1–0.5 人日 = 额外 3–8 人日），**凭空多出 5% 的 A 期产能消耗**。**建议在 `config/mcp-tools.json` 的表头加一行注释标明「G11–G31 为 G11 门禁脚本的子断言编号」。**

### 7.2 三项表面冲突、实为口径差异（已在本稿统一）

| # | 差异 | 出现位置 | 统一口径 |
|---|---|---|---|
| 1 | **「四条件」vs「三条件」** | §4.1.2 是三条件；§6.10 第 2 项与 §6.13.4 的 M-08 行曾写「四条件保留」 | **三条件**。`10-adversarial-verdict.md:68-70` 的裁决是 κ 从四条件中**移除**，运行时第三条件改为「单答案稳定性」。§6.6.3 改写稿里的「M-08 达标判定三条件保留」已统一 |
| 2 | **统计窗口 18 天 vs 17 天** | §5.5.4 读法 (a) 行的「11/22 上线即赚 18 天」 | **17 天**。36（已丢失）+ 26（11/12 起）+ 17（11/22 起）= 79（官方窗口） |
| 3 | **20 个 tool 注解字段 vs 只读工具的空值** | §3.3.2 注解表与「四个注解字段全部显式写出」 | **四字段恒定存在、值可为 `false`**；只读工具的 `destructiveHint` / `idempotentHint` 显式填 `false`（见 §3.3.2 口径统一说明） |

### 7.3 四项已在本方案中修正的硬错（跨节汇总）

| # | 硬错 | 修正位置 | 修正后的表述 |
|---|---|---|---|
| 1 | **赛道错配**（Machine Pay 推向特殊赛道） | §5.1 | Trialroom = Vibe Pay 主赛道 + 网页应用收款；Machine Pay 移入 §5.10 附录并标注「属于另一件独立作品」 |
| 2 | **¥0.01 依据引错产品** | §5.2 | 依据换成网页应用收款 `total_amount` 取值范围 `[0.01, 100000000]`；兜底语义重写为「¥0.01 是通道物理下限，切 ¥0.1 是语义变化，需两套文案」 |
| 3 | **judge-κ 层级放错**（逐题 AND 条件） | §4.1 | κ 移出四条件，改为**发布门禁**；门禁改双阈值 + 报区间 |
| 4 | **MCP 规范表述反向**（第 68 行 vs 第 72 行自相矛盾） | §3.2 | 改为**双层强制**：`tools/list` 只做 UX，`tools/call` 负例才是 CI 主断言 |

**另有 1 条已在本轮落地修复**（业主方裁决 P0-5）：**鉴权作用域绕过**——`check-middleware-order.mjs` 原只比较行号，已重写为作用域覆盖判定，本轮实测 `verify-all` 10/10、`gate-bypass-regression` 21/21 全绿。

### 7.4 三类尚未验证的假设（诚实标注）

| # | 假设 | 为什么未验证 | 何时能验证 | 若不成立的后果 |
|---|---|---|---|---|
| 1 | **κ_JH ≥ 0.79 可达** | κ 一次都没算过；n=40 的 95% 区间宽 0.615 | S3 三阶段标注完成后（W1 末尾，取决于 2.5 人日划拨） | §4.9 的降级路径：判定收窄为提示 / 三维合并为「技术判断力」/ 条件收缩为二条 |
| 2 | **小红书单篇 800 UV** | 0 star、0 存量用户、无赛道排名；§7.3.2.1 自己评价为「整个方案里最不乐观的一个数」 | 11/09 前第一篇发布数据回填 | §5.7.3 的验算式不闭合（全部渠道做到下沿 1330 < 目标 1920）；需切换渠道组合并下调 12/07 目标 |
| 3 | **¥0.01 首单能过风控** | 官方产品文档侧「风控」「限额」`ACQ.MERCHANT_RISK_LIMIT` **全部零命中**；只有三条间接证据证明 0.01 是被支持的正常价格 | 11/12 第一单剧本 | 11/12 里程碑错过 → 统计窗口从 27 天掉到 17 天；§5.6.3 的错误码分流表是唯一预案 |

### 7.5 四项依赖官方回复才能闭合的口径

见 §10 的完整清单。要点：**去重键**、**¥0.01 是否计入**、**退款是否扣减累计人数**、**「作品提交并通过审核后」的计数前置**——这四条都不是我们能自己决定的，且**第 4 条直接决定 11/22–12/08 这 17 天是否计入**。

---

## 八、本周开工清单（10 项，可验收判据）

> 与 §6.5.1 同源同表，此处作为独立可勾选清单。**截止日以「必须完成」计。**

| # | 事项 | 成本 | 负责人 | 截止 | 可验收判据 | 落在哪个文件 |
|---|---|---|---|---|---|---|
| **1** | **报名完成 + 开通【网页应用收款】** | 0.2 | T | **10/31** | 控制台「网页应用收款 = 已开通」截图 + 日期 + 账号 | 报名系统；`trialroom/questionbank/` 无；证据存 `research/` |
| **2** | **赛道路径归位** | 0.2 | 组长 | **10/28** | 一页七列对照表：作品 → Vibe Pay 主赛道 → 网页应用收款 → 人类买方 → 报名人支付宝账号 → 计入路径 → 作品链接归属；Machine Pay 一栏写「另立独立作品，不共用作品链接」 | 新建 `trialroom/research/track-positioning.md`；参评材料 §支付集成度段首 |
| **3** | **κ_HH + κ_JH 校准 + 双阈值门禁接线** | 1.0（W1 增量） | M | **10/31** | ① κ 从四条件移除，改为发布门禁（设计文档 `:777-783` 的 `passed` 表达式里没有 κ）；② 双阈值 `κ_JH ≥ 0.85×κ_HH` 且 `≥0.60`；③ 报区间不报二值 + 旧→新换算表；④ 复算脚本落盘 | `db/004_calibration_schema.sql`（新建）、`tools/calibrate-judge.mjs`（新建）、`tools/check-calibration-gate.mjs`（新建）、`tools/calibration/verify.mjs` + `gate2.mjs`（新建）、`Trialroom-全量设计方案.md:777-783`、`db/001_platform_schema.sql:250`、`web/src/lib/evaluation/qualification.ts`（新建） |
| **4** | **MIT 义务 + 题库来源合规** | 1.3 | T | **10/31** | About 页 MIT 全文 + `THIRD_PARTY_LICENSES/` + 两镜像 LICENSE 与 label + 构建产物 `licenses/` + `verify-source-hygiene.mjs` 能独立失败并接进 CI + `SCHEMA.md:60` 措辞已改 | `tryout_pr_src/.../web/public/LICENSE`、`web/src/pages/LicensesPage.tsx`、`web/src/App.tsx`、`web/src/pages/AboutPage.tsx`、`web/vite.config.ts`、`docker/Dockerfile.server`、`docker/Dockerfile.web`、`trialroom/LICENSE`、`trialroom/THIRD_PARTY_NOTICES.md`、`trialroom/db/000_base_schema.sql:3`、`trialroom/questionbank/SCHEMA.md:60`、`trialroom/questionbank/data/sources-license.json`（新建）、`trialroom/tools/verify-source-hygiene.mjs`（新建）、`trialroom/tools/check-license-distribution.mjs`（新建） |
| **5** | **支付接入开工**（窗口 10/27 起） | 台账 9.3 + 净增 8.0 | T | 开工 **10/27**；沙箱全链路 **11/06**；生产首笔 **11/12**；上线 **11/22** | ① 支付适配器接口契约文档（`orders`/`entitlements`/`idempotency_keys` 三写入路径）；② 9 行工作分解表逐行有验收点；③ 沙箱全链路录屏 ≤ 5 分钟；④ 生产首单三处截图 + 失败清单；⑤ 测试通道 24h 内关闭证据 | `server/services/payment/`（新建）、`server/routes/payment.js`（新建）、`db/001_platform_schema.sql:84-140`、`web/src/pages/Payment*`（新建）、`research/payment-authenticity-controls.md`（新建） |
| **6** | **获客与漏斗作战表** | 0.5 | T | **11/08** | ① 漏斗式分母写死（UV → 落地页 → 入座 → 练习 → 付费，每环有基准转化率）；② 11/12 / 11/22 / 12/01 三个人数目标（1 / 10 / 20）；③ 六个埋点事件按日可导出；④ 方案 B 备料（不出现「付费用户数」字段） | `Trialroom-全量设计方案.md` §7.3（新增）、`server/routes/metrics.js`、埋点表（新建）、`qa/funnel/YYYY-MM-DD.md` |
| **7** | **CI 既有红修复 + MCP 边界补进主设计文档** | 0.5 + 0.3 | T + M | **11/08** | ① `platform-gates` job 绿；② `web` job 前提解决（CF-06b）；③ 元门禁改断言对象（`GATES` 数组是唯一真相源）；④ `Trialroom-全量设计方案.md` 新增「线上 MCP 暴露面与权限边界」一节 + ADR-11 | `trialroom/.github/workflows/ci.yml:26/:38-60/:74-92`、`trialroom/tools/verify-all.mjs:41-112`、`trialroom/tools/gate-bypass-regression.test.mjs`、`Trialroom-全量设计方案.md`（新章节）、`config/mcp-tools.json`（新建） |
| **8** | **MCP 最小切片**（**前置：§6.4.4 情景 A 成立 + N11 前置完成**） | 切片 3.3 + 门禁 1.9 | C | W3 骨架 / W5 接入 | ① 5 个房间与面试工具 + 1 个只读证据工具，注解四写；② 每工具 × 每 scope 的正负例矩阵全绿；③ `tools/list` 按 scope 分片快照 + 4 条附带断言；④ 全部由 `tools/verify-all.mjs` 一条命令触发，任一失败退出码非 0 | `db/002_mcp_schema.sql`（新建）、`server/auth-mcp.js`（新建）、`server/mcp/`（新建）、`config/mcp-tools.json`（新建）、`config/mcp-header-whitelist.json`（新建）、`docker/nginx.conf`（`location /mcp/`）、`tools/check-mcp-gates.mjs`（新建）、`tools/check-mcp-surface.mjs`（新建） |
| **9** | **职责分离可见演示** | 0.8 | M | **11/30** | 同一份证据走两条路的对照演示（直接进评分 prompt 会失真 / 经抽取器不失真）**在 A 期外部可见** | `server/services/materialBoundary.js`（新建）、`server/services/byoEvidence.js`（新建）、演示脚本 + 录屏（存 `research/`） |
| **10** | **「面试官问你的代码」设计稿**（实现移 B 期 W16） | 0.2 | M | **11/30** | ① 每个问题带源码行号引用；② 提问受 no-spoilers 约束（只回题干与分级提示、不回答案、不执行用户代码）；③ 回答进评分 → 达标判定 → 复盘重答三段各有截图 | `Trialroom-全量设计方案.md`（新增设计稿章节）、`questionbank/data/`（新增题面） |

**清单纪律三条**：① **第 1、2 项是零代码前置**，逾期直接归零，不允许排到第 7 位以后；② **第 3、4、5 项是本周唯一的净增量**，它们不进 A 期则整个 25.5 人日白花；③ **第 8 项在 §6.4.4 情景 A 不成立时整块移 B 期**，不得先开工后补前置。

---

## 九、需要业主方拍板的三件事

### 9.1 决策一 · 赛道路径归位

| 项 | 内容 |
|---|---|
| **选项 A（建议）** | **Trialroom 走 Vibe Pay 主赛道 + 网页应用收款**；Machine Pay 若要做，另立独立作品、不共用作品链接，其 agent 付费用户不计入 Trialroom 的商业化叙述 |
| **选项 B** | 沿用研究终稿**已被本方案推翻**的写法（「支付只走 Machine Pay 一条轨道」，见 §5.1.2） |
| **我的建议** | **A**。理由三条：① 细则 `:164-168` 的 Vibe Pay 计入口径里 **Machine Pay 一次都没出现**；② `:127`「同一赛道内最多 1 个作品可获奖」+ Vibe Pay 9 个奖 ¥100,000 vs Machine Pay 1 个奖 ¥10,000 ⇒ **换赛道 = 换奖池**；③ Machine Pay 的买方是 agent 不是人，**物理上无法为「¥0.01 首单」这类面向人类求职者的定价服务** |
| **选 B 的代价** | 作品被判投特殊赛道，**等于把 50 分（支付 25 + 商业化 25）的计分口径整体让给一条没有人类买方链路的轨道**；且 §5.5 的 15–25 人日支付工作全部作废（网页应用收款的接入指南不适用于 Machine Pay 链路） |
| **截止日** | **10/28**（因为支付窗口 10/27 就要开始，晚一天 15–25 人日的链路就塞不进 11/22） |
| **拍板人** | 组长（业主方） |
| **落点** | `trialroom/research/track-positioning.md`（新建）；`Trialroom-全量设计方案.md` §支付集成度段首；`trialroom/review/08-final-plan.md` §4.3 台账新增行 |

### 9.2 决策二 · 支付窗口前移与扩到 3 人的决策日

| 项 | 内容 |
|---|---|
| **选项 A（建议）** | **支付窗口 10/27 起 + 扩到 3 人的决策日定在 10/30**（11/03 到岗，按 8 人日/周计边际有效产能） |
| **选项 B** | 维持索引原排期：支付负责人 11/18 开始、11/22 上线；扩编决策日 11/09 |
| **我的建议** | **A**。理由：① 支付自建轨实测 **15–25 人日**（施工图原估 3–5 人日，低估 3–5 倍），**11/18 开工、11/22 上线 = 4 天做 15–25 人日，物理上不可达**；② 报名表须 11/15 前改才有意义，**11/09 决定只剩 4 个自然日**走完改表 + 新成员加入；③ 不扩编情景的缺口是 **25.7 人日 = 产能的 40.2%**，而基线的返工击穿阈值是 **0.5 人日/周** |
| **选 B 的代价** | 情景 B：MCP 块 9.1 人日整块移 B 期 → 需求 80.6，仍缺 16.6 → 再砍到 66.6，**仍缺 2.6**，已触及「不可砍四项」与 P0 底线；剩余唯一可行路径是**接受 12/01 上线**（统计窗口 17 天 → 9 天，商业化 25% 折半）+ **砍掉评分可信度块**（产品完整度 30% 的「凭什么准」当场塌掉） |
| **截止日** | **支付窗口 10/27 起**（执行日）；**扩编决策 10/30 当天必须拍**（决策日，不可移动） |
| **拍板人** | 组长（业主方） |
| **落点** | `00-当前状态索引.md` §八（删除「队友做支付（11/18–12/3）」，改为「支付负责人窗口 10/27–11/14」）、§九 止损线（新增 10/30 / 11/06 / 11/12 / 12/01 四行）、§十三·补 新增决策 #58；`Trialroom-完整平台实施与参赛施工图-v2.md` §三.1（替换为 v3 的 W1–W6） |

### 9.3 决策三 · 获客 checkpoint 人数目标

| 项 | 内容 |
|---|---|
| **选项 A（建议）** | **11/12 ≥ 1 人（首单）；11/22 ≥ 10 人；12/01 ≥ 20 人；12/07 ≥ 30 人** |
| **选项 B** | 对齐官方激励门槛 10 人：只在 12/01 核一次，数字定 10 |
| **我的建议** | **A**。理由：① 官方激励门槛是 10 人（去重），**内部目标必须比它更激进，否则「商业化 25%」和「影响力 20%」都没有抓手**；② 三个 checkpoint 的作用是**早发现**——11/22 若 < 10，渠道与文案的调整只剩 10 天；11/12 若 U0 < 120，投放的调整空间只剩 16 天；③ **分母必须写死**（§5.7.3 的验算式），否则 checkpoint 只是一句口号 |
| **选 B 的代价** | 「商业化 25%」这一栏的**唯一实物**（一条日累计曲线 + 一个 N）会退化成一个刚好压线及格的分；而且 11/12 与 11/22 两个早期失血点被跳过，**渠道调整窗口被砍掉两次** |
| **截止日** | **10/28**（必须与决策一同一批拍板，否则落地页文案与投放素材无法在 11/05 起投前定稿） |
| **拍板人** | 组长（业主方） |
| **落点** | `00-当前状态索引.md` §九 止损线（11/15 / 11/25 / 12/01 三条阈值按 CP-2 / CP-3 前移并对齐）；`Trialroom-全量设计方案.md` §7.3 商业化作战表（新增节）；`qa/funnel/` 日报模板 |

---

## 十、仍待官方确认的窄口径清单

> 分三类：**A 类 必答 6 问**（W1 内一次性发出，10/28 前）、**B 类 本轮追加 3 问**（可同批发）、**C 类 本方案内部待确认 2 项**（不需官方答，但需业主方或团队确认）。

### 10.1 A 类 · 必答 6 问（W1 内一次性发出，10/28 前）

| # | 问题 | 为什么重要 | 依据 | 答不出来的兜底 |
|---|---|---|---|---|
| **A1** | 「累计完成有效交易的**去重用户数**」的**去重键**是支付宝账号还是实名身份？同一自然人多个账号算几人？ | 细则 `:155`/`:163` 只写结果不写判定；决定我们能否用「一人一号」的假设做内控 | 细则 `:155`、`:163` | 主动规避一切自购/互刷/测试单，并留逐笔交付证据链（§5.3.4 内控十条） |
| **A2** | 「**¥0.01 是否计入有效交易**」？是否存在最低金额阈值？ | 细则未定义；决定首单档是 ¥0.01 还是 ¥0.1/¥1 | 接入指南 `:235`（协议层下限）+ 细则未定义 | 备 B 案（¥0.1 + 两套文案，0.5 人日）；**§5.2.3 已规定 B 案文案必须在 W1 写好** |
| **A3** | 「**退款 / 异常交易 / 跨产品重复**」如何影响累计人数？退款是否扣减累计人数？ | 决定「失败自动退次数」会不会自我抵消 | 官方激励计划合并范围只在支付宝产品之间（索引 `:144`） | **不产生退款流水**：¥0.01 首单因系统原因失败按「不扣次数、当场补发一次」处理（§5.9.3） |
| **A4** | 「**参赛作品提交并通过审核后**」是否意味着**作品未生效则其交易不计入**？ | **直接决定 11/22–12/08 这 17 天是否计入**（接近 18 天窗口的全部） | 细则 `:155` 字面前置 + 官网「先审核，再公开」 | 上线定义改为「作品已生效 ∧ 收款可用」；11/22 上线当日同步提交一个可用版本进审核（§5.5.4） |
| **A5** | 「**合作平台路径（灵光 / 观猹 / WeaveFox / QMuse）现在能否入驻**？入驻审核周期、分类配额、接入要求？」 | 这是唯一能解锁「直接计入统计 + 内置订单/权益」路径的问题 | `nowpay-intro.md:66-75` | 维持纯自建（网页应用收款 + 网页应用收款路径已通），双轨预案不启动（§5.4.4） |
| **A6** | 「**先提交作品、后补齐参评材料**是否允许？作品提交表单的完整字段是什么？」 | 决定「11/22 提交审核」与「12/08 补材料」能不能拆开 | 细则 `:29-31` 把两者写成一个阶段 | 11/22 与 12/08 各提交一次完整版本（把两次提交的成本计入 W6 的 0.8 人日） |

### 10.2 B 类 · 本轮追加 3 问（可与 A 类同批发）

| # | 问题 | 为什么重要 | 依据 |
|---|---|---|---|
| **B1** | 「**网页应用收款**的**费率**口径？以及『退款时手续费不退回』（接入指南 `:350`）是否同样适用于网页应用收款？」 | 费率目前只能从智能收款套件 doc 的收单产品费率表（JSAPI 0.6%~1%）借用；网页应用收款接入指南本身未列费率。§5.9 的成本表依赖这个数 | 接入指南 `:350`；`nowpay-intro.md:91-98` |
| **B2** | 「**首次签约收单产品未满 90 日 / 连续交易未满 30 日 → 次日结算**」是否同样适用于**网页应用收款**？ | 若适用，我们 11/22 的首笔收入 12/09 仍在结算周期内，对「资金到账即可交付」无影响，但**材料里不能把「实时到账」写成我们的承诺** | `nowpay-intro.md:85-88` |
| **B3** | 「**同时接入【智能收款套件】与【网页应用收款】的用户数是否合并统计**？」（索引 §十一·补 第 3 条） | 决定双轨是否值得开 | 索引 `:299` |

> **另有两问属 Machine Pay 独立作品，不阻塞 Trialroom 主线**（保留在问题清单里）：① 服务发现机制（`service_id` 分配后如何被 Agent 发现，有无服务目录）；② `service_id` 审核周期。

### 10.3 C 类 · 内部待确认 2 项（不需官方答）

| # | 事项 | 需要谁确认 | 截止 | 落点 |
|---|---|---|---|---|
| **C1** | 官网「**同一作品不得跨赛道重复投稿**」是否成立 | 队长（控制台截图复核） | **10/28** | `trialroom/research/track-positioning.md` |
| **C2** | §7.1 冲突一的 **2.5 人日差额**从哪出（N12 / N13 / W5 余量三选一） | 组长 | **10/30**（与扩编决策同批） | `08-final-plan.md` §4.3 台账；本方案 §6.2.2 |

---

## 十一、参考来源

> 合并四节引用，去重。每条独立成行，带完整 URL 或文件路径。

### 11.1 官方权威口径（唯一裁决来源）

- `doc_activity-rules.txt:9` — 报名账号需手机号绑定 + 实人认证；港澳台外籍暂不能报名
- `doc_activity-rules.txt:10` — 个人/团队双线限制；同身份证/账号/手机号/设备任一即同一参赛选手
- `doc_activity-rules.txt:14` — 商业闭环性：接入至少一款支付宝 AI 付产品，完成发现→使用→付款→交付完整链路
- `doc_activity-rules.txt:15` — 合规性：违规、虚假交易及刷量数据将被剔除
- `doc_activity-rules.txt:17` — 报名账号须与作品中接入 AI 付的支付宝账号一致
- `doc_activity-rules.txt:26` — 报名阶段 2026-09-21 ~ 2026-12-01 23:59:59
- `doc_activity-rules.txt:29-31` — 开发与作品提交 2026-09-30 ~ 2026-12-09 23:59:59
- `doc_activity-rules.txt:42-73` — 赛道表：主赛道 Vibe Pay / Skill Pay；特殊赛道 Machine Pay / Token Pay / Agent Pay；Vibe Pay 作品应用形态含「网页应用（包含 web 及 h5）」
- `doc_activity-rules.txt:43` — 同一赛道内最多提交 10 件作品，可同时报名多个赛道
- `doc_activity-rules.txt:83-96` — Vibe Pay 奖项：¥30,000×1 + ¥15,000×3 + ¥5,000×5 = ¥100,000 / 9 个奖
- `doc_activity-rules.txt:110-114` — Machine Pay 最佳探索奖 ¥10,000×1
- `doc_activity-rules.txt:127` — 同一赛道内最多仅有 1 个作品可获奖
- `doc_activity-rules.txt:128` — 奖金发放至报名登录账户内
- `doc_activity-rules.txt:132` — 对每个提交且通过审核的作品打分，TOP30 晋级决赛
- `doc_activity-rules.txt:144-150` — 支付集成度 25%：付费点合理性 / 链路完整性 / 支付体验三态反馈 / 交付闭环
- `doc_activity-rules.txt:152-155` — 商业化成熟度 25%：是否获得真实、有效的付费用户；参赛作品提交并通过审核后，统计 9/21–12/09 的累计完成有效交易的去重用户数
- `doc_activity-rules.txt:157-160` — 作品影响力 20%：作品详情页浏览/点赞/评论
- `doc_activity-rules.txt:162-163` — 统计口径：按报名时实人认证的支付宝账户，以主办方系统记录及计算口径为准
- `doc_activity-rules.txt:164-168` — Vibe Pay 计入口径：套件直接计入；基础收款能力须另行开通网页应用收款或移动应用收款（方式一官网 / 方式二 Skill）
- `doc_participation-notice.txt:25` — 不以作弊、恶意刷取数据
- `doc_participation-notice.txt:27` — 限制或中止参赛 / 取消参赛资格 / 取消晋级 / 取消获奖 / 追回已发放奖金
- `官方规则原文与限制清单.md` §1.2 第 3 条 / §1.3 第 2、4 条 / §1.5 — 商业闭环性四要素；同一作品不得跨赛道重复投稿（**官网口径，非细则留存副本**）；先审核再公开；数据统计口径表
- 支付宝 AI 付官网 — https://aipay.alipay.com
- 支付宝开放平台文档（分账相关，本地无留存副本，PC-17 未闭合） — https://opendocs.alipay.com/open/01n2xi
- 支付宝开放平台文档（分账解决方案，本地无留存副本，PC-17 未闭合） — https://opendocs.alipay.com/solution/0hb278
- 支付宝个人账号开通指引 — https://opendocs.alipay.com/common/02kg61

### 11.2 官方产品文档（本地留存副本）

- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:2` — 适用于商家网页应用，**支持个人收款场景**
- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:17-19` — Agent 快速集成（推荐）：`npx -y @alipay/alipay-aipay@latest install` … 完成沙箱测试并完成签约入驻
- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:49` / `:52` — `alipay.trade.page.pay` 下单 / `alipay.trade.query` 补偿；「支付结果必须以异步通知或查询接口返回为准」
- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:57-59` / `:240-248` — 必须验签；核对 `app_id` / `out_trade_no` / `total_amount`；按 `trade_status` 处理；`out_trade_no` 不可重复
- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:235` — `total_amount` 必填，精确到分，**取值范围 [0.01,100000000]，金额不能为 0**
- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:329` / `:340` / `:348` / `:350` / `:352` — `alipay.trade.refund` / `alipay.trade.fastpay.refund.query` / 退款周期 12 个月 / 退款时手续费不退回 / 总退款额 ≤ 实付
- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:546` — `alipay.trade.close` 关闭交易
- `docs_vibe-pay_ai-web-app-payment-qianyi_ai-web-app-payment-integration-guide.md:632-647` — `alipay.data.dataservice.bill.downloadurl.query` 对账流程
- `docs_ai-receive_api-list_alipay-aipay-agent-payment-precreate.md:25` — `amount` 必选，**不超过 50 元**，示例 `0.01`（**无下限**）
- `mp_MACHINE_PAY.md:7` / `:18-20` / `:33` / `:137` — 402 + `amtPaymentLink` + `Payment-Proof` + `verify` 时序
- `docs_md/docs_vibe-pay_nowpay_nowpay-intro.md:19` / `:51` — 多种收费模式（一次性买断/次数/额度/时长）；商业化基础设施（下单支付、订单管理、权益管理）
- `docs_md/docs_vibe-pay_nowpay_nowpay-intro.md:62-64` / `:66` / `:68` / `:75` / `:77` / `:81` — 准入条件（个人账号/企业账号）；**暂时仅支持创作者通过合作平台接入**；已合作平台 灵光/观猹/WeaveFox/QMuse；创作者可前往合作平台了解接入方式；有意向的平台可提交合作申请；创作者独立接入能力正在准备中
- `docs_md/docs_vibe-pay_nowpay_nowpay-intro.md:85-88` — 结算：默认收款到签约账号支付宝余额账户，实时到账；首次签约收单产品未满 90 日或连续交易未满 30 日 → 次日结算
- `docs_md/docs_vibe-pay_nowpay_nowpay-intro.md:91-98` — 费率：JSAPI 支付 0.6%~1% + 即刻收商品经营 0.4%
- `doc_vibe-pay.md` §3.1 / §3.2 / §四 — 基础收款能力 vs 智能收款套件的定位与选择表

### 11.3 项目内部文档

- `trialroom/review/10-adversarial-verdict.md` — 业主方交叉裁决（最高权威）：编号对照 + P0 全集 39 条 + 撞名警告（`:14-23`）、总裁决（`:31`）、P0-1 赛道错配（`:39-52`）、P0-2 ¥0.01 依据（`:54-62`）、P0-3 κ 层级（`:64-76`）、P0-4 MCP 双层强制（`:78-82`）、P0-5 已修与 10/10 + 21/21（`:86-114`）、裁决 R-1~R-14（`:120-135`）、MCP 席 S-02~S-18（`:143-157`）、`rubricHints` 免费午餐（`:163-169`）、本周清单 10 项（`:175-188`）、拍板三事（`:194-198`）
- `trialroom/review/09-mcp-security.md` — MCP 安全席报告（S-01…S-20、A4–A8、B1–B4、F1–F9、X-1–X-3）
- `trialroom/review/09-ai-quality.md` — AI 质量席报告（J-01…J-28）
- `trialroom/review/09-payment-commercial.md` — 支付与商业化席报告（A1–A4、PC-01…PC-18、T-1…T-19 行标）
- `trialroom/review/09-integration-license.md` — 集成许可席报告（C1–C5、L-01…L-22、G-1…G-9）
- `trialroom/review/09-consistency-feasibility.md` — 整体一致性席报告（C-1…C-16、CF-01…CF-24、G-1…G-15、R-1…R-19）
- `trialroom/review/08-final-plan.md` — 69 条裁决与基线产能账（`:419-447` B 期 20 项、`:449-462` 降级池 7.0、`:466-508` 产能模型、`:530-619` §4.3 台账 64.2、`:623-688` §4.4 W1–W6、`:962-972` §6.4 止损点、`:974-988` §6.5 提交前 48 小时时间盒、`:1116-1137` §8.1 18 项拍板、`:1139-1154` §8.2 官方待问 12 项）
- `trialroom/review/07-final-plan.md` — 前序合并方案
- `trialroom/research/platformization-report-20261026.md` — 本轮研究终稿（被审查对象；= `mavis-deep-research/20261026_235158_trialroom-online-interview-platform/final_turn_001.md`，两份同文，252 行）
- `trialroom/research/payment-authenticity-controls.md` — 《付费真实性内控》（**新建，0.5 人日**）
- `trialroom/research/pricing-anchors-2026.md` §1.4 `:113-122` / §5.1 `:334-349` / §5.2 / `:55` — 真人 1v1 辅导市场价 ¥240–1400 中位 ¥600；单场模型成本 0.05–0.12 元；¥9.9/5 次被否决（折扣 49%）；「0.01 ≤ 元/次 ≤ 50」的内部误引
- `trialroom/research/asr-benchmark-2c2g.md` — ASR 2c2g 实测（**新建，0.5 人日**）
- `trialroom/Trialroom-全量设计方案.md:206` — 组件拓扑写「反向代理 (Caddy)」（与基座 nginx 不一致）
- `trialroom/Trialroom-全量设计方案.md:239-245` — M-67：应用容器实际 1 核
- `trialroom/Trialroom-全量设计方案.md:522` — 评分（隔离式 6 次请求）
- `trialroom/Trialroom-全量设计方案.md:729-731` — `/api/replay/hint`
- `trialroom/Trialroom-全量设计方案.md:775-790` — §4.4.4 达标判定四条件（第三条件原文）
- `trialroom/Trialroom-全量设计方案.md:1165-1171` — `stripInvisibleChars` + `<user_material>` 既有实现（**⚠ 实测全仓 0 命中，见 §3.6.2**）
- `trialroom/Trialroom-全量设计方案.md:1556` — 许可证审查承诺原文
- `trialroom/Trialroom-全量设计方案.md:1617` — ADR-01 一次只评一个维度
- `trialroom/Trialroom-全量设计方案.md:1628` — MIT 唯一硬义务原文
- `trialroom/Trialroom-全量设计方案.md:1655-1659` — ADR-07 提示词注入是数据边界问题
- `trialroom/Trialroom-全量设计方案.md:1683` — 安全基线「跨用户访问返回 404 而非 403」
- `trialroom/Trialroom-全量设计方案.md:1686` — 安全基线「`data/.api_token` 机制在多用户下必须废除」
- `trialroom/Trialroom-全量设计方案.md:1692-1704` — §6.5 可观测性（既有日志体系）
- `trialroom/Trialroom-全量设计方案.md:1767-1775` — §7.1.3 定价档位表（¥0.01 / ¥3.9 / ¥19.9·5 次 / ¥49.9·20 次 / ¥29.9·30 天 / ¥9.9 房间共享）
- `trialroom/Trialroom-全量设计方案.md:1813-1832` — §7.1.4 首单 ¥0.01 vs ¥0.1；兜底条件；绑定实名 + 每人限 1 次 + `is_first_order`
- `trialroom/Trialroom-全量设计方案.md:1851` — 「失败自动退次数」是必做条款
- `trialroom/Trialroom-全量设计方案.md:1974-1978` / `:1988` — 影响力口径原文；「影响力与商业化必须同源」
- `trialroom/Trialroom-全量设计方案.md:2020-2038` — §7.3.2 分层指标（落地页 UV 2000、25%/60%/50%/30%/5%、有效付费用户 ≥30、房间邀请转化 8%）
- `trialroom/Trialroom-全量设计方案.md:2040-2083` — §7.3.2.1 漏斗闭合验算（原表算术不闭合、最宽松 27.4 < 30、路径 A/B/C/D、三条行动项）
- `trialroom/Trialroom-全量设计方案.md:2084-2092` — §7.3.2.2 房间转化埋点缺口（匿名 session ticket 归并，归属 W2 + W4）
- `trialroom/Trialroom-全量设计方案.md:2284-2285` — §10.2 复盘验收两行仍为 ⬜
- `trialroom/Trialroom-全量设计方案.md:2369` — 验收标准表合规行（「第三方声明页含 MIT 全文与各依赖许可」）
- `trialroom/Trialroom-模型接入矩阵与抗退役路由层.md:160` / `:163` / `:180` / `:212` — 候选链按优先级排序、后面是**降级**；只有可用性故障才降级；不要写 `catch → tryNext`
- `trialroom/Trialroom-房间机制与安全规范.md:174-183` — §1.6 权限模型（房主专属「推进轮次」；他人答案默认不可见）
- `trialroom/Trialroom-完整平台实施与参赛施工图-v2.md:147-169` — §2.3 商业化双轨；**工时 3–5 人日（自建轨）**
- `trialroom/Trialroom-完整平台实施与参赛施工图-v2.md:307-317` — §三.1 A 期排期表
- `trialroom/Trialroom-完整平台实施与参赛施工图-v2.md:319` — 「800+ 题库（第一批）」旧数
- `trialroom/Trialroom-完整平台实施与参赛施工图-v2.md:339` — 「12-09 前扩到 300+」承诺
- `trialroom/Trialroom-完整平台实施与参赛施工图-v2.md:351-362` / `:364-371` — §五 待拍板清单 / §六 下一步
- `trialroom/Machine-Pay-实现指南.md:77` / `:97` — 服务类型限 Restful / 回调接口；单价 0.01≤元/次≤50；控制台服务注册路径（**项目内部文档，非官方原文**）
- `/workspace/mcd-contest/alipay/Trialroom-商业版平台化升级方案.md:11-23` — 总量判断（14 条需求 110–155 人日）
- `/workspace/mcd-contest/alipay/Trialroom-商业版平台化升级方案.md:368-382` — §六 A 期表（42 人日）
- `/workspace/mcd-contest/alipay/Trialroom-商业版平台化升级方案.md:398-412` / `:416-425` — §七 优先级与取舍清单 / §八 待拍板六件事
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:14-62` — 决策表（#5 受众 / #13 只交一件 / #23 不可砍四项 / #37 收款 11-22 / #38 报名 11-15 / #40 `entitlements` 唯一真相源 / #42 门禁输入集合 / #45 个人收款主体 / #55 扩编 10/30）
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:140-146` — Machine Pay 关键事实（402 头前缀、precreate 前落库、无上架目录、按量付费 0 费率至 12/31、激励计划合并统计）
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:150-169` — §八 完整平台排期 + 分工建议（11/18–12/3）
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:173-182` — §八·补 不可砍四项与可砍顺序
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:186-191` — §八·二 今天/本周必须动的四件事
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:195-213` — §九 止损线 6 条 + 换算
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:268-275` — §十 获客渠道 5 条
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:299` / `:302` — 官方待确认清单第 3 条 / `service_id` 审核周期
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:367-419` — §十三·补 新增决策 #43~#56 / 已落地修复 6 项 / 清单已被取代 / 新增止损点 3 条
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:398-399` — 门禁绕过回归 21/21；`verify-all` 10/10
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:409-411` — 开工清单已被业主方裁决 §七 10 项取代
- `/workspace/mcd-contest/alipay/00-当前状态索引.md:381` — 决策 #48 校准素材改用既有 `rubricHints`

### 11.4 源码与 schema（只读核对）

- `tryout_pr_src/Tryout-fix-83-issues/server/index.js:53` — `const HOST = process.env.HOST || (process.env.DOCKER === "1" ? "0.0.0.0" : "127.0.0.1");`
- `tryout_pr_src/Tryout-fix-83-issues/server/index.js:59-61` — `trust proxy` 动态设置
- `tryout_pr_src/Tryout-fix-83-issues/server/index.js:122` — `createRateLimiter({ windowMs: 60_000, max: 120 })`
- `tryout_pr_src/Tryout-fix-83-issues/server/index.js:123` — `/api/chat` 限流 20 次/分
- `tryout_pr_src/Tryout-fix-83-issues/server/index.js:344-348` — `app.use("/api", …authMiddleware…)`，认证作用域**只覆盖 `/api`**
- `tryout_pr_src/Tryout-fix-83-issues/server/index.js:941` / `:950-964` — `DAILY_TOKEN_BUDGET` 默认 **500000**，全局共享；超出返回 429
- `tryout_pr_src/Tryout-fix-83-issues/server/index.js:823-824` — 题库列表接口 `res.ok(list.map(questionBank.toLite))`
- `tryout_pr_src/Tryout-fix-83-issues/server/auth.js:30` — `TOKEN_FILE`（`data/.api_token`）
- `tryout_pr_src/Tryout-fix-83-issues/server/auth.js:51-53` / `:53-93` — `loadTokens()` 的一次性全局 `Set`；env + 文件，无 scope / aud / iss / 过期 / 吊销 / 用户维度
- `tryout_pr_src/Tryout-fix-83-issues/server/auth.js:79-81` — 「前端可在 Settings 页查看 token」
- `tryout_pr_src/Tryout-fix-83-issues/server/auth.js:115-135` — `authMiddleware`：任一 token 匹配即通过
- `tryout_pr_src/Tryout-fix-83-issues/server/llm.js:35` / `:112` — `assertSafeUrlAtFetch` / `createSafeLookup`
- `tryout_pr_src/Tryout-fix-83-issues/server/ssrf-shared.js` — IP / 元数据判定（`normalizeIp` / `isInternalIp` / `isMetadataHost` / `NO_REDIRECT_FETCH_INIT`）
- `tryout_pr_src/Tryout-fix-83-issues/server/services/questionBank.js:33-35` / `:48-74` — 题库路径 `server/data/questionbank.json`；内存缓存载入
- `tryout_pr_src/Tryout-fix-83-issues/server/services/questionBank.js:81-87` — `toLite` **只丢弃 `referenceAnswer`**，其余字段全留
- `tryout_pr_src/Tryout-fix-83-issues/server/services/questionBank.js:110-129` — `getReferenceForScoring` 返回 `{ referenceAnswer, keyPoints, type }`，**不含 `rubricHints`**
- `tryout_pr_src/Tryout-fix-83-issues/server/services/asrGuard.js:32-34` / `:74-77` — `DEFAULT_MAX_CONCURRENT = 2` / `DEFAULT_QUEUE_TIMEOUT_MS = 15_000` / `DEFAULT_MAX_QUEUE = 32`；2 核机上并发上限 = 2
- `tryout_pr_src/Tryout-fix-83-issues/server/services/weaknessCore.js` — 78 行，跨会话弱项聚合（已实现一半）
- `tryout_pr_src/Tryout-fix-83-issues/docker/nginx.conf:8-10` — `location /` SPA fallback（会吞 `/mcp`）
- `tryout_pr_src/Tryout-fix-83-issues/docker/nginx.conf:13-31` — `location /api/`；`:20-23` XFF 替换模式；`:27-30` `proxy_buffering off` / `proxy_cache off` / `proxy_read_timeout 300s`
- `tryout_pr_src/Tryout-fix-83-issues/docker/docker-compose.yml:25` — `DOCKER=1`
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/scoringEngine.ts:11-13` — 锚定偏见注释：任何一次调用的上下文中不得出现其他维度的分数
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/scoringEngine.ts:30-41` / `:90-115` / `:121-197` — `QuestionReference` 无 `rubricHints`；`buildReferenceBlock`；`buildDimensionPrompt`（`:131` `buildRubricBlock`）
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/scoringEngine.ts:49-53` — `DimensionScore.evidence` / `confidence` / `noEvidence`
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/scoringEngine.ts:176-182` / `:191` — 「沟通表达……**它是系统性的噪声，不是答案质量的信号**」；「你只能看到这一段书面回答，**没有追问环节**」
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/scoringEngine.ts:447` / `:463-466` — `DEFAULT_SCORING_CONCURRENCY = detectConcurrencyCap(3)` + `createLimit(concurrency)` + `Promise.all(dims.map(...))`
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/scoringEngine.ts:502-514` — `AggregateResult` 字段（含 `missingCount`）
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/scoringEngine.ts:543-555` / `:558-560` / `:564` — 缺失维度记 **0 分**；`avg5 = sum / n` 按全 6 维做分母；0 分进 `weaknesses`
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/starEvaluator.ts:12-13` — ADR-002：只锚两端 QWK **0.59**；摊到 1/3/6 档 0.39；每档 1 个锚点 ≈ 每档 3 个（**QWK 0.65**）
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/starEvaluator.ts:15-58` / `:60-64` / `:68-72` / `:91-102` — `EVALUATION_DIMENSIONS` 6 项；ADR-003 ICC 0.853 / 0.840 / 0.805；`ANCHOR_IDS`；`anchorIdToScore`；`buildRubricBlock`
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/consistency.ts:39-52` / `:55-76` / `:106-115` — `dimensionConsistency`；`summarizeRuns` **只按维度名聚合**；`overall` = 6 维算术平均
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/baseline.ts:8-10` / `:21-24` / `:33-55` — 「我们**没有**任何真实面试数据」；`DimensionScoreInput` 无 `difficulty`；`computePersonalBaseline` 取**中位数**、`minSamples = 3`
- `tryout_pr_src/Tryout-fix-83-issues/web/src/lib/evaluation/referenceAdapter.ts:16` / `:56-84` / `:90-113` — `DEFAULT_MAX = 500`；`adaptReference`；`extractScoringHints`（M-16 全链未接线）
- `tryout_pr_src/Tryout-fix-83-issues/web/scripts/eval-ab.mjs:53` / `:224-230` — `consistency.ts` 的唯一 import 点；6 道题结果 push 进同一扁平数组
- `tryout_pr_src/Tryout-fix-83-issues/web/src/pages/AboutPage.tsx:38` / `:92` / `:98` — 「MIT License」标签、页脚、年份
- `tryout_pr_src/Tryout-fix-83-issues/web/public/questionbank.json` — 808 题 `source` 计数器 = {None: 808}
- `tryout_pr_src/Tryout-fix-83-issues/web/vite.config.ts` — 无 license 插件、无 rollup banner
- `tryout_pr_src/Tryout-fix-83-issues/server/scripts/check-middleware-order.mjs` — CI 真正跑的那份（已同步作用域覆盖判定）
- `trialroom/db/000_base_schema.sql:3` / `:27` / `:31` — 「源自开源基座 Tryout 的 server/db.js，20 张表」与来源路径
- `trialroom/db/000_base_schema.sql:84-85` — `difficulty` 枚举 `easy/normal/hard/extreme/hell`（与题库 L1–L5 两套）
- `trialroom/db/000_base_schema.sql:155-167` / `:169-176` — `evaluations` 表（含 `model_version`）；`evaluation_dimensions` 只有 `score / weight / comment`
- `trialroom/db/000_base_schema.sql:186-202` — `providers` 表：`in_failover_queue` / `failover_priority`（故障切换字段）
- `trialroom/db/001_platform_schema.sql:84-105` — `orders` 表（`out_trade_no` / `amount_cents` / `status` / `channel` / `idempotency_key` / `trade_no` / `refunded_at` / `raw_notify`）
- `trialroom/db/001_platform_schema.sql:92` — 订单状态机 `created|pending|paid|delivered|refunded|closed|failed`
- `trialroom/db/001_platform_schema.sql:107` / `:108` — `idx_orders_out_trade_no` / `idx_orders_idempotency`（**全局唯一**，与 MCP 作用域冲突）
- `trialroom/db/001_platform_schema.sql:114-126` / `:131-139` — `entitlements` 表；`idempotency_keys` 表
- `trialroom/db/001_platform_schema.sql:151-172` — `rooms` 表；`:152` `room_id` 无格式约束；`:154` `room_code` 6 位房号；`:157` `visibility invite|public`；`:160` `rooms.difficulty` L1..L5；`:170` `idx_rooms_code`
- `trialroom/db/001_platform_schema.sql:178-192` — `room_seats`；`:188` `is_host`
- `trialroom/db/001_platform_schema.sql:195-206` — `room_turns`；`:206` UNIQUE `(room_id, turn_index)`
- `trialroom/db/001_platform_schema.sql:250` — 注释「达标判定复用 consistency.ts 与 baseline.ts，不新造标准」
- `trialroom/db/001_platform_schema.sql:251-269` / `:270` — `replay_attempts` 表 + `idx_replay_user`
- `trialroom/db/001_platform_schema.sql:417` / `:455-465` — `v_user_entitlements`；`v_paid_user_stats`（`status IN ('paid','delivered') AND refunded_at IS NULL`）
- `trialroom/db/migrate.mjs:21-30` / `:340-384` — 迁移链契约；校验和比对（G4 门禁）
- `trialroom/questionbank/SCHEMA.md:29` — `rubricHints` = 「3–5 条，评分锚点，对应 Tryout 现有 6 维 rubric」
- `trialroom/questionbank/SCHEMA.md:60-61` — 来源与原创性条款（「优先引用」+「改写」但无门禁）
- `trialroom/questionbank/validate.mjs:165` — 强制 `rubricHints` 长度 3–5、必填
- `trialroom/questionbank/scripts/verify-no-leak.mjs:15` / `:30` / `:57-64` / `:217-221` — `rubricHints` 是泄漏特征串；`FORBIDDEN_FIELDS` 含 `rubricHints`；「keyPoints / rubricHints 是答案材料本身, 不做这个豁免」
- `trialroom/questionbank/scripts/export-pro-questionbank.mjs`（文件头） — `PUBLIC_FIELDS` 9 字段白名单；导出前跑泄漏自检
- `trialroom/questionbank/data/*.json` — 116 题（ai.json 11 + 其余 15 域各 7）；`source` 为 100+ 唯一 URL 或 `synthetic-2026`
- `trialroom/tools/verify-all.mjs:30` / `:39` / `:41-112` / `:92-97` / `:105-111` / `:129-135` / `:167-179` — `OSS` 路径；「每个门禁都必须能独立失败」；`GATES` 数组 10 道；G8b；G10；缺脚本 = BROKEN；失败退出码
- `trialroom/tools/gate-bypass-regression.test.mjs:1-30` / `:17-23` — 六项检测能力；6 个合成样本
- `trialroom/tools/count-routes.mjs:129-174` — 未覆盖前缀检测 + `--expect` + 失败出口
- `trialroom/tools/check-middleware-order.mjs:157-190` — 鉴权作用域覆盖判定（`authScopes` / `coveredBy`）
- `trialroom/.github/workflows/ci.yml:21-92`（`:26` / `:33-34` / `:38-60` / `:65-71` / `:74-92`） — 单次 checkout；唯一执行点；自我满足的元门禁；干净库迁移链；web job
- `trialroom/docker/Dockerfile.server` / `Dockerfile.web` — 仅 `COPY server/ ./` / `COPY --from=web-builder /web/dist ...`，无 LICENSE、无 `org.opencontainers.image.licenses`

### 11.5 外部文献

- ELBench（arXiv 2608.09548）附录 F — 象限加权 Cohen's κ；人类天花板作为参照的原文；Table 8 逐候选成绩（Qwen3.6 0.825 / Kimi-2.6 0.798 / MiniMax-M3 0.784 / Grok-4.3 0.772 / Llama-4 0.751 / Human-human 0.856）；300 条 × 3 专家；N=9 多数票；顺序随机化；同族回避 — https://arxiv.org/abs/2608.09548
- ELBench 附录 G — 标注者资历原文；三阶段流程（培训对齐 → 双盲独立 → 共识会议）
- ELBench 附录 H — item-level bootstrap 10,000 次口径（转录自 AI 席 §4 第 11 条）
- Geometry（arXiv 2606.03043） — 「一致率高可能是共享盲点的证据」；轴角 87°–89° vs 人类 78°–81°；σ_J/σ_H 0.3–0.5；ensemble 收敛到 judge 共同轴；few-shot calibration 对策；平均参考会「讨好 judge 若干度」 — https://arxiv.org/abs/2606.03043
- JudgmentBench（arXiv 2605.25240） — Spearman 0.908 vs 0.150；win-rate 0.669 vs 0.542；标注时间 1.92 vs 4.74 分钟；1,530 个成对偏好全部来自执业律师；成对难以分解为可复用判据 — https://arxiv.org/abs/2605.25240
- arXiv:2601.03444 — 量表人机 ICC：0-5 为 0.853、0-100 为 0.840、0-10 为 0.805（经 `starEvaluator.ts` ADR-003 转引） — https://arxiv.org/abs/2601.03444
- MCP 2026-07-28 规范与迁移指南 — https://modelcontextprotocol.io/specification/2026-07-28
- MCP SEP-2577 — 废弃 Roots / Sampling / Logging（deprecate，非 remove） — https://modelcontextprotocol.io/community/sep/2577
- MCP SEP-2596 — 规范特性生命周期与废弃政策（Active / Deprecated / Removed 三态，最短 12 个月退场窗口） — https://modelcontextprotocol.io/community/sep/2596
- MCP 官方博客《Tool Annotations as Risk Vocabulary》（2026-03-16） — 「They aren't enforcement… that's a job for network controls or sandboxing, not a boolean hint」；默认值刻意悲观 — https://blog.modelcontextprotocol.io/
- OAuth 2.1 / RFC 8707 resource indicator / RFC 9207 `iss` — https://datatracker.ietf.org/doc/html/rfc8707
- LangBot Box Runtime 文档 — 「Scope controls session reuse; it is not a security boundary.」（终稿引用；MCP 席复核成立）

### 11.6 五份独立核验报告（本轮修订依据）

- `/workspace/verify-platform/deliverable.md` — 第一节核验报告：3 条严重项 + 1 条 P0 级缺失（S-16）+ 11 条中度 + 7 条轻度，共 24 条修订
- `/workspace/verify-scoring/deliverable.md` — 第二节核验报告：R1–R11 共 11 条修订
- `/workspace/verify-payment/deliverable.md` — 第三节核验报告：S1–S7 共 16 条修订（计数经元复核统一为 13 处行号 + 6 条断言）
- `/workspace/verify-schedule/deliverable.md` — 第四节核验报告：R1–R14 共 15 条修订（4 项 P0 阻断 + 6 项 P1 + 5 项 P2）
- `/workspace/verify-verification/deliverable.md` — 对支付核验报告的元复核：V-1 ~ V-7 共 7 条修订（其中 V-1 判定 `verify-payment` 的 S5-2 为假阳性，V-2 指出其 `PC-01` 行的 `:116` 为假引用）

---

## 十二、附录

### 12.1 五席评审报告清单

| 席位 | 报告文件 | 编号体系 | P0 条数 | 在本方案中的承接位置 |
|---|---|---|---|---|
| MCP 安全 | `review/09-mcp-security.md` | S-01…S-20、A4–A8、B1–B4、F1–F9、X-1–X-3 | S-01 / S-02 / S-03 | §3.2（双层强制）、§3.4（scope 绑定）、§3.5（token class）、§3.7（规范边界）、§3.11（门禁）、§3.12（降级方案）、§3.13（威胁总表）；§6.13.1 CF-04 |
| AI 质量 | `review/09-ai-quality.md` | J-01…J-28 | J-01 / J-02 / J-03 / J-05 / J-09 / J-10 / J-11 / J-14 / J-15 / J-16 / J-18 | §4.12.1（P0 全表）、§4.1（判据层级）、§4.2（双阈值与区间）、§4.5（`rubricHints` 接线）、§4.6（架构如实描述）、§4.7（一致率回归监控）、§4.8（成对比较分期）、§4.9（降级路径）、§4.10（成本） |
| 支付商业化 | `review/09-payment-commercial.md` | A1–A4、PC-01…PC-18、T-1…T-19（行标） | PC-01…PC-07 | §5.11.1（P0 全表）、§5.11.2（P1/P2）、§5.11.3（T 系列行标）；§5.1（赛道）、§5.3（真实性）、§5.4（套件）、§5.5（工作量）、§5.6（首单）、§5.7（商业化）、§5.8（分账）、§5.9（成本） |
| 集成许可 | `review/09-integration-license.md` | C1–C5、L-01…L-22、G-1…G-9 | L-01…L-09 | §6.13.1（L-01…L-09）、§6.13.3（L-10…L-22）；§6.11（五步 + 三档 + MIT 义务） |
| 整体一致性 | `review/09-consistency-feasibility.md` | C-1…C-16、CF-01…CF-24、G-1…G-15、R-1…R-19 | CF-01…CF-08、CF-10 | §6.13.1（CF-01…CF-10）、§6.13.2（G-1…G-15 + 一致性席 R-1…R-19）；§6.1（三份排期对撞）、§6.2（产能账）、§6.4（取舍）、§6.6（止损） |
| **业主方交叉裁决** | `review/10-adversarial-verdict.md` | A1–A4 / C-1 / R-1…R-14 | P0-1…P0-5（5 条） | **全文最高权威**：§1.1（P0-1~P0-4 改写位置表）、§3.11.4（S-16 落点）、§6.13.4（裁决 R-1…R-14）、§7.3（4 处已修正硬错）、§9（拍板三事） |

### 12.2 业主方裁决的动作项（A / C / R 两套编号）

| 编号 | 裁决内容 | 本方案落点 | 状态 |
|---|---|---|---|
| **A1** | 支付轨道归位 | §5.1.3 对照表 + §5.1.4 话术 | ✅ 建议已提，**待业主方拍板（10/28）** |
| **A2** | 智能收款套件的准入问题换成正确的问题 | §5.4.2 / §5.4.3 第 5 问 | ✅ 已改写 |
| **A3** | 工作量重估 + 窗口前移 | §5.5.1 / §5.5.2 / §5.5.3 | ✅ 已重估，**待业主方拍板扩编日（10/30）** |
| **A4** | 商业化补一条真计划 | §5.7 全节 | ✅ 已补，**待业主方拍板人数目标（10/28）** |
| **C-1** | 合并后的本周清单 10 项 | §6.5 / §8 | ✅ 已重排为可执行顺序 + 验收判据 |
| **C-2** | 从本周清单里删掉的三项（OAuth 2.1 资源服务器 / BYO 远程 endpoint / 「κ ≥ 0.70」） | §6.5.3 | ✅ 已删并写明理由 |
| **C-3** | 本周清单第 2 项（κ 校准）的三条硬约束 | §6.5.2 判据 A / B / C | ✅ 已写死为可验收条款 |
| **C-4** | 需拍板的三件事 | §9 | ✅ 已展开为三件（各含选项 / 建议 / 代价 / 截止日） |
| **C-5** | 新增到官方待问清单的 3 问 | §10.2 B1–B3 | ✅ 已列 |
| **R-1** | 智能收款套件的准入问题要换成「合作平台路径现在能否入驻」 | §6.10 第 30 项旁的官方待问清单 | ✅ |
| **R-2** | 「小号刷量无效」是过度解读；刷量是资格级风险 | §6.12 R-09 | ✅ |
| **R-3** | 支付工作量重估 15–25 人日 + 窗口前移到 10/27 + 沙箱 11/06 + 首笔 11/12 | §6.2.2 N8 + §6.3.1–§6.3.4 + §6.6.1 止损点 3/6 | ✅ |
| **R-4** | 商业化 25% 补真计划 | §6.5.1 第 6 项 + §6.3.2 第 15 项 + §6.12 R-08 | ✅ |
| **R-5** | 「作品提交并通过审核后」是计数的资格前提 | §6.12 R-06 + §6.5.1 第 6 项 | ✅ |
| **R-6** | 许可证表 4/6 行错 | §6.11.1 + §6.11.2 | ✅ |
| **R-7** | MIT 义务零落实 | §6.11.4 + §6.10 第 23–28 项 | ✅ |
| **R-8** | 真正的商业许可证风险在题库 `source` | §6.11.3 + G12 | ✅ |
| **R-9** | 「可判」与「面试官问你的代码」已不是空白 | §6.8.1 + §6.7 Q7 | ✅ |
| **R-10** | 「六维隔离 + 多模型投票」架构不存在 | §6.7 Q5（改述为「已实现、A 期未接线」） | ✅ |
| **R-11** | 「成对数据天然存在」是空的 | §6.4.2 + §6.5.2 判据 C | ✅ |
| **R-12** | 一致率降级为回归监控要先修 M-15 口径 | §6.3.3 第 4 项 + §6.7 Q3 + §6.12 R-16 | ✅ |
| **R-13** | 11/08 止损规则会砍掉本轮自己的阻断项 | §6.6.3（**改写后的止损规则原文**） | ✅ |
| **R-14** | 扩到 3 人的决策日 11/09 → 10/30 | §6.2.1 + §6.6.1 止损点 1 + §6.4.4 | ✅ |

### 12.3 编号对照表（两套编号并存 · 必读）

> ⚠️ **`R-` 撞名警告（实为三套并存）**：一致性席的 `R-1..R-19`、业主方裁决的 `R-1..R-14`、**以及本方案 §6.12 风险登记的 `R-01..R-24`**——三者**同名不同义**。前两套用**一位数**、风险登记用**两位数**（`R-01` 带前导零）以示区分。本方案凡引一致性席发现一律写「**一致性席 R-n**」，引业主方动作项一律写「**裁决 R-n**」，引风险登记一律写「**风险 R-nn**」或直接给条目名（如「§6.12 R-09 刷量被判定」）。**这是本项目最容易发生引用事故的一处。**

#### 12.3.1 席位编号 → 本方案章节

| 席位 | 编号前缀 | 范围 | 承接章节 |
|---|---|---|---|
| MCP 安全席 | **S-** | S-01…S-20 | §3.2（S-01）｜§3.5（S-02）｜§3.4（S-03）｜§3.6（S-04）｜§3.3.2（S-05）｜§3.7.5（S-06）｜§3.8（S-07）｜§3.12.1（S-08）｜§3.11.1（S-09）｜§3.9（S-10）｜§3.7.1（S-11）｜§3.7.2（S-12）｜§3.7.3（S-13）｜§3.7.4（S-14）｜§3.10（S-15）｜§3.11.4（S-16）｜§3.11.3（S-17）｜§3.3.1（S-18）｜§3.8.5（S-19）｜§3.13（S-20 由 `review/01-security.md` 承接） |
| MCP 安全席 | **A4–A8** | 抽取器断言 | §3.6.4 |
| MCP 安全席 | **B1–B4** | `x-mcp-header` 四条断言 | §3.7.5 |
| MCP 安全席 | **F1–F9** | 降级方案九条最小门禁 | §3.12.1 |
| MCP 安全席 | **X-1–X-3** | 三条最坏被利用场景 | §3.12.1 |
| MCP 安全席 | **G-M0a~d / G-M1 / G-M3 / G-M4 / G-M9 / G-M10** | 门禁子项 | §3.11.1（状态表）、§3.9.4（G-M3→G19 / G-M4→G20）、§3.10.4（G-M9→G13a / G-M10→G13b） |
| AI 质量席 | **J-** | J-01…J-28 | §4.12.1（P0 11 条）、§4.12.2（P1 15 条）、§4.12.3（P2 2 条） |
| 支付商业化席 | **A1–A4** | 放行条件 | §12.2 |
| 支付商业化席 | **PC-** | PC-01…PC-18 | §5.11.1（PC-01…PC-07）、§5.11.2（PC-08…PC-18） |
| 支付商业化席 | **T-1…T-19** | 倒排时间线**行标**（实为 13 行） | §5.11.3（行标 → 落点对照） |
| 集成许可席 | **C1–C5** | 放行条件 | §6.11.1–§6.11.2 |
| 集成许可席 | **L-** | L-01…L-22 | §6.13.1（L-01…L-09）、§6.13.3（L-10…L-22） |
| 集成许可席 | **G-1–G-9** | 差距清单 | §6.11.4（G-1…G-9 与 L-06/L-07/L-08/L-09/L-10/L-11/L-21 一一对应） |
| 整体一致性席 | **C-1…C-16** | 冲突对照 | §6.1.2、§6.4.3（引用 C-1 组） |
| 整体一致性席 | **CF-** | CF-01…CF-24 | §6.13.1（CF-01…CF-10 + CF-11…CF-24 状态）、§6.13.2 |
| 整体一致性席 | **G-1–G-15** | 放行条件 | §6.13.2 |
| 整体一致性席 | **R-1…R-19** | 冲突与发现（**与裁决 R- 撞名**） | §6.13.2（全部写为「一致性席 R-n」） |
| 业主方裁决 | **P0-1…P0-5** | 5 个 P0 级硬错 | §1.1（改写位置表）、§3.2.1（P0-4）、§3.11.1（P0-5 已修）、§5.1（P0-1）、§5.2（P0-2）、§4.1.1（P0-3）、§7.3 |
| 业主方裁决 | **A1–A4 / C-1…C-5 / R-1…R-14** | 动作项 | §12.2 |
| 本方案内部 | **R-01…R-24** | **§6.12 风险登记（两位数，与上述两套一位数 R- 区分）** | §6.12 |
| 本方案内部 | **N1–N19** | v3 排期新增项 | §6.2.2、§6.3.1–§6.3.7 |
| 本方案内部 | **W1–W16** | 周次 | §6.3.1–§6.3.8 |
| 本方案内部 | **G11–G31** | **G11 门禁脚本的子断言编号（不是 25 道独立门禁）** | §3.11.3、§6.9.3 |
| 本方案内部 | **G1–G14** | `verify-all.mjs` 的 `GATES` 门禁号（**唯一真相源**） | §6.9.1、§6.9.2(c)、§6.9.3 |
| 本方案内部 | **I-1** | 平台化路线账外新增 → 影子工程（**不占 CF 编号**） | §6.1.1、§6.1.4、§6.10 第 13 项 |
| 本方案内部 | **T-pay / T-demo / T-44…T-1** | 支付倒排行标 | §5.5.3 |

#### 12.3.2 `R-` 撞名的逐条对照（最易引用事故处）

| 编号 | **业主方裁决 R-n** 说的是 | **一致性席 R-n** 说的是 | 本方案引用写法 |
|---|---|---|---|
| R-1 | 智能收款套件准入问题要问对 | 44 天只能做成一条腿 | 「裁决 R-1」 / 「一致性席 R-1」 |
| R-2 | 刷量是资格级风险 | 非本系统输入只供给证据 | 「裁决 R-2」 / 「一致性席 R-2」 |
| R-3 | 支付工作量重估 + 窗口前移 | 统一权限模型优于两套架构 | 「裁决 R-3」 / 「一致性席 R-3」 |
| R-4 | 商业化补真计划 | 一致率高不是可靠性的证据 | 「裁决 R-4」 / 「一致性席 R-4」 |
| R-5 | 「作品已生效」是计数资格前提 | 换模型不能替代人工校准 | 「裁决 R-5」 / 「一致性席 R-5」 |
| R-6 | 许可证表 4/6 行错 | 诚实标注测量边界 | 「裁决 R-6」 / 「一致性席 R-6」 |
| R-7 | MIT 义务零落实 | `initialize` / `Mcp-Session-Id` 已移除 | 「裁决 R-7」 / 「一致性席 R-7」 |
| R-8 | 风险在题库 `source` | MRTR / `requestState` | 「裁决 R-8」 / 「一致性席 R-8」 |
| R-9 | 「可判」已不是空白 | `x-mcp-header` 不能携带密钥 | 「裁决 R-9」 / 「一致性席 R-9」 |
| R-10 | 「多模型投票」架构不存在 | 工具注解不是安全边界 | 「裁决 R-10」 / 「一致性席 R-10」 |
| R-11 | 「成对数据天然存在」是空的 | BYO 只接远程 HTTP | 「裁决 R-11」 / 「一致性席 R-11」 |
| R-12 | 一致率降级要先修 M-15 口径 | 许可核验方法论 | 「裁决 R-12」 / 「一致性席 R-12」 |
| R-13 | 11/08 止损规则会砍掉阻断项 | 多人同场不是空白 | 「裁决 R-13」 / 「一致性席 R-13」 |
| R-14 | 扩编决策日 11/09 → 10/30 | 支付只走 Machine Pay 一条轨（**已被裁决推翻**） | 「裁决 R-14」 / 「一致性席 R-14」 |
| R-15…R-19 | — | 分账不做 / 有效交易去重 / 套件准入 / 小额未定义 / 计费顺序 | **仅「一致性席 R-15…R-19」**（裁决无对应） |

#### 12.3.3 与 §6.12 风险登记 `R-01…R-24` 的区分

§6.12 风险登记使用**两位数**编号（`R-01`…`R-24`），与上表两套**一位数**编号（`R-1`…`R-19` / `R-14`）在字面上高度相似。**引用时必须带前缀或章节号**：

| 写法 | 指代 | 落点 |
|---|---|---|
| 「**裁决 R-9**」 | 业主方裁决的「『可判』与『面试官问你的代码』已不是空白」 | §6.8.1 + §6.7 Q7 |
| 「**一致性席 R-9**」 | 一致性席的「`x-mcp-header` 不能携带密钥」 | §6.9.3 G11 判据 ⑪ |
| 「§6.12 **R-09**」 | 风险登记的「刷量被判定（资格级风险）」 | §6.12 风险表 |
| 「§6.12 **R-22**」 | 风险登记的「门禁扫不存在的目录 → 永远绿」 | §6.12 风险表 |

**同一句话里出现两套 R- 编号时，必须两处都带前缀。**

### 12.4 本方案的局限声明

1. **未写任何新的实现代码。** 本方案中提到的 `qualification.ts`、`tools/calibrate-judge.mjs`、`db/004_calibration_schema.sql`、`tools/check-mcp-gates.mjs`、`tools/verify-source-hygiene.mjs`、`tools/check-license-distribution.mjs`、`tools/check-calibration-gate.mjs`、`server/auth-mcp.js`、`server/services/materialBoundary.js`、`tools/calibration/*` 均只是**落点描述**，一行都还没写。
2. **未创建任何标注。** κ_JH / κ_HH 的具体数值在本方案中全部是**占位符**（X / Y / Z / A–B / [C, D]），必须由 §4.2.7 的 S3 产出后回填。**在回填之前，材料里不得出现任何 κ 的具体数字。**
3. **未跑过 judge 端到端校准。** 成本数字沿用 `2050 token/次` 的推算口径，实际值必须在 S0 裁剪接线后用一次真实 run 回填。
4. **未改任何既有文件。** 本方案是方案文档，不是补丁。§6.10 的 33 项文档落点需要在下一轮施工图更新中同步。
5. **五份核验报告的修订已逐条吸收，但「吸收」不等于「已落地」**——本方案是文档层修订，§6.10 与 §6.3 的排期项才是执行层。
6. **本方案未做第三方独立复核。** 五份核验报告核验的是**四节分稿**，不是本合并稿；合并过程引入的新问题（尤其 §7.1 的四项冲突）**尚无独立核验**。

### 12.5 术语与缩写表

| 缩写 / 术语 | 全称 / 含义 | 首次出现 |
|---|---|---|
| MCP | Model Context Protocol，模型上下文协议 | §1.1 术语表 |
| scope | 作用域，MCP 工具的权限档位（如 `trialroom:read`） | §3.2 |
| handle | 不透明、不可猜测、绑定 principal+tenant 的资源句柄（`room_id`） | §3.4.3 |
| κ | Cohen's kappa，一致性系数；本项目用象限加权 κ_QW，单元 = (题 × 维) 的 A–E 标签 | §4.2.4 |
| κ_JH | judge 与人工标注者之间的 κ | §4.2.2 |
| κ_HH | 两名人工标注者之间的 κ（人类天花板） | §4.2.5 |
| AC1 | 一致性系数 1，线性权重的 κ 交叉验证口径 | §4.2.4 |
| QWK | Quadratic Weighted Kappa | §4.3.4 |
| Vibe Pay | 赛事主赛道名（可接入 Vibe Pay-基础收款能力 / 智能收款套件） | §5.1.1 |
| 网页应用收款 | Vibe Pay 基础收款能力下的收款产品，本作品的实际支付通道 | §5.1.1 |
| 去重用户数 | 主办方口径下的「累计完成有效交易的去重用户数」 | §5.3.1 |
| BYO | Bring Your Own，用户自带模型 / 工具 | §3.8 |
| T-pay / T-demo | 统计意义上的上线日 / 演示意义上的上线日 | §5.5.3 |
| GATES | `tools/verify-all.mjs` 的门禁登记表（唯一真相源） | §6.9.1 |
| 门禁 | 可独立失败、失败即构建变红的自动化检查 | §1.1 术语表 |
| 降级池 | `08-final-plan.md` §3.3 的 7.0 人日预启动降级清单 | §6.4.3 |
| 情景 A / B | 10/30 扩编通过 / 不通过两条分支 | §6.4.4 |
| CP-1 / CP-2 / CP-3 | 商业化三个 checkpoint（11/12 / 11/22 / 12/01） | §5.7.4 |
| 方案 B | 12/01 仍不达标时的材料备选（不出现「付费用户数」字段） | §5.7.7 |
| 义务级 / 分数级 | 刷量风险的两个量级：取消资格 vs 不加分 | §5.3.2 |
| license laundering | 许可洗白：作者声明 MIT，但内容派生自受限上游 | §6.11.2 |
| 落点 | 某条问题 / 要求在本方案或代码库中的具体承接位置 | 全文 |
| 验收判据 | 可机器判定或可截图判定的完成条件 | 全文 |

---

*本方案为《Trialroom 参赛最终方案 v3》的合并终稿，取代 `review/07-final-plan.md`、`review/08-final-plan.md` 与 `research/platformization-report-20261026.md` 的现行版本。四节正文全部保留，未改写事实；跨节矛盾已显式列出并给出裁决建议。五席评审报告、业主方裁决与五份独立核验报告的落点全部可追溯。*
