# Development

## Prerequisites

- **Node 24 or newer.** `.npmrc` sets `engine-strict=true`, so an older Node fails the install
  rather than producing a tree that breaks later.
- **pnpm 9.15** - the version in `packageManager`. `corepack enable` picks it up automatically.

## Getting set up

```bash
pnpm install
```

Always the plain install locally; CI uses `pnpm install --frozen-lockfile`. Never `npm install` or
`yarn` - there is one lock file and it is `pnpm-lock.yaml`.

To see the whole system running, rather than to work on it:

```bash
docker compose -f deploy/compose.yaml up -d --build
```

The `setup` container migrates the database and makes two environments of an invented customer before
the service and worker start. Then `http://dev.acme.localhost:8088/v1/tenant` answers, and
`http://dev.acme.localhost:8088/v1/sign-in/organisation` signs you in. Add `down` in place of `up` to
stop it, and `-v` to throw the data away too. If something else on your machine holds one of its
ports, copy `deploy/.env.example` to `deploy/.env` and change it there: each port moves every address
that names it, the stand-in provider's redirect addresses included.

[`deploy/README.md`](../deploy/README.md) is the rest of it: what each container is for, every
address and password, and how to stop typing `-f deploy/compose.yaml`.

**Working on the code, rather than watching it run, needs only two of those containers**, with the
service and worker run from source, as below.

## The database and the object store

The suites - and the service and the worker - need PostgreSQL 17 with pgvector, and an
S3-compatible object store. Docker runs both:

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
docker compose -f deploy/compose.yaml down   # add -v to throw their data away too
```

The password is a development default for a container bound to `127.0.0.1`, never a credential for
anything deployed. `pnpm test` fails with an instruction to start it when it is not running.

## The service

`apps/service` needs the database prepared once, then runs with reload on save:

```bash
pnpm dev:setup                                    # builds what it imports, then database alloy_dev and a store for each environment
cp deploy/service.env.example deploy/service.env  # development settings; the copy is ignored
pnpm build                                        # the packages the service imports
pnpm --filter @alloy-works/service dev            # http://127.0.0.1:8088
```

The tenant comes from the hostname, so address it as one. `curl` can say it outright:

```bash
curl -H "Host: dev.acme.localhost" http://127.0.0.1:8088/v1/tenant
```

Signing in needs the stand-in provider running beside it, which offers invented people to sign in
as:

```bash
pnpm --filter @alloy-works/stand-in-idp start     # http://127.0.0.1:9090
```

Then open `http://dev.acme.localhost:8088/v1/sign-in/organisation` in a browser, choose someone,
and `http://dev.acme.localhost:8088/v1/me` says who you are. On another port, tell the stand-in
where the service is, since it only returns people to addresses it knows:
`STAND_IN_REDIRECT_URIS=http://dev.acme.localhost:8181/v1/sign-in/organisation/callback`.

`pnpm dev:setup` invites Ada, at `ada@example.com`, to administer each environment, so the first time she
signs in she is Administrator there; nobody else holds a role until something grants one.
`http://dev.acme.localhost:8088/v1/access/explain?principal=<her id from /v1/me>&target=tenant` shows it.

**A database `pnpm dev:setup` prepared before 0.25.0** already holds Ada as a principal, and a sign-in finds
her by that identity, never by an invitation. If she signed in there before, she administers already and
the invitation is refused harmlessly. If she never did, she never becomes Administrator: the invitation
waits for a sign-in that never claims it. Start from a fresh database instead - drop the `alloy_dev`
database, with nothing connected to it, and run `pnpm dev:setup` again, which creates it. An old database also still lists the invitation to
`grace@example.com` that `pnpm dev:setup` used to make, waiting with no expiry and never accepted, since
Grace is a principal already; **Withdraw** it.

To give somebody access before they have ever signed in, invite them. As Ada, open "Install the printer",
choose **Manage access**, and under **Invite someone** enter `ivy@example.com` in **Address** and press
**Invite**. Ivy - whom the stand-in knows and `pnpm dev:setup` does not make - is now offered under **Give
access** as "ivy@example.com, invited and not signed in yet": pick her, a role and where, and **Give**.
Signing in as Ivy, she has it from her first request. **Withdraw** takes back an invitation nobody has
accepted, with everything given to it. Somebody who has signed in already, like Alice, is chosen
directly, and inviting their address is refused. **Remove** takes a grant away again, except the last
grant that lets anyone administer the environment.

