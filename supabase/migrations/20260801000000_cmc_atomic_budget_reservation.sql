begin;

-- A GitHub job may be retried after the HTTP response is lost. Keep one
-- owner-private CMC reservation per durable run id so that retrying the RPC
-- cannot silently reserve (and then spend) the same provider credits twice.
create unique index if not exists dashboard_snapshot_runs_cmc_owner_run_id_uq
  on public.dashboard_snapshot_runs ((details ->> 'runId'))
  where projection_id = 'cmc-provider-state'
    and details ->> 'dataUseScope' = 'owner_private'
    and nullif(btrim(details ->> 'runId'), '') is not null;

create or replace function public.reserve_cmc_provider_credits(
  p_run_id text,
  p_reserved_credits integer,
  p_daily_credit_budget integer,
  p_monthly_credit_budget integer,
  p_request_ids jsonb,
  p_current_due boolean,
  p_history_due boolean
)
returns table (
  reservation_id bigint,
  reservation_created boolean,
  reservation_started_at timestamptz,
  reservation_details jsonb
)
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_utc_day text;
  v_utc_month text;
  v_daily_charged numeric := 0;
  v_monthly_charged numeric := 0;
  v_invalid_reservations bigint := 0;
  v_existing_id bigint;
  v_existing_status text;
  v_existing_started_at timestamptz;
  v_existing_details jsonb;
  v_new_id bigint;
  v_new_started_at timestamptz;
  v_new_details jsonb;
