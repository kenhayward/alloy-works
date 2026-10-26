-- A person's interface language (docs/plans/2026-10-26-ui-interface-localisation.md, UI-E; LOC-005):
-- one of the declared tags the domain checks, or null for their browser's. A principal is a tenant's,
-- so a person in two environments chooses in each. Never the content's language.

alter table principal add column interface_language text
  check (interface_language is null or char_length(interface_language) between 2 and 35);

do $$
begin
  execute format('grant update (interface_language) on principal to %I', current_schema());
end
$$;
