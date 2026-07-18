begin;

create table if not exists public.metric_catalog (
  metric_id text primary key,
  title jsonb not null,
  unit text not null,
  cadence text not null,
  source_policy_ids text[] not null,
  visibility text not null default 'internal',
  quality_policy jsonb not null,
  default_display jsonb not null,
  projection_ids text[] not null default '{}'::text[],
  catalog_version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metric_catalog_metric_id_not_blank check (btrim(metric_id) <> ''),
  constraint metric_catalog_title_object check (jsonb_typeof(title) = 'object'),
  constraint metric_catalog_unit_not_blank check (btrim(unit) <> ''),
  constraint metric_catalog_cadence_not_blank check (btrim(cadence) <> ''),
  constraint metric_catalog_sources_present check (cardinality(source_policy_ids) > 0),
  constraint metric_catalog_visibility_valid check (visibility in ('public', 'internal', 'private')),
  constraint metric_catalog_quality_object check (jsonb_typeof(quality_policy) = 'object'),
  constraint metric_catalog_display_object check (jsonb_typeof(default_display) = 'object')
);

insert into public.metric_catalog (
  metric_id, title, unit, cadence, source_policy_ids, visibility,
  quality_policy, default_display, projection_ids, catalog_version
) values
  ('crypto.totalMarketCap', '{"zh":"加密货币总市值","en":"Total crypto market cap"}', 'USD', 'daily', array['coinmarketcap'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('btc.marketCap', '{"zh":"比特币市值","en":"Bitcoin market cap"}', 'USD', 'daily', array['coinmarketcap'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('stablecoin.usdt.marketCap', '{"zh":"USDT 流通市值","en":"USDT circulating market cap"}', 'USD', 'daily', array['defillama','coinmarketcap'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('stablecoin.usdc.marketCap', '{"zh":"USDC 流通市值","en":"USDC circulating market cap"}', 'USD', 'daily', array['defillama','coinmarketcap'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('stablecoin.major.marketCap', '{"zh":"主要稳定币总市值","en":"Major stablecoin market cap"}', 'USD', 'daily', array['defillama'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('stablecoin.usdt.depegBps', '{"zh":"USDT 脱锚幅度","en":"USDT depeg distance"}', 'bps', 'daily', array['coinmarketcap'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"basis_points","precision":2}', array['crypto-liquidity'], 1),
  ('crypto.etf.BTC.net_flow_usd', '{"zh":"美国现货 BTC ETF 净流量","en":"U.S. spot BTC ETF net flow"}', 'USD', 'daily', array['sosovalue','blockbeats'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"signed_compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('crypto.etf.ETH.net_flow_usd', '{"zh":"美国现货 ETH ETF 净流量","en":"U.S. spot ETH ETF net flow"}', 'USD', 'daily', array['sosovalue'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"signed_compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('crypto.etf.SOL.net_flow_usd', '{"zh":"美国现货 SOL ETF 净流量","en":"U.S. spot SOL ETF net flow"}', 'USD', 'daily', array['sosovalue'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"signed_compact_currency","precision":2}', array['crypto-liquidity'], 1),
  ('treasury.mstr.btc_holdings', '{"zh":"Strategy 比特币持仓","en":"Strategy bitcoin holdings"}', 'BTC', 'disclosure', array['strategy-disclosures','sosovalue'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_number","precision":0}', array['crypto-liquidity'], 1),
  ('treasury.mstr.btc_average_cost_usd', '{"zh":"Strategy 比特币平均成本","en":"Strategy bitcoin average cost"}', 'USD_per_asset', 'disclosure', array['strategy-disclosures'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"currency","precision":0}', array['crypto-liquidity'], 1),
  ('treasury.bmnr.eth_holdings', '{"zh":"BitMine 以太坊持仓","en":"BitMine ether holdings"}', 'ETH', 'disclosure', array['sec-edgar'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"compact_number","precision":0}', array['crypto-liquidity'], 1),
  ('treasury.bmnr.eth_average_cost_usd', '{"zh":"BitMine 以太坊平均成本","en":"BitMine ether average cost"}', 'USD_per_asset', 'disclosure', array['sec-edgar'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"currency","precision":0}', array['crypto-liquidity'], 1),
  ('macro.JGB10Y.value', '{"zh":"日本十年期国债收益率","en":"Japan 10-year government bond yield"}', 'percent', 'daily', array['japan-mof'], 'public', '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}', '{"format":"percent","precision":3}', array['us-equity'], 1)
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

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_metric_observations_metric_catalog_fk'
  ) then
    alter table public.market_metric_observations
      add constraint market_metric_observations_metric_catalog_fk
      foreign key (metric_id) references public.metric_catalog(metric_id) not valid;
  end if;
end;
$$;

create table if not exists public.dashboard_snapshot_runs (
  id bigint generated always as identity primary key,
  projection_id text not null,
  status text not null,
  catalog_version integer not null,
  observation_count integer not null default 0,
  source_observed_at timestamptz,
  source_fetched_at timestamptz,
  transformed_at timestamptz,
  artifact_sha256 text,
  error_code text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dashboard_snapshot_runs_projection_not_blank check (btrim(projection_id) <> ''),
  constraint dashboard_snapshot_runs_status_valid check (status in ('started', 'completed', 'failed')),
  constraint dashboard_snapshot_runs_observation_count_valid check (observation_count >= 0),
  constraint dashboard_snapshot_runs_hash_valid check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint dashboard_snapshot_runs_details_object check (jsonb_typeof(details) = 'object')
);

create index if not exists dashboard_snapshot_runs_projection_created_idx
  on public.dashboard_snapshot_runs (projection_id, created_at desc);

alter table public.metric_catalog enable row level security;
alter table public.dashboard_snapshot_runs enable row level security;

revoke all on table public.metric_catalog from public, anon, authenticated;
revoke all on table public.dashboard_snapshot_runs from public, anon, authenticated;
grant select, insert, update on table public.metric_catalog to service_role;
grant select, insert, update on table public.dashboard_snapshot_runs to service_role;
grant usage, select on sequence public.dashboard_snapshot_runs_id_seq to service_role;

drop policy if exists metric_catalog_no_public_access on public.metric_catalog;
create policy metric_catalog_no_public_access
  on public.metric_catalog for all to anon, authenticated
  using (false) with check (false);

drop policy if exists dashboard_snapshot_runs_no_public_access on public.dashboard_snapshot_runs;
create policy dashboard_snapshot_runs_no_public_access
  on public.dashboard_snapshot_runs for all to anon, authenticated
  using (false) with check (false);

create or replace function public.set_market_metric_observation_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- fetched_at is the immutable first successful fetch; last_checked_at may only advance.
  new.fetched_at = coalesce(old.fetched_at, new.fetched_at);
  new.last_checked_at = case
    when old.last_checked_at is null then new.last_checked_at
    when new.last_checked_at is null then old.last_checked_at
    else greatest(old.last_checked_at, new.last_checked_at)
  end;
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_market_metric_observation_updated_at() from public, anon, authenticated;
grant execute on function public.set_market_metric_observation_updated_at() to service_role;

comment on column public.market_metric_observations.fetched_at is
  'Immutable first successful fetch time; preserved by the update trigger.';
comment on column public.market_metric_observations.last_checked_at is
  'Most recent source check time; monotonic under idempotent upsert.';
comment on table public.market_metric_observations is
  'Canonical append-style market facts. Existing rows remain the last-known-good when an upstream adapter fails.';

commit;
