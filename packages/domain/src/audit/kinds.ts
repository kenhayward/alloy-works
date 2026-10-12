import { z } from 'zod';
import { permissions } from '../access/permissions.js';

/**
 * The audit log's closed list of kinds (audit.md, "Event types"; the AU1 plan, AU1-A): each with the
 * requirement it answers (LIF-063), a strict `detail` and the module that emits it, or null where a
 * later design builds the act. A kind added is a code change, and a migration of `audit_event`'s
 * check, which a test holds to this list. AU1.2 and AU1.3 build the emitters named here; the census
 * (AU1.3) holds each to its module.
 *
 * A detail holds identifiers, names, codes and rules, never a value (LIF-030): a name is a short
 * identifier, so a value - a host, an address, a credential, a sentence - does not fit one.
 */

const Id = z.uuid();

/** A field's, setting's, code's or rule's name: lower camel or snake, dotted, never a value. */
export const AuditName = z
  .string()
  .max(64)
  .regex(/^[a-z][A-Za-z0-9_]*(\.[a-z][A-Za-z0-9_]*)*$/);

/** An identifier that is not a uuid: a node's or a binding's, from its own short alphabet. */
const Identifier = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** A requirement's identifier, as the trace names it. */
const RuleId = z.string().regex(/^[A-Z]{3}-\d{3}$/);

