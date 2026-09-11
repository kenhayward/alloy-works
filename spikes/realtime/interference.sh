#!/usr/bin/env bash
# Throwaway. What does notifying cost everything else?
#
# NOTIFY serialises commits that notify: each one takes a lock on the shared notification queue at
# commit. So the question is not only how many events a second Postgres can carry, but what carrying
# them does to ordinary writes that never notify. pgbench runs a plain insert from 16 clients for 20
# seconds, first alone, then while the producer notifies at each rate; then the producer runs alone
# as fast as it can, to find the ceiling. The two realtime instances stay connected and listening.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"

bench() {
  MSYS_NO_PATHCONV=1 docker exec rt-pg pgbench -n -U postgres -c 16 -j 4 -T 20 -f /spike/busy.sql postgres 2>/dev/null \
    | awk '/^tps/ {printf "%.0f", $3} /latency average/ {lat=$4} END {printf " tps, latency %s ms", lat}'
}

produce() {
  MSYS_NO_PATHCONV=1 docker run --rm --network rt-spike -v "$here:/app/spike" alloy-rt-spike \
    node /app/spike/load.mjs produce "$1" "$2"
}

echo "writes alone: $(bench)"
for rate in 300 1000 3000; do
  produce "$rate" 26 > "/tmp/produce-$rate.log" &
  sleep 4
  echo "writes while notifying at $rate/s: $(bench)"
  wait
  echo "  producer: $(cat "/tmp/produce-$rate.log")"
done
echo "producer alone, as fast as it can: $(produce 100000 15)"
