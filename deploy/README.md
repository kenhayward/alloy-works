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
| `Dockerfile`              | Every image the system runs as, as four targets sharing one install and one build |
| `Dockerfile.dockerignore` | What never enters a build context: `node_modules`, `dist`, the docs, this folder  |
| `compose.yaml`            | The whole system for development, and the shape a small installation takes        |
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
| `worker`       | `worker`                   | no port               | Claims jobs and runs them, carrying the pinned Typst           |

`service` and `worker` wait for `setup` to finish, and `setup` waits for the database and the store
to be healthy, so one `up` is enough from nothing.

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
```

`Dockerfile.dockerignore` is read in preference to any `.dockerignore` at the context root, which is
how the ignore list stays next to the file it belongs to. If you rename the Dockerfile, rename that
with it: nothing fails loudly when it stops matching, the build just gets slower and fatter.

| Target    | Carries                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `build`   | The workspaces the containers need, installed and built; the others copy from it    |
| `tools`   | The whole workspace, for the setup step and the stand-in provider. Development only |
| `service` | `apps/service` and its production dependencies, plus the built renderer             |
| `worker`  | The same for `apps/worker`, plus the pinned Typst binary, checked against its hash  |

Neither shipped image carries development tooling, test files or Electron. Both run as the `node`
user. CI builds both on every pull request and runs each entry point; nothing is pushed anywhere,
because where they would be pushed comes with hosting.

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
`ALLOY_E2E_SERVICE`, `ALLOY_E2E_IDP` and `ALLOY_E2E_IDP_ISSUER` tell it where a moved stack is.

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

| Variable                           | Read by         | What it does                                                        |
| ---------------------------------- | --------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                     | service, worker | Which database, as which login role                                 |
| `RENDERER_ROOT`                    | service         | Where the built renderer is; without it, the API and nothing else   |
| `OBJECT_STORE_ENDPOINT`, `_BUCKET` | service, worker | The object store, which must be an address a browser can follow too |
| `SECRET_OBJECT_STORE_KEY`          | service, worker | Seals each environment's store credential before it is stored       |
| `SIGN_IN_HOST`, `GOOGLE_CLIENT_ID` | service         | The Google route; set together or not at all                        |
| `DEV_EXTRA_HOSTNAME`               | setup           | An extra address for the development environment                    |
| `ALLOY_SERVICE_URL`                | the desktop app | Which environment its window opens                                  |

Secrets arrive as `SECRET_*` variables and never reach a log: the configuration the service logs at
start-up names them, never their values.

## What is not here yet

- **No hosted deployment of any kind**, and so no registry, no TLS termination, no secret store, no
  backups and no monitoring. Everything above runs on one machine over plain HTTP.
- **No release process.** Images are built on every pull request and thrown away; the desktop
  installer is built locally and is unsigned.
  [`docs/ci-and-releases.md`](../docs/ci-and-releases.md) is where that will be written down.
- **No migration story for an installation that already has data.** The migration runner is real and
  tested; running it against something that matters is not yet a procedure anyone has written.
