-- A tenant's reference sources (the XR plan, XR-C; docs/design/reference-sources.md): a row for each
-- source an administrator has switched, none for one left as it came, which is on. A source is one of
-- domain's declared list (`REFERENCE_SOURCES`); an extension's (XRd) widens the check then.
create table reference_source_policy (
  source text primary key constraint reference_source_policy_source check (source in ('crossref', 'pubmed')),
  enabled boolean not null
);

do $$
begin
  execute format('revoke insert, update, delete, truncate on reference_source_policy from %I', current_schema());
  execute format('grant select, insert (source, enabled), update (enabled) on reference_source_policy to %I', current_schema());
end
$$;
