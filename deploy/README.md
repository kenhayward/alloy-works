# Deployment

Everything the system is built and run as: the image definitions, the stack that wires them
together, and what the ignore list keeps out of a build.

> **Status: development, and the small installations
> [ADR-0019](../docs/decisions/0019-platform-typescript-service-publishing-workers-object-storage.md)
> describes.** There is no hosted environment, no registry, no TLS and no release process. Every
> password in `compose.yaml` is a local default for a container bound to `127.0.0.1`, and none of
> them is a credential for anything deployed. Which cloud, and whether there is a self-hosted
> option, is one of the decisions still open in
> [the scope](../docs/specification/Project_Scope.md).

| File                      | What it is                                                                        |
| ------------------------- | --------------------------------------------------------------------------------- |
| `Dockerfile`              | Every image the system runs as, as five targets sharing one install and one build |
| `Dockerfile.dockerignore` | What never enters a build context: `node_modules`, `dist`, the docs, this folder  |
| `compose.yaml`            | The whole system for development, and the shape a small installation takes        |
| `sources/postgres.sql`    | The seed of the development source in the `sources` profile                       |
| `.env.example`            | The ports the stack publishes, with their defaults; copy to `.env` to change them |
| `service.env.example`     | Settings for running the service **from source**; copy to `service.env`           |
| `worker.env.example`      | The same for the worker; copy to `worker.env`                                     |

## Running the stack

The compose file lives here rather than at the root, so every command names it:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
docker compose -f deploy/compose.yaml logs -f service
docker compose -f deploy/compose.yaml down          # add -v to throw the data away too
```

**To stop typing `-f deploy/compose.yaml`,** export `COMPOSE_FILE` in your shell and then use
`docker compose` as normal:

```bash
export COMPOSE_FILE=deploy/compose.yaml            # bash, zsh
$env:COMPOSE_FILE = 'deploy/compose.yaml'          # PowerShell
```

The project is named `alloy-works` in the file itself, so its containers, network and volumes keep
the same names whatever directory you run it from.

Working on the code needs only two of these containers -
`docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs` - with the service and the
worker run from source. [`docs/development.md`](../docs/development.md) is that path.

## What it starts

| Service        | Image or target            | Where                 | For                                                            |
| -------------- | -------------------------- | --------------------- | -------------------------------------------------------------- |
| `postgres`     | `pgvector/pgvector:pg17`   | `127.0.0.1:5432`      | Every environment's schema, and the job queue                  |
| `seaweedfs`    | `chrislusf/seaweedfs:4.46` | `127.0.0.1:8333`      | Documents, by content hash under a prefix per environment      |
| `stand-in-idp` | `tools`                    | `127.0.0.1:9090`      | Signing in, as an organisation's provider and as Google        |
| `setup`        | `tools`                    | runs once, then exits | Migrations, two invented environments, a store credential each |
| `service`      | `service`                  | `127.0.0.1:8088`      | The API, and the renderer beside it                            |
| `worker`       | `worker`                   | no port               | Claims jobs and runs them, carrying Typst and veraPDF          |
| `connector`    | `connector`                | no port               | Reaches a tenant's own data sources, and nothing else          |

`service` and `worker` wait for `setup` to finish, and `setup` waits for the database and the store
to be healthy, so one `up` is enough from nothing.

### The connector and its two networks

`connector` is the one process that reaches a tenant's own source
([data.md](../docs/design/data.md#the-connector)). It is on two networks and no others:
`connector-private`, which it shares with the service alone and which carries the service's requests
to it on port 8090, and `connector-egress`, out to the sources. Both are `internal: true` with
`com.docker.network.bridge.gateway_mode_ipv4: isolated`, so neither is routed anywhere else and
neither gives the host an address on its bridge: from the connector, nothing of the platform
answers - not the database, the store, the provider or the worker, by name or by address - and no
port the host publishes answers either, on any address. **That option needs Docker Engine 28 or
later**; The worker is on neither network, so it has no
address for the connector at all. `tests/e2e`'s `connector-isolation.test.ts` asks the running
stack all of this on every CI run, and on Docker Desktop for Windows (engine 29.8.1) it holds as it
does on Linux: a port published on every address, and a process on the Windows host listening on
every address, each answer an ordinary container through the host and neither answers the
connector.

The service reaches it at `CONNECTOR_URL` with the key in `SECRET_CONNECTOR_KEY`; without the two
the service still starts, and every data act answers `connector_unavailable`.

**It runs as root with three capabilities and nothing else**: `cap_drop: [ALL]`, `cap_add: [SETUID,
SETGID, KILL]`, `no-new-privileges` and `read_only: true`. Each request's child runs as a user of its
own (20000 plus its slot), so the kernel keeps it from the keys the supervisor still holds in its
`/proc` environment; switching to that user, and killing it, is what the three capabilities are for.
A deployment that runs the connector must give it the same: without them it refuses to start, saying
so, rather than run children that could read its keys.

### A source to connect to: the `sources` profile

`source-postgres` is a PostgreSQL of a tenant's own for development and CI, pinned by digest, TLS on
with the image's own snakeoil pair, and seeded by `sources/postgres.sql`: a database `readings`, a
schema `sample` with `site`, `reading` and a view `site_summary`, a read-only account `reader`
(`source-reader-dev-password`) and an account `writer` (`source-writer-dev-password`) that may add
readings. It is on `connector-egress` alone and publishes no port, so only the connector reaches it.
It starts only when asked for:

```bash
docker compose -f deploy/compose.yaml --profile sources up -d --build --wait
```

or with `COMPOSE_PROFILES=sources` in `deploy/.env`. Then, signed in as Ada, **Connections** makes a
connection in General to host `source-postgres`, port `5432`, database `readings`, account `reader`,
TLS `require`; setting its password tests it. `pnpm dev:setup` gives Ada a development role,
**Connection user**, holding `use_connection` on General, since no starting role holds it.

Open **`http://dev.acme.localhost:8088`** once it is up. The page names the environment, offers a
way in, and the stand-in will sign you in as Ada, Grace or Alice. The same environment also answers
at `http://127.0.0.1:8088`, which is what the end-to-end suite uses and what to reach for when
`*.localhost` does not resolve on your machine.

