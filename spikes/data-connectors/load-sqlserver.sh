#!/usr/bin/env bash
# Load SQL Server's schema once the server answers (it has no init hook): the phase 1 schema, then
# phase 2's least-privileged login, the users it may impersonate, and the EXECUTE AS table. Retries
# for up to two minutes. Run from spikes/data-connectors. Invented credentials only.
set -u
export MSYS_NO_PATHCONV=1
C=aw-data-connectors-sqlserver-1
SQLCMD="/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P Spike-SqlServer-Fake-Pw1 -C -b"
docker cp init/sqlserver.sql "$C:/tmp/init.sql"
docker cp init/sqlserver-phase2.sql "$C:/tmp/init2.sql"
for i in $(seq 1 60); do
  if docker exec "$C" $SQLCMD -Q "select 1" >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "$C" $SQLCMD -i /tmp/init.sql && docker exec "$C" $SQLCMD -i /tmp/init2.sql && echo "sqlserver schema loaded"
