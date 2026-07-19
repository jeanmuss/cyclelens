begin;

-- Keep the legacy identifier private and inactive so retained observations can
-- satisfy the catalog foreign key without entering new public projections.
insert into public.metric_catalog (
  metric_id,
  title,
  unit,
  cadence,
  source_policy_ids,
  visibility,
  quality_policy,
  default_display,
  projection_ids,
  catalog_version,
  active
) values (
  'equity.JGB10Y.value',
  '{"zh":"日本十年期国债收益率（旧指标 ID）","en":"Japan 10-year government bond yield (legacy metric ID)"}',
  'percent',
  'daily',
  array['japan-mof'],
  'internal',
  '{"missing":"preserve_last_known_good","stale":"show_with_quality_flag","revisions":"retain"}',
  '{"format":"percent","precision":3}',
  '{}'::text[],
  1,
  false
)
on conflict (metric_id) do update set
  title = excluded.title,
  unit = excluded.unit,
  cadence = excluded.cadence,
  source_policy_ids = excluded.source_policy_ids,
  visibility = excluded.visibility,
  quality_policy = excluded.quality_policy,
  default_display = excluded.default_display,
  projection_ids = excluded.projection_ids,
  active = false,
  updated_at = now();

-- Existing projects may retain Supabase's historical automatic grants. The
-- admin Data API is backend-only, so table reachability is opt-in and explicit.
revoke all on table public.manual_macro_events
  from public, anon, authenticated;
revoke all on table public.manual_macro_event_audit
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.manual_macro_events to service_role;
grant select, insert
  on table public.manual_macro_event_audit to service_role;

revoke all on sequence public.manual_macro_event_audit_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.manual_macro_event_audit_id_seq
  to service_role;

revoke all on function public.set_manual_macro_events_updated_at()
  from public, anon, authenticated;
revoke all on function public.log_manual_macro_event_change()
  from public, anon, authenticated;
revoke all on function public.set_market_metric_observation_updated_at()
  from public, anon, authenticated;
revoke all on function public.log_market_metric_observation_revision()
  from public, anon, authenticated;

grant execute on function public.set_manual_macro_events_updated_at()
  to service_role;
grant execute on function public.log_manual_macro_event_change()
  to service_role;
grant execute on function public.set_market_metric_observation_updated_at()
  to service_role;
grant execute on function public.log_market_metric_observation_revision()
  to service_role;

-- Make future postgres-owned objects fail closed until a migration grants the
-- exact backend capability that needs them.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions
  from public, anon, authenticated, service_role;

alter table public.market_metric_observations
  validate constraint market_metric_observations_metric_catalog_fk;

commit;