## Two names that have to work from both sides

The object store and the sign-in provider each answer to a `*.localhost` name as well as to a
container name - `store.localhost` and `idp.localhost`. A signed download link and a sign-in
redirect both carry the address that made them, so the browser has to be able to follow the same
address the service used. Any `*.localhost` name resolves to the local machine in a browser and to
the container inside the compose network, which is what makes one address work on both sides.

**A published port must therefore be the same number as the port inside the container.** Each port
in `.env` sets both, and every address that names it, so they move together.

## Building the images by hand

The build context is the repository root, not this directory, because the images are built from the
whole workspace. Run these **from the root**:

```bash
docker build -f deploy/Dockerfile --target service -t alloy-works-service .
docker build -f deploy/Dockerfile --target worker -t alloy-works-worker .
docker build -f deploy/Dockerfile --target connector -t alloy-works-connector .
```

`Dockerfile.dockerignore` is read in preference to any `.dockerignore` at the context root, which is
how the ignore list stays next to the file it belongs to. If you rename the Dockerfile, rename that
with it: nothing fails loudly when it stops matching, the build just gets slower and fatter.

| Target      | Carries                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `build`     | The workspaces the containers need, installed and built; the others copy from it                                                   |
| `tools`     | The whole workspace, for the setup step and the stand-in provider. Development only                                                |
| `service`   | `apps/service` and its production dependencies, plus the built renderer                                                            |
| `worker`    | The same for `apps/worker`, plus the pinned Typst binary, checked against its hash, and veraPDF on Debian's Java 17                |
| `connector` | `apps/connector` and its production dependencies - the domain, the sealing package, `pg` and `zod` - and nothing of the platform's |

No shipped image carries development tooling, test files or Electron. Each runs as the `node`
user. CI builds each on every pull request, for x86-64, and runs each entry point; nothing is pushed
anywhere, because where they would be pushed comes with hosting.

