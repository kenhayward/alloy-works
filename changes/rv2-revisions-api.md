### Added

- **Values revised by hand, through the API.** `POST /v1/documents/{id}/bindings/revisions` revises a bound value, or a bound table's cell by its row's key, with a reason, or withdraws the revision. The query's value is kept behind it, and each revision is on the audit log with what it was and what it became.
- **Never silently replaced.** Accepting, resolving or keeping a binding over a revision must say whether to withdraw or keep it. A publication and a baseline print the revisions standing when they were asked for, and `provenance.json` gives both halves.
