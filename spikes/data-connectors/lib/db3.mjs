// Phase 3: direct connections to the two source databases for cases 5 to 7, from a container on
// aw-dc-sources. Invented, fake development credentials, as in compose.yaml and the init files.
import pg from 'pg';
import tedious from 'tedious';
const { Connection, Request } = tedious;

export const PG = { host: '172.31.20.21', port: 5432, database: 'sourcedb' };
export const PG_CONNECTOR = {
  ...PG,
  user: 'connector_login',
  password: 'source-pg-connector-fake-pw',
};
export const PG_OBSERVER = { ...PG, user: 'postgres', password: 'source-pg-fake-pw' };
export const PG_ADA_LOGIN = { ...PG, user: 'ada_login', password: 'ada-login-fake-pw' };
export const MS = { server: '172.31.20.22', port: 1433, database: 'sourcedb' };
export const MS_CONNECTOR = {
  ...MS,
  user: 'connector_login',
  password: 'Spike-Connector-Fake-Pw1',
};
export const MS_OBSERVER = { ...MS, user: 'sa', password: 'Spike-SqlServer-Fake-Pw1' };

export async function pgClient(cfg = PG_CONNECTOR, extra = {}) {
  const c = new pg.Client({ ...cfg, ...extra });
  await c.connect();
  return c;
}

export function msConnect(cfg = MS_CONNECTOR, extra = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Connection({
      server: cfg.server,
      authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
      options: {
        port: cfg.port,
        database: cfg.database,
        encrypt: true,
        trustServerCertificate: true,
        connectTimeout: 10000,
        requestTimeout: 30000,
        ...extra,
      },
    });
    conn.on('connect', (err) => (err ? reject(err) : resolve(conn)));
    conn.on('error', () => {});
    conn.connect();
  });
}

// Run one request; returns { rows: [ {col: value} ], meta } or rejects with the driver's error.
// `onRow(row, request)` may return false to stop consuming (the caller cancels).
export function msQuery(conn, sql, params = [], { onRow, onMeta } = {}) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let meta = null;
    const req = new Request(sql, (err) =>
      err ? reject(Object.assign(err, { rows, meta })) : resolve({ rows, meta }),
    );
    for (const p of params) req.addParameter(p.name, p.type, p.value, p.options);
    req.on('columnMetadata', (m) => {
      meta = m.map((c) => ({
        name: c.colName,
        type: c.type.name,
        precision: c.precision,
        scale: c.scale,
      }));
      onMeta?.(meta, req);
    });
    req.on('row', (cols) => {
      const r = Object.fromEntries(cols.map((c) => [c.metadata.colName, c.value]));
      if (onRow) {
        if (onRow(r, req, cols) === false) return;
      } else rows.push(r);
    });
    conn.execSql(req);
  });
}

export function msClose(conn) {
  try {
    conn.close();
  } catch {}
}
