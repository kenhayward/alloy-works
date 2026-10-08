# 0048 - Plain http sources until a tenant can refuse them

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

The D6 plan's guarded client was HTTPS only (D6-B): an HTTP API's base URL and an S3 endpoint had to
start `https://`. Sources on a laptop or a LAN - a SeaweedFS or MinIO on a port, an internal API -
often have no certificate, so they could not be connected at all. Ken decided on 2026-10-08 to allow
plain `http` everywhere in this tranche, and to let a tenant administrator switch it off later.

## Decision

**An HTTP API's base URL and an S3 endpoint may be `http` or `https`**, in every environment. Plain
`http` goes through the same guarded client, by `node:http`: the same address guard and pinned
lookup, no redirect, no proxy, one deadline, the same byte limits and checksums. Its port is 80
unless it names one. S3 signs for the scheme it is sent over. Nothing else changes: a PostgreSQL
connection keeps its TLS setting, and the connector's link to the service is unchanged.

**ADM-050 (T7)** lets a tenant administrator refuse plain `http`; until then nothing does.

## What would change the answer

- **A tenant with regulated content goes live before T7.** ADM-050 comes forward, or a deployment
  refuses `http` outright, since an HTTP API's secret header crosses the network in clear.

## Consequences

- D6-B's "HTTPS only" no longer holds. An `http` connection's secret header and its data are readable
  on the network between connector and source; an S3 key's secret is not, as SigV4 sends a signature.
- The stored shape widens and never narrows: a version stored with `http` stays readable after
  ADM-050, which refuses to run it rather than to read it.
- "An HTTPS API" is now "An HTTP API" wherever the interface names the type.
