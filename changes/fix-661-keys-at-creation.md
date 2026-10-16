### Fixed

- **An idempotency key is honoured when a document's template runs queries.** Sending the same request again with its key now answers with the document already made, without running its queries again, as it does for any other template; a creation that failed is not remembered, so it can be tried again with the same key.
