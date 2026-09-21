# Interface 12: Administration

> **A sketch, by request**, built inline and test first. It is slice 12 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** Administration opens from the account chip as a modal (`Administration.png`), never a
route. Sections are listed on the left and one shows on the right. Only the sections the service can
answer are built:

- **Environment:** its name and its address;
- **Spaces:** each space the reader may read, and whether they may create in it;
- **People and invitations:** everybody who has signed in or been invited, and the invitations still
  waiting;
- **Roles:** each role and what it holds;
- **About:** the version, and the scaffolding's environment panel and delivery line (Q2), which
  leave Home for it.

**Requirements:** none claimed. The access page's IAM tests keep theirs. This reads the same routes
at the environment level.

## Rulings

- **Groups, Component types and Layouts wait.** No route lists groups. Component types are listed
  per space, and there is no tenant-wide list. No route lists layouts. The build order names all
  three.
- **People and roles are read at the environment level** (`level=tenant`), and invitations as they
  are, all to their last page (`everyPage`). A reader who may not administer the environment is
  told `You may not manage access here.`, the access page's sentence, in that section alone. The
  other sections still show.
- **The version** reaches the renderer as `__APP_VERSION__`, defined by Vite from `/version.json`, the
  canonical version, so About cannot drift from it.
- **Administration is offered to everybody signed in.** What each section may show is the service's
  to decide, and it says so section by section.

## Tasks

1. **`admin/Administration.tsx`** and its module: `Administration({ client, about, onClose })`, in the
   `Modal`, with the section list as buttons (`aria-current`) and the chosen section. Tests in
   `Administration.test.tsx`:
   - `opens on Environment, and moves between the sections it can answer`;
   - `lists the spaces, the people and the waiting invitations, and the roles with what each holds`;
   - `says so in the section, and only there, where the reader may not manage the environment`;
   - `says which version this is in About, beside what it is given`.
2. **`Header`** gains `Administration` in the account chip, opening the modal with an `about`
   the header is handed. Test: `opens Administration from the account chip, and closes it`.
3. **`App`** passes the environment panel and the delivery line to the header as `about`, and stops
   showing them under Home. **`vite.config.ts`** defines `__APP_VERSION__`. The App tests move.

## Done when

- Lint, typecheck, format, and the web, trace and desktop suites are clean.
- `trace.json` is regenerated last.
- The modal has been looked at in the running renderer. That view is a proxy.
