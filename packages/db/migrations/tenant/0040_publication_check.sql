-- A publication's PDF checked by veraPDF against PDF/UA-1, after the publication is recorded (W14.1;
-- ADR-0030, decisions W-B and W-C of the W14 plan). The check is a job of its own, `check_pdf`, queued
-- in the transaction that records the publication, and its verdict is a row of its own here, because
-- `publication_output` is never updated (0017): what veraPDF found joins the publication, it does not
-- change it.
--
-- One row per PDF output, keyed to the output itself, so a check names only a PDF the publication has.
-- Insert-only for the runtime role, and timed by the database, not by its caller: a check is what was
-- found when it was made, never corrected afterwards. A second run of the job finds the row and records
-- nothing. It is deleted only with its publication, which nothing in the product deletes (PUB-047).
create table publication_check (
  publication_id uuid not null references publication on delete cascade,
  format text not null check (format = 'pdf'),
  -- The checker and its own version, read from its report; the profile it was asked to check.
  checker text not null check (checker = 'verapdf'),
  checker_version text not null check (checker_version ~ '^[0-9]+(\.[0-9]+){1,3}$'),
  profile text not null check (profile = 'ua1'),
  compliant boolean not null,
  -- Each rule the PDF failed, as veraPDF numbers it: its clause of ISO 14289-1, its test within the
  -- clause, and what the rule asks for, in veraPDF's words. Bounded: PDF/UA-1's profile has fewer rules
  -- than the bound, so a list longer than it is not a report.
  failed_rules jsonb not null,
  checked_at timestamptz not null default now(),
  primary key (publication_id, format),
  foreign key (publication_id, format)
    references publication_output (publication_id, format) on delete cascade,
  -- A case, not `and`: Postgres need not evaluate `and` in order, and the length of anything but an
  -- array is an error rather than a refusal.
  constraint publication_check_failed_rules check (
    case
      when jsonb_typeof(failed_rules) <> 'array' then false
      else jsonb_array_length(failed_rules) <= 200
        and octet_length(failed_rules::text) <= 262144
        and not jsonb_path_exists(
          failed_rules,
          '$[*] ? (@.type() != "object"
                   || !exists(@.clause) || @.clause.type() != "string"
                   || !exists(@.test) || @.test.type() != "number"
                   || (exists(@.description) && @.description.type() != "string"))'
        )
    end
  ),
  -- A PDF that passed failed nothing.
  constraint publication_check_compliant_without_failures check (
    not compliant or failed_rules = '[]'::jsonb
  )
);

-- Select and insert, and the insert by what was found alone: never the time, which is the database's.
do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on publication_check from %I',
    current_schema()
  );
  execute format(
    'grant insert (publication_id, format, checker, checker_version, profile, compliant, failed_rules) '
    'on publication_check to %I',
    current_schema()
  );
  execute format('grant select on publication_check to %I', current_schema());
end
$$;
