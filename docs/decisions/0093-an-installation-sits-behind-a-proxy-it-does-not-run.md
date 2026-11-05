# 0093 - An installation sits behind a proxy it does not run

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

The first installation on the internet (plan IS) runs on one Linux machine behind a reverse proxy its owner
already runs for other sites, with the public certificates. `compose.yaml` publishes development passwords, the
stand-in and every port, and `compose.lan.yaml` trusts a local authority. Neither can face the internet.

## Decision

1. **An override, `compose.internet.yaml`, not a second stack.** It resets every published port but 443, removes
   the stand-in and Google, and makes every secret `${X:?}`, so the images and wiring stay development's.
2. **The owner's proxy holds the certificate; Caddy on the machine is the one door.** Caddy uses its own
   internal certificate to the proxy, believes `X-Forwarded-For` from `PROXY_ADDRESS` alone and overwrites the
   rest. The service and Keycloak believe Caddy's fixed address alone. Nothing else is reachable from the network.
3. **Keycloak is the provider, in production mode**, with a realm holding nobody. Its first administrator is made
   by `configure.sh` with a temporary password and must enrol an authenticator.
4. **The stack reaches its own public names through the proxy**, by hairpin, not by Docker aliases or split DNS:
   the issuer and the store's endpoint are the names people use, and the fetch guard refuses private addresses.
5. **Deploys follow published tags** through `deploy.sh` on a timer, dumping the databases first, and never
   removing a volume.

## What would change the answer

A second installation, or one without a proxy of its owner's: Caddy would then get public certificates itself. A
hosted platform, which brings its own ingress and secret store. A need for the stack's own traffic to avoid the
proxy.

## Consequences

The proxy's access list must allow the machine's own address. Docker needs public resolvers where the firewall
drops the local one. Client addresses are only as good as the proxy's `X-Forwarded-For`.
