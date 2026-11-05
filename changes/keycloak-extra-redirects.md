### Fixed

- **Keycloak and new tenants.** On a development stack, `ALLOY_EXTRA_REDIRECT_URIS` in `deploy/.env` lets a sign-in return to a tenant made from an organisation's console, and survives a restart.
