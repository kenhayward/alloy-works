# The export format

How to read an Alloy Works export without Alloy Works. Everything here is checked by a reader written
from this page, which imports nothing of the product
([`apps/worker/src/testing/export-reader.ts`](../../apps/worker/src/testing/export-reader.ts)).

This is format 2. An archive says which format it is in `manifest.json`. Format 1, the five files
`artifacts.jsonl` to `publications.jsonl` in a ZIP, is no longer written.

## Opening an archive

An export is one uncompressed POSIX tar file, which any tar tool opens. An entry over 8 GiB gives its
size in a pax `size` record.

| Entry                    | Holds                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| `manifest.json`          | Always first: what the archive holds and what it does not           |
| `schema.json`            | Every table's columns, types, keys and references                   |
| `secrets.jsonl`          | A reference to each secret, never its value                         |
| `tables/<name>.jsonl.gz` | Gzipped JSON Lines: a table's rows, one object a line               |
| `objects/<sha256>`       | Bytes the rows name, as stored, named by the SHA-256 of their bytes |

A table's file may be several gzip members one after another, as the gzip format allows. A table with
no rows has an empty one.

A partial archive (`scope` is `configuration`, `space`, `document` or `publication`) also holds
`references.jsonl`: one `{ "table", "id", "how" }` for each row its rows name that it does not hold
(`how` is `by_identity`), or that it holds only because it was asked to follow references (`by_value`). It
holds definitions always, and of a person only `id`, `kind`, `issuer`, `subject` and `display_name`. It holds
no audit log, no access and no threads marked internal. A row needing a row outside the archive through a
required key is not in it.

## The manifest

| Member                | Means                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| `format`              | `2`                                                                         |
| `export`              | The export's identifier                                                     |
| `scope`               | `tenant` for everything, or the part, with `scopeId` and `followReferences` |
| `requestedAt`         | When it was asked for                                                       |
| `cutAt`               | The moment it holds: every table as of this one instant                     |
| `lastMigration`       | The newest database migration of the product that wrote it                  |
| `tables`              | Each carried table's file and row count                                     |
| `objects`             | How many, and `missing`: hashes the store could not give back, or wrongly   |
| `secrets`             | The file holding the references, and how many                               |
| `rebuilt`             | Tables not held because they are made again from what is, each with why     |
| `leftOut`             | Tables not held for any other reason, each with why                         |
| `columnsNeverCarried` | Columns no table's rows hold, and why                                       |

A table in neither `tables`, `rebuilt` nor `leftOut` does not exist. An export is complete apart from
what these say, so check `objects.missing` first.

## The rows

Each line is one row as a JSON object, its members named as `schema.json` names the columns. Instants
are ISO 8601 with their offset, `bytea` is `\x` and hexadecimal, and a number is written as the
database holds it, so read a large one with care: a sequence or a price can exceed what a double holds
exactly.

For each table, `schema.json` gives `columns` (`name`, `type` as PostgreSQL names it, `nullable`),
`primaryKey`, `foreignKeys` (`columns`, `refers`), `notCarried` (the table's columns no row holds:
values computed from others, transaction numbers, sealed secrets) and `identity`:

| `identity`   | Means                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `kept`       | Its identifier is the same anywhere, and may be in a digest           |
| `natural`    | Its identifier is random; what identifies it is a unique name or pair |
| `singleton`  | One row of settings                                                   |
| `renumbered` | Its number is only the order rows were written in this environment    |

The tables you most likely want: `artifact` (each component, document, template and definition),
`artifact_version` (every version of each), `relationship`, `baseline`, `publication`, `audit_event`
(the audit log), `principal` (people), `access_grant`, `thread` and `thread_comment`.

## The secrets

A line of `secrets.jsonl` is `{ "reference", "kind", "table", "holder" }`, one for each thing that holds
a secret: `connection:<id>`, `model_endpoint:<id>`, `webhook:<id>`, `extension:<id>` or
`identity_provider:<id>`. The value is never in an archive. API tokens and sessions are left out whole.

## Checking a version

A version's digests can be recomputed from the archive alone. The canonical text of a value is its
JSON with members sorted by UTF-16 code unit, strings in NFC, no whitespace between tokens, and arrays
in the order given. For a `component`, `document` or `template`, the value of any member named `marks`
is sorted first, by `type` and then `id`, since marks are a set.

`content_hash` is the lowercase hexadecimal SHA-256 of the canonical text of `content`.

`version_digest` is the SHA-256 of an object written by hand, in this order, from these canonical
texts:

| Member          | Canonical text of                                                                             |
| --------------- | --------------------------------------------------------------------------------------------- |
| `componentType` | For a component, the `definition_version_id` of its `componentType` definition; else `null`   |
| `content`       | `content`, as above                                                                           |
| `definitions`   | The version's rows of `version_definition`, as `{ id, kind, version }`, sorted by those three |
| `notCarried`    | `not_carried`, sorted by `field`                                                              |
| `parameters`    | `parameters`, and only where it holds a member                                                |
| `values`        | `metadata_values`                                                                             |

In a `version_definition` row, `id` is `definition_artifact_id`, `kind` is `definition_kind` and
`version` is `definition_version_id`.

## Bytes

An asset version names its bytes in `content.object`; a publication's output in
`publication_output.object_key`. Either is a key ending in the SHA-256 of the bytes, and the bytes are
at `objects/<that hash>`. Check them against it.
