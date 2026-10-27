# 人侧操作清单(只有你能做的事)——Trialroom

> 代码侧已全部就位;以下动作物理上只能由账号所有人执行。
> 每项附验收判据,完成一项勾一项。官方日历锚点:报名截止 12/01 23:59:59,
> 提交截止 12/09 23:59:59(取证:docs/official/payathon-2026-landing.md)。

## 🔴 本周(逾期即归零)

- [ ] **1. 报名**(https://aipay.alipay.com/community/events/payathon-2026,支付宝账号登录填报)
  - 验收:报名成功页截图;报名无需选赛道(提交时再选)
- [ ] **2. 开通【网页应用收款】**(支付宝开放平台 → 创建网页应用 → 签约收款能力)
  - 验收:控制台「已开通」截图 + 拿到 `APPID` / `应用私钥` / `支付宝公钥`
  - 注:接入指南写明支持个人收款场景,无需营业执照;沙箱联调不需要任何资质
- [ ] **3. 把三要素注入环境变量**(沙箱先用沙箱密钥):
  ```
  ALIPAY_APP_ID=...              ALIPAY_APP_PRIVATE_KEY=...(应用私钥)
  ALIPAY_PUBLIC_KEY=...(支付宝公钥)  ALIPAY_GATEWAY=https://openapi.alipaydev.com/gateway.do
  ALIPAY_NOTIFY_URL=https://<你的域名>/pay/alipay/notify
  ```
  - 注入后:`isConfigured()` 变 true,mock 测试通道自动关闭(代码已内置该切换)
  - 验收:`curl localhost:3001/api/platform/products` 返回 `provider: "alipay_web"`

## 🟡 沙箱 → 生产(11 月上中旬)

- [ ] **4. 沙箱全链路**:沙箱买家账号支付 ¥0.01 → 异步通知到达 → 订单变 paid
  - 验收:payment_notifications 表出现 `verify_ok=1` 记录;截 3 张图(下单页/支付页/落库查询)
- [ ] **5. 生产首单**(方案 11/12 里程碑):真实支付 ¥0.01,**下单后 24h 内关闭测试通道**
  - 验收:3 张截图(out_trade_no / trade_status / 后端落库);`is_internal_verification=0`
  - 内控纪律:零自购、零互刷、团队亲友只允许首单 1 笔且打内控标
- [ ] **6. 服务器与域名**:公网服务器(1c2g 起步,方案按 1 核容器+ASR 并发 2 规格设计);
  域名备案 W1 启动(支付不依赖域名,IP+端口可兜底)
  - 验收:`docker compose up -d --build` 后公网可访问,`/pay/alipay/notify` 可达

## 🟢 提交窗口(12/08–12/09)

- [ ] **7. 提交作品**:选 **Vibe Pay 主赛道**(赛道路径归位,ADR 见方案 §5.1);
  Machine Pay 若做须另立独立作品、不共用链接(官方:同一作品不得跨赛道重复投稿)
- [ ] **8. 参评材料纪律自检**(四禁用词:行业基准/人类面试官水平/达到专家水平/国际领先;
  κ 数值回填前不得出现具体数字;不写「我们的 808 题」「分账」)

## ⚙️ 环境待办(阻塞 GitHub 推送,不阻塞开发)

- [ ] **9. gh 凭据失效**:`gh auth login -h github.com` 重新认证,然后创建私有仓推送:
  ```
  gh repo create wufufu770/trialroom --private --source . --push
  ```
- [x] ~~10. Mimosa 提交钩子拦截~~ **已解除**(2026-10-27):删除 6 个本地运维脚本 +
      analysis.js 扩展名白名单加固后,高危发现降至阈值下,提交恢复正常;
      剩余历史标记(测试 spawn/题面 URL/POST 启发式)为已定性的误报,见交付报告附 A

## 📞 官方 9 问(可随时发,不阻塞)

见 `docs/official/OPEN_QUESTIONS.md` —— 全部口径已做冗余对冲(落库字段覆盖任何答案组合,
回复到达后只切报表列,数据层零改动)。