**The worker image builds for x86-64 and arm64.** Typst is downloaded for the architecture being
built, and veraPDF, which checks every publication's PDF, runs on Debian's `openjdk-17-jre-headless`,
which Debian publishes for both. Only veraPDF's jars and launcher are copied from its pinned
`verapdf/cli` image, which is published for x86-64 alone; `VERAPDF_PLATFORM` names that platform, so
an arm64 build takes the same jars. An arm64 build has been made under emulation and its veraPDF run
there; no arm64 machine has run the worker natively yet:

```bash
docker buildx build --platform linux/arm64 -f deploy/Dockerfile --target worker .
```

## When a port is already taken

Every port the stack publishes comes from `deploy/.env`, which Compose reads from this directory.
Copy the example and change what you need; the copy is git-ignored:

```bash
cp deploy/.env.example deploy/.env
```

| Variable        | Default | What it moves                                                                           |
| --------------- | ------- | --------------------------------------------------------------------------------------- |
| `SERVICE_PORT`  | `8088`  | The service, and the addresses the stand-in provider returns people to after signing in |
| `IDP_PORT`      | `9090`  | The stand-in provider, and the issuer address the setup and the service are given       |
| `STORE_PORT`    | `8333`  | The object store's S3 API, and the endpoint the setup, the service and the worker use   |
| `POSTGRES_PORT` | `5432`  | Postgres on `127.0.0.1` only; the containers still reach it at `postgres:5432`          |

Each variable sets the port inside the container and the one published, and every setting that
names it, so nothing has to be moved by hand. The end-to-end suite reads its own addresses:
`ALLOY_E2E_SERVICE`, `ALLOY_E2E_IDP` and `ALLOY_E2E_IDP_ISSUER` tell it where a moved stack is. The
browser suite reads `ALLOY_BROWSER_SERVICE`, `ALLOY_BROWSER_API` and `ALLOY_BROWSER_IDP`.

**A second stack beside the first** needs a project name of its own as well as ports of its own, since
the file names the project: `-p` overrides it, and every container, network and volume takes the new
name, so the first stack is never touched.

```bash
SERVICE_PORT=8188 IDP_PORT=9190 STORE_PORT=8433 POSTGRES_PORT=5532 \
  docker compose -p aw-browser -f deploy/compose.yaml up -d --build --wait
docker compose -p aw-browser -f deploy/compose.yaml down -v
```

## Driving the stack in a browser

