# R10: Variables from templates and results, and profile defaults

> T4's tenth slice, extending [publishing.md](../design/publishing.md)'s variables (the R5 plan) and
> [templates.md](../design/templates.md). **Full tier**: stored shapes (a variable's sources, a template
> parameter's feeds, a template's profile), a contract change. Built inline, one final review at the
> slice's end. Decisions marked **(default)** are recommendations Ken may overturn; the rest are his
> answers of 2026-10-16.

**Goal:** a template says which variables each of its parameters feeds; a variable may also take its
value from a query result the document holds; a variable resolves from the parameter, then the
metadata, then the result, and the publish records which; making a document names each variable its
required components hold that does not resolve yet; and a template declares its documents' profile.

| PR   | Holds                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------ |
| R10a | This plan; REU-037 withdrawn, TPL-064 superseded by TPL-072; the mapping, the query source, precedence |
| R10b | Profile defaults on the template (TPL-051); the final review; the close, 0.181.0                       |

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R10-A | **The template maps parameters to variables** (TPL-069, TPL-067; Ken's answer): a template parameter's `feeds` gains `variables`, variable keys. A key names a declared variable whose type takes the parameter's, one value to one value, else `parameter_variable` at save; feeding one counts as a use (TPL-068). A variable's own `sources.parameter` is read only where the document's template feeds that key from none.                                                   |
| R10-B | **A query result as a source** (REU-016; Ken's answer): a variable's `sources.query` is `{ definition, column }`. It takes that column from the result the referring document holds for a binding of that definition, where the result is one row; none held, held results that disagree, or a result of any other number of rows leave it unresolved, the publish failing `variable_unresolved` by name (REU-017).                                                              |
| R10-C | **Precedence, recorded** (REU-038): the parameter, then the metadata field, then the query result; each printed variable records which supplied it, `query` beside `parameter` and `metadata`.                                                                                                                                                                                                                                                                                   |
| R10-D | **Creation names what does not resolve** (TPL-072; Ken's answer): making a document from a template answers, beside the document, each variable its required components hold that does not resolve against its parameters, values and the results it holds, by node and key. Nothing is refused. A query source counts where the document holds a result of its definition; the publish says whether it is one row. The page opens the new document, so the answer is the API's. |
| R10-E | **Profile defaults** (TPL-051; R10b, default): a template's `profile` declares a default value for some axes and which axes a document from it must set. Making a document writes the defaults as its profile, a parameter's value where a parameter feeds an axis, or records it incomplete where a required axis has neither; a publish of an incomplete profile is refused as an unset axis is.                                                                               |
| R10-F | **REU-037 withdrawn** (Ken's answer): no chain of references crosses two document contexts while a document places no document, so REU-036 is the whole rule.                                                                                                                                                                                                                                                                                                                    |

## Task 1: Variables - R10a

- Domain: `feeds.variables` and its checks; `sources.query`; `resolveVariable` with the mapping and
  results; assemble's results by definition; `PrintedVariable.source` widened.
- Db and worker: the mapping read from the document's template version; each held result's
  definition carried.
- Creation's unresolved variables, through the API and the page.
- Tests: the mapping over a variable's own parameter; precedence across all three; a query source
  resolved, and unresolved by none, many rows and disagreement; creation naming one unresolved.

## Task 2: Profile defaults - R10b

- The template's `profile`, its checks, creation writing it, the publish's refusal; the final review;
  the close.
