# Phase 9 首页跨市场指标覆盖与来源状态

审计日期：2026-07-20

对应实现：`app/src/features/dashboard/widgetDefinitions.js`

来源策略：`app/src/domain/metrics/sourcePolicy.js`

## 当前覆盖

首页默认布局共有 **8 个分组、25 个指标单元格**。其中 13 个是第一版首页依赖，12 个是本批为“美股大盘”和“宏观流动性”概况补齐的新依赖。当前默认审批环境下，25 个单元格中 **11 个可发布、14 个显示 N/A**。公开 `dashboard` projection 另保留一个非默认单元格依赖 `stablecoin.usdt.depegBps`，因此 projection 有 12 个指标，不能把它计入 25 个默认单元格。

每个单元格只展示名称、最新值、日增减和周增减。日/周参考点不存在、指标是披露频率、来源未获许可或没有合格观测时显示 `N/A`，不会补零。来源、新鲜度、方法和限制仍统一放在页面数据说明区。

## 两个概况区域的映射

| 来源页面概况 | 指标 | 首页分组 | 当前发布状态 |
| --- | --- | --- | --- |
| 美股大盘 | QQQ、SPY、DIA、SOX、黄金代理 | 美股大盘 | N/A；旧 AKShare/Yahoo 路径被阻止，黄金为 FRED 第三方序列 |
| 美股大盘 | 美国 10 年期国债、VIX | 宏观流动性 | 美国 10 年期可用；VIX N/A |
| 美股大盘 | 日本 10 年期国债 | 日本长期利率 | 可用；日本财务省官方 CSV |
| 美股大盘 | BTC 市值、加密总市值 | 加密市场规模 | 可用；CMC 产品发布开关默认开启 |
| 宏观流动性 | 风险压力评分、美国 10 年期国债、实际利率、广义美元指数、VIX、高收益债利差、美元净流动性 | 宏观流动性 | 4 个政府序列可用；VIX、高收益债利差及依赖二者的评分 N/A |

## 本批新增的 12 个目录项

| 优先级 | 指标 | 候选来源 | 审核结论 | 默认状态 |
| ---: | --- | --- | --- | --- |
| 1 | 美国 10 年期国债收益率 `macro.US10Y.value` | FRED / U.S. Treasury | 政府所有的事实序列，可发布衍生观测并保留署名 | 可用 |
| 2 | 美国 10 年期实际利率 `macro.US10Y.realYield` | FRED / U.S. Treasury | 同上 | 可用 |
| 3 | 广义美元指数 `macro.DXY.value` | FRED / Federal Reserve | 政府所有的事实序列 | 可用 |
| 4 | 美元净流动性 `macro.netLiquidity.usd` | WALCL − WTREGEN − RRPONTSYD | 只由美联储和美国财政部序列确定性派生 | 可用 |
| 5 | 纳斯达克 100 代理 `equity.us.qqq.price` | 旧 AKShare / Sina 缓存 | 非官方聚合路径，未做许可与数据流批准 | N/A |
| 6 | 标普 500 代理 `equity.us.spy.price` | 旧 AKShare / Sina 缓存 | 同上 | N/A |
| 7 | 道琼斯代理 `equity.us.dia.price` | 旧 AKShare / Sina 缓存 | 同上 | N/A |
| 8 | 费城半导体指数 `equity.us.sox.value` | 旧 yfinance / Yahoo 缓存 | 非官方访问路径，禁止继续作为生产源 | N/A |
| 9 | 黄金价格代理 `commodity.gold.proxy` | FRED / Credit Suisse NASDAQ 序列 | FRED 不转授底层第三方序列的再发布权 | N/A；需 `FRED_THIRD_PARTY_SERIES_APPROVED=1` |
| 10 | VIX `macro.VIX.value` | FRED / CBOE | 同上 | N/A；需同一审批开关 |
| 11 | 美国高收益债利差 `macro.HYOAS.value` | FRED / ICE BofA | 同上 | N/A；需同一审批开关 |
| 12 | 风险压力评分 `macro.riskPosture.score` | 政府利率/美元 + CBOE VIX + ICE BofA 利差 | 任一核心第三方输入未获批准时，不发布衍生评分 | N/A；需同一审批开关 |

## 尚未满足的 Phase 9 验收条件

当前还没有一个通过公开展示、缓存、署名和维护审查的美股宽基价格或市场广度指标。QQQ、SPY、DIA 和 SOX 单元格已经预留，但只能显示 `N/A`。Phase 9 不能据此宣告全部完成；后续应优先评估官方指数发布方、具有明确公开展示许可的数据套餐，或重新定义为可由官方政府/交易所事实构造的市场广度指标。不得启用浏览器抓取、Cookie 复用或反向工程接口来消除 `N/A`。
