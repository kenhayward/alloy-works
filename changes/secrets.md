### Added

- **Secrets.** Administration's new Secrets section lists every secret the environment holds, what uses each and when it was last replaced, with a link to where it is replaced, so an administrator sees every dependent before replacing one. If something using a secret fails to sign in after the secret is replaced, those who read Diagnostics are told once, naming everything that uses it.

### Changed

- **Tokens overlap when replaced.** A new SCIM or CT Studio token leaves the one before it working for 24 hours, so the provider or CT Studio can move to it without a gap; any older one ends at once. Turning SCIM off still ends every token at once.
- **Extension secrets need the permission to replace secrets.** Setting a reference extension's secret now needs rotate secrets, as every other secret does, rather than administer.
