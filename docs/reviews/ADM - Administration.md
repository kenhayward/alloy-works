## Defects to fix now

ADM-016 ends mid-sentence: "must be measured in production, not only in tests, and reported against" — no object. Presumably the scope §11 budgets, but that's inference.

ADM-020 is truncated the same way: "objectives must be stated and measured against".

§10 traceability is incomplete relative to inline references. API-004 (ADM-003), IMP-018 (ADM-005) and LIF-026 (ADM-002, ADM-009) appear in the body with no row.
ADM-012 ("cost trends") and ADM-017 ("diagnostics") are directional rather than testable. Acceptable as T5 items, but they're the two an implementer will argue hardest about; a minimum granularity (e.g., trend per capability) would close most of that gap.

## Gaps to consider closing

Tenant view of its own audit trail. Nothing says a tenant admin can read, search or export the tenant's log — yet ADM-002, ADM-009 and ADM-024 all write into it. If LIF owns retention and IAM owns roles, nobody currently owns review/export. Add a row or name the document that does.

Minimum content of self-service diagnostics. ADM-017 grants access and ADM-018 fences it, but nothing says which measured signals (per-capability health, latency, error rate from ADM-015; index/webhook status implied by ADM-019) actually appear in the tenant view. As written, "diagnostics" is a promise without a floor — and ADM-019's "surfaced rather than logged" doesn't say surfaced to whom.

Budget alert delivery (ADM-013). Who receives an alert and via which channel? If notification is one of your other 20 documents this needs a dependency row plus cross-reference; if it isn't owned anywhere, it's the clearest functional gap here.

Configuration export versus secrets. ADM-005 exports configuration "so that a tenant can be reproduced" while ADM-008 forbids secrets in any export. Together they imply exports carry placeholders or references and import rebinds them — a real design decision that's currently implicit. State it (or confirm the document covering IMP-018 does).

Tenant lifecycle beyond bootstrapping. Q04 covers before an admin exists; suspension, contract end and offboarding/data deletion appear nowhere. If LIF or IAM owns termination, a "Not here" row tells readers where to look; if nobody does, this is the largest gap in the list.

Usage-data retention and precision. Q02 (metered for pricing vs visibility only) changes measurement precision and how long usage records must be kept. Worth an explicit note that settling Q02 feeds back into ADM-010/ADM-011, plus a cross-check against LIF's retention policy.

Cross-document checks to verify rather than assume
SCIM / IdP provisioning and throttling of the administrative API (ADM-003 makes it reachable; nothing says how it's protected) — presumably IAM or platform.
Audit-log integrity. The document leans heavily on audit but never asserts the log itself is tamper-evident or append-only; that's likely LIF-026, but confirm.

Secret dependency visibility. ADM-007 covers value validity during rotation, not which connections or endpoints consume a secret — an admin rotating one needs to know what to smoke-test afterwards.