`pnpm test:browser` drives the renderer this stack serves in a pinned Chromium, fetched once with
`pnpm --filter @alloy-works/browser fetch-chromium`. It opens `http://dev.acme.localhost:8088`, signs
in through the stand-in's own page as Ada, and makes what it needs through the API; a change to the
renderer reaches it only once the `service` image is rebuilt. CI runs it in the whole-system job,
after the end-to-end suite and against the same containers.
[`docs/testing.md`](../docs/testing.md#the-browser-suite) has the rest.

## Settings for running from source

Running the service or the worker from source, rather than in a container, reads a file here:

```bash
cp deploy/service.env.example deploy/service.env   # then pnpm --filter @alloy-works/service dev
cp deploy/worker.env.example deploy/worker.env     # then pnpm --filter @alloy-works/worker dev
```

Each `dev` script names its own file through Node's `--env-file-if-exists`, so a missing one is not
an error - you get the configuration failure instead, naming the variable. `*.env` is git-ignored
and `*.env.example` is not, so your copy stays yours and the example stays honest.

**The containers read none of this.** `compose.yaml` gives each of them its own environment, so
`docker compose up` needs no file here at all, and nothing in this folder ever enters an image -
`Dockerfile.dockerignore` excludes the whole directory.

## Configuration

Each image refuses to start without its configuration and says which variable is missing, rather
than failing somewhere further in. The compose file sets all of them, and the two `*.env.example`
files above set the same ones for a run from source; these are the ones worth knowing:

| Variable                           | Read by                | What it does                                                                                                                          |
| ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | service, worker        | Which database, as which login role                                                                                                   |
| `RENDERER_ROOT`                    | service                | Where the built renderer is; without it, the API and nothing else                                                                     |
| `OBJECT_STORE_ENDPOINT`, `_BUCKET` | service, worker        | The object store, which must be an address a browser can follow too                                                                   |
| `SECRET_OBJECT_STORE_KEY`          | service, worker, setup | Seals each environment's store credential and its sign-in client secret before they are stored; the service will not start without it |
| `VERAPDF_COMMAND`                  | worker                 | veraPDF's launcher; the image's own, `/opt/verapdf/verapdf`, unset                                                                    |
| `JAVA_OPTS`                        | worker                 | veraPDF's JVM options; `-XX:MaxRAMPercentage=50` added where they name no heap limit                                                  |
| `LEASE_MS`                         | worker                 | How long a claimed job is held, two minutes unset; veraPDF gets a third to start and a third to check                                 |
| `SWEEP_INTERVAL_MS`                | worker                 | How often the sweeps run, a check that gave up queued again among them                                                                |
| `SIGN_IN_HOST`, `GOOGLE_CLIENT_ID` | service                | The Google route; set together or not at all                                                                                          |
| `DEV_EXTRA_HOSTNAME`               | setup                  | An extra address for the development environment                                                                                      |
| `ALLOY_SERVICE_URL`                | the desktop app        | Which environment its window opens                                                                                                    |
| `CONNECTOR_URL`                    | service                | Where the connector answers, `http://connector:8090` in the stack; set with `SECRET_CONNECTOR_KEY`, or neither                        |
| `SECRET_CONNECTOR_KEY`             | service                | The key the service presents to the connector: the connector's `CONNECTOR_KEY`                                                        |
| `CONNECTOR_KEY`                    | connector              | 32 bytes of base64 the service must present; read once at start and deleted from the environment                                      |
| `CONNECTOR_SEALING_KEY`            | connector              | 32 bytes of base64, another key, that seals and opens every source credential; the service never holds it                             |
| `CONNECTOR_DENY`                   | connector              | Required: the platform's own address ranges, as CIDRs separated by commas, or `none` where the networks already hold it apart         |
| `CONNECTOR_PORT`, `CONNECTOR_HOST` | connector              | Where it listens, `8090` on every address unset                                                                                       |
| `CONNECTOR_MAX_CHILDREN`           | connector              | How many requests run at once, each in a fresh process, 8 unset; the next is answered `connector_busy`                                |
| `COMPOSE_PROFILES`                 | Compose                | `sources` starts the development source with every `up`                                                                               |

Secrets arrive as `SECRET_*` variables and never reach a log: the configuration the service logs at
start-up names them, never their values. veraPDF, a child of the worker, is started with `PATH`, the
locale and `JAVA_OPTS` and none of the worker's other variables, so it holds neither the database URL
nor the store's key. Give `JAVA_OPTS` a heap limit sized to the worker's container, `-Xmx` or
`-XX:MaxRAMPercentage`; without one, the worker sets half the container's memory. veraPDF has the
worker's network access, but its XMP parser refuses external entities: an external DTD, an external
general entity and a parameter entity in a PDF's metadata were each refused with no request made, in
the final review of the check. Its Java runtime, Debian's `openjdk-17-jre-headless`, floats with
Debian's updates, as the `node:24-bookworm-slim` base does.

**An environment's sign-in client secret is not one of them.** It is the environment's own, sealed with
`SECRET_OBJECT_STORE_KEY` into its own schema when its sign-in is configured
(`configureOrganisationSignIn` in `packages/db`, given the secret itself), and opened for that
environment alone. The setup container configures the development environments this way, with the
stand-in's client secret; running it again seals the secret afresh, and is how an installation set up
before secrets were sealed catches up - until then those environments sign nobody in through the
stand-in, and the service's log says so. Only the Google route's secret, which is one for the whole
product, stays a variable, `SECRET_GOOGLE`.

## What is not here yet

- **No hosted deployment of any kind**, and so no registry, no TLS termination, no secret store, no
  backups and no monitoring. Everything above runs on one machine over plain HTTP.
- **No release process.** Images are built on every pull request and thrown away; the desktop
  installer is built locally and is unsigned.
  [`docs/ci-and-releases.md`](../docs/ci-and-releases.md) is where that will be written down.
- **No migration story for an installation that already has data.** The migration runner is real and
  tested; running it against something that matters is not yet a procedure anyone has written.
