# 0102 - Every route declares what it reads

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

A tenant may let support look at metadata, or at content too, and until a stated time (ADM-022 to ADM-026; the
[SA plan](../plans/2026-11-07-sa-support-access-boundary-and-secrets.md)). Which of 493 routes reveal content cannot
be worked out at request time from a permission: `read` answers a title and a body alike. Ken drew the line (SA-B):
titles and names are metadata; bodies, captions, comments, asset files, publications and search snippets are content.
Field values, version notes and approval reasons count as content too (SA-B extended).

## Decision

1. **`reads: 'content' | 'metadata' | 'none'` is required on `RouteContract`**, beside `access`, so the compiler
   holds every route to it, a new one included.
2. **A route carrying any content is `content`**: one field of a body, a caption, a field value, a version note, an
   approval reason, an asset's bytes, a publication, a snippet, SQL, or a mail or webhook delivery's contents. A
   metadata scope then sees less than it might, never more.
3. **A write is classed by what its answer or effect reveals**, as a read is: one answering the document as it now
   is is `content`.
4. **`none`** is what reveals nothing of the tenant's artifacts or people: signing in, the caller's own sessions,
   tokens and preferences, the environment's own settings.
5. **The OpenAPI document publishes it** as `x-alloy-reads` on each operation.
6. **A test pins the doubtful as content** (`packages/api-contract/src/reads.test.ts`): search, document reads,
   numbering, texts, changes since, comparisons, previews and pages, shared outputs, every download and export,
   query definitions, mail and webhook deliveries, version and approval lists; and every route answering bytes or a
   model's stream.

## What would change the answer

- A response shaped per caller, withholding content fields from a metadata reader, would let a route be both; that
  costs a second shape for each, and the service would have to prove each one withholds.
- A requirement that support see some content without a content grant would need a fourth value.

## Consequences

- Enforcing it is SAb's: the service's route hook refuses a support principal a route its scope does not reach.
- 209 routes read content, 229 metadata and 55 none, at 0102. A route's class is reviewed with its schema: a new
  field that is content moves its route.