It also makes something to edit without creating one by hand: in each environment, a component called
"Install the printer" in General, and Ada, through her invitation, and Grace, made as a principal before
she first signs in, allowed Author on General; Grace makes the grants and the component's versions, since
a principal still waiting on an invitation could be withdrawn. Alice and Ivy are given nothing. Sign in as
Ada, open "Install the printer", type, and **Save version**. To see the lock from the other side, sign in
as Grace in a private window - the stand-in remembers who signed in last in a window - and start typing in
the same component.

**It no longer makes a component type of its own.** Every environment is provisioned with one, called
Topic and assigning no schemas, and declares it the default, so creating always has a type to take; the
seed takes that default like anything else. **A database prepared before 0.26.0** keeps the Topic it
already has, with the author it was made by, and gains only the row declaring it the default - nothing you
had changes, and there is no second type beside it.

To make a component by hand, sign in as Ada and use **New component**, above the list:

1. **Where** offers the spaces you may create in, which is **General** alone. **Component type** already
   shows **Topic**, the environment's default.
2. Type `Replace the toner` in **Title**, leave **Language** at `en-GB` and **Direction** at **Left to
   right**, and press **Create**. The page opens the new component at **Version 0.1 in General**, with one
   empty paragraph in it. Nothing focuses that paragraph yet, so click into it.
3. Type a sentence: the lock is claimed by the first keystroke, not by creating, so the page says **You
   are editing this component.** and then **Saved at** the time.
4. Change **Title** to `Replace the printer toner`. The heading follows as you type and the page saves
   again, because the title is part of the document; `Ctrl+Z` takes it back a character at a time, in the
   same history as the text. Clearing it changes nothing, and leaving the field empty says **A component
   needs a title.** and puts the title back in it - so retyping a title in place says nothing at all;
   typing `english` into **Language** and leaving the field says **A language tag looks like en-GB.**,
   while `pt-BR` is taken as you type it.
5. **Save version**, then **Back to components**: the list shows the new title at version 0.2.

Signed in as Alice, who holds nothing, the list says there is nothing she may read and there is no **New
component** at all. Give her **Reader** on General from **Manage access** and reload: she sees both
components and still has no **New component**, because a Reader may read and not create. Give her
**Author** instead and it appears, offering General.

**A database prepared before 0.27.0** gains migration 0016 the next time `pnpm dev:setup` runs - in
containers, the `setup` container runs it. It widens three checks, so that a document is a kind of
artifact, lives in exactly one space and has an author for every version, and it changes nothing you
had. `pnpm dev:setup` makes no document of its own.

To make a document and build its outline by hand, sign in as Ada and choose **Documents**, beside
**Components** above the list:

1. **New document** offers **General** alone under **Where**, and beneath it the page says **There are
   no documents you may read.**
2. Type `The dosing report` in **Title**, leave **Language** at `en-GB` and **Direction** at **Left to
   right**, and press **Create**. The page opens it: **The dosing report**, **Version 0.1 in General**,
   **Add section**, **Add component** and **Undo**, and **This document has no sections yet.**
3. Press **Add section**, type `Introduction` in **New section title** and press `Enter`: the tree
   shows **Introduction**, selected, and the page says **Added Introduction.** and **Version 0.2 in
   General**. Add `Method` and `Results` the same way, at 0.3 and 0.4. A new section goes after the one
   selected, and the one just added is selected, so they land in that order; with the tree focused,
   `Enter` opens the same field.
4. Click **Method** and press `Alt+Right`: it goes under **Introduction**, and the page says **Moved
   Method under Introduction.** Click **Introduction** and press `Alt+Down`: it moves after **Results**,
   taking **Method** with it - **Moved Introduction after Results.** Press `Ctrl+Z` once: **Introduction**
   goes back to the top with **Method** still beneath it, and the page says **Undone. Moved Introduction
   to the start of the document.** at version 0.7, because an undo is an act, and a version, too.
5. Select **Method** and press **Add component**. **Component** offers the components you may read;
   choose **Install the printer** and press **Add**. It goes after **Method**, under **Introduction**:
   the tree shows **Install the printer, latest**, and the page says **Added Install the printer.**
   Press `Alt+Right` and it goes under **Method**. Select **Results** and add the same component again:
   the same component, twice, each its own row.
