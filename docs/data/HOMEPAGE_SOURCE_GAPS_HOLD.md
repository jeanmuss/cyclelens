# 首页缺失指标来源：暂停处理记录

状态：**暂停补源，但保留页面、目录、历史事实表和早报 contract 的指标槽位**

审计日期：2026-07-20

## 决策

这批来源问题不在 Phase 7 早报批次中处理。首页与早报继续使用同一组 25 个默认指标：有合格公开观测时显示数值，没有时显示 `N/A`；不得补零、启用被阻止的抓取路径，或把未获批准的 last-known-good 当作当日数据。

生产首页在最近一次完整投影中有 13 个可发布指标、12 个 `N/A`。仓库内离线基线较旧，USDT/USDC 尚未包含最近的 CMC 观测，因此本地干跑可能是 11 个可用、14 个 `N/A`；定时早报会从 `data-cache` 恢复与生产相同的已审核数据，再生成 dashboard projection。

## 当前 12 个生产缺失项

| # | 首页分组 | 指标 | 当前目录来源 | 缺失原因 | 后补方向 |
| ---: | --- | --- | --- | --- | --- |
| 1 | 美股大盘 | 纳斯达克 100（QQQ）`equity.us.qqq.price` | AKShare 聚合适配器，底层为 Sina 美股日线 | 非官方聚合路径，生产已阻止 | 评估具备明确公开展示、缓存和署名许可的官方或付费来源 |
| 2 | 美股大盘 | 标普 500（SPY）`equity.us.spy.price` | AKShare / Sina 美股日线 | 同上 | 同上 |
| 3 | 美股大盘 | 道琼斯（DIA）`equity.us.dia.price` | AKShare / Sina 美股日线 | 同上 | 同上 |
| 4 | 美股大盘 | 费城半导体指数 `equity.us.sox.value` | yfinance / Yahoo Finance `^SOX` | 非官方库和访问路径，生产已阻止 | 优先评估指数发布方或明确许可的数据套餐 |
| 5 | 美股大盘 | 黄金价格代理 `commodity.gold.proxy` | FRED `NASDAQQGLDI`；底层为 Credit Suisse / NASDAQ Gold FLOWS103 | FRED 可访问不等于底层第三方再发布授权 | 单独完成底层权利与展示许可审查后再开 gate |
| 6 | 宏观流动性 | 风险压力评分 `macro.riskPosture.score` | DGS10、DTWEXBGS、VIXCLS、BAMLH0A0HYM2 的衍生评分 | VIX 与 ICE BofA 输入未获批准，衍生值随之停止发布 | 输入全部获批后才恢复衍生评分 |
| 7 | 宏观流动性 | VIX `macro.VIX.value` | FRED `VIXCLS`；底层 CBOE | 底层第三方再发布许可未确认 | 单独审核 CBOE 权利或更换合规来源 |
| 8 | 宏观流动性 | 美国高收益债利差 `macro.HYOAS.value` | FRED `BAMLH0A0HYM2`；底层 ICE BofA | 底层第三方再发布许可未确认 | 单独审核 ICE BofA 权利或更换合规来源 |
| 9 | 现货 ETF 资金流 | BTC ETF 日净流 `crypto.etf.BTC.net_flow_usd` | SoSoValue Open API；BlockBeats 仅作可选交叉检查 | 账户套餐和公开展示权未确认，两个 gate 均关闭 | 获得书面/套餐许可后独立开启对应 gate |
| 10 | 现货 ETF 资金流 | ETH ETF 日净流 `crypto.etf.ETH.net_flow_usd` | SoSoValue Open API | 同上 | 同上 |
| 11 | 现货 ETF 资金流 | SOL ETF 日净流 `crypto.etf.SOL.net_flow_usd` | SoSoValue Open API | 同上 | 同上 |
| 12 | 稳定币流动性 | 主要稳定币总市值 `stablecoin.major.marketCap` | 当前 catalog 只允许 DefiLlama | DefiLlama gate 关闭；现有 CMC USDT/USDC 观测不能通过当前目录规则自动合成为该指标 | 后续评审“CMC 两币之和”是否满足产品定义与许可，再用 catalog/migration 正式变更 |

## 明确保留的架构空间

- 上述 12 个 `metric_id` 继续留在统一 metric catalog、dashboard projection 白名单、首页 widget registry 与 Telegram 早报 contract 中。
- Supabase 的 `metric_catalog` 与标准化事实表继续容纳这些 ID；恢复来源时必须使用 migration、来源策略和许可 gate，不新建旁路数据结构。
- 公开网页和早报都只消费经审核的静态 projection；不会在浏览器或通知脚本中直连供应商。
- 本文是暂停记录，不构成对任何候选来源的许可批准。后续恢复工作时，应先更新来源审查结论，再改 gate、采集器和数据测试。

更完整的 Phase 9 指标覆盖关系见 [`HOMEPAGE_PHASE9_METRICS.md`](./HOMEPAGE_PHASE9_METRICS.md)。
