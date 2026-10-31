# 0073 - Desktop releases live in a public releases repository

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The DR plan published each release in this repository and pointed the updater at it, needing no token
because the repository was public (DR-H, ADM-053). Ken means to keep this repository private for a
while, CI on a runner of his own, and later make it public again. Private, its releases answer the
updater's anonymous requests with 404, and a token in the app would be a secret in the app.

## Decision

**Releases are published to `kenhayward/aw-releases`, public, holding releases alone; the updater
reads it, whatever this repository's visibility.**

- **The workflow writes it with `RELEASES_TOKEN`**, a token scoped to that repository's contents, used
  by the one step that publishes. It still tags the released commit here, with `GITHUB_TOKEN`.
- **While this repository is public, each release is published here too**, so copies of 0.220.0, whose
  `app-update.yml` names this repository, update to a release that reads the new one. Private, that
  step is skipped.

## What would change the answer

- **Hosting the installers elsewhere** (a bucket behind the product's own domain): electron-updater's
  `generic` provider, and no second repository.
- **Signing**: changes nothing here, but the release step gains the certificate.

## Consequences

- This repository can be private without breaking installed copies, once they run 0.220.1 or later.
- A release that published to `aw-releases` but failed here is not retried here, as the next run finds
  its version released; copies of 0.220.0 then wait for the next release.
- One more secret, `RELEASES_TOKEN`, to renew when it expires.
