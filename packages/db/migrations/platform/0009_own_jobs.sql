-- An environment's own jobs, for its Diagnostics (diagnostics.md; the DG plan, pre-flight 8; ADR-0098).
-- The queue stays closed to a tenant's role, which may only add to it: this definer answers counts by
-- kind and state, times and failure codes, for the tenant whose role is set, and never a job's subject,
-- its arguments or another tenant's.
create function own_jobs(since timestamptz)
  returns table (
    kind text,
    state text,
    jobs bigint,
    first_at timestamptz,
    last_at timestamptz,
    last_error text
  )
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  with mine as (
    select job.kind,
           case when job.failed_at is not null then 'failed'
                when job.finished_at is not null then 'done'
                when job.locked_until > now() then 'running'
                else 'waiting' end as state,
           coalesce(job.failed_at, job.finished_at, job.created_at) as at,
           job.last_error,
           job.id
      from job
      join tenant on tenant.id = job.tenant_id
     where tenant.role_name = current_setting('role', true)
       and (job.created_at >= since or (job.finished_at is null and job.failed_at is null)
            or job.finished_at >= since or job.failed_at >= since)
  )
  select kind, state, count(*), min(at), max(at),
         case when state = 'failed'
              then (array_agg(last_error order by at desc, id desc))[1] end
    from mine
   group by kind, state
   order by kind, state
$$;

revoke all on function own_jobs(timestamptz) from public;
grant execute on function own_jobs(timestamptz) to aw_tenant;
