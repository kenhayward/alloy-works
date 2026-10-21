### Added

- **Webhook subscriptions through the API.** An administrator can subscribe a service identity's HTTPS endpoint to event types at `/v1/webhooks`, with a signing secret shown once, rotated without losing events, and every change recorded in the audit log. Delivery follows in the next release.
