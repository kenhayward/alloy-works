-- What the objectives are measured from (diagnostics.md; the DG plan, pre-flight 1 and 2; ADR-0101).

-- Each minute the worker probed the service's /health, which reads the database: up if any probe in it
-- was. A minute nobody recorded counts as down, so a dead service or worker is never measured as up.
create table service_probe (
  minute timestamptz primary key check (date_trunc('minute', minute) = minute),
  up boolean not null
);
grant select, insert, update, delete on service_probe to aw_worker;

-- Each backup and restore drill of a class, written by deploy/internet's backup.sh and restore-drill.sh
-- as the cluster's owner. Elsewhere backups are the operator's own, and nothing is recorded.
create table backup_run (
  id bigint generated always as identity primary key,
  class text not null check (class in ('databases', 'objects')),
  act text not null check (act in ('backup', 'drill')),
  started_at timestamptz not null,
  finished_at timestamptz not null check (finished_at >= started_at),
  outcome text not null check (outcome in ('succeeded', 'failed'))
);
create index backup_run_latest on backup_run (class, act, started_at desc);

-- The minutes probed and up since `since`, and the first ever probed: the deployment's, the same for
-- every environment, which reads it through this definer and never the table.
create function service_availability(since timestamptz)
  returns table (first_probe timestamptz, probed bigint, up bigint)
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select (select min(minute) from service_probe),
         count(*),
         count(*) filter (where service_probe.up)
    from service_probe
   where minute >= since
$$;

revoke all on function service_availability(timestamptz) from public;
grant execute on function service_availability(timestamptz) to aw_tenant;

-- The latest run of each class and act, and when one last succeeded.
create function backup_record()
  returns table (
    class text,
    act text,
    last_started_at timestamptz,
    last_seconds double precision,
    last_outcome text,
    succeeded_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select distinct on (run.class, run.act)
         run.class, run.act, run.started_at,
         extract(epoch from run.finished_at - run.started_at)::double precision,
         run.outcome,
         (select max(done.finished_at) from backup_run done
           where done.class = run.class and done.act = run.act and done.outcome = 'succeeded')
    from backup_run run
   order by run.class, run.act, run.started_at desc
$$;

revoke all on function backup_record() from public;
grant execute on function backup_record() to aw_tenant;
