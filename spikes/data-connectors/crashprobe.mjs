// Case 2, the crash path: open the secret, force a driver failure, and rethrow the RAW driver error
// as an uncaught exception so Node prints it to stderr and exits - exactly what a crash report would
// capture. Run as a one-shot container; the harness searches its combined output for the secret.
// Env: KIND, plus the sealed spec fields.
import { openSecret } from './lib/seal.mjs';
import pg from 'pg';
import tedious from 'tedious';

const KIND = process.env.KIND || 'postgres';
const key = Buffer.from(process.env.SEALING_KEY, 'base64');
const secret = openSecret(key, 'connection', process.env.TENANT, process.env.SEALED);

if (KIND === 'postgres') {
  const cfg = process.env.CONN_STRING
    ? {
        connectionString: process.env.CONN_STRING.replace('__SECRET__', encodeURIComponent(secret)),
        connectionTimeoutMillis: 3000,
      }
    : {
        host: process.env.HOST,
        port: 5432,
        database: 'sourcedb',
        user: 'connector_login',
        password: secret,
        connectionTimeoutMillis: 3000,
      };
  const client = new pg.Client(cfg);
  client
    .connect()
    .then(() => client.query('select 1'))
    .then(() => process.exit(0))
    .catch((err) => {
      throw err;
    }); // uncaught -> Node prints err + stack to stderr, exit 1
} else {
  const conn = new tedious.Connection({
    server: process.env.HOST,
    authentication: { type: 'default', options: { userName: 'sa', password: secret } },
    options: {
      port: 1433,
      database: 'sourcedb',
      encrypt: true,
      trustServerCertificate: true,
      connectTimeout: 4000,
    },
  });
  conn.on('connect', (err) => {
    if (err) throw err;
    process.exit(0);
  });
  conn.on('error', (err) => {
    throw err;
  });
  conn.connect();
}
