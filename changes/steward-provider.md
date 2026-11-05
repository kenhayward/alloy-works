### Added

- **A first way in through any provider.** The operator's `steward provider` gives a new organisation's tenant its first sign-in through Keycloak or any OpenID Connect provider, with the client secret piped in. It works only until somebody who signed in holds access there.

### Fixed

- **Google under Keycloak.** A stack on Keycloak with `compose.lan.yaml` no longer keeps Google's settings.
