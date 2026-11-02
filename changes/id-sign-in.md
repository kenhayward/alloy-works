### Added

- **Administration's Sign-in.** An administrator adds, renames and closes identity providers, replaces a provider's secret, opens or closes the Google route and its domains, and sets how long a session lasts, all after signing in again within the last ten minutes. A shorter lifetime reaches every open session at once.
- **Signing in again within a session.** A route can ask for a recent sign-in, which goes through the way in the session came by and is accepted only for the same person.
- **Disabling a person.** Administration's People disables and enables anybody: they are signed out and lose their API tokens at once, and cannot sign in until enabled.
- **An invitation's ways in, and a group's provider.** Inviting somebody can name who may claim it, and a group standing for a provider's value names which provider where there are several.

### Changed

- **No act leaves nobody able to get in.** Disabling a person, closing a provider or the Google route, and removing a grant are refused where nobody who can sign in could then configure sign-in.
- **A provider is reached only at a public address, over HTTPS**, outside development, whatever its issuer or its published endpoints say.

### Fixed

- **Citation styles and Reference sources** open in Administration, rather than Overview.
