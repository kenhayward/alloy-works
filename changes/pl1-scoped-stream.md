### Added

- **A stream for one document or component.** `GET /v1/stream?document=` or `?component=` says, as it happens, who holds each component the caller may read and until when, and when the document's outline changes. Its events are described at `/asyncapi/v1.json`, beside the API's own description.
