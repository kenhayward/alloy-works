-- The translation policy's history (docs/design/translation.md; the TE plan, TE-D; LOC-036): each
-- change's values whole, who and when, inserted only where a value changed and never changed or
-- removed; and the row a publish or a preview in a language was decided under.

set constraints all immediate;

create table translation_policy_change (
  id uuid primary key default gen_random_uuid(),
  fallback text not null check (fallback in ('source', 'refuse')),
  out_of_date text not null check (out_of_date in ('publish', 'refuse')),
  note jsonb not null check (jsonb_typeof(note) = 'object'),
  conflict text not null check (conflict in ('review', 'accept', 'reject')),
  machine text not null check (machine in ('off', 'inside', 'any')),
  -- Nobody for the row this migration inserts.
  by uuid references principal on delete restrict,
  -- The clock, not the transaction's start: changes take turns under the policy's lock, so the later
  -- change is the later row.
  at timestamptz not null default clock_timestamp()
);
create index translation_policy_change_at on translation_policy_change (at desc, id desc);

-- The policy as found, by nobody.
insert into translation_policy_change (fallback, out_of_date, note, conflict, machine)
select fallback, out_of_date, note, conflict, machine from translation_policy;

-- Null for a publish in its document's own language, a baseline's and every request before 0170.
alter table publication_request add column policy_change uuid
  references translation_policy_change on delete restrict;

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on translation_policy_change from %I',
    current_schema()
  );
  execute format(
    'grant select, insert (fallback, out_of_date, note, conflict, machine, by) on translation_policy_change to %I',
    current_schema()
  );
  execute format('grant insert (policy_change) on publication_request to %I', current_schema());
end
$$;