6. The second one is selected. Press **Remove component**: the page asks **Remove Install the printer?
   This cannot be undone, and nothing before it can be undone afterwards.** Press **Remove**: **Removed
   Install the printer.**, and **Undo** and `Ctrl+Z` now do nothing, because nothing before a removal
   can be undone.
7. Select **Results** and choose **A new page** under **Starts on**: the page says **Results now starts
   on a new page.**, and its row reads **Results, starts on a new page**. Nothing else changes, because
   nothing publishes yet: the declaration is on the node, not in any content. **Undo** has something to
   undo again.
8. In a private window - the stand-in remembers who signed in last in a window - sign in as **Grace**
   and open **The dosing report** from **Documents**. Select **Method**, change its **Title** to
   `Method and materials` and press `Enter`: **Renamed Method to Method and materials.** Back in Ada's
   window, without reloading, select **Results** and press `Alt+Up`. The page says **Somebody else changed this
   document. This is how it stands now.**, the tree shows **Method and materials**, **Results** has not
   moved, and **Undo** does nothing: undoing Ada's page break now would change an outline she had not
   seen. Her next act is made from the outline Grace left, and is recorded.
9. Close Grace's private window, and in a new one sign in as **Alice**, who holds nothing:
   **Documents** says **There are no documents you may read.** and offers no **New document**. As
   Ada, open "Install the printer", choose **Manage access**, and give Alice **Reader** at **The space
   General**. Reload Alice's page: she sees
   **The dosing report**, and opening it says **You may read this document but not change it.** Her
   outline has no **Add section**, **Add component**, **Undo**, **Title**, **Starts on** or **Remove**;
   the arrow keys move between rows, and `Alt` with the arrows, `Enter` and `Delete` do nothing. **You
   may not change this document.** is what somebody who could edit sees instead, if that is taken away
   while the document is open.
10. Two things only a browser can show, so check them by hand whenever the panel changes. As Ada, who
    left the document for **Manage access** in step 9, go **Back to the component**, then **Back to
    components**, choose **Documents** and open **The dosing report** again from there. Click **Introduction**, a top-level row, and press `Alt+Left`: nothing
    happens, because it has nowhere to be promoted to - and the browser must not go Back, which is what
    `Alt+Left` does on Windows and Linux; if it does, the page leaves the document for the list of
    documents it was opened from. Then select **Method and materials**
    and press `Alt+Left`: **Moved Method and materials to the top level, after Introduction.** And drag
    and drop: drag **Results** onto the **Introduction** row and it becomes Introduction's last child
    (**Moved Results under Introduction.**); drag it again, and **Move to the end of the document**
    appears below the tree - drop it there and it goes back to the end. A thin gap above each row takes
    a drop too, putting the row dragged before it. Each drop is one act, and **Undo** takes it back.

These steps are written from the code and its tests. Step 10's two are the ones no test here can stand
in for: the tests drive the keymap and drag and drop with synthetic events, which a browser's own Back
and its own dragging never see.

**Numbering changes nothing stored**, so a database from before 0.28.0 is numbered as it stands and
needs no step. To see it by hand, carry on as Ada with **The dosing report** as step 10 left it:
**Introduction**, **Method and materials** with **Install the printer** under it, and **Results**.

1. Each row shows its number before its title: `1` **Introduction**, `2` **Method and materials**,
   `2.1` **Install the printer, latest** and `3` **Results, starts on a new page**. The number is
   what the row is described by, not part of its name, so the page's sentences still say
   **Introduction** and not `1 Introduction`.
2. Select **Introduction** and press `Alt+Down`: **Moved Introduction after Method and materials.**,
   and every number changes with it - **Method and materials** `1`, **Install the printer** `1.1`,
   **Introduction** `2`, **Results** `3`. Press `Ctrl+Z`: **Undone. Moved Introduction to the start of
   the document.**, and the numbers go back.
3. Select **Method and materials** and untick **Numbered**: **Method and materials is no longer
   numbered.** It and **Install the printer** lose their numbers, and **Results** becomes `2`, because
   a node left out uses up no number. Select **Install the printer**: its own **Numbered** is still
   ticked, and beside it the page says **Not numbered while Method and materials is not.** Press
   `Ctrl+Z`: **Undone. Method and materials is now numbered.** `Ctrl+Z` undoes from the tree, from
   **Numbered** and **Appendix** and from **Starts on** alike, so it works straight after unticking the
   box too; only a text field, such as **Title**, keeps it as its own undo.
