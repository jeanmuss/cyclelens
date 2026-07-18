begin;

update public.metric_catalog
set
  source_policy_ids = array['strategy-disclosures'],
  catalog_version = greatest(catalog_version, 2),
  updated_at = now()
where metric_id = 'treasury.mstr.btc_holdings';

commit;
