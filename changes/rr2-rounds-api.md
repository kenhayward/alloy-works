### Added

- **Review rounds, through the API.** `POST /v1/documents/{id}/rounds` opens a round naming its reviewers, its scope and its due date, on the document or one of its baselines. Each reviewer is told, starts, finishes with comments or with nothing to say, and may reopen while it is open. `GET /v1/rounds/{id}` answers who has reviewed it.