4. Select **Results** and tick **Appendix**: **Results is now an appendix.**, and its number is `A`.
   Click **Results** in the tree and press `Alt+Right`: nothing moves, and the page says **An appendix
   stays at the top level.** Select **Install the printer**: it has a **Numbered** box and no
   **Appendix**, which only a top-level node is offered.
5. Select **Install the printer**, press **Add component**, choose **Replace the printer toner** (made
   under **New component** above) and press **Add**: it goes after **Install the printer** as `2.2`.
   Add it again, from the new row: `2.3`. One component, placed twice, each place with its number.
6. The address bar ends `#/documents/` and the document's id. Open
   `http://dev.acme.localhost:8088/v1/documents/<that id>/numbering` in the same window: the numbering
   of the latest version, with `"scheme": "default/1"`, a `section` entry for each of `1`, `2`, `2.1`,
   `2.2`, `2.3` and `A`, each naming its node, and under `occurrences` the component version each of
   the three component rows resolved to. There is no figure yet, because nothing holds one.
7. **Figure numbers, through the API**, because the editor writes paragraphs alone. Open **Replace the
   printer toner**; the address bar ends `#/components/` and its id. In the browser's console, on that
   page, give it two figures after its paragraph and make a version of that - claiming the lock
   (`move: true` takes it from another window of yours, if one holds it), saving one iteration, and
   **Done editing**'s release, which cuts the version:

   ```js
   const component = '<its id>';
   const json = { 'content-type': 'application/json' };
   const opened = await (await fetch(`/v1/components/${component}`)).json();
   const session = crypto.randomUUID();
   const figure = (id) => ({
     type: 'figure',
     id,
     asset: 'asset',
     imageStyle: 'wide',
     caption: 'A caption',
     alternative: { kind: 'decorative' },
   });
   await fetch(`/v1/components/${component}/lock`, {
     method: 'POST',
     headers: json,
     body: JSON.stringify({ session, move: true }),
   });
   await fetch(`/v1/components/${component}/iterations/${session}/1`, {
     method: 'PUT',
     headers: json,
     body: JSON.stringify({
       openedFrom: opened.version.id,
       content: {
         ...opened.content,
         content: [...opened.content.content, figure('f1'), figure('f2')],
       },
     }),
   });
   await fetch(
     `/v1/components/${component}/lock?session=${session}&openedFrom=${opened.version.id}`,
     { method: 'DELETE' },
   );
   ```

   Open the numbering again: the first place's figures are `Figure 2.1` and `Figure 2.2`, and the
   second's `Figure 2.3` and `Figure 2.4` - one component, numbered once per place - and both
   occurrences name the version just made, while the document's own version is unchanged. From now
   on the editor opens **Replace the printer toner** for reading only, because it holds figures it
   cannot change yet.

8. **A number never says what somebody may not read.** Alice has **Reader** on General from step 9.
   As Ada, open **Replace the printer toner**, choose **Manage access**, and give Alice **Reader** at
   **This component** with **Deny**. Signed in as Alice, open the document's numbering: the section
   entries are the same six, both **Replace the printer toner** occurrences answer `"version": null`,
   and there is no figure at all - nothing says whether it holds any - and its id appears nowhere in
   the answer. Her outline names both rows **A component**, numbered `2.2` and `2.3` like everybody
   else's.

These numbering steps are written from the code and its tests, and were **not** followed in a
browser: the renderer's tests run in jsdom and the route's on the wire. What only a person can check
is that the numbers, the two boxes, the hint and the appendix's refusal look and read right.

**Navigation changes nothing stored either**, so a document from before 0.29.0 has addresses and lists
the moment it opens. To see it by hand, sign in as Ada and open **The dosing report** again from
**Documents**, as step 8 above left it.

1. Select **Install the printer**. Beneath the tree, **Link to Install the printer** shows an address
   ending `#/documents/<the document's id>/nodes/<its id>`, matching the browser's own address bar.
   Press **Copy link**: the page says **Copied the link to Install the printer.**
2. Select **Introduction** and press `Alt+Down`: it moves after **Method and materials**, which
   becomes `1`; **Install the printer**, still its first child, becomes `1.1`. Paste the address
   copied in step 1 into a new tab, signed in to the same environment: the document opens with
   **Install the printer** chosen, focused and marked, now at `1.1` - the address named the node, not
   the position it held.
