# 首页 13 个默认指标：来源与可用性清单

审计日期：2026-07-18

对应实现：`app/src/features/dashboard/widgetDefinitions.js`

来源策略：`app/src/domain/metrics/sourcePolicy.js`

## 1. 当前结果

Phase 4 完成时，13 个默认指标中 4 个可发布、9 个因来源审批开关关闭而显示 `N/A`。本轮按产品决定将 CMC 默认发布开关置为 `1`，并把 Strategy 持仓切换到官方披露；重建后为 **7 个可用、6 个 N/A**。Dashboard 投影另含一个非默认依赖 `stablecoin.usdt.depegBps`，因此投影文件本身有 8 个指标，不能把它误算进这 13 项。

| # | 默认指标 | Phase 4 候选来源/行数 | 本轮决定 | 当前状态 | 当前最新观测 |
| ---: | --- | --- | --- | --- | --- |
| 1 | 加密货币总市值 `crypto.totalMarketCap` | CMC，5 行 | `CMC_REDISTRIBUTION_APPROVED` 默认 `1`；可显式设 `0` 暂停 | 可用 | 2026-07-16，约 2.220 万亿美元 |
| 2 | 比特币市值 `btc.marketCap` | CMC，5 行 | 同上 | 可用 | 2026-07-16，约 1.295 万亿美元 |
| 3 | 主要稳定币总市值 `stablecoin.major.marketCap` | DefiLlama，400 行 | Binance/OKX 无等价流通市值字段 | N/A | 候选数据不发布 |
| 4 | USDT 流通市值 `stablecoin.usdt.marketCap` | DefiLlama，400 行 | Binance/OKX 只有交易所价格/成交数据，不能替代全市场流通市值 | N/A | 候选数据不发布 |
| 5 | USDC 流通市值 `stablecoin.usdc.marketCap` | DefiLlama，400 行 | 同上 | N/A | 候选数据不发布 |
| 6 | 美国现货 BTC ETF 净流量 `crypto.etf.BTC.net_flow_usd` | SoSoValue，21 行 | Binance/OKX 不提供美国 ETF 申赎/净流量 | N/A | 候选数据不发布 |
| 7 | 美国现货 ETH ETF 净流量 `crypto.etf.ETH.net_flow_usd` | SoSoValue，21 行 | 同上 | N/A | 候选数据不发布 |
| 8 | 美国现货 SOL ETF 净流量 `crypto.etf.SOL.net_flow_usd` | SoSoValue，21 行 | 同上 | N/A | 候选数据不发布 |
| 9 | Strategy 比特币持仓 `treasury.mstr.btc_holdings` | 原有 SoSoValue 49 行 | 移除 SoSoValue 采集；只使用审核过的 Strategy 官方披露 | 可用 | 2026-06-21，847,363 BTC |
| 10 | Strategy 比特币平均成本 `treasury.mstr.btc_average_cost_usd` | Strategy 官方披露，1 行 | 维持官方披露 | 可用 | 2026-06-21，75,651 美元/BTC |
| 11 | BitMine 以太坊持仓 `treasury.bmnr.eth_holdings` | SEC EDGAR，3 行 | 维持官方披露 | 可用 | 2026-06-28 22:30Z，5,742,237 ETH |
| 12 | BitMine 以太坊平均成本 `treasury.bmnr.eth_average_cost_usd` | SEC EDGAR，1 行 | 维持同日单位/成本基础推导 | 可用 | 2026-02-28，约 3,794.26 美元/ETH |
| 13 | 日本 10 年期国债收益率 `macro.JGB10Y.value` | 日本财务省，116 行 | 维持官方 CSV | 可用 | 2026-07-14，2.713% |

## 2. Binance / OKX 能否替代 DefiLlama 与 SoSoValue

结论：**当前不能替代这 6 个 N/A 指标。**

Binance 官方列出的免认证市场数据端点覆盖成交、深度、交易对信息、K 线、ticker 和价格；OKX 官方市场数据覆盖 ticker、深度、成交、K 线、指数/标记价格、资金费率和未平仓量。这些字段可以支持未来的稳定币价格偏离、交易量或交易所流动性指标，但不能生成：

- USDT/USDC 的全市场流通量或流通市值；
- 美国上市现货 ETF 的申购赎回或每日净流入。

用交易所成交量替代 ETF 净流量，或用交易所价格乘一个未知/异源供应量替代流通市值，都会改变指标语义，因此不采用。DefiLlama 和 SoSoValue 的审批开关继续保持关闭，对应项显示 `N/A`。

官方文档：

- [Binance Market Data Only URLs](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
- [OKX API Guide — Market Data](https://www.okx.com/docs-v5/en/)

## 3. CMC 与 Strategy 的执行规则

- CMC：仓库记录了 2026-07-18 的产品发布决定。没有显式环境值时按 `1` 处理；部署变量明确设为 `0` 时，CMC 行在持久化和公共投影前被拒绝。API key 仍只允许存在于本地忽略文件或部署 secret，绝不进入浏览器和仓库。
- Strategy：`app/data/corporate-treasury-disclosures.json` 是审核后的事实输入；`npm run apply-reviewed-treasuries` 将其确定性应用到静态 LKG。更新器不再请求 SoSoValue 的 MSTR treasury 端点，指标目录和后续 migration 也只声明 `strategy-disclosures`。
- 上游失败仍保留 last-known-good；没有通过来源策略的候选行不会为了消除 `N/A` 而进入公开投影。

## 4. 剩余风险

- CMC 的产品开关为 `1` 不替代账户套餐和供应商条款复核；套餐、展示范围或缓存规则变化时必须重新审查。
- 6 个 N/A 指标没有用近似字段填充。后续可以选择取得原来源展示许可、采购文档化数据服务，或改变产品指标定义，但必须作为新的明确决策。
- Strategy 官方披露目前只有仓库内已经审核的一条持仓事实；它比第三方聚合历史短，但来源质量更高，也不会把未经批准的第三方历史伪装成官方历史。
