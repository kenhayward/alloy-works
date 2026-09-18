# Alloy Works

A **component content management system** - content authored as small, typed, independently
revisable components that publications assemble rather than own - delivered as **both a web
application and a desktop application**.

> **Status: research, and scaffolding.** One path runs end to end - open an environment, sign in,
> ask for a sample document, watch a worker make it. Beside it, a component can be made and its
> paragraphs edited and versioned, and a document can be made and its outline of sections and
> components restructured, a version at a time, and its sections numbered. Nothing is formatted
> beyond plain paragraphs, cross-referenced or published yet.
> [`docs/features.md`](docs/features.md) is explicit about what does and does not exist.

## What it is for

Reports that combine narrative judgement with live data are produced today by two incompatible
classes of tool, and organisations pay for the gap between them. **Document tools do not understand
data:** a word processor treats a figure as characters, so when the figure changes somebody re-types
it, somebody else re-checks it, and the version that reached the regulator cannot be traced to the
query that produced it. **Data tools do not understand documents:** a BI platform binds a table to a
query flawlessly and then has nothing to say about a 200-page assessment with numbered sections,
cross-references, citations, an approval chain and a legally required accessible PDF. **Neither
understands reuse:** the same methodology statement appears in dozens of reports, is copied, is
corrected in one place, and stays wrong in the rest.

Alloy Works answers all three. Content is authored as small, typed, independently revisable
**components**; documents assemble components rather than owning them. Values, tables and figures
are **bound** to parameterised queries against connected sources, and every bound value carries
provenance back to the query and the moment that produced it. Generative AI participates as a
governed contributor - declared prompts with declared context inside templates, and a tool-enabled
assistant grounded in the tenant's own content beside the author. Publishing produces
submission-grade PDF and Word from the same source. It is web-first and multi-tenant, with a desktop
shell for people who would rather have an application than a browser tab.

The capabilities are individually mature and no product combines them, which is the whole bet:

> **CCMS-grade reuse and lifecycle, plus Workiva-grade live data lineage, plus AI-native authoring,
> in one web-first product.**

Two things are entry requirements rather than differentiators, because a buyer will not consider a
product without them: **published output must be indistinguishable from what the organisation
produces today**, and **review must feel at least as good as a word processor**.

It is deliberately **not** a BI tool, a spreadsheet, a data warehouse, an asset manager, a wiki, a
web publishing channel, an XML editor for arbitrary schemas, or offline-first.
[`docs/specification/Project_Scope.md`](docs/specification/Project_Scope.md) carries the full
argument: the market position, the personas, twenty-two capability areas, the non-goals, the
decisions taken and still open, and the risks. The detailed requirements are in
[`docs/specification/requirements/`](docs/specification/requirements/) - one document per area, all twenty-two written and each reviewed, and the first twenty-one read against each other in a cross-cutting pass. Every one ends with a change history saying what changed and why, and the reviews behind them
are kept in [`docs/reviews/`](docs/reviews/). Each subsystem design in
[`docs/design/`](docs/design/) declares which requirements it answers, so a requirement no design
claims is work not yet designed.

### The order it gets built in

Six tranches, each a usable increment rather than a layer:

| Tranche                    | Contains                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1 - The spine**         | Tenancy, identity, access control, components with immutable versions, documents and outlines, the editor, numbering, tables and figures, styles and themes, templates, metadata and component types, search, PDF and Word publishing, the API |
| **T2 - The data**          | Connections, query definitions, parameters, bindings, provenance, revising a value by hand, tabular presentation                                                                                                                               |
| **T3 - The collaboration** | Presence, locks, threads, suggestions, baselines, comparison, workflow and audit, component lifecycles                                                                                                                                         |
| **T4 - The reuse**         | Transclusion, where-used, variables, conditions and profiling, relationships and graph queries, diverging revisions                                                                                                                            |
| **T5 - The intelligence**  | Template prompts, the assistant and interactive chat, retrieval grounding, AI governance and cost controls                                                                                                                                     |
| **T6 - The interchange**   | Word import, citation styles, external reference sources, translation                                                                                                                                                                          |

T1 alone is a single-author product that already publishes better than a word processor, which is
what makes it a shippable increment rather than a foundation nobody can evaluate - and it is larger
than its name suggests, touching thirteen of the twenty-two areas, because publishing at the fidelity
bar needs themes, templates, assets and tables as well as an editor. **The first pieces of it are built** - tenancy and sign-in, access control, components with immutable versions, a component's paragraphs edited under a lock, and documents whose outlines you restructure and whose sections are numbered - on the scaffolding under them. Cross-references, formatting beyond plain paragraphs, templates, search and publishing are not, and the table below and [`docs/features.md`](docs/features.md) say exactly what is.

## Features

