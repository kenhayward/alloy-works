### Fixed

- **Keycloak lets the next person sign in.** On a development stack using Keycloak, signing in as somebody else in the same browser was refused until Keycloak's session was ended by hand. That session now lasts 15 seconds.
