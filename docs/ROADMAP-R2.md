# Trialroom 更新与新增功能方案(R2 调研稿)

> 依据:R2 全项目巡检(单点/组合/逻辑/压力三轮全绿后的功能缺口盘点)+ 11-final-plan 未建项。
> 排序原则:**先补核心闭环(P0),再商业化必需(P1),后体验增长(P2)**。
> 规模单位:人日(按方案 §6.2 口径,单人有效产能)。

## P0 · 核心闭环缺口(没有它们,产品不成立)

### 1. 面试主循环接权益(当前最大的洞)
- **现状**:用户能买套餐,但开始面试**不扣次数**——`consumeEntitlement` 全仓无路由调用方;`interview_attempts` 表全空。
- **方案**:新增 `POST /api/platform/attempts`(platformAuth + requireScope):校验/扣减权益(次卡扣额度、时间卡校验期)→ 建 `interview_attempts` 行(挂 user/room/position/difficulty)→ 返回 attempt_id;基座面试页开跑前调用;结束时回写 `finished_at` 与三条件 `qualification`(复用 `qualification.mjs` 的 evaluateQualification)。
- **验收**:无权益开跑被拒(402 语义);5 次包恰好 5 次;台账守恒律测试(已有)继续绿;E2E 增"买→练→耗尽→再买"旅程。
- **规模**:1.5 人日。**依赖**:无。

### 2. ask_next_question 出真题(占位题 → 题库注入)
- **现状**:MCP 推进只回"第 N 题(由面试官 Agent 生成…)"占位串,808 题库未接入房间。
- **方案**:`tools.mjs` 取题器——按房间 `industry` + 难度映射(L1-L5 ↔ easy..hell)从 `server/data/questionbank.json` 顺序取未用题(房内 `asked` 记录去重),题干入 `room_messages`;**参考答案永不入消息流**(留服务端,评分期由隔离引擎使用——证据/结论分离纪律 §3.6)。
- **验收**:同房两次推进得两道不同题;`room_messages` 无 referenceAnswer 字段;industry 不匹配时回退全库。
- **规模**:1 人日。**依赖**:无。

### 3. 正式身份体系(dev-token 不能上生产)
- **现状**:生产态无任何用户注册/登录途径;api_tokens 只能开发引导。
- **方案(最小可行)**:支付宝 OAuth 网页授权(收款主体天然有)——`/api/platform/auth/alipay` 三步:跳转授权 → 换 user_id(alipay.system.oauth.token)→ 以 `alipay_user_hash` 找/建 users 并签发 api_tokens(30 天)。备选:手机号+短信(需短信服务,成本+合规)。
- **验收**:沙箱授权往返;同一支付宝账号两次登录归并同一 user;E2E 覆盖。
- **规模**:2 人日。**依赖**:支付宝三要素(与收款同源)。

### 4. κ 真实校准闭环
- **现状**:管线/门禁/换算表就绪,mock 占位;缺 MiniMax key + 人工标注。
- **方案**:key 注入 → `calibrate-judge --provider minimax --full`;两开发者三阶段标注 120 item(培训 30min/人 + 双盲 2.5h/人 + 共识 30min/人);G14 出真实双阈值判定;结果回填参评材料换算表。
- **验收**:G14 measured 模式通过;κ 数值才允许出现在材料(此前占位纪律不变)。
- **规模**:1 人日工程 + 6 人时标注。**依赖**:MiniMax key(用户侧)。

## P1 · 商业化与参赛必需

| # | 功能 | 现状缺口 | 方案要点 | 验收判据 | 规模 |
|---|---|---|---|---|---|
| 5 | **对账补偿** | notify 可能丢(支付宝重试有限),created 订单无补救 | 定时任务(5min)对 `created>15min` 订单调 `alipay.trade.query`,已支付则补落账;结果入 payment_notifications | 人为丢一条 notify,对账自动补上 | 1 人日 |
| 6 | **真实退款执行** | `refundOrder` 只改本地,未调支付宝 | 接 `alipay.trade.refund`(RSA2 同套);退款单号幂等;失败回滚本地状态 | 沙箱退款往返 + 本地状态一致 | 1 人日 |
| 7 | **支付结果页** | return_url 回跳无承接页 | `/welcome?paid=1` 展示结果 + 轮询订单状态转圈;失败分支文案 | 支付宝沙箱全链路点穿 | 0.5 人日 |
| 8 | **房间生命周期** | close/leave 有状态无端点 | `POST /rooms/:id/close`(房主)、`POST /rooms/:id/leave`(软离座,已有 ON CONFLICT 复活路径兜底) | 关房后入座 404;离座再入座保号(测试已有) | 0.5 人日 |
| 9 | **管理后台页** | stats/orders 有 JSON 无 UI | PlatformPage 加 admin 标签页:多口径统计卡 + 订单/通知审计表 | admin token 可见,普通用户 404 | 1 人日 |
| 10 | **复盘对照真数据** | 现拉基座 sessions,attempt 全空 | 等 #1 落地后切换数据源为 interview_attempts,维度分对比 + 进步曲线 | 两次 attempt 对照可见 | 0.5 人日 |

## P2 · 体验与增长

| # | 功能 | 要点 | 规模 |
|---|---|---|---|
| 11 | 分享卡图片 | 服务端 SVG/PNG(房间号+二维码+口号),`GET /share/:code.png` | 1 人日 |
| 12 | 落地页 SEO/OG | meta/OG 标签、sitemap、题库静态页互链(基座已有 428 页,互导流) | 0.5 人日 |
| 13 | 群面×平台房间打通 | 基座 GroupInterviewEngine 的候选人调度接入 room_messages 流 | 3 人日 |
| 14 | Pro 题库 116 题 | 新制题(带 rubricHints+判据链),sources-license 登记来源为空 | 3 人日 |
| 15 | 证据抽取器(§3.6) | 两段式:边界化(8KB/20 条/6k token)→ 固定 Schema 结构化;平台自有模型;A4 静态断言门禁 | 2 人日 |
| 16 | 监控四信号(M-15) | 锚点翻转率/跨题标准差/逐维 κ 变化/parse 失败率,落 qa/calibration 告警文件 | 1 人日 |
| 17 | 数据备份 | trialroom.db 每日 WAL checkpoint + 备份轮转(7 份) | 0.5 人日 |

## 汇总

- **P0 合计 ≈ 5.5 人日**:完成即"付费 → 练习扣次 → 真题 → 真评分"完整商业闭环
- **P1 合计 ≈ 6.5 人日**:对账/退款/结果页是收钱的三件套,参赛必做
- **P2 合计 ≈ 11 人日**:增长与体验,按需排期
- 建议执行序:P0#1 → P0#2 → P1#5/#6(与支付宝三要素同批联调)→ P0#3 → P1#7/#8 → 其余

## 本轮(R2)巡检结论归档

- 三轮全绿:单元 69(平台)+299(全后端)+673(前端)、E2E 24/24×3、压力 6/6×3、门禁 15 道
- 新修缺陷:D6 通用限流上限硬编码(env 化为 API_RATE_GENERAL)、D7 压测自撞配额(显式配额注入)
- 守恒律/状态机/双进程 WAL 全部验证通过,无未决缺陷
