-- Publishing in a language (docs/design/translation.md; the TR plan, TR-I to TR-K; TRb): the language a
-- publish was made in; what each occurrence resolved to - a translation, the source fallen back to, or
-- a translation out of date; and the tenant's policy for both.

set constraints all immediate;

-- Null where a publish was made in its document's own language, as every request before 0160 was.
alter table publication_request add column language text
  check (language is null or char_length(language) between 2 and 35);

-- Null where it resolved as it always has: the component in its own language.
alter table publication_request_occurrence add column translation text
  check (translation is null or translation in ('translated', 'untranslated', 'outOfDate'));

-- The tenant's policy (TR-J; LOC-017, LOC-036, LOC-037): one row, as import_policy is (0157). A
-- missing variant falls back to the source, marked, or refuses the publish; an out-of-date one
-- publishes or refuses. `note` holds the words the mark says, by language.
create table translation_policy (
  singleton boolean primary key default true check (singleton),
  fallback text not null default 'source' check (fallback in ('source', 'refuse')),
  out_of_date text not null default 'publish' check (out_of_date in ('publish', 'refuse')),
  note jsonb not null default '{}'::jsonb check (jsonb_typeof(note) = 'object')
);
insert into translation_policy default values;

do $$
begin
  execute format('grant insert (language) on publication_request to %I', current_schema());
  execute format('grant insert (translation) on publication_request_occurrence to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on translation_policy from %I', current_schema());
  execute format(
    'grant select, update (fallback, out_of_date, note) on translation_policy to %I',
    current_schema()
  );
end
$$;
