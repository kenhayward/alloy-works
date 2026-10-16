# R7: Bulk generation

> T4's seventh slice, extending [templates.md](../design/templates.md) and the R3 jobs. **Full tier**:
> migration 0107 (cohorts and their rows, a job kind), a new contract, a worker job. Built inline, one
> final review at the slice's end. Decisions marked **(default)** are recommendations Ken may overturn.

**Goal:** many documents made from one template and a set of parameter rows, given inline or taken
from a query's result, as one job: each row its own document or its own reported failure, nothing
partial; the set a cohort, found again afterwards, every row made from the same resolution, and the
failed rows run again without touching the rest.

| PR  | Holds                                                                                               |
| --- | --------------------------------------------------------------------------------------------------- |
| R7a | This plan; cohorts (0107); the job; the routes (Task 1)                                             |
| R7b | Generate from a template in the page, a CSV or a pasted list; the cohort's page; the close, 0.178.0 |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7-A | **A cohort is a record and a job** (REU-031, REU-034; default): `cohort` holds the space, the template version, what it resolved at the start, the title pattern and where its rows came from; `cohort_row` each row's parameters and outcome; an `api_job` of kind `cohort` makes them, followed, cancelled and downloaded as R3's are. Asked for by `POST /v1/spaces/{space}/cohorts`, `create` in the space. |
| R7-B | **Rows inline or from a result** (REU-032; default): the body names `rows` (at most 1,000, each a parameter set) or a `dataset` version whose rows, one parameter per column, the caller may read. A file is read into rows by the page (R7b): the API takes no upload.                                                                                                                                         |
| R7-C | **Titles from a pattern** (default): `title` with `{name}` for a parameter's value, so forty site reports are named by their site. A row whose title comes out empty or too long fails, by its row.                                                                                                                                                                                                             |
| R7-D | **Resolved once** (REU-051): the template's version and every definition it resolves (theme, layout, schemas, fields) are read once, at submission, and every row, rerun or not, is made from that resolution, recorded on the cohort. Templates place no components, so no reference is movable today; a template that comes to place them pins them here too.                                                 |
| R7-E | **A row is a transaction** (REU-033, TPL-039): each made in its own, its document and its values together or nothing; a refusal fails that row alone, with the refusal's code and what it names, and the run goes on. The job's JSON Lines report has one line per row.                                                                                                                                         |
| R7-F | **Rerun the failed** (REU-035): `POST /v1/cohorts/{id}/rerun` makes a new job over the failed rows alone, from the same resolution; a made row is never touched. Each row keeps its attempts.                                                                                                                                                                                                                   |
| R7-G | **Found again** (REU-034): `GET /v1/cohorts/{id}` names its rows, their documents and outcomes, to anybody who may read its space. Approving and publishing a cohort as one act waits for batch acts; the cohort is what they will take.                                                                                                                                                                        |
| R7-H | **The budget** (REU-049): a test makes four hundred documents and holds the run to the hour; measured in production with the other budgets (ADM-016, T7), so REU-049 is not claimed.                                                                                                                                                                                                                            |

## Task 1: Cohorts - R7a

- 0107; db `cohorts.ts` (submit, claim, record, read, rerun) with `createDocument` split so a row is
  made from a resolution; the worker's `cohort` job; contract, service, census rows.
- Tests: forty rows made, one failing alone and reported; nothing partial; the resolution kept though
  the template changes mid-run; rerun touching only the failed; rows from a dataset version.

## Task 2: The page - R7b

- **Generate** on a template: rows from a CSV file or pasted, a title pattern, then the cohort's page
  following the job, its rows and documents, and **Run the failed again**. The browser walks. The final
  review hunts a partial document and a row made from another resolution. The close: 0.178.0.
