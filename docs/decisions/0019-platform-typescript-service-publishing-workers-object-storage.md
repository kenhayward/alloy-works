# 0019 - The platform: a TypeScript service, publishing workers, object storage

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

The decisions so far say what each subsystem does and where its data lives: Postgres, one schema
per tenant ([ADR-0008](0008-schema-per-tenant-isolation.md)), holding the version chain
([ADR-0012](0012-relational-version-chain-hashed-content.md)), search
([ADR-0016](0016-search-in-postgres-behind-one-interface.md)), relationships
([ADR-0017](0017-relationships-in-postgres-traversed-by-recursive-sql.md)) and the realtime fan-out
([ADR-0018](0018-realtime-one-push-channel-postgres-fan-out.md)); Typst rendering PDF from data
([ADR-0013](0013-typst-rendering-resolved-data-through-a-fixed-template.md)); our own Word writer
([ADR-0015](0015-word-output-our-own-writer-reflowable.md)). Scope §9 decision 2 makes a web service
the system of record. No record says what that service is written in, where the heavy work of
publishing runs, or where binary files are kept - and those three decide the shape of the system
diagram.

What already existed pointed one way. The domain rules - the content schema draft, the theme
resolver, the Word writer - are platform-free TypeScript in `packages/domain`, written so that
something other than the renderer could import them. The realtime spike's instances ran on Node. The
publishing spike drove Typst as a command-line binary, previews included, through `typst watch`.

The alternatives weighed were Go or the JVM for the service, which would mean writing the domain
rules twice or sharing them through WebAssembly; rendering inside the service process, which puts a
300-page publish in contention with every editor on the same instance; a separate queue broker, the
trade the search, relationship and realtime decisions each declined; and binaries kept in Postgres or
on a mounted volume. For a store bundled with small installations, MinIO was the obvious name and was
rejected: its community edition stopped publishing images in October 2025 and its repository was
archived in 2026, so shipping it would mean shipping an unpatched component.

## Decision

**The service is TypeScript on Node LTS. Publishing runs in separate workers, fed by a queue in
Postgres, invoking a pinned Typst binary. Binary files live in S3-compatible object storage, with
SeaweedFS bundled for development and small installations.**

- **One language from renderer to worker.** The service and the workers import `packages/domain`
  directly, so a rule - what a valid component is, how a theme resolves, how a run is written for
  Word - has one implementation, and the renderer and the service cannot disagree about it. The only
  parts not in TypeScript are Postgres, the Typst binary and the object store.
- **Publishing is a job.** A request to publish inserts a row into one queue table in a shared
  platform schema - tenant, kind and ids, never content - and workers, the same codebase with a
  different entry point, claim jobs with `FOR UPDATE SKIP LOCKED`. A worker then does the work under
  that tenant's database role, as the service does (ADR-0008): resolves the document, writes the JSON
  for the template and the OOXML parts, runs Typst and stores the outputs. Heavy renders never compete
  with interactive requests, and workers scale on their own.
- **Typst is a pinned binary**, run with no network, only the job's own directory and the fonts the
  baseline pins (ADR-0013, STY-047). Its version is part of the worker image, so the version a
  publication records is the one that produced it.
- **Previews are the same binary kept warm**: `typst watch` for each open document, on a preview
  worker the document stays with, so an edit reuses the layout that did not change - the mechanism the
  publishing spike measured. A preview is a long-lived process, not a queued job.
- **Binaries are objects**, keyed by content hash under a tenant prefix and reached with credentials
  scoped to that tenant: uploaded assets, pinned fonts, and published PDF and Word files. Postgres
  holds their metadata and every reference to them, so the refusal to delete what a baseline needs
  stays a foreign key (VER-023, AST-019); an object is removed only by a sweep that finds no row
  referring to its hash.
- **The product uses a small part of the S3 API** - put, get, head, delete, and signed links for
  downloads - so any S3-compatible store serves, in any cloud or on a customer's own hardware.
- **Development and small installations run from one compose file**: the service, a worker,
  Postgres and SeaweedFS (Apache 2.0), which runs as a single process with its S3 gateway.

## What would change the answer

- **Other heavy work.** Comparing two large baselines, importing a Word document or generating a
  batch of documents may prove as heavy as publishing; each then becomes a job on the same workers,
  not a reason to change the service.
- **A queue that outgrows a table.** Publishing implies jobs a minute, not a second, which a table
  claimed with `SKIP LOCKED` serves easily. Bulk generation at far higher rates would put a broker
  behind the same enqueue interface.
- **The bundled store disappointing.** SeaweedFS is replaceable by any S3-compatible store, which is
  the point of using so little of the API. Garage and RustFS were the other candidates.
- **Typst's command line changing under the pipeline.** Embedding Typst as a library would remove a
  process per render at the cost of another layer to pin; it is the alternative if the binary's
  interface becomes the constraint.

## Consequences

- The proposed system - containers, the flows between them, and what is still open - is drawn in
  [`docs/design/system.md`](../design/system.md), which grows a section as each subsystem's design
  lands. [`docs/architecture.md`](../architecture.md) stays the account of the repository as built.
- A worker and the service share every rule, so the publishing pipeline is tested in the same suites,
  in the same language, as the rules it applies.
- The conformance suite runs its object-storage tests against SeaweedFS and against at least one
  cloud provider's store, so "S3-compatible" is a tested claim rather than a hope.
- Where the system is hosted, and whether customers may host it themselves, is not decided here. It is
  added to scope §10, where it hinges on the first customer's data residency needs (ADM-Q01).