3. Change one letter of the pasted address's last part and press Enter: the page says **The linked
   part is not in this document.** Reload the tab: the same message shows again, because the address
   keeps what was followed.
4. Beneath the outline, **Figures** lists `Figure 1.1 A caption in Replace the printer toner`,
   `Figure 1.2 A caption in Replace the printer toner`, `Figure 1.3 A caption in Replace the printer
toner` and `Figure 1.4 A caption in Replace the printer toner` - the chapter prefix followed
   **Method and materials** from `2` to `1` at once, before the page heard back from the service.
   Choose a figure's link: the occurrence that holds it is chosen and marked in the tree.
5. Signed in as Alice, denied **Replace the printer toner** in step 8 above, the same document lists
   no figures at all: neither occurrence's caption nor number is hers to see, and nothing says the
   component behind them holds any.

These navigation steps are written from the code and its tests, and were **not** followed in a
browser either: the panel's tests run in jsdom over a fake service, and its timing in Electron's
Chromium against the same fake.

The development environment also takes Google accounts, with the stand-in playing Google and
`signin.localhost:8088` as the one address it returns to. Opening
`http://dev.acme.localhost:8088/v1/sign-in/google` and choosing Ada accepts her invitation through that
route instead, if she has not signed in yet; Grace, a principal already, is signed straight in; Ivy is
admitted once Ada has invited her; and Alice is neither a principal nor invited, so the sign-in address
refuses her. On another port, set `SIGN_IN_HOST` in
`deploy/service.env` and `STAND_IN_GOOGLE_REDIRECT_URI` for the stand-in to match. Like Google, the
stand-in remembers who signed in and does not ask again: restart it to choose someone else.

## Two ways to see the whole thing

**Everything in containers**, which is what CI drives and the nearest thing to a small installation:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

Open `http://dev.acme.localhost:8088`: the page says **Development**, offers **Sign in**, and after
signing in as Ada says who you are. **Make a sample** adds one as `queued`, and it becomes `done` on
its own a second or two later, because the stream said so rather than the page asking again. The
same environment also answers at `http://127.0.0.1:8088`, which is what `tests/e2e` uses.

**The renderer from source**, when you are changing it:

```bash
pnpm --filter @alloy-works/service dev            # http://127.0.0.1:8088
pnpm dev:web                                      # http://dev.acme.localhost:5173
```

The dev server sends everything under `/v1` to the service with the `Host` header as the browser
sent it, so open it at `http://dev.acme.localhost:5173` rather than `localhost:5173`: the
environment is resolved from the address in the bar, exactly as in production, and `localhost` is no
environment.

## The worker

Work a request should not wait for runs in `apps/worker`. It needs the pinned Typst, fetched once
per machine, and the same object store the service signs links against:

```bash
pnpm --filter @alloy-works/worker fetch-typst     # Typst 0.15.1 into .tools/, checked against its hash
cp deploy/worker.env.example deploy/worker.env
pnpm --filter @alloy-works/worker dev
```

With the service signed in to (above), ask for a sample and follow it. The worker picks the job up
within a second or two, and the answer then carries a link that fetches the PDF:

```bash
curl -X POST -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<from the browser>"   http://127.0.0.1:8088/v1/samples
curl -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<the same>"   http://127.0.0.1:8088/v1/samples/<the id>
```

Each environment reaches only its own corner of the store, with a credential `pnpm dev:setup` made
for it, so a link signed for one environment fetches nothing from another.

Browsers resolve any `*.localhost` to this machine too, but to **both** `127.0.0.1` and `::1`, and
the service listens on the IPv4 address only - the same trap the renderer's dev server met. If
anything else on the machine listens on port 8088 over IPv6, a browser can reach that instead. Set
`PORT` in `deploy/service.env` to a free port when that happens.

## Commands

Everything below runs from the repo root.

```bash
pnpm lint          # eslint, flat config at the root, across every workspace
pnpm format        # prettier --check (use `pnpm exec prettier --write .` to fix)
pnpm typecheck     # tsc --noEmit in every workspace
pnpm build         # domain (emits dist/) then the renderer and the shell
pnpm test          # every suite in every workspace, apart from the end-to-end one
pnpm test:e2e      # the whole system, which needs the stack up first
```

