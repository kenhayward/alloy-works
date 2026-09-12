## Substantive gaps

Concurrent mutation semantics on the synchronous API. This is the biggest hole for a component CMS with multiple driving systems. The table says IAM owns what a token may do and COL owns which events exist, but nothing in this document or its boundary tables assigns how two concurrent writes to the same component are resolved — ETag/If-Match, version fields, 409 responses. API-036's locks are presence-layer, advisory UX; they do not substitute for a storage-level conflict contract on mutating endpoints. Two integrators PUTting the same component today has no specified answer.

Long-running operations. ADR-0018 settles that model output streams on its request, but bulk regeneration, large exports, and connector runs will outlive a single request. There is no requirement set for async job semantics (submit, poll, cancel, failure reporting) — and equally no non-requirement stating long work must fit inside a request lifetime. One of those two should be present; as written it's silent.

Bulk import/export. "Another system drives this one" in CMS practice often means moving content at scale. API-031 covers output formats as extensions, but there is no statement about batch create/update endpoints or bulk import — either a requirement or an explicit "Not here"/non-requirement so the gap doesn't surface later as an integration request that contradicts API-first.

Webhook ordering and stable identity across retries. API-028 guarantees retried delivery, but says nothing about ordering of content/workflow/review/publication events — integrators will assume "publication after review" arrives in that order unless told there is no guarantee. Separately, a delivery that times out after the receiver processed it will be resent; API-026 requires the payload to "identify" the event, but it should state plainly that every delivery of the same event carries the same identifier, or receivers cannot de-duplicate.

Sync-API traceability. Errors name what failed (API-006), MCP calls are audited (API-023) and webhook deliveries inspectable (API-029), but an ordinary API response has no requirement to carry a request ID correlatable with server logs. Cheap, and it is the single thing integrators ask for first in a support conversation — which this document elsewhere explicitly tries to avoid (the API-014 paragraph).

Extension lifecycle. Section 8 covers adding extensions, declaring their authority (API-033) and attributing failures (API-034), but not updating or removing one. In a CMS where connectors back live sources, "what happens to data touched by a connector I remove" is a real question; it deserves at least an entry in §10 alongside API-Q03.

Where availability/performance targets are owned. The document sets one latency figure (API-036) but no SLOs for the synchronous surface, and "Not here" assigns ADM rate/cost reporting only. Worth checking across the set that sync-API availability and latency targets are owned somewhere; if not, it is a system-level hole rather than this document's fault.

## Smaller issues

API-011 appears truncated: "must keep working until it" — ends mid-sentence. Presumably "until that date."
API-009 says limits "must be declared" — sharpen to "declared in the specification" so contract tests under API-003 can actually verify it.
MCP versus API versioning: nothing states how a major API version bump interacts with the tool surface (does MCP follow, lag, or stay pinned?). One line would close it; Q02 covers count only.
The 401/403 distinction for auth failures is genuinely IAM's, but this document could take one sentence of ownership — "auth and authorisation errors follow the IAM contract" — rather than leaving it implicit in the dependency table.
None of these change the two governing decisions or anything downstream depends on; they are integration edges that will be discovered by whoever writes the first real connector.
