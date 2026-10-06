import { childRequestSchema, type PostgresSettings } from '@alloy-works/domain';
import pg from 'pg';

/**
 * A child made to crash (DAT-005's last case): it reads its request as the real child does, connects
 * as the real child does, and lets the driver's own error go uncaught, so Node writes it, with its
 * stack, to standard error and exits without an answer. The supervisor must answer `connector_error`
 * and let nothing of it through.
 */
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const request = childRequestSchema.parse(
  JSON.parse(Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? ''),
);
const source = request.request.settings.source as PostgresSettings['source'];
const client = new pg.Client({
  host: source.host,
  port: source.port,
  database: source.database,
  user: source.account,
  password: request.secret,
  ssl: { rejectUnauthorized: false },
  application_name: 'alloy-connector',
});
await client.connect();
