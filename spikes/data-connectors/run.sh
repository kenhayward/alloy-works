#!/usr/bin/env bash
# Phase 3: run a case script in a one-shot container on aw-dc-sources (the connector's network), with
# the harness's current source copied in, so no image rebuild is needed after an edit to lib/ or a
# case. Linux, in a container, as the brief's section 6 asks.
#   bash run.sh case6.mjs                          # plain
#   bash run.sh case6.mjs -e TZ=Pacific/Kiritimati # extra `docker run` arguments after the script
# Output goes to stdout; redirect it to a dcp3-*.json file.
set -u
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
S="$1"; shift
docker run --rm --network aw-dc-sources "$@" -v "$HERE:/src:ro" aw-dc-agent:latest \
  sh -c "cp /src/*.mjs /app/ && cp -r /src/lib /app/ && cd /app && node $S"