| Feature                      | Description                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An environment you can open  | Sign in, ask for a sample document, and watch it arrive without asking again, in a browser or the desktop app                                                                                                               |
| One renderer, two deliveries | The same React interface is served as a web app and loaded unchanged by the Electron shell                                                                                                                                  |
| Platform bridge              | A single typed seam for everything that differs between a browser tab and a desktop window                                                                                                                                  |
| Content model                | The stored shape of a component's content: blocks, inline content and overlapping annotations, each identified, versioned by schema and checked both ways                                                                   |
| Access                       | Who may do what, decided through roles and grants, which an administrator gives and takes away on a component's Manage access page - to people invited by address before they first sign in, too - with why for each answer |
| Editing a component          | Open a component's paragraphs, edit them under a lock, saved as you type, and make a version with Save version or Done editing                                                                                              |
| Making a component           | Create one in a space you may create in, with a title, a base language and a direction, and change them afterwards above the surface                                                                                        |
| Documents and outlines       | Make a document in a space, build its outline out of sections and components, and restructure it a version at a time. Sections are numbered as you go                                                                       |
| Brand identity               | The Alloy Works mark wired into the favicon, the installed web app, the desktop window, Dock, tray and installer                                                                                                            |

Full prose list: [`docs/features.md`](docs/features.md).

## Getting started

Requires **Node 24+** and **pnpm 9.15** (`corepack enable` picks up the pinned version).

```bash
pnpm install
pnpm test
```

Run the web delivery in a browser:

```bash
pnpm dev:web
```

Run the desktop delivery - dev server and Electron shell together:

```bash
pnpm app
```

Run the whole system in containers - database, object store, sign-in provider, service and worker -
and open `http://dev.acme.localhost:8088`:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

Build a desktop installer for your platform (unsigned, output in `release/`):

```bash
pnpm --filter @alloy-works/desktop package
```

## Layout

```
apps/
  web/        @alloy-works/web      React + TS + Vite. The renderer, and the web app.
  desktop/    @alloy-works/desktop  Electron main + preload. No UI of its own.
  service/    @alloy-works/service  Fastify web service: hostname to tenant, the API contract.
  worker/     @alloy-works/worker   Claims queued jobs and runs them; carries the pinned Typst.
packages/
  domain/     @alloy-works/domain   Content model and rules. No React, no Electron, no fs.
  editor/     @alloy-works/editor   The editor's ProseMirror schema and mapping. Browser code, no React.
  db/         @alloy-works/db       Roles, tenants, migrations, withTenant; the version chain and access;
                                     the editor's lock and iterations.
  api-contract/ @alloy-works/api-contract  Routes as zod schemas; the generated openapi.json.
  api-client/ @alloy-works/api-client  The generated client, and the live stream reader.
  stand-in-idp/ @alloy-works/stand-in-idp  A sign-in provider with invented people, for development.
  objects/    @alloy-works/objects  Object storage: a credential and a prefix per environment.
tests/
  e2e/        @alloy-works/e2e      The whole system in containers, driven over HTTP.
deploy/       The Dockerfile, its ignore list, and the compose stack. See deploy/README.md.
docs/         Architecture, development, testing, CI, decisions, the specification and its reviews.
```

## Documentation

| Document                                           | What it covers                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [docs/guides/](docs/guides/)                       | How to run the traceability tooling and read what it says, for a developer and for an auditor               |
| [docs/architecture.md](docs/architecture.md)       | The repository as built: workspaces, the renderer/shell split, the platform bridge, packaging               |
| [docs/design/](docs/design/)                       | How the product will be built: the system map, then one design per subsystem                                |
| [docs/development.md](docs/development.md)         | Setup, commands, running each delivery                                                                      |
| [deploy/README.md](deploy/README.md)               | The images, the compose stack, configuration, and what is not there yet                                     |
| [docs/testing.md](docs/testing.md)                 | TDD, the suites, the pristine-output gate                                                                   |
| [docs/ci-and-releases.md](docs/ci-and-releases.md) | The pipeline, versioning, the changelog                                                                     |
| [docs/plans/](docs/plans/)                         | Implementation plans, written and committed as each piece is built                                          |
| [docs/decisions/](docs/decisions/)                 | Architecture decision records                                                                               |
| [docs/specification/](docs/specification/)         | What the product is going to be - the scope, the detailed requirements, and the spikes behind the decisions |
| [docs/reviews/](docs/reviews/)                     | The reviews of those requirements, kept as received, and what was done about each                           |
| [CONTRIBUTING.md](CONTRIBUTING.md)                 | How to work on this                                                                                         |

## Platforms

The web delivery targets current browsers. The desktop delivery is built on Electron and is intended
to be first-class on Windows, macOS and Linux. **Only the Windows installer has been built and run**;
the macOS and Linux packaging is configured but untested, nothing is signed or notarised, and there
is no release process.

## Licence

[Apache 2.0](LICENSE).
