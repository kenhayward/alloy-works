-- The words a component fallen back to its source is marked with, recorded on its occurrence as the
-- request is made (the TR plan, TR-J; the TR final review): so the job prints what the policy said
-- when the publish was asked for, and a request publishes the same whenever its job runs. Null on an
-- occurrence not fallen back, and on every request before 0162, whose job reads the policy.

alter table publication_request_occurrence add column untranslated text
  check (untranslated is null or char_length(untranslated) between 1 and 200);

do $$
begin
  execute format(
    'grant insert (untranslated) on publication_request_occurrence to %I',
    current_schema()
  );
end
$$;
