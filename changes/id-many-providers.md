### Added

- **More than one identity provider.** An environment can sign in through several identity providers, each offered by name. A provider's groups and invitations are its own, and closing one ends its sessions and tokens alone.

### Changed

- **Closing a sign-in route ends its people's tokens too**, not only their sessions.
- **A connection naming people by subject** refuses each act while more than one provider is open, since a subject means a person at only one.

### Fixed

- **A rotated signing key** is picked up by the next sign-in, even within a minute of the provider's keys being fetched.
