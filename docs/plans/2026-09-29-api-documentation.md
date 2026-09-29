# API documentation

> **A test-first implementation plan** for API-062, from
> [Developer API reference, in T1](../design/service-foundations.md#developer-api-reference-in-t1).
> One pull request closes [issue #352](https://github.com/kenhayward/alloy-works/issues/352); each
> task ends in a commit, and production code follows a test watched fail.

**Goal:** an integration developer can open the authoritative v1 reference on an environment,
navigate every operation by domain, understand it without reading the repository, paste a personal
token and execute a token-enabled operation without the browser's session taking part or the token
being kept.

## Constraints

- The committed `packages/api-contract/openapi.json` stays the one synchronous contract. No runtime
  OpenAPI generator and no hand edit of the generated file.
- OpenAPI stays at 3.1. Tags and `x-tagGroups` provide group, tag and operation navigation.
- Scalar and every browser asset are pinned and served by Alloy Works. No CDN, hosted registry,
  analytics, agent, remote font or request proxy.
- Documentation is public only on a hostname that resolves to an environment. Executing needs an
  explicitly entered personal token; requests omit cookies and cannot leave the page's origin.
- A session-only operation is documented and cannot be executed in the reference.
- Test titles cite API-062 only where they demonstrate the reference or its authoritative document.
- Prettier runs before `pnpm trace generate`; the affected suites, typecheck, lint, build and full
  test run are green before the pull request opens.

## Task 0: Requirement, design and plan

1. File the requirement issue and draft API-062 through `pnpm trace draft`.
2. Add API-062 under the synchronous API, update the corpus counts and pins, and regenerate the
   trace.
3. Extend `service-foundations.md` with DOC-A to DOC-H: addresses, completeness, hierarchy,
   rendering, execution, browser boundary and verification; claim API-062 only once the whole
   requirement is designed.
4. Add this plan and its entry in the plans index.
5. Verify `pnpm trace check`, `pnpm trace pins`, the trace suite and formatting, then commit before
   the implementation below begins.

## Task 1: A complete, hierarchical OpenAPI document

**Red:** add contract tests named `API-062 publishes a complete navigable description of every
operation` and `API-062 keeps examples valid against the schemas they describe`. They enumerate all
routes and fail for the first operation without the required metadata. Add focused expectations for
the root tags, `x-tagGroups`, relative server, common headers, permission extension and token/session
execution marker. Run the API-contract suite and retain the failing output.

**Green:**

1. Add a closed tag catalogue and group catalogue, with display order and descriptions, in
   `packages/api-contract`.
2. Extend `RouteContract` with a required description, tag and documentation examples. Derive the
   required permission and token eligibility from `RouteAccess`; never repeat either in a route.
3. Give all routes descriptions and one tag. Give JSON request bodies and successful JSON responses
   examples that their zod schemas accept; explicitly classify streams, redirects, bytes and empty
   responses as not having JSON examples.
4. Publish the tag catalogue, `x-tagGroups`, `servers: [{ url: '/' }]`, examples, common request and
   response headers, `x-alloy-permission` and `x-alloy-token-enabled` from `buildOpenApi`.
5. Expand the document introduction with authentication, errors, request ids, idempotency,
   pagination, concurrency and compatibility. Keep field rules beside their zod schemas.
6. Generate `openapi.json` and the API client after formatting. Confirm their drift tests and the
   complete API-contract suite pass. Commit.

## Task 2: Versioned service endpoints and self-hosted reference

**Red:** in a service test named `API-062 serves the authoritative v1 document and reference only on
an environment hostname`, ask for `/openapi/v1.json`, `/docs`, `/docs/v1/` and the local Scalar asset.
Show the renderer fallback answering at least one before the implementation, and assert an unknown
hostname is refused. Add exact content type, redirect, cache, CSP, referrer and nosniff expectations.

**Green:**

1. Pin Scalar's server-rendering/browser packages in the service workspace. Copy or emit the pinned
   browser bundle into the service build; do not use its default CDN or fonts.
2. Register the documentation routes before the renderer fallback. `/openapi/v1.json` serves the
   committed document, `/docs` redirects, `/docs/v1/` serves the reference and versioned assets are
   immutable.
3. Resolve the hostname for the JSON, HTML and asset routes without requiring a session. Use the
   existing tenant-not-found error on an unknown host.
4. Apply the security and cache headers from the design. Configure Scalar with local content only,
   no persistence and every optional networked feature disabled.
5. Refactor route parity narrowly: contract routes remain an exact set and documentation
   infrastructure has its own exact set. Do not ignore every non-`/v1` route.
6. Add the Scalar files to the service package/build and container where required. Run service tests,
   typecheck and build. Commit.

## Task 3: Explicit-token execution in a real browser

**Red:** add one browser test named `API-062 executes a token-enabled operation only with the token
entered for this environment`. Against the real stack it signs in only to issue a short-lived token,
opens `/docs/v1/`, enters the token and invokes `GET /v1/me`. Capture requests and fail because the
reference does not yet enforce the boundary. Assert:

- the API request carries `Authorization: Bearer …` and no `Cookie`;
- a page holding only the signed-in session gets `401` through the explorer;
- reload removes the token and no storage value or generated code contains it;
- a session-only operation has no execute control;
- a changed server origin is refused before a request; and
- a mutating operation shows the environment warning before it can be sent.

**Green:** add the smallest local Scalar adapter/plugin that reads the canonical security metadata,
keeps the token in component memory, uses same-origin fetch with `credentials: 'omit'`, disables
execution for session-only operations and supplies the mutation warning. It may change presentation,
never paths, schemas or security in the OpenAPI document. Run the browser test with console output
pristine and commit.

## Task 4: Product documentation and release

1. Update `docs/architecture.md` with the built endpoints, contract metadata flow, local Scalar
   assets and browser security boundary.
2. Update `docs/features.md` and the README feature table in lockstep: where the reference is and what
   its token can execute. Add the external developer procedure under `docs/guides/` only where it is
   a procedure; keep behavioural facts in the contract and architecture.
3. Mark this plan Built in `docs/plans/README.md` after the work is complete.
4. Bump the Minor version and reset Build, because API-062 is a functional enhancement. Mirror it in
   `version.json`, root `package.json` and `apps/desktop/package.json`, and add the changelog entry with
   the pull request number.
5. Format, regenerate OpenAPI, the client and trace in that order, then run the affected suites,
   `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm trace check`, `pnpm trace pins` and
   `pnpm trace gate`.
6. Review the whole branch against API-062 and DOC-A to DOC-H. Push the branch, open a pull request
   whose body contains `Fixes #352`, attach it to the task and read every CI log before handoff.

## Deliberately left out

- OAuth, service identities and a hosted developer portal. Personal tokens are the T1 caller.
- Moving documentation to another origin or widening CORS. That changes the credential boundary.
- OpenAPI 3.2 solely for nested tags. The designed hierarchy needs no deeper level.
- Executing the session-only sign-in, sign-out, token-management or realtime endpoints from the
  reference.
- Declaring rate limits before API-051 has a design and implementation.
