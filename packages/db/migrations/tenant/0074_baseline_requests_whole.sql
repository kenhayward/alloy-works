-- A baseline's request whole (the BL final review, findings 2 and 3): 0073 holds a request made from a
-- baseline to its pins when the transaction that made it commits, and a part added later would carry
-- into a publication marked `baseline` what the baseline never pinned. So a request records the
-- transaction that made it, and a part of one made from a baseline is refused outside it. And only a
-- publish names a baseline: a preview is of the document as it is.

alter table publication_request
  add column made_tx bigint not null default txid_current(),
  add constraint publication_request_baseline_publish check (baseline_id is null or kind = 'publish');

create function publication_request_part_with_its_baseline_request() returns trigger
language plpgsql as $$
declare
  outside boolean;
begin
  execute format(
    'select exists (select 1 from %I.publication_request where id = $1 '
    'and baseline_id is not null and made_tx <> txid_current())',
    tg_table_schema
  ) into outside using new.request_id;
  if outside then
    raise exception
      '%: a part of a request made from a baseline is recorded only in the transaction that asked for it',
      tg_table_name;
  end if;
  return new;
end
$$;

create trigger publication_request_occurrence_with_its_baseline_request
  before insert on publication_request_occurrence
  for each row execute function publication_request_part_with_its_baseline_request();
create trigger publication_request_asset_with_its_baseline_request
  before insert on publication_request_asset
  for each row execute function publication_request_part_with_its_baseline_request();
create trigger publication_request_binding_with_its_baseline_request
  before insert on publication_request_binding
  for each row execute function publication_request_part_with_its_baseline_request();
