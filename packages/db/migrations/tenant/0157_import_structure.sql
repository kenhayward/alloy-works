-- An import's structure (docs/design/import.md; the IM plan, IM-G to IM-J; IMc): its parts' suggested
-- changes and comments, the references outside it and the identities it carries, held with the
-- proposal; the tenant's identity policy; and who each suggestion, thread and comment made at
-- acceptance was attributed to.

-- The tenant's identity policy (IM-I; IMP-010): one row, as editing_policy is (0037). `map` maps an
-- exact email to its member and offers a name match to confirm; `keep` keeps every identity as text;
-- `discard` keeps none.
create table import_policy (
  singleton boolean primary key default true check (singleton),
  policy text not null default 'map' check (policy in ('map', 'keep', 'discard'))
);
insert into import_policy default values;

alter table import
  -- Where each block the reader identified was admitted, so a reference across parts resolves.
  add column anchors jsonb not null default '{}' check (jsonb_typeof(anchors) = 'object'),
  -- Each reference whose bookmark is not in the file (IMP-033), and how its importer resolved it.
  add column outside jsonb not null default '[]' check (jsonb_typeof(outside) = 'array'),
  -- The identities the file carries (IMP-009), and the member each name match was confirmed as.
  add column identities jsonb not null default '[]' check (jsonb_typeof(identities) = 'array'),
  add column confirmed jsonb not null default '{}' check (jsonb_typeof(confirmed) = 'object'),
  -- The file's own properties (IM-J), kept only where the policy keeps identities as text.
  add column properties jsonb check (properties is null or jsonb_typeof(properties) = 'object'),
  -- The policy applied, once, at acceptance (IMP-011, IMP-032).
  add column policy text check (policy is null or policy in ('map', 'keep', 'discard')),
  add constraint import_policy_accepted check (policy is null or state = 'accepted');

-- A part's headings, by the reader's identifiers a reference names them by; each Word author's changes
-- to its blocks; and its comments, each to be a thread.
alter table import_part
  add column headings text[] not null default '{}',
  add column changes jsonb not null default '[]' check (jsonb_typeof(changes) = 'array'),
  add column threads jsonb not null default '[]' check (jsonb_typeof(threads) = 'array');

-- The images an import's job checked and stored, by the placeholder its figures name until acceptance
-- makes each an asset (IM-C). Held here rather than as assets, since a version is never deleted: an
-- abandoned or failed import deletes its rows and each object nothing else holds (IMP-008).
create table import_asset (
  import_id uuid not null references import on delete cascade,
  placeholder uuid not null,
  object_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  format text not null check (format in ('png', 'jpeg')),
  bytes bigint not null check (bytes >= 0),
  header jsonb not null check (jsonb_typeof(header) = 'object'),
  primary key (import_id, placeholder)
);
create index import_asset_object on import_asset (object_key);

-- What each suggestion, thread and reply an import made was attributed to (IMP-011): the policy
-- applied, the Word author as text where it keeps one, and the member it matched. Attribution alone:
-- everything an import makes is made by its importer, since a file's names and emails are its
-- writer's to type. Beside them, since suggestions and threads are insert-only; never changed.
create table import_attribution (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references import,
  suggestion_id uuid references suggestion,
  thread_id uuid references thread,
  comment_id uuid references thread_comment,
  policy text not null check (policy in ('map', 'keep', 'discard')),
  attributed_to text check (attributed_to is null or length(attributed_to) between 1 and 300),
  member uuid references principal,
  constraint import_attribution_one check (num_nonnulls(suggestion_id, thread_id, comment_id) = 1)
);
create index import_attribution_import on import_attribution (import_id);
create unique index import_attribution_suggestion on import_attribution (suggestion_id)
  where suggestion_id is not null;
create unique index import_attribution_thread on import_attribution (thread_id)
  where thread_id is not null;
create unique index import_attribution_comment on import_attribution (comment_id)
  where comment_id is not null;

do $$
begin
  execute format('revoke insert, update, delete, truncate on import_policy from %I', current_schema());
  execute format('grant select, update (policy) on import_policy to %I', current_schema());
  execute format(
    'grant update (anchors, outside, identities, confirmed, properties, policy) on import to %I',
    current_schema()
  );
  execute format(
    'grant insert (headings, changes, threads), update (headings, changes, threads) on import_part to %I',
    current_schema()
  );
  execute format('revoke insert, update, delete, truncate on import_asset from %I', current_schema());
  execute format(
    'grant select, insert (import_id, placeholder, object_key, sha256, format, bytes, header), delete on import_asset to %I',
    current_schema()
  );
  execute format('revoke insert, update, delete, truncate on import_attribution from %I', current_schema());
  execute format(
    'grant select, insert (import_id, suggestion_id, thread_id, comment_id, policy, attributed_to, member) on import_attribution to %I',
    current_schema()
  );
end
$$;
