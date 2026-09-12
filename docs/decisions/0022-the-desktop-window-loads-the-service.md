# 0022 - The desktop window loads the service

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

[ADR-0003](0003-one-renderer-two-deliveries.md) settled that there is one renderer and two
deliveries: a browser tab and an Electron window, with no per-delivery fork of a component. What it
did not settle is where the Electron window gets the renderer from. Until now it loaded the dev
server while unpackaged and a file from disk once packaged, because there was nothing else to load
from - there was no service.

There is now. The service is the system of record
([system.md](../design/system.md)), a request reaches one environment by its hostname
([ADR-0020](0020-service-foundations-tenant-roles-zod-first-apis-kysely.md)), and a signed-in
session is a `__Host-` cookie belonging to that hostname. A window loading `file://` is a different
origin: it has no hostname for the service to resolve, and it can hold no cookie the service would
accept. So the desktop delivery, as built, could not sign in at all - not badly, but not at all.

Scope decision 2 already anticipated this, saying the platform bridge would be re-examined when the
service arrived. This is that.

The same change is what lets the service serve the renderer beside its API: one origin for the page
and the calls it makes.

## Decision

**When the desktop app is given an environment's address, its window loads that address. Without
one, it loads what it loaded before.**

- **The address comes from `ALLOY_SERVICE_URL`.** The shell prefers it over both the dev server and
  the packaged file, packaged or not, because an address that was configured was configured
  deliberately.
- **Nothing about the renderer changes with the delivery.** ADR-0003 holds; what it now means is
  that the Electron window is a browser pointed at the environment, and the renderer cannot tell
  which of the two it is in except by asking the bridge.
- **The bridge keeps its one job**, saying which delivery this is. It does not become a transport
  for API calls, and the renderer still calls the service the same way in both deliveries.

## What would change the answer

- **Working offline.** A window that has to show content with no service reachable would need the
  renderer served locally again, and an API token rather than a session cookie, because a token can
  be held by a page that came from disk. That is a different application, not a setting.
- **A capability that has to run before any service is reachable**, such as choosing a workspace
  folder or unlocking a credential store at first run. That screen would be a local page, with the
  environment loaded after it.
- **A second environment in one window.** Sessions are per hostname, so two environments mean two
  windows or a chooser; neither changes what a window loads, but a chooser would replace the
  environment variable.

## Consequences

- The desktop app signs in exactly as the browser does, through the same routes and the same
  cookies, and there is nothing delivery-specific about a session.
- Until there is a screen to ask for it, the address is an environment variable, so the desktop
  delivery is configured rather than chosen. A first-run screen belongs with the authoring
  interface.
- A packaged build with no address still loads the local file, so the renderer's own development and
  the packaging tests are unchanged.
- The window now depends on a reachable service to show anything at all, which makes the desktop
  app's failure modes the web app's failure modes. That is the point: there is one system to keep
  working, not two.