begin
  if p_run_id is null
    or p_run_id <> btrim(p_run_id)
    or length(p_run_id) < 1
    or length(p_run_id) > 100 then
    raise exception using errcode = '22023', message = 'cmc_reservation_run_id_invalid';
  end if;
  if p_reserved_credits is null or p_reserved_credits < 1
    or p_daily_credit_budget is null or p_daily_credit_budget < 1
    or p_monthly_credit_budget is null or p_monthly_credit_budget < 1
    or p_daily_credit_budget > p_monthly_credit_budget
    or p_reserved_credits > p_daily_credit_budget
    or p_reserved_credits > p_monthly_credit_budget then
    raise exception using errcode = '22023', message = 'cmc_reservation_budget_invalid';
  end if;
  if p_request_ids is null or jsonb_typeof(p_request_ids) <> 'array' then
    raise exception using errcode = '22023', message = 'cmc_reservation_plan_invalid';
  end if;
  if jsonb_array_length(p_request_ids) < 1
    or jsonb_array_length(p_request_ids) > 16
    or exists (
      select 1
      from jsonb_array_elements(p_request_ids) as request(value)
      where jsonb_typeof(request.value) <> 'string'
        or length(btrim(request.value #>> '{}')) < 1
        or length(request.value #>> '{}') > 100
    ) then
    raise exception using errcode = '22023', message = 'cmc_reservation_plan_invalid';
  end if;
  if p_current_due is null or p_history_due is null then
    raise exception using errcode = '22023', message = 'cmc_reservation_plan_invalid';
  end if;

  -- One database-wide transaction lock serializes the ledger calculation and
  -- insertion. The partial unique index remains a second idempotency barrier.
  perform pg_catalog.pg_advisory_xact_lock(1129270604, 20260801);

  select run.id, run.status, run.started_at, run.details
    into v_existing_id, v_existing_status, v_existing_started_at, v_existing_details
  from public.dashboard_snapshot_runs as run
  where run.projection_id = 'cmc-provider-state'
    and run.details ->> 'dataUseScope' = 'owner_private'
    and run.details ->> 'runId' = p_run_id
  limit 1;

  if found then
    if not coalesce((
      v_existing_status = 'started'
      and v_existing_details #>> '{reservation,creditsReserved}' = p_reserved_credits::text
      and v_existing_details #>> '{reservation,dailyCreditBudget}' = p_daily_credit_budget::text
      and v_existing_details #>> '{reservation,monthlyCreditBudget}' = p_monthly_credit_budget::text
      and v_existing_details #> '{plan,requestIds}' = p_request_ids
      and v_existing_details #>> '{plan,currentDue}' = p_current_due::text
      and v_existing_details #>> '{plan,historyDue}' = p_history_due::text
    ), false) then
      raise exception using errcode = '23505', message = 'cmc_reservation_run_id_conflict';
    end if;

    -- The caller treats created=false as ambiguous and must not contact CMC.
    return query
      select v_existing_id, false, v_existing_started_at, v_existing_details;
    return;
  end if;

  v_day_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  v_day_end := v_day_start + interval '1 day';
  v_month_start := date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';
  v_month_end := v_month_start + interval '1 month';
  v_utc_day := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD');
  v_utc_month := to_char(v_now at time zone 'UTC', 'YYYY-MM');

  -- A reservation without a trustworthy non-negative integer charge makes the
  -- ledger unknowable. Refuse new provider traffic instead of undercounting it.
  select count(*)
    into v_invalid_reservations
  from public.dashboard_snapshot_runs as run
  where run.projection_id = 'cmc-provider-state'
    and run.details ->> 'dataUseScope' = 'owner_private'
    and run.status in ('started', 'completed', 'failed')
    and run.started_at >= v_month_start
    and run.started_at < v_month_end
    and not coalesce(case
      when jsonb_typeof(run.details #> '{reservation,creditsReserved}') = 'number'
        and run.details #>> '{reservation,creditsReserved}' ~ '^(0|[1-9][0-9]*)$'
      then (run.details #>> '{reservation,creditsReserved}')::numeric <= 9007199254740991
      else false
    end, false);

  if v_invalid_reservations <> 0 then
    raise exception using errcode = '22023', message = 'cmc_budget_ledger_invalid';
  end if;

  with ledger as (
    select
      run.started_at,
      run.status,
      (run.details #>> '{reservation,creditsReserved}')::numeric as reserved,
      case
        when jsonb_typeof(run.details #> '{result,creditCount}') = 'number'
          and run.details #>> '{result,creditCount}' ~ '^(0|[1-9][0-9]*)$'
        then case
          when (run.details #>> '{result,creditCount}')::numeric <= 9007199254740991
          then (run.details #>> '{result,creditCount}')::numeric
          else null
        end
        else null
      end as actual
    from public.dashboard_snapshot_runs as run
    where run.projection_id = 'cmc-provider-state'
      and run.details ->> 'dataUseScope' = 'owner_private'
      and run.status in ('started', 'completed', 'failed')
      and run.started_at >= v_month_start
      and run.started_at < v_month_end
  ), charged as (
    select
      started_at,
      case
        when status = 'completed' then coalesce(actual, reserved)
        else greatest(reserved, coalesce(actual, 0))
      end as credits
    from ledger
  )
  select
    coalesce(sum(credits) filter (
      where started_at >= v_day_start and started_at < v_day_end
    ), 0),
    coalesce(sum(credits), 0)
    into v_daily_charged, v_monthly_charged
  from charged;

  if v_daily_charged + p_reserved_credits > p_daily_credit_budget then
    raise exception using errcode = '22023', message = 'cmc_daily_budget_exceeded';
  end if;
  if v_monthly_charged + p_reserved_credits > p_monthly_credit_budget then
    raise exception using errcode = '22023', message = 'cmc_monthly_budget_exceeded';
  end if;

  v_new_details := jsonb_build_object(
    'dataUseScope', 'owner_private',
    'runId', p_run_id,
    'startedAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reservation', jsonb_build_object(
      'utcDay', v_utc_day,
      'utcMonth', v_utc_month,
      'creditsReserved', p_reserved_credits,
      'dailyCreditBudget', p_daily_credit_budget,
      'monthlyCreditBudget', p_monthly_credit_budget
    ),
    'plan', jsonb_build_object(
      'requestIds', p_request_ids,
      'currentDue', p_current_due,
      'historyDue', p_history_due
    )
  );

  insert into public.dashboard_snapshot_runs (
    projection_id,
    status,
    catalog_version,
    observation_count,
    started_at,
    details
  ) values (
    'cmc-provider-state',
    'started',
    1,
    0,
    v_now,
    v_new_details
  )
  returning id, started_at, details
    into v_new_id, v_new_started_at, v_new_details;

  return query
    select v_new_id, true, v_new_started_at, v_new_details;
end;
$$;

revoke all on function public.reserve_cmc_provider_credits(
  text, integer, integer, integer, jsonb, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_cmc_provider_credits(
  text, integer, integer, integer, jsonb, boolean, boolean
) to service_role;

commit;
