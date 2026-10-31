# 0072 - The desktop app asks which environment to connect to

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

[ADR-0022](0022-the-desktop-window-loads-the-service.md) made the window load the service, its
address from `ALLOY_SERVICE_URL`, and foresaw the screen this records: "a local page, with the
environment loaded after it". An installed copy has no variable set, so it loaded the renderer from
disk, which cannot sign in. Releasing an installer (ADM-052) would install something that does
nothing, so the address has to be asked for first (ADM-051, the
[DR plan](../plans/2026-10-31-dr-desktop-releases.md)).

## Decision

**The window loads the variable's address, else the one the person chose and the app kept, else a
Connect to screen; it asks again from the tray, and when the address does not answer.**

- **The screen is the renderer's**, loaded from disk at `#/connect`, standing alone above its chrome,
  so it is one renderer (ADR-0003), worded from the catalogue and walked under axe.
- **The bridge gains a second job**: `connectTo`, answered only for that screen, never a served page,
  so an environment cannot point the app at another. The main process checks the address and asks
  `/v1/me` with no session: an environment answers 401 `unauthenticated`.
- **`https`, or `http` on loopback only**: the session cookie is `__Host-` and `Secure`.
- **Kept in `connection.json`** in the app's own folder; an address is not a secret.
- **The window's trusted target follows what it loads**, the screen and the environment taking turns.

## What would change the answer

- **More than one environment at once**: a chooser, or a window each (ADR-0022 named it).
- **An organisation deploying the app with its address set**, by policy or installer argument: read
  before the kept one, as the variable is.

## Consequences

- An installed copy signs in with nothing configured, so a release is worth publishing (ADM-052).
- `ALLOY_SERVICE_URL` still wins, so development and the suites are unchanged.
- The bridge is no longer only "which delivery this is"; each further method still needs its own
  validated handler.
