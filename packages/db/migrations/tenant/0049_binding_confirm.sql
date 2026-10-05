-- Placing and changing (the B2 plan; docs/design/bindings.md, BI-J): Keep holds the result a binding
-- already held under its changed digest, querying nothing, as a resolution of its own, `confirm`.
-- A confirm holds the version it replaces: it keeps a result, never takes another. The grant is
-- unchanged, and `binding_resolution_accept_replaces` already asks every act but resolve to name
-- what it replaces.
alter table binding_resolution drop constraint binding_resolution_act;
alter table binding_resolution
  add constraint binding_resolution_act check (act in ('resolve', 'accept', 'confirm'));
alter table binding_resolution
  add constraint binding_resolution_confirm_holds
  check (act <> 'confirm' or replaces = dataset_version);
