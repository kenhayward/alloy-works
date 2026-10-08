import { z } from 'zod';

/** The request's trace id (API-047), which joins an event to the service's own logs. */
const TraceId = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
/** A principal's name as it was, kept as the event's actor label (audit.md, "Labels"). */
const ActorLabel = z.string().min(1).max(400);

/**
 * Who a tenant transaction acts for (the AU1 plan, AU1-D): written once per transaction, and read by
 * every event it records, so no event is ever unattributed. A person by session, a person by token,
 * the system (a job or a sweep, with the principal who asked for it where one did), the vendor, or
 * nobody (a failed sign-in naming no one).
 */
export const AuditContext = z.discriminatedUnion('actorKind', [
  z.strictObject({
    actorKind: z.literal('person'),
    actor: z.uuid(),
    actorLabel: ActorLabel.optional(),
    traceId: TraceId.optional(),
  }),
  z.strictObject({
    actorKind: z.literal('token'),
    actor: z.uuid(),
    token: z.uuid(),
    actorLabel: ActorLabel.optional(),
    traceId: TraceId.optional(),
  }),
  z.strictObject({
    actorKind: z.literal('system'),
    requestedBy: z.uuid().optional(),
    traceId: TraceId.optional(),
  }),
  z.strictObject({ actorKind: z.literal('vendor'), traceId: TraceId.optional() }),
  z.strictObject({ actorKind: z.literal('anonymous'), traceId: TraceId.optional() }),
]);

export type AuditContext = z.infer<typeof AuditContext>;

export const auditActorKinds = ['person', 'token', 'system', 'vendor', 'anonymous'] as const;
