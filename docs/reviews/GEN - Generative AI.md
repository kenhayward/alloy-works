## Concrete issues

Digest duplication. GEN-006 records "a digest of the context" at run time and GEN-023 repeats it on the artifact. Defensible as two attachment points (execution vs content record), but the document should say whether they are the same digest or how one derives from the other, otherwise implementers will pick two different values and provenance matching silently breaks.

GEN-N03's double negative — "No training on customer content… without that being stated" is readable as allowing endpoint training when it is stated (probably intended), but the sentence invites misreading at exactly the review moment it matters. Suggest: "This product does not train on customer content. An endpoint configured to do so may only be used where that is stated in configuration."

The §12 traceability table under-covers its own citations. It lists five rows, but section 5 cites IAM-001 (GEN-015), section 8 cites DAT-003 and ADR-0012, and GEN-001 leans on the prompt-library concept owned by TPL per your own Depends-on table. None appear in §12. As written, a reviewer cross-checking external references will find four unaccounted-for anchors.

"Constraint" as a Tranche value is a different axis from T2/T5 and works only if the rest of the 21-doc corpus defines that notation. Worth confirming it does; otherwise this document quietly invents vocabulary.

## Missing areas, ranked

No terminal state for rejected generated content. The lifecycle as specified is: generated → (proposal) → accepted, with acceptance audited by GEN-024 and publishing blocked while unaccepted content remains per GEN-025. But there is no disposition for a proposal an author discards — not here, and nowhere named in Depends-on or Not-here.
As written, a discarded draft can permanently block publishing under GEN-025 unless "discarded" exists as a state owned by some other spec. At minimum this document should name where it lives (LIF lifecycle?); ideally it should specify that discarding is explicit and audited, because silently purging destroys the chain GEN-026 needs to report on who accepted what.

Context overflow. GEN-002/GEN-003 make context explicit and forbid implicit receipt — but nothing says what happens when declared context exceeds model capacity. Silent truncation is exactly the "implicit context" GEN-003 forbids, from the other direction. A requirement that overflow be refused or surfaced would fit section 3 in one line.

Embedding cost. GEN-038 subjects embedding to GEN-027 and GEN-031 only — deliberately narrow citations, but embeddings consume tokens and budgets. If that's intentional (embedding billed differently), say so; if not, section 9 should name it. The current silence reads as oversight because the rest of the document is this precise about which sections apply to what.

Prompt review workflow ownership. GEN-001 makes prompts "reviewable like a query definition" but no spec named in Depends-on owns the process — who reviews, what approval means for a prompt version. TPL owns binding; CNT owns content; nobody visibly owns prompt sign-off. Either add it to Not-here with an owner or state that GEN-001 inherits the query-definition review process from wherever queries are governed.

Retention of records. GEN-006, GEN-023 and GEN-024 all create durable records (runs, digests, acceptance acts) but nothing says how long they persist or where retention is owned — plausibly ADM, which already owns "token cost reporting and budgets in the large". A Not-here row would close it.

GEN-038's scope. It does two jobs: classify embedding as a model call (GEN's business) and guarantee an in-boundary or no-search option for tenants (arguably SCH's). The point is well made — the prose note under §8 is good — but the second half risks duplicating whatever semantic-search boundary requirement SCH carries. Check for overlap; if it exists, GEN-038 should cite it rather than restate it.
Two things that look missing but aren't: post-acceptance visibility of AI marks is consciously open in GEN-Q01, and out-of-boundary PII/residency is deferred to GEN-Q02 with named settling parties — both are correctly parked rather than silently absent.

GEN-N04 No general tool access. The assistant may call the product's capabilities and nothing else (GEN-007) - This is too narrow a definitition, we must allow open user specified prompts with appropriate guardrails, interactive rag based context generation and interactive chat are valid targets and need requirements, generic questions not relevant to the product should in general be caught by guardrails if considered harmful.

We should also introduce the concept of context specification when generative ai is used with template instantiation, add requirements that allow a context to build from a combination of components

In interactive chat the user should have the choice of a number of configured endpoints (configured at the tenant level by an administrator) and within this chat be able to update and create components through tool use and save their own custom prompts to a personal prompt library available only to them
