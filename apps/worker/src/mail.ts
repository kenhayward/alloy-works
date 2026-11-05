import { randomUUID } from 'node:crypto';
import {
  claimMail,
  recordMailAttempt,
  type ClaimedMail,
  type MailOutcome,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { MAIL_DEADLINE_MS, TEST_MAIL, type AuditContext } from '@alloy-works/domain';

import type { Mailer } from './mailer.js';
import type { WorkerLog } from './worker.js';

const SYSTEM: AuditContext = { actorKind: 'system' };

/** At most this many mails a tenant a pass, and this many tenants at once (EM-M, EM-I). */
export const MAILS_A_PASS = 50;
const TENANTS_AT_ONCE = 2;

/**
 * How long a claimed pass is held: each mail sent in turn at its deadline and the connector's five
 * seconds more, with a minute to spare, so no other worker claims its tail while it is sent.
 */
const LEASE_MS = MAILS_A_PASS * (MAIL_DEADLINE_MS + 5000) + 60_000;

/** The name a mail shows it is from where the tenant has none of its own, nor a channel's (EM-K). */
const PRODUCT = 'Alloy Works';

/**
 * One pass of the mail loop (the EM plan, EM-M), in every live tenant, two at a time: the mails due
 * claimed with a lease, each decided again for whom it is to (EM-G), sent through the connector one
 * after another outside any transaction, and recorded after. A tenant's pass ends at its relay's
 * first failure, so a black-holed relay holds up only its own tenant. A suspended or closing tenant's
 * mail waits, costing no attempt (EM-T). Answers how many were attempted.
 */
export async function sendMail(
  db: TenantDatabase,
  mailer: Mailer,
  log: WorkerLog,
): Promise<number> {
  const waiting = [...(await db.liveTenants())];
  let attempted = 0;
  await Promise.all(
    Array.from({ length: Math.min(TENANTS_AT_ONCE, waiting.length) }, async () => {
      for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
        try {
          attempted += await sendInTenant(db, next, mailer, log);
        } catch (error) {
          log.error({ tenant: next.id, err: error }, 'mail failed in a tenant');
        }
      }
    }),
  );
  return attempted;
}

async function sendInTenant(
  db: TenantDatabase,
  tenant: Tenant,
  mailer: Mailer,
  log: WorkerLog,
): Promise<number> {
  const { claimed, dropped } = await db.withTenant(
    tenant,
    (trx) => claimMail(trx, MAILS_A_PASS, LEASE_MS),
    SYSTEM,
  );
  if (dropped > 0) log.info({ tenant: tenant.id, dropped }, 'dropped mail nobody may be sent');
  let attempted = 0;
  for (const mail of claimed) {
    attempted += 1;
    let outcome: MailOutcome;
    try {
      const answer = await mailer({
        requestId: randomUUID(),
        tenant: tenant.id,
        id: mail.id,
        relay: mail.relay,
        fromName: mail.fromName ?? tenant.name ?? PRODUCT,
        to: mail.to,
        ...wordsOf(mail),
      });
      outcome =
        answer === 'busy'
          ? { kind: 'wait' }
          : answer.type === 'sent'
            ? { kind: 'sent', latencyMs: answer.latencyMs }
            : {
                kind: 'failed',
                failure: answer.code,
                latencyMs: answer.latencyMs,
                ...(answer.smtpCode === undefined ? {} : { smtpCode: answer.smtpCode }),
              };
    } catch (error) {
      // Nothing recorded: its lease runs out and it is sent again, with the same id (EM-L).
      log.error({ tenant: tenant.id, err: error }, 'a mail failed');
      return attempted;
    }
    const { relayFailed } = await db.withTenant(
      tenant,
      (trx) => recordMailAttempt(trx, mail.id, outcome, mail.lease),
      SYSTEM,
    );
    if (outcome.kind === 'failed' && outcome.failure === 'relay_not_configured') {
      log.warn({ tenant: tenant.id }, 'the operator offers no mail relay: mail is dropped');
    }
    const quota = outcome.kind === 'failed' && outcome.failure === 'quota_reached';
    if (relayFailed || quota || outcome.kind === 'wait') {
      // The rest wait for the next pass: their lease is given back now, not when it runs out.
      await db.withTenant(
        tenant,
        async (trx) => {
          const rest = claimed.slice(claimed.indexOf(mail) + 1);
          for (const each of rest) {
            await recordMailAttempt(trx, each.id, { kind: 'wait' }, each.lease);
          }
        },
        SYSTEM,
      );
      return attempted;
    }
  }
  return attempted;
}

/** What a mail says, in the product's words and none of anybody's content (EM-E). */
function wordsOf(mail: ClaimedMail): { readonly subject: string; readonly text: string } {
  switch (mail.purpose) {
    case 'test':
      return TEST_MAIL;
  }
}
