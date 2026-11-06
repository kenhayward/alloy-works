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

Mine, from the storage map, and as the pre-flight changed them:

- **RM-I** the copy keeps the outline's node ids. They are unique within an outline only (STR-003), and every
  table keys a node by its document too, so `node` cross-references and section titles resolve in the copy
  unchanged. Sections are still the copy's own (STR-004).
- **RM-J** a copied component is copied at the version the document shows, its type, values (checked with
  the original's as `previous`) and scope with it, and starts the workflow's first state. Placed twice at
  different versions, the newest shown wins, reported. A reference to a copy keeps `pinned` (to the copy's
  version) or `latest`; `approved` becomes `latest`, reported. `component` cross-references between copies
  are remapped. An override is repointed to the copy's version where its block is unchanged there, else
  dropped and counted. Its lines and translations are not copied, and are counted.
- **RM-K** never copied, under any choice, and reused instead: a reference the template requires (`origin`),
  a deleted or archived component. A reference the caller cannot read refuses a copy of it
  (`copy_unreadable`, counted); reusing it is as the original was.
- **RM-L** the copy carries the template at its effective version (the latest move; `indexTemplateOf` after),
  section waivers, parameters, values, language, profile and scope; each bound part's latest resolution, as a
  `resolve` by the copier, with the revisions standing on it, never resolved afresh. Not versions, dates,
  baselines, comments, publications or grants.
- **RM-M** a component's copy is its latest version under the new title; a template's, its definition under the
  new name, made through `createTemplate`'s resolution (`template_unresolved`).
- **RM-N** audited as `artifact.copied`, beside `artifact.moved`, the copy its subject and `{from}` its detail;
  a migration re-adds `audit_event_kind`; a LIF row adds it to LIF-067's list (LIF-063). Not a webhook type:
  the copy's first version cut announces it.
- **RM-O** into another space, the preview says what moving would cost there (the moving consequences).
- **RM-P** `SpaceList` gains `mayDesign`, so a template's copy may go to any space the caller may design in.
- **RM-Q** one menu a row, each mounting its acts' dialogs (no host a listing): cheap, and tested.

## Interfaces

- `packages/domain/src/structure/copy.ts`: `copyOutline(outline, replaced)`, pure: the copy's outline,
  references repointed, modes and overrides as RM-J, and what it changed counted. `COPY_MAX` (200).
- `packages/db/src/copies.ts`: `previewCopy`, `copyDocument`, `copyComponent`, `copyTemplate`, each through
  `createArtifact`; a migration adding `artifact.copied`.
- Contract, as moving's: `POST /v1/artifacts/{id}/copy/preview` and `POST /v1/artifacts/{id}/copy`, body
  `{to, title, components?: 'reuse' | 'own' | 'all'}`. `read` on the artifact; `create` (`design` for a
  template) at `to`, checked in the handler. 403, 404, 409 `space_archived`, 400 `copy_too_large`,
  `copy_unreadable`, `template_unresolved`. The preview answers counts, the title in use and moving's costs.
- `apps/web/src/listing/ContentRowMenu.tsx`; `apps/web/src/listing/DuplicateDialog.tsx`.

## Tests

Domain: ids kept; repointing; `approved` to `latest`; remapped `component` targets; the cap.
Routes: each copy, permission refused, unreadable refused, too large refused, title-in-use answered, the audit
event, cross-tenant refused. Web: each menu's rows by kind and permission, an Administrator's, the lifecycle
flyout, Copy link, Publish, the dialog's three choices, warning and progress. Browser: the walks over a row
menu and the dialog.

## Docs

SCH-075 and REU-056 to REU-058 (issues #1015, #1016), and the LIF row; an ADR for RM-A, RM-B and RM-I;
`features.md`, `README.md`, the structure design's copy paragraph; `openapi.json` and the client; one
fragment.
