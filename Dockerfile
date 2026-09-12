# syntax=docker/dockerfile:1

# One file, four targets. `build` installs and builds what the containers need; `tools` keeps the
# whole workspace for the compose stack's setup and stand-in provider; `service` and `worker` carry
# only their own production tree.
#
# Debian rather than Alpine: glibc is the surface native modules are built against, and image size is
# not what matters for a system that ships as a compose file.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# The manifests first, so a change to source does not reinstall the world.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/service/package.json apps/service/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/objects/package.json packages/objects/
COPY packages/stand-in-idp/package.json packages/stand-in-idp/
# Only what the containers need: this is what keeps Electron and the renderer out of the image.
RUN pnpm install --frozen-lockfile \
      --filter "@alloy-works/service..." \
      --filter "@alloy-works/worker..." \
      --filter "@alloy-works/stand-in-idp..."
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/service/ apps/service/
COPY apps/worker/ apps/worker/
RUN pnpm --filter "@alloy-works/service..." build \
 && pnpm --filter "@alloy-works/worker..." build
# Each app, with its own production dependencies and nothing else.
RUN pnpm deploy --filter @alloy-works/service --prod /prod/service \
 && pnpm deploy --filter @alloy-works/worker --prod /prod/worker

# Development only: the whole workspace, so the compose stack can prepare a database and run the
# stand-in provider. No deployed installation runs this.
FROM build AS tools
WORKDIR /repo
CMD ["pnpm", "dev:setup"]

FROM base AS service
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/service ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]

FROM base AS worker
ENV NODE_ENV=production TYPST_BINARY=/usr/local/bin/typst
# The version the worker is pinned to, and the hash of each architecture's release. Keep these in
# step with apps/worker/src/typst-release.ts, which the tests and `fetch-typst` use.
ARG TYPST_VERSION=0.15.1
ARG TYPST_SHA256_X86_64=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c
ARG TYPST_SHA256_AARCH64=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
 && rm -rf /var/lib/apt/lists/* \
 && case "$TARGETARCH" in \
      arm64) arch=aarch64; sha256=$TYPST_SHA256_AARCH64 ;; \
      *) arch=x86_64; sha256=$TYPST_SHA256_X86_64 ;; \
    esac \
 && curl -fsSL -o /tmp/typst.tar.xz \
      "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${arch}-unknown-linux-musl.tar.xz" \
 && echo "${sha256}  /tmp/typst.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/typst.tar.xz -C /tmp \
 && mv "/tmp/typst-${arch}-unknown-linux-musl/typst" /usr/local/bin/typst \
 && rm -rf /tmp/typst.tar.xz "/tmp/typst-${arch}-unknown-linux-musl" \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y \
 && typst --version
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./
USER node
CMD ["node", "dist/main.js"]
