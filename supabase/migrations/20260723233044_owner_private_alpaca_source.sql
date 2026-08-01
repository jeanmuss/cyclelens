begin;

update public.metric_catalog
set
  source_policy_ids = array['alpaca'],
  catalog_version = greatest(catalog_version, 3),
  updated_at = now()
where metric_id in (
  'equity.us.qqq.price',
  'equity.us.spy.price',
  'equity.us.dia.price'
);

do $$
begin
  if exists (
    select 1
    from public.metric_catalog
    where metric_id in (
      'equity.us.qqq.price',
      'equity.us.spy.price',
      'equity.us.dia.price'
    )
      and source_policy_ids is distinct from array['alpaca']::text[]
  ) then
    raise exception 'Alpaca source policy migration did not converge';
  end if;
end
$$;

commit;