`build`, `typecheck` and `test` run through Turborepo, which builds `@alloy-works/domain` first
because the others import its `dist/`. Running a workspace's script directly bypasses that:

```bash
pnpm --filter @alloy-works/domain build   # do this first if you filter to one workspace
pnpm --filter @alloy-works/web test
```

## Running the app

**Web only** - a browser tab, no Electron:

```bash
pnpm dev:web       # http://localhost:5173
```

**Desktop** - builds the domain package, starts the Vite dev server and the Electron shell together:

```bash
pnpm app
```

**Desktop, against an environment** - the window loads the service rather than the dev server, which
is how it signs in
([ADR-0022](decisions/0022-the-desktop-window-loads-the-service.md)):

```bash
ALLOY_SERVICE_URL=http://dev.acme.localhost:8088 pnpm app
```

The shell waits for `127.0.0.1:5173`, then opens a window pointed at the dev server, so editing the
renderer hot-reloads inside the desktop window. It is the same renderer either way - the only thing
that changes is which `PlatformBridge` answers, and the running app tells you which one it got. In
the desktop window it should read **"Running as desktop on Electron _x.y.z_"**; if it says `web`,
the preload failed to load and the renderer fell back to the browser bridge.

Two things worth knowing when it misbehaves:

- **The address is pinned to `127.0.0.1`, not `localhost`.** Node 17+ resolves `localhost` to the
  IPv6 loopback first, and a dev server on `::1` with a shell waiting on `127.0.0.1` hangs forever
  with no error. Vite's `server.host`, the shell's `DEV_SERVER_URL` and the `dev` script all name
  the same literal address, and a test fails if they drift.
- **`strictPort` is on**, so a stale dev server from a previous run makes `pnpm app` fail fast with
  "Port 5173 is already in use" rather than quietly starting on 5174 where the shell will never find
  it. Kill the old process rather than changing the port.

Closing the window ends the session and `pnpm app` exits 0 - `concurrently --success first` takes
its result from whichever half exits first.

## Packaging

```bash
pnpm --filter @alloy-works/desktop package       # installer for the current platform
pnpm --filter @alloy-works/desktop package:dir   # unpacked app only, much faster
```

Output goes to `release/`, which is git-ignored. There is no signing and no release workflow - this
builds an installer you can run locally, and nothing more.

**Test a packaging change by running the packaged app, not just the build.** The dev and packaged
layouts differ in two ways that unit tests cannot see: the renderer is copied in as `renderer/`,
and images are read from outside the asar. A mistake in either shows up only in the installed app -
as a blank window, or as a tray icon that is simply not there.

**On Windows, keep the checkout path short.** NSIS's `makensis.exe` is not long-path aware, and a
deep checkout can take a nested include inside `app-builder-lib` past the 260-character limit; the
error names a file that is present. `.npmrc` caps pnpm's virtual-store names at 50 characters to
buy back room, but a very deep path can still exceed it.

## Adding a workspace

1. Create `apps/<name>` or `packages/<name>` with a `package.json` named `@alloy-works/<name>`,
   `"private": true` and `"version": "0.0.0"` (workspace packages are not individually versioned -
   see [ci-and-releases.md](ci-and-releases.md)).
2. Give it `build`, `typecheck` and `test` scripts. Turborepo picks up any workspace that has them;
   `--if-present` is not needed because the task graph skips what does not exist.
3. Extend `tsconfig.base.json` rather than restating compiler options.
4. Update the workspace table in [architecture.md](architecture.md) in the same PR.
5. **If a container needs it, add its `package.json` to the manifest list in
   [`deploy/Dockerfile`](../deploy/Dockerfile)** and to the install filter beside it. The manifests
   are copied one by one, before the source, so that a source change does not reinstall the world -
   which means a workspace missing from that list is simply absent from the image, and the failure
   is a type error inside the build rather than anything that names the workspace.

## Layout

```
apps/         web, desktop, service, worker
packages/     domain, db, api-contract, api-client, objects, stand-in-idp
tests/        e2e - the whole system, driven over HTTP
deploy/       The Dockerfile, its ignore list, and the compose stack
docs/         This documentation
```

[`README.md`](../README.md) has the same layout with a line about each one, and
[`deploy/README.md`](../deploy/README.md) covers that folder on its own.
