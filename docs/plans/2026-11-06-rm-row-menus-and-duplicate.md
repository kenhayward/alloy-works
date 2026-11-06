# Row menus and Duplicate (RM)

One PR, as Ken asked: CI's speed outweighs the size. Documents comes before Components in the rail; every
row of Documents, Components and Templates gets a More actions menu; and each can be duplicated.

## Calls

Ken's, on the assessment:

- **RM-A** a row's menu is the menu bar's `Flyout`, `under` its button (ADR-0049's More actions, with
  submenus), named "More actions for {title}". Not a hamburger.
- **RM-B** it reads the item (`GET /v1/{documents,components,templates}/{id}`) when it opens: permissions and
  standing in one answer, no contract change. What cannot apply stays, `aria-disabled`, as the open page's.
- **RM-C** Lifecycle is a flyout of `useLifecycleActs`: the workflow's own names, approvals, Return, reasons,
  and `askFirst` (REL-024) where the component page passes it. No Promote or Demote.
- **RM-D** Publish opens a dialog holding `Publishing`, Preview beside it. Copy link copies the deep link
  (STR-044). Sharing outside the tenant stays on publications.
- **RM-E** the menus. Documents: Open, Publish, Copy link, Lifecycle, Relationships, Duplicate; Manage
  access, Move, Hold, Archive or Unarchive, Delete. Components: Open, Copy link, Lifecycle, Used in,
  Relationships, Duplicate; the same five. Templates: Generate documents (still a row button too),
  Relationships, Manage access, Duplicate. Templates gain no lifecycle, archive or delete: that is a
  contract of its own.
- **RM-F** Duplicate asks a title and a space (the original's, or any the caller may create in); a title in
  use there is warned of, not refused, since titles are unique nowhere.
- **RM-G** a document's copy offers three: reuse every component; copy only its own (the default); copy
  every one. "Its own" is a component placed in no other document.
- **RM-H** at once, one transaction, at most `COPY_MAX` (200, as `PLACE_MAX`) components copied. The dialog
  says how many first (REU-046), then stays modal with a progress bar until answered.

Mine, from the storage map:

- **RM-I** the copy keeps the outline's node ids. They are unique within an outline only (STR-003), and every
  table keys a node by its document too, so `node` cross-references and section titles resolve in the copy
  unchanged. Sections are still the copy's own (STR-004).
- **RM-J** a copied component is copied at the version the document shows (pinned, latest or approved),
  its type and values with it, and starts the workflow's first state. A reference to it keeps `pinned` (to
  the copy's version) or `latest`; `approved` becomes `latest`, since nothing of the copy is approved yet,
  and the report says so. `component` cross-references between copied components are remapped.
- **RM-K** the copy carries the template, parameters, values, language and profile; not versions, dates,
  baselines, comments, publications, bindings' resolutions (resolved afresh) or grants. A reference the
  caller cannot read refuses a copy of it (`copy_unreadable`, counted); reusing it is as the original was.
- **RM-L** a component's copy is its latest version under the new title; a template's, its definition under
  the new name.
- **RM-M** each copy is audited as `content.copied`, from and to (LIF-063), beside the version cut.

## Interfaces

- `packages/domain/src/structure/copy.ts`: `copyOutline(outline, title, replaced)`, pure: the copy's
  outline, references repointed and modes as RM-J. `COPY_MAX`.
- `packages/db/src/copies.ts`: `previewDocumentCopy`, `copyDocument`, `copyComponent`, `copyTemplate`,
  each through `createArtifact`; a migration adding `content.copied`.
- Contract: `GET /v1/documents/{id}/copies?space&title&components` (counts, title in use), `POST
/v1/documents/{id}/copies`, `POST /v1/components/{id}/copies`, `POST /v1/templates/{id}/copies`.
  Read on the original, `create` (`design` for a template) on the space. `copy_too_large`,
  `copy_unreadable`.
- `apps/web/src/listing/RowMenu.tsx`: `ContentRowMenu` by kind; `DuplicateDialog`.

## Tests

Domain: ids kept; repointing; `approved` to `latest`; remapped `component` targets; the cap.
Routes: each copy, permission refused, unreadable refused, too large refused, title-in-use answered, the audit
event, cross-tenant refused. Web: each menu's rows by kind and permission, an Administrator's, the lifecycle
flyout, Copy link, Publish, the dialog's three choices, warning and progress. Browser: the walks over a row
menu and the dialog.

## Docs

Two requirements (row acts, SCH; duplicate, STR), filed as issues; an ADR for RM-A, RM-B and RM-I;
`features.md`, `README.md`, the structure design's copy paragraph; `openapi.json` and the client; one
fragment.
