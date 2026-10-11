-- Baselines (docs/design/baselines.md; the BL plan, BL-B): a named, immutable version of a whole
-- document - everything a publish would read, resolved once and pinned. Every reference is a foreign
-- key refusing the deletion of what it names (VER-022, VER-023), every row is inserted and read and
-- never changed (VER-017), and a baseline's parts are inserted only in the transaction that made it.

create table baseline (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  -- VER-046: 1 to 120 characters, none a control character, nothing before or after, composed (NFC),
  -- unique in its document by its key (domain's `nameKey`), so two names a reader takes for one are one.
  name text not null
    constraint baseline_name check (
      char_length(name) between 1 and 120
      and name !~ '^[[:space:]]' and name !~ '[[:space:]]$'
      and name !~ '[\u0001-\u001f\u007f-\u009f]'
      and name is nfc normalized
    ),
  name_key text not null constraint baseline_name_key check (char_length(name_key) >= 1),
  document_version_id uuid not null,
  made_by uuid not null references principal on delete restrict,
  made_at timestamptz not null default now(),
  -- The transaction that made it, so its parts can be held to it below. Never the caller's to name.
  made_tx bigint not null default txid_current(),
  -- The lifecycle gate it was made at (VER-021): none until LIF has gates to name, which widens this.
  gate text constraint baseline_gate check (gate is null),
  layout_id uuid not null,
  layout_version_id uuid not null,
  layout_kind text not null default 'layout' check (layout_kind = 'layout'),
  theme_id uuid not null,
  theme_version_id uuid not null,
  theme_kind text not null default 'theme' check (theme_kind = 'theme'),
  template_id uuid,
  template_version_id uuid,
  template_kind text not null default 'template' check (template_kind = 'template'),
  -- VER-043: SHA-256 over `baselineDigestInput` of everything pinned.
  digest text not null constraint baseline_digest check (digest ~ '^[0-9a-f]{64}$'),
  constraint baseline_template_whole check ((template_id is null) = (template_version_id is null)),
  unique (document_id, name_key),
  unique (id, document_id),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict,
  foreign key (document_version_id, document_id, document_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  foreign key (layout_version_id, layout_id, layout_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  foreign key (theme_version_id, theme_id, theme_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  foreign key (template_version_id, template_id, template_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index baseline_document on baseline (document_id, made_at desc, id);

-- Every component version the baseline's occurrences take, by node, and every asset version its images
-- place, by none: the kind held by the key, so a node's pin is a component's and an image's an asset's.
create table baseline_pin (
  baseline_id uuid not null references baseline on delete restrict,
  node text constraint baseline_pin_node check (node ~ '^[a-z2-7]{26}$'),
  version_id uuid not null,
  artifact_id uuid not null,
  kind text not null
    constraint baseline_pin_kind check (
      (node is not null and kind = 'component') or (node is null and kind = 'asset')
    ),
  foreign key (version_id, artifact_id, kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create unique index baseline_pin_occurrence on baseline_pin (baseline_id, node)
  where node is not null;
create unique index baseline_pin_asset on baseline_pin (baseline_id, version_id) where node is null;

-- DAT-038: every binding the pinned components hold, in either mode, by the dataset version its
-- latest resolution held when the baseline was made, and the dataset's name then, which provenance
-- prints: a name changed later changes nothing a baseline publishes.
create table baseline_binding (
  baseline_id uuid not null references baseline on delete restrict,
  node text not null constraint baseline_binding_node check (node ~ '^[a-z2-7]{26}$'),
  binding text not null
    constraint baseline_binding_binding check (char_length(binding) >= 1 and binding is nfc normalized),
  digest text not null constraint baseline_binding_digest check (digest ~ '^[0-9a-f]{64}$'),
  resolution bigint not null references binding_resolution (id) on delete restrict,
  dataset_version uuid not null,
  dataset_id uuid not null,
  dataset_kind text not null default 'dataset' check (dataset_kind = 'dataset'),
  -- None where the dataset was never named, as provenance prints it.
  dataset_name text
    constraint baseline_binding_dataset_name check (
      char_length(dataset_name) between 1 and 200 and dataset_name is nfc normalized
    ),
  primary key (baseline_id, node, binding),
  foreign key (dataset_version, dataset_id, dataset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

-- VER-049: superseded once, by a later baseline of the same document, never itself; who and when. A
-- superseded baseline is kept, read and published as before.
create table baseline_supersession (
  baseline_id uuid primary key,
  document_id uuid not null,
  superseded_by uuid not null,
  superseded_by_principal uuid not null references principal on delete restrict,
  superseded_at timestamptz not null default now(),
  constraint baseline_supersession_not_itself check (baseline_id <> superseded_by),
  foreign key (baseline_id, document_id) references baseline (id, document_id) on delete restrict,
  foreign key (superseded_by, document_id) references baseline (id, document_id) on delete restrict
);

-- Inserted and read, never changed: the insert by what the row says, never its time or transaction.
do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on baseline, baseline_pin, baseline_binding, '
    'baseline_supersession from %I',
    current_schema()
  );
  execute format(
    'grant insert (id, document_id, name, name_key, document_version_id, made_by, layout_id, '
    'layout_version_id, theme_id, theme_version_id, template_id, template_version_id, digest) '
    'on baseline to %I',
    current_schema()
  );
  execute format('grant insert on baseline_pin, baseline_binding to %I', current_schema());
  execute format(
    'grant insert (baseline_id, document_id, superseded_by, superseded_by_principal) '
    'on baseline_supersession to %I',
    current_schema()
  );
  execute format(
    'grant select on baseline, baseline_pin, baseline_binding, baseline_supersession to %I',
    current_schema()
  );
end
$$;

-- A baseline's parts are recorded in the transaction that made it: one added later would say it
-- pinned what it never did. Qualified by the table's own schema, as access_changed (0010) is.
create function baseline_part_with_its_baseline() returns trigger
language plpgsql as $$
declare
  same boolean;
begin
  execute format(
    'select exists (select 1 from %I.baseline where id = $1 and made_tx = txid_current())',
    tg_table_schema
  ) into same using new.baseline_id;
  if not same then
    raise exception '%: a baseline''s parts are recorded only in the transaction that made it',
      tg_table_name;
  end if;
  return new;
end
$$;

create trigger baseline_pin_with_its_baseline before insert on baseline_pin
  for each row execute function baseline_part_with_its_baseline();
create trigger baseline_binding_with_its_baseline before insert on baseline_binding
  for each row execute function baseline_part_with_its_baseline();

-- Superseded by a later one only (BL-E), so supersession has no cycles.
create function baseline_superseded_by_a_later() returns trigger
language plpgsql as $$
declare
  later boolean;
begin
  execute format(
    'select (select made_at from %1$I.baseline where id = $2) > '
    '(select made_at from %1$I.baseline where id = $1)',
    tg_table_schema
  ) into later using new.baseline_id, new.superseded_by;
  if later is not true then
    raise exception 'baseline_supersession: a baseline is superseded only by a later one';
  end if;
  return new;
end
$$;

create trigger baseline_superseded_by_a_later before insert on baseline_supersession
  for each row execute function baseline_superseded_by_a_later();
