import {
  labels,
  principalLabel,
  recordEvent,
  setAuditContext,
  type AuditLabel,
  type SignInRoute,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { formatLevel, isLabelledKind, labelFor, type AuditContext } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { AppError, type AccessRefusal, type RefusedTarget } from './errors.js';

/**
 * The service's part of the audit log (audit.md, "Writing"; the AU1 plan, AU1-D and AU1-E): who a
 * request's transactions act for, and the refusals it answers with.
 */

/** Who a request acts for: its principal, by session or by token, under its trace id. */
export function contextOf(request: FastifyRequest): AuditContext | undefined {
  const principal = request.principal;
  if (!principal) return undefined;
  const actorLabel = principal.displayName?.trim().slice(0, 400) || undefined;
  const named = {
    actor: principal.principalId,
    traceId: request.id,
    ...(actorLabel === undefined ? {} : { actorLabel }),
  };
  return request.credential?.kind === 'token'
    ? { actorKind: 'token', token: request.credential.id, ...named }
    : { actorKind: 'person', ...named };
}

function targetText(target: RefusedTarget): string {
  return target.kind === 'grant' ? `grant:${target.id}` : formatLevel(target);
}

/** What a refused target is called now, kept beside the event for when it is gone. */
async function targetLabel(
  trx: TenantTransaction,
  target: RefusedTarget | null,
): Promise<AuditLabel | undefined> {
  if (target === null || target.kind === 'tenant' || target.kind === 'grant') return undefined;
  if (target.kind === 'space') {
    const space = await trx
      .selectFrom('space')
      .select('name')
      .where('id', '=', target.id)
      .executeTakeFirst();
    const text = space && labelFor('space', space);
    return text === undefined ? undefined : { role: 'subject', text, refersTo: target.id };
  }
  const latest = await trx
    .selectFrom('artifact_version')
    .select(['kind', 'content'])
    .where('artifact_id', '=', target.id)
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!latest || !isLabelledKind(latest.kind)) return undefined;
  const text = labelFor(latest.kind, latest.content as Record<string, unknown>);
  return text === undefined ? undefined : { role: 'subject', text, refersTo: target.id };
}

/** Writes a refusal's event in `trx`, which carries the refused principal's context. */
export async function recordRefusalIn(
  trx: TenantTransaction,
  error: AppError & { readonly refusal: AccessRefusal },
): Promise<void> {
  const { refusal } = error;
  const label = await targetLabel(trx, refusal.target);
  await recordEvent(
    trx,
    {
      kind: 'access.refused',
      outcome: 'refused',
      ...(refusal.target === null ? {} : { subject: subjectOf(refusal.target) }),
      space: refusal.target?.kind === 'space' ? refusal.target.id : (refusal.space ?? null),
      detail: {
        permission: refusal.permission,
        target: refusal.target && targetText(refusal.target),
        reason: refusal.reason,
        level: refusal.level && formatLevel(refusal.level),
        hidden: refusal.hidden,
        code: error.code,
        ...(error.rule === undefined ? {} : { rule: error.rule }),
      },
    },
    label === undefined ? [] : [label],
  );
}

function subjectOf(target: RefusedTarget) {
  return target.kind === 'tenant' ? { kind: 'tenant' } : { kind: target.kind, id: target.id };
}

/** Whether an error is a refused authorisation the log records. */
export function isRefusal(error: unknown): error is AppError & { readonly refusal: AccessRefusal } {
  return error instanceof AppError && error.refusal !== undefined;
}

/**
 * Records a refused authorisation of an identified principal (IAM-013; AU1-E), in a short transaction
 * of its own, since the refused act committed nothing. Anything else - a plain not found, an anonymous
 * request - is not recorded. A failure to write is logged at error and never changes the answer.
 */
export async function recordRefusal(
  db: TenantDatabase,
  request: FastifyRequest,
  error: unknown,
): Promise<void> {
  if (!isRefusal(error) || !request.tenant) return;
  const context = contextOf(request);
  if (!context) return;
  try {
    await db.withTenant(request.tenant, (trx) => recordRefusalIn(trx, error), context);
  } catch (failure) {
    request.log.error({ err: failure }, 'the refusal could not be recorded');
  }
}

/**
 * Names `principalId` as who the rest of this transaction acts for, by their name as it is now: a
 * sign-in's own transaction, which names nobody until it knows who signed in (the AU1 plan, AU1-F).
 */
export async function actAs(
  trx: TenantTransaction,
  principalId: string,
  traceId: string,
): Promise<void> {
  const label = await principalLabel(trx, 'actor', principalId);
  await setAuditContext(trx, {
    actorKind: 'person',
    actor: principalId,
    traceId,
    ...(label === undefined ? {} : { actorLabel: label.text }),
  });
}

/** Why a sign-in failed, by kind alone: never the provider's words (IAM-013). */
export type SignInFailure =
  | 'provider_error'
  | 'provider_refused'
  | 'not_invited'
  | 'handoff_expired'
  | 'handoff_other_browser';

/**
 * Records a failed sign-in (IAM-013) in a short transaction of its own, since the sign-in commits
 * nothing: as the principal it was for where one is known, and as nobody otherwise. A failure to write
 * is logged at error and never changes the answer, which is a failure either way.
 */
export async function recordSignInFailure(
  db: TenantDatabase,
  request: FastifyRequest,
  tenant: Tenant,
  route: SignInRoute,
  failure: SignInFailure,
  principalId?: string,
): Promise<void> {
  try {
    await db.withTenant(
      tenant,
      async (trx) => {
        if (principalId !== undefined) await actAs(trx, principalId, request.id);
        await recordEvent(
          trx,
          {
            kind: 'authentication.sign_in_failed',
            outcome: 'refused',
            ...(principalId === undefined
              ? {}
              : { subject: { kind: 'principal', id: principalId } }),
            detail: { route, failure },
          },
          principalId === undefined
            ? []
            : labels(await principalLabel(trx, 'subject', principalId)),
        );
      },
      { actorKind: 'anonymous', traceId: request.id },
    );
  } catch (error) {
    request.log.error({ err: error }, 'the failed sign-in could not be recorded');
  }
}
