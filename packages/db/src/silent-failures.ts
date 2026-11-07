import {
  capabilityHealth,
  decide,
  HEALTH_WINDOW_MS,
  silentFailureKey,
  silentFailuresNow,
  silentFailuresToTell,
  workHealth,
  type SilentFailureNow,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts } from './access-facts.js';
import { backgroundWork } from './background-work.js';
import { connectionRunsSince } from './connection-runs.js';
import { embeddingWaitSeconds } from './embeddings.js';
import { integrityOf } from './integrity.js';
import { capabilityUsage } from './measurements.js';
import { ownJobs } from './own-jobs.js';
import { notifyTenant } from './realtime.js';
import type { TenantTransaction } from './tables.js';

const DAY = 86_400_000;

/**
 * The environment's silent failures now (diagnostics.md, "Who else is told"; DGe4), from the records
 * Diagnostics reads: a capability failing over the health window, work failing or late, jobs failed in
 * the last day, a data source down, the index lagging past its ceiling, integrity failing.
 */
export async function silentFailuresOf(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<SilentFailureNow[]> {
  const minutes = await capabilityUsage(trx, 'minute', new Date(now.getTime() - HEALTH_WINDOW_MS));
  const counted = new Map<string, { requests: number; serverErrors: number; refused: number }>();
  for (const minute of minutes) {
    const sum = counted.get(minute.capability) ?? { requests: 0, serverErrors: 0, refused: 0 };
    counted.set(minute.capability, {
      requests: sum.requests + minute.requests,
      serverErrors: sum.serverErrors + minute.serverErrors,
      refused: sum.refused + minute.refused,
    });
  }
  return silentFailuresNow({
    // Failing reads the error rate alone, so no latency is needed.
    capabilities: [...counted].map(([capability, counts]) => ({
      capability,
      health: capabilityHealth({ ...counts, clientErrors: 0, buckets: [] }).health,
    })),
    work: (await backgroundWork(trx)).map((run) => ({
      work: run.work,
      health: workHealth(run, now),
    })),
    jobs: await ownJobs(trx, new Date(now.getTime() - DAY)),
    connections: (await connectionRunsSince(trx, new Date(now.getTime() - DAY))).map((each) => ({
      connection: each.connection,
      down: each.lastFailed,
    })),
    indexWaitSeconds: await embeddingWaitSeconds(trx),
    integrity: (await integrityOf(trx, now)).classes,
  });
}

/**
 * Tells those who administer the environment of each silent failure not yet told, once until it
 * clears, by an inbox kind never mailed, as a failing mail channel is (EM-N); a failure cleared is
 * forgotten, so its return tells again. Candidates are granted at the environment a role holding
 * administer, each decided again on their grants. A failure is recorded as told only once somebody
 * was. Answers how many were told of.
 */
export async function tellSilentFailures(
  trx: TenantTransaction,
  now: readonly SilentFailureNow[],
): Promise<number> {
  const told = await trx.selectFrom('silent_failure_told').select('failure').execute();
  const { tell, forget } = silentFailuresToTell(
    now,
    told.map((each) => each.failure),
  );
  if (forget.length > 0) {
    await trx.deleteFrom('silent_failure_told').where('failure', 'in', forget).execute();
  }
  if (tell.length === 0) return 0;
  const { rows: candidates } = await sql<{ id: string }>`
    select distinct p.id from access_grant g
      join role r on r.id = g.role_id
      left join group_member m on m.group_id = g.group_id
      join principal p on p.id = coalesce(g.principal_id, m.principal_id)
     where g.level = 'tenant' and g.effect = 'allow'
       and 'administer' = any (r.permissions)
       and p.kind = 'user' and p.disabled_at is null and p.erased_at is null`.execute(trx);
  const recipients: string[] = [];
  for (const { id } of candidates) {
    const facts = await loadFacts(trx, id, { kind: 'tenant' });
    if (facts !== undefined && decide('administer', facts).allowed) recipients.push(id);
  }
  if (recipients.length === 0) return 0;
  for (const failure of tell) {
    const counts = JSON.stringify({ kind: failure.kind, subject: failure.subject });
    for (const id of recipients) {
      await sql`insert into notification (recipient, kind, counts)
        values (${id}, 'diagnostics', ${counts}::jsonb)`.execute(trx);
    }
    await trx
      .insertInto('silent_failure_told')
      .values({ failure: silentFailureKey(failure) })
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }
  for (const id of recipients) await notifyTenant(trx, { kind: 'inbox', recipient: id });
  return tell.length;
}
