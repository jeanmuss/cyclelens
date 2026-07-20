begin;

insert into public.metric_catalog (
  metric_id, title, unit, cadence, source_policy_ids, visibility,
  quality_policy, default_display, projection_ids, catalog_version
) values
  ('equity.us.qqq.price', '{"zh":"纳斯达克 100（QQQ）","en":"Nasdaq 100 proxy (QQQ)"}', 'USD', 'daily', array['akshare'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"currency","precision":2}', array['dashboard','us-equity'], 2),
  ('equity.us.spy.price', '{"zh":"标普 500（SPY）","en":"S&P 500 proxy (SPY)"}', 'USD', 'daily', array['akshare'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"currency","precision":2}', array['dashboard','us-equity'], 2),
  ('equity.us.dia.price', '{"zh":"道琼斯（DIA）","en":"Dow Jones proxy (DIA)"}', 'USD', 'daily', array['akshare'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"currency","precision":2}', array['dashboard','us-equity'], 2),
  ('equity.us.sox.value', '{"zh":"费城半导体指数","en":"PHLX Semiconductor Index"}', 'index', 'daily', array['yahoo-finance'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"number","precision":2}', array['dashboard','us-equity'], 2),
  ('commodity.gold.proxy', '{"zh":"黄金价格代理","en":"Gold price proxy"}', 'index', 'daily', array['fred-third-party'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"number","precision":2}', array['dashboard','us-equity'], 2),
  ('macro.riskPosture.score', '{"zh":"风险压力评分","en":"Risk pressure score"}', 'score', 'weekly', array['fred-government','fred-third-party'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"number","precision":0}', array['dashboard'], 2),
  ('macro.US10Y.value', '{"zh":"美国十年期国债收益率","en":"U.S. 10-year Treasury yield"}', 'percent', 'daily', array['fred-government'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"percent","precision":2}', array['dashboard','us-equity'], 2),
  ('macro.US10Y.realYield', '{"zh":"美国十年期实际利率","en":"U.S. 10-year real yield"}', 'percent', 'daily', array['fred-government'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"percent","precision":2}', array['dashboard'], 2),
  ('macro.DXY.value', '{"zh":"广义美元指数","en":"Broad U.S. dollar index"}', 'index', 'daily', array['fred-government'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"number","precision":2}', array['dashboard'], 2),
  ('macro.VIX.value', '{"zh":"VIX 波动率指数","en":"VIX volatility index"}', 'index', 'daily', array['fred-third-party'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"number","precision":2}', array['dashboard','us-equity'], 2),
  ('macro.HYOAS.value', '{"zh":"美国高收益债利差","en":"U.S. high-yield OAS"}', 'percent', 'daily', array['fred-third-party'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"percent","precision":2}', array['dashboard'], 2),
  ('macro.netLiquidity.usd', '{"zh":"美元净流动性","en":"U.S. dollar net liquidity"}', 'USD', 'weekly', array['fred-government'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_currency","precision":2}', array['dashboard'], 2)
on conflict (metric_id) do update set
  title = excluded.title,
  unit = excluded.unit,
  cadence = excluded.cadence,
  source_policy_ids = excluded.source_policy_ids,
  visibility = excluded.visibility,
  quality_policy = excluded.quality_policy,
  default_display = excluded.default_display,
  projection_ids = excluded.projection_ids,
  catalog_version = excluded.catalog_version,
  active = true,
  updated_at = now();

update public.metric_catalog
set
  projection_ids = case
    when metric_id = 'macro.JGB10Y.value' then array['dashboard','us-equity']
    else array['dashboard','crypto-liquidity']
  end,
  catalog_version = 2,
  updated_at = now()
where metric_id in (
  'crypto.totalMarketCap',
  'btc.marketCap',
  'stablecoin.usdt.marketCap',
  'stablecoin.usdc.marketCap',
  'stablecoin.major.marketCap',
  'stablecoin.usdt.depegBps',
  'crypto.etf.BTC.net_flow_usd',
  'crypto.etf.ETH.net_flow_usd',
  'crypto.etf.SOL.net_flow_usd',
  'treasury.mstr.btc_holdings',
  'treasury.mstr.btc_average_cost_usd',
  'treasury.bmnr.eth_holdings',
  'treasury.bmnr.eth_average_cost_usd',
  'macro.JGB10Y.value'
);

commit;
