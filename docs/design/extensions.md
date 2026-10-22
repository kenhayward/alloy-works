# Extensions

How a tenant adds a kind of data source the product does not build in. GN-D gave extensions a design of
their own, a protocol and never code (API-N03); Ken's answers of 2026-10-21 shaped it, and
[ADR-0066](../decisions/0066-an-extension-is-a-manifest-and-a-remote-service.md) records it. Built by
[the EX plan](../plans/2026-10-21-ex-extensions.md). Output formats (API-031) follow under the same
manifest once sources prove it.

## The shape in one paragraph

An **extension** is a manifest at an HTTPS URL and the service it names, hosted by whoever wrote it, the
tenant or a vendor. A tenant administrator **installs** one by its URL: the connector fetches the
manifest, the administrator reads what it declares - what it is, the settings and credential a
connection to it takes, its capabilities, and the hosts it says it sends data to - and confirms; each
manifest an extension has had is kept, by its digest. A connection of type `extension` holds a
snapshot of the manifest it was made against - its endpoint, digest and capabilities - so nothing it
does changes behind it, and its credential is bound to that endpoint. A query definition of kind
`extension` holds the extension's own request. The connector calls the extension through its guarded
client as it calls an HTTP source, holding it to the product's limits and its answer to one shape; a
failure the extension causes says so, in codes of its own (API-034). Updating shows what changed first;
removal waits until no connection uses it.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-030** | A source type is a manifest and a service, installed by an administrator, with no change to the product                                                                                                     |
| **DAT-054** | The same: a connection of type `extension` reaches any source an extension answers for                                                                                                                      |
| **DAT-079** | Every source type declares its capabilities, the built-in ones in domain and an extension in its manifest; a definition binding parameters on one that declares none is refused at its write and at its run |
| **API-033** | An extension is sent only what it declares: its settings, its one credential, the definition's request and the values bound; never a tenant, a person or another header                                     |
| **API-034** | A failure an extension causes is the source side's (`connector`), in codes of its own (`extension_refused`, `extension_failed`, `extension_invalid`), never the product's                                   |
| **API-048** | Updated after its preview shows what changed, connections moving to it each a new version; removed only once no connection uses it, its uses listed                                                         |
| **API-049** | Removed, it alters no content; a binding on a connection retired with it is refused as `connection.retired`, never silently stale                                                                           |

| Left unclaimed | Why                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| API-059        | Permissioned, audited and its outbound hosts shown, but the outbound inventory (ADM-041) is T7's                |
| DAT-073        | A cheap revision token needs a revision held in every result's provenance, for every source type: its own slice |
| API-031        | Output formats follow under the same manifest, in T7                                                            |

## The manifest

`GET <url>` answers JSON, at most 64 KiB, digested as canonical JSON:

| Member                                        | Holds                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `manifest`                                    | `1`                                                                                                          |
| `name`, `version`, `publisher`, `description` | What it is, as the extension says                                                                            |
| `kind`                                        | `source`, or `reference` (below)                                                                             |
| `endpoint`                                    | The HTTPS base its calls go to                                                                               |
| `settings`                                    | The fields a connection gives it, each `{ key, label, type: text, number or boolean, required }`, at most 20 |
| `authentication`                              | `none`, or `{ label }`: one secret, sent as `Authorization: Bearer`                                          |
| `capabilities`                                | `parameters`, `keyColumns`, `rowLimit`: booleans                                                             |
| `outbound`                                    | Every host it says it sends a tenant's data to, each `{ host, purpose }`: its word, shown at install         |

A manifest that does not parse is `manifest_invalid`, naming the paths that failed and never their
values. The manifest fetch reaches what an HTTP connection's sample may: the host an administrator
names, held to the guard.

## The calls

Each a `POST` to the snapshot's `endpoint` + `/test` or `/run`, JSON in and out: the connection's
settings, the definition's `request` (opaque, at most 64 KiB), the values bound where `parameters` is
declared, and the product's limits, the row limit only where `rowLimit` is. A describe is the column
sample HTTP's is (DAT-105). `run` answers `{ columns: [{ name, type }], rows }`, read as an HTTP
source's JSON is, so the product's canonical form, checksum and limits hold; anything else is
`extension_invalid`. As an HTTP source's: 401, 403 and a redirect are `connection_failed`, another 4xx
`extension_refused`, a 5xx or no answer `extension_failed`, and no body but a 2xx's is read. Every run is
the connection's own account (DAT-078): no person's identity is ever sent.

## Reference extensions

A manifest of kind `reference` (the XR plan, XR-J; LIB-032) declares `reference { search, fetch }`,
paths under its endpoint, in place of `settings` and `capabilities`. It is a reference source, not a
source of rows: the tenant's sources hold it as `ext:<id>`, its secret is the install's, and its switch
is its use, so it is removed once off. [reference-sources.md](reference-sources.md#built-in-xrd) has
the rest.

## Ruled out

- **Code run by the product** (API-N03; Ken): a manifest and a service, never a package.
- **A vendor catalogue** (Ken): an administrator installs by URL, reading what it declares first.
- **Output formats now** (Ken): sources first; `kind` is left open for them.
- **An attribution of its own**: `connector`, the source side's, already never the product's; the
  extension's codes say whose the failure is (the pre-flight review).