/** `tenant`, or a kind and a uuid: what a refusal or a grant was about, as `formatLevel` writes it. */
export const AuditTarget = z
  .string()
  .regex(
    /^(tenant|(space|artifact|grant):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
  );

const SignInRoute = z.enum(['organisation', 'google']);

/**
 * Why a sign-in failed, by kind alone (IAM-013): never the provider's message. A provider's error or
 * refusal and an uninvited account name nobody; a Google hand-off that expired or was redeemed in
 * another browser names the principal it was for.
 */
export const signInFailures = [
  'provider_error',
  'provider_refused',
  'not_invited',
  'handoff_expired',
  'handoff_other_browser',
] as const;
const Permission = z.enum(permissions);
const empty = z.strictObject({});

/** Why an authorisation was refused: a decision's reason, or a token at a route taking a session. */
export const refusalReasons = [
  'denied',
  'not_granted',
  'capped',
  'scoped',
  'token_not_allowed',
] as const;

/** A refused authorisation (IAM-013): what was asked, of what, the rule and whether it was hidden. */
export const AccessRefusedDetail = z.strictObject({
  permission: Permission.nullable(),
  target: AuditTarget.nullable(),
  reason: z.enum(refusalReasons),
  /** The level that decided, where one did. */
  level: AuditTarget.nullable(),
  /** Answered as not found, though the target exists (audit.md, "Writing"). */
  hidden: z.boolean(),
  /** The wire code the caller was answered with, and the rule, where one refused. */
  code: AuditName,
  rule: RuleId.optional(),
});

const Grant = z.strictObject({
  role: Id,
  level: AuditTarget,
  effect: z.enum(['allow', 'deny']),
  grantee: Id,
  granteeKind: z.enum(['principal', 'group']),
});

const Membership = z.strictObject({
  group: Id,
  principal: Id,
  through: z.enum(['manual', 'provider']),
});

const Binding = z.strictObject({
  document: Id,
  node: Identifier,
  binding: Identifier,
  dataset: Id.optional(),
  version: Id.optional(),
  /** A check's finding for the binding: its result unchanged, or a revision waiting. */
  outcome: z.enum(['unchanged', 'revision']).optional(),
});

/** A canonical value in a revision's detail: what it was and what it became (DAT-058). */
const Canonical = z.union([z.string().max(10000), z.boolean(), z.null()]);

/**
 * A value revised by hand, or a revision withdrawn (the RV plan, RV-C, RV-D): where - its document,
 * node, binding and any cell - the resolution it stands in front of, the revision recorded, and the
 * value it was (the query's, or the revision it replaces) and the value it became.
 */
const Revised = z.strictObject({
  document: Id,
  node: Identifier,
  binding: Identifier,
  cell: z
    .strictObject({
      key: z.record(z.string().max(200), Canonical),
      column: z.string().max(200),
    })
    .optional(),
  act: z.enum(['revise', 'withdraw', 'keep']),
  resolution: z.string().regex(/^[0-9]{1,19}$/),
  revision: z.string().regex(/^[0-9]{1,19}$/),
  was: Canonical,
  became: Canonical,
});

/** An export, and what of. */
const Exported = z.strictObject({ export: Id, of: z.enum(['audit']) });

interface KindSpec {
  /** The requirements it answers (LIF-063). */
  readonly requirements: readonly string[];
  readonly detail: z.ZodType<Record<string, unknown>>;
  /** The module that writes it, or null where a later design builds the act. */
  readonly emittedBy: string | null;
}

const kind = (
  requirements: readonly string[],
  detail: z.ZodType<Record<string, unknown>>,
  emittedBy: string | null,
): KindSpec => ({ requirements, detail, emittedBy });

const SESSIONS = 'apps/service/src/sessions.ts';
const AUDIT_LOG = 'apps/service/src/audit-log.ts';
const LATER = null;

export const auditKindSpecs = {
  // The subject is the principal; the session is named in detail. A session also ends by the expiry
  // sweep (apps/worker/src/sweep.ts) and by a route closed (packages/db/src/sign-in.ts).
  'authentication.signed_in': kind(
    ['IAM-013'],
    z.strictObject({ route: SignInRoute, session: Id }),
    SESSIONS,
  ),
  'authentication.sign_in_failed': kind(
    ['IAM-013'],
    z.strictObject({
      route: SignInRoute,
      failure: z.enum(signInFailures),
      /** For a failure naming nobody: how many since the route's last, at most one a minute. */
      count: z.int().positive().optional(),
    }),
    'apps/service/src/audit.ts',
  ),
  'authentication.signed_out': kind(
    ['IAM-013', 'IAM-040'],
    z.strictObject({
      // `ended_by_holder`: its holder ended it from another of their sessions (IAM-040).
      ended: z.enum(['signed_out', 'expired', 'route_closed', 'ended_by_holder']),
      session: Id,
      expiredAt: z.iso.datetime({ offset: true }).optional(),
    }),
    SESSIONS,
  ),
  'access.refused': kind(['IAM-013', 'LIF-026'], AccessRefusedDetail, 'apps/service/src/audit.ts'),
  'access.granted': kind(['ADM-002', 'LIF-026', 'IAM-050'], Grant, 'packages/db/src/grants.ts'),
  'access.revoked': kind(['ADM-002', 'LIF-026'], Grant, 'packages/db/src/grants.ts'),
  'group.made': kind(['ADM-002'], empty, 'packages/db/src/groups.ts'),
  'group.deleted': kind(['ADM-002'], empty, 'packages/db/src/groups.ts'),
  'group.member_added': kind(['ADM-002'], Membership, 'packages/db/src/groups.ts'),
  'group.member_removed': kind(['ADM-002'], Membership, 'packages/db/src/groups.ts'),
  'invitation.sent': kind(
    ['ADM-002'],
    z.strictObject({ principal: Id }),
    'packages/db/src/invitations.ts',
  ),
  'invitation.accepted': kind(
    ['ADM-002'],
    z.strictObject({ principal: Id }),
    'packages/db/src/invitations.ts',
  ),
  'invitation.withdrawn': kind(
    ['ADM-002'],
    z.strictObject({ principal: Id }),
    'packages/db/src/invitations.ts',
  ),
  'tenant.invited': kind(['IAM-060'], empty, 'packages/db/src/sign-in.ts'),
  'tenant.administrator_named': kind(
    ['IAM-060'],
    z.strictObject({ principal: Id }),
    'packages/db/src/first-administrator.ts',
  ),
  'tenant.administrator_claimed': kind(
    ['IAM-060'],
    z.strictObject({ principal: Id }),
    'packages/db/src/invitations.ts',
  ),
  'sign_in_route.configured': kind(
    ['IAM-043'],
    z.strictObject({ route: SignInRoute }),
    'packages/db/src/sign-in.ts',
  ),
  'sign_in_route.closed': kind(
    ['IAM-043'],
    z.strictObject({ route: SignInRoute }),
    'packages/db/src/sign-in.ts',
  ),
  'token.issued': kind(
    ['IAM-037'],
    z.strictObject({ scopes: z.array(Permission) }),
    'packages/db/src/api-tokens.ts',
  ),
  'token.used': kind(['IAM-037'], empty, 'packages/db/src/api-tokens.ts'),
  'token.revoked': kind(['IAM-037'], empty, 'packages/db/src/api-tokens.ts'),
  'space.made': kind(['ADM-002', 'ADM-049'], empty, 'packages/db/src/spaces.ts'),
  'space.renamed': kind(['ADM-002', 'ADM-049'], empty, 'packages/db/src/spaces.ts'),
  'space.archived': kind(['ADM-002', 'ADM-049'], empty, 'packages/db/src/spaces.ts'),
  'space.restored': kind(['ADM-002', 'ADM-049'], empty, 'packages/db/src/spaces.ts'),
  'settings.changed': kind(
    ['ADM-002', 'COL-060', 'LOC-036'],
    z.strictObject({ settings: z.array(AuditName).min(1) }),
    'apps/service/src/settings.ts',
  ),
  'content.version_cut': kind(
    ['LIF-026', 'DAT-013'],
    z.strictObject({ kind: AuditName, parent: Id.nullable(), author: Id.optional() }),
    'packages/db/src/versions.ts',
  ),
  'connection.made': kind(['DAT-007'], empty, 'packages/db/src/connections.ts'),
  'connection.changed': kind(
    ['DAT-007'],
    z.strictObject({ settings: z.array(AuditName).min(1) }),
    'packages/db/src/connections.ts',
  ),
  'connection.credential_set': kind(['DAT-007'], empty, 'packages/db/src/connections.ts'),
  'connection.tested': kind(
    ['DAT-007'],
    z.strictObject({
      outcome: AuditName,
      findings: z.array(AuditName),
      /** A failed test's code (DAT-007): never the source's words. */
      failure: AuditName.optional(),
    }),
    'packages/db/src/connections.ts',
  ),
  'connection.retired': kind(['DAT-007'], empty, 'packages/db/src/connections.ts'),
  'binding.resolved': kind(['LIF-026'], Binding, 'apps/service/src/data/bindings.ts'),
  'binding.checked': kind(['LIF-026'], Binding, 'apps/service/src/data/bindings.ts'),
  'binding.accepted': kind(['LIF-026', 'DAT-037'], Binding, 'apps/service/src/data/bindings.ts'),
  'binding.confirmed': kind(['LIF-026'], Binding, 'apps/service/src/data/bindings.ts'),
  'dataset.named': kind(['LIF-026'], empty, 'packages/db/src/datasets.ts'),
  'asset.ingested': kind(['LIF-064'], empty, 'packages/db/src/assets.ts'),
  'asset.refused': kind(
    ['AST-037', 'LIF-064'],
    z.strictObject({ reason: AuditName }),
    'packages/db/src/assets.ts',
  ),
  'asset.replaced': kind(['LIF-064'], empty, LATER),
  'asset.relicensed': kind(['LIF-064'], empty, LATER),
  'publication.requested': kind(
    ['LIF-026'],
    // `baseline` names the baseline a publish is made from (the BL final review); absent for one
    // of the document as it is.
    z.strictObject({ request: Id, formats: z.array(AuditName).min(1), baseline: Id.optional() }),
    'packages/db/src/publishing.ts',
  ),
  // A publication's events are about the document version it publishes: the subject.
  'publication.produced': kind(
    ['LIF-026', 'LIF-050'],
    z.strictObject({ request: Id, publication: Id }),
    'apps/worker/src/jobs/publish.ts',
  ),
  'publication.failed': kind(
    ['LIF-026'],
    z.strictObject({ request: Id, codes: z.array(AuditName) }),
    'apps/worker/src/jobs/publish.ts',
  ),
  // An export asked for and each download of it handed out (the AU2 plan, AU-N): the audit log's
  // today, a document's when IMP builds one, told apart by `of`.
  'export.produced': kind(['LIF-026', 'LIF-028', 'ADM-039', 'IMP-023'], Exported, AUDIT_LOG),
  'export.downloaded': kind(['LIF-026', 'LIF-028', 'ADM-039', 'IMP-044'], Exported, AUDIT_LOG),
  'audit.label_erased': kind(
    ['VER-038'],
    z.strictObject({ labels: z.int().nonnegative() }),
    'packages/db/migrations/tenant/0060_audit.sql',
  ),
  // Declared now, emitted by the design that builds the act, which gives its detail a shape.
  'workflow.transitioned': kind(['LIF-026'], empty, LATER),
  'approval.given': kind(['LIF-026'], empty, LATER),
  'approval.rejected': kind(['LIF-026', 'LIF-053'], empty, LATER),
  'gate.rejected': kind(['LIF-053', 'LIF-057'], empty, LATER),
  'hold.applied': kind(['LIF-057'], empty, LATER),
  'hold.removed': kind(['LIF-057'], empty, LATER),
  'artifact.archived': kind(['LIF-057'], empty, LATER),
  'artifact.deleted': kind(['LIF-057'], empty, LATER),
  'revision.designated': kind(['LIF-026'], empty, LATER),
  // A baseline made, and one superseded by a later one (the BL plan): about the document version it
  // pins, the subject; its name is the document's content, never the log's.
  'baseline.made': kind(
    ['LIF-026', 'VER-021'],
    z.strictObject({ baseline: Id }),
    'packages/db/src/baselines.ts',
  ),
  'baseline.superseded': kind(
    ['LIF-026', 'VER-049'],
    z.strictObject({ baseline: Id, by: Id }),
    'packages/db/src/baselines.ts',
  ),
  // A restore (the RS plan, RS-C): about the new version, the subject; the earlier one it came from.
  'content.restored': kind(
    ['LIF-026', 'CNT-170'],
    z.strictObject({ kind: AuditName, from: Id }),
    'packages/db/src/restore.ts',
  ),
  'reference.repointed': kind(['CNT-161'], empty, LATER),
  // A lock taken from an idle holder after their grace (COL-009; collaboration.md): whom from, and
  // the session it was taken from; the taker is the actor.
  'lock.taken': kind(
    ['COL-009', 'COL-045'],
    z.strictObject({ from: Id, session: Id }),
    'apps/service/src/editing.ts',
  ),
  // A thread started, a comment added or edited, a thread resolved (the TH plan): about what the
  // thread is on, the subject; identifiers alone, never the words (COL-036).
  'thread.started': kind(
    ['COL-012'],
    z.strictObject({ thread: Id, anchor: AuditName }),
    'packages/db/src/threads.ts',
  ),
  'comment.added': kind(
    ['COL-014', 'COL-015'],
    z.strictObject({ thread: Id, comment: Id, mentions: z.int().nonnegative() }),
    'packages/db/src/threads.ts',
  ),
  'comment.edited': kind(
    ['COL-051'],
    z.strictObject({ thread: Id, comment: Id }),
    'packages/db/src/threads.ts',
  ),
  'thread.resolved': kind(
    ['COL-013'],
    z.strictObject({ thread: Id }),
    'packages/db/src/threads.ts',
  ),
  'suggestion.made': kind(
    ['COL-021'],
    z.strictObject({ suggestion: Id, against: Id }),
    'packages/db/src/suggestions.ts',
  ),
  'suggestion.accepted': kind(
    ['COL-024'],
    z.strictObject({ suggestion: Id, author: Id, version: Id }),
    'packages/db/src/suggestions.ts',
  ),
  'suggestion.rejected': kind(
    ['COL-024'],
    z.strictObject({ suggestion: Id, author: Id }),
    'packages/db/src/suggestions.ts',
  ),
  'suggestion.withdrawn': kind(
    ['COL-048'],
    z.strictObject({ suggestion: Id }),
    'packages/db/src/suggestions.ts',
  ),
  'round.opened': kind(
    ['COL-028'],
    z.strictObject({
      round: Id,
      reviewers: z.number().int().min(1).max(50),
      baseline: Id.optional(),
    }),
    'packages/db/src/rounds.ts',
  ),
  'round.closed': kind(['COL-028'], z.strictObject({ round: Id }), 'packages/db/src/rounds.ts'),
  'review.completed': kind(
    ['COL-032'],
    z.strictObject({ round: Id, outcome: z.enum(['commented', 'nothing_to_say']) }),
    'packages/db/src/rounds.ts',
  ),
  'review.reopened': kind(['COL-057'], z.strictObject({ round: Id }), 'packages/db/src/rounds.ts'),
  'template.moved': kind(['TPL-033'], empty, LATER),
  'binding.revised': kind(['DAT-058', 'LIF-064'], Revised, 'apps/service/src/data/revisions.ts'),
  'relationship.made': kind(['LIF-064', 'REL-011'], empty, LATER),
  'relationship.changed': kind(['LIF-064', 'REL-033'], empty, LATER),
  'relationship.removed': kind(['LIF-064', 'REL-011'], empty, LATER),
  'generation.run': kind(['LIF-064'], empty, LATER),
  'generation.accepted': kind(['LIF-064', 'GEN-024', 'LOC-041'], empty, LATER),
  'generation.discarded': kind(['LIF-064'], empty, LATER),
  'publication.shared_accessed': kind(['LIF-064'], empty, LATER),
  'support.granted': kind(['LIF-064', 'ADM-042'], empty, LATER),
  'support.used': kind(['LIF-064', 'ADM-024'], empty, LATER),
  'support.revoked': kind(['LIF-064', 'ADM-042'], empty, LATER),
  'channel.changed': kind(['LIF-064'], empty, LATER),
  'tool.used': kind(['LIF-064', 'API-023'], empty, LATER),
  // Declared for the requirements that say their act is audited (LIF-063), each emitted by the design
  // that builds its act.
  'secret.accessed': kind(['ADM-009'], empty, LATER),
  'tenant.closed': kind(['ADM-030', 'LIF-066'], empty, LATER),
  'webhook.changed': kind(['API-055', 'LIF-064'], empty, LATER),
  'extension.changed': kind(['API-059', 'LIF-064'], empty, LATER),
  'organisation.changed': kind(['IAM-068'], empty, LATER),
  'import.restored': kind(['IMP-048'], empty, LATER),
  'library.changed': kind(['LIB-056'], empty, LATER),
  'line.merged': kind(['LIF-045'], empty, LATER),
  'revision.effective': kind(['LIF-060'], empty, LATER),
  'component.type_changed': kind(['MET-014'], empty, LATER),
  'theme.moved': kind(['STY-026', 'STY-066'], empty, LATER),
  'style.changed': kind(['STY-032'], empty, LATER),
} as const satisfies Record<string, KindSpec>;

export type AuditKind = keyof typeof auditKindSpecs;

/** Every kind, in the order `audit_event`'s check constraint lists them: sorted. */
export const auditKinds = (Object.keys(auditKindSpecs) as AuditKind[]).sort();

export function isAuditKind(value: string): value is AuditKind {
  return Object.hasOwn(auditKindSpecs, value);
}

/**
 * A kind's detail, checked against its shape: what the store writes, or a throw naming the kind and
 * the members that failed, never their values.
 */
export function parseAuditDetail(kind: AuditKind, detail: unknown): Record<string, unknown> {
  const parsed = auditKindSpecs[kind].detail.safeParse(detail);
  if (parsed.success) return parsed.data;
  const members = parsed.error.issues.map((issue) => issue.path.join('.') || '(the whole)');
  throw new Error(`The detail of ${kind} does not fit its shape at ${members.join(', ')}`);
}
