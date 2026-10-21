### Added

- **Webhooks are delivered.** Each event a subscription wants is posted to its endpoint within seconds, signed as Standard Webhooks specifies, only while its service identity may read what the event is about. A failing endpoint is retried for a day, and one failing for three days is disabled.
