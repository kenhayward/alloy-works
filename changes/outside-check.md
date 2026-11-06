### Added

- **An outside check for an installation on the internet.** One script asks the installation, from outside, for what a caller should not get, and the door now logs who called.

### Fixed

- **Keycloak's administration is closed at the door.** A path with a semicolon in it reached Keycloak's console and its master realm; only the sign-in realm is let through now. The store's internal services no longer answer other containers, the firewall finds its network rather than assuming one, and automatic deploys take a release only by its tag.
- **Deliveries into an installation on the internet are quicker.** Its worker reaches the object store directly, rather than out through the proxy and back, which made each of its calls about 13 times as long.
