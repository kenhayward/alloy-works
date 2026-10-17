-- What a cohort's run does at a failed row (TPL-047; the R20 plan, R20-D): carries on, as every run
-- has, or stops, leaving the rows after it waiting for Rerun.

set constraints all immediate;

alter table cohort add column on_failure text not null default 'continue'
  constraint cohort_on_failure check (on_failure in ('continue', 'stop'));

do $$
begin
  execute format('grant insert (on_failure) on cohort to %I', current_schema());
end
$$;
