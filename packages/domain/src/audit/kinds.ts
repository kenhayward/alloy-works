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
/** A condition axis's key, or one of its values' (REU-020). */
const ScopeKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const ScopeValue = z.strictObject({ axis: ScopeKey, value: ScopeKey });

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
 * refusal, an uninvited account and an erased person (the ER plan, ER-D) name nobody; a Google
 * hand-off that expired or was redeemed in another browser names the principal it was for.
 */
export const signInFailures = [
  'provider_error',
  'provider_refused',
  'not_invited',
  'handoff_expired',
  'handoff_other_browser',
  'principal_erased',
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
  // An extension (IAM-050; the R13 plan, R13-E): the grant it extends and both expiries.
  extends: Id.optional(),
  expiresAt: z.string().optional(),
  extendedFrom: z.string().nullable().optional(),
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

/** Which version a reference takes: a pinned one's version, or `latest` or `approved` (CNT-182). */
const ReferenceMode = z.strictObject({
  kind: z.enum(['pinned', 'latest', 'approved']),
  version: Id.optional(),
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
const Exported = z.strictObject({ export: Id, of: z.enum(['audit', 'tenant']) });

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
const MODELS = 'packages/db/src/model-endpoints.ts';
const PROPOSALS = 'packages/db/src/generation-proposals.ts';

/** A relationship acted on: its type and itself, both by identifier (the R8 plan, R8-E). */
const Related = z.strictObject({ type: z.uuid(), relationship: z.uuid() });

export const auditKindSpecs = {
  // The subject is the principal; the session is named in detail. A session also ends by the expiry
  // sweep (apps/worker/src/sweep.ts) and by a route closed (packages/db/src/sign-in.ts).
  'authentication.signed_in': kind(
    ['IAM-013', 'LIF-067'],
    z.strictObject({ route: SignInRoute, session: Id }),
    SESSIONS,
  ),
  'authentication.sign_in_failed': kind(
    ['IAM-013', 'LIF-067'],
    z.strictObject({
      route: SignInRoute,
      failure: z.enum(signInFailures),
      /** For a failure naming nobody: how many since the route's last, at most one a minute. */
      count: z.int().positive().optional(),
    }),
    'apps/service/src/audit.ts',
  ),
  'authentication.signed_out': kind(
    ['IAM-013', 'IAM-040', 'LIF-067'],
    z.strictObject({
      // `ended_by_holder`: its holder ended it from another of their sessions (IAM-040). `erased`:
      // its holder was erased (the ER plan, ER-A).
      ended: z.enum(['signed_out', 'expired', 'route_closed', 'ended_by_holder', 'erased']),
      session: Id,
      expiredAt: z.iso.datetime({ offset: true }).optional(),
    }),
    SESSIONS,
  ),
  'access.refused': kind(['IAM-013', 'LIF-067'], AccessRefusedDetail, 'apps/service/src/audit.ts'),
  'access.granted': kind(['ADM-002', 'LIF-067', 'IAM-050'], Grant, 'packages/db/src/grants.ts'),
  'access.revoked': kind(['ADM-002', 'LIF-067'], Grant, 'packages/db/src/grants.ts'),
  'group.made': kind(['ADM-002', 'LIF-067'], empty, 'packages/db/src/groups.ts'),
  'group.deleted': kind(['ADM-002', 'LIF-067'], empty, 'packages/db/src/groups.ts'),
  'group.member_added': kind(['ADM-002', 'LIF-067'], Membership, 'packages/db/src/groups.ts'),
  'group.member_removed': kind(['ADM-002', 'LIF-067'], Membership, 'packages/db/src/groups.ts'),
  'invitation.sent': kind(
    ['ADM-002', 'LIF-067'],
    z.strictObject({ principal: Id }),
    'packages/db/src/invitations.ts',
  ),
  'invitation.accepted': kind(
    ['ADM-002', 'LIF-067'],
    z.strictObject({ principal: Id }),
    'packages/db/src/invitations.ts',
  ),
  'invitation.withdrawn': kind(
    ['ADM-002', 'LIF-067'],
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
  'space.made': kind(['ADM-002', 'ADM-049', 'LIF-067'], empty, 'packages/db/src/spaces.ts'),
  'space.renamed': kind(['ADM-002', 'ADM-049', 'LIF-067'], empty, 'packages/db/src/spaces.ts'),
  'space.archived': kind(['ADM-002', 'ADM-049', 'LIF-067'], empty, 'packages/db/src/spaces.ts'),
  'space.restored': kind(['ADM-002', 'ADM-049', 'LIF-067'], empty, 'packages/db/src/spaces.ts'),
  'settings.changed': kind(
    ['ADM-002', 'COL-060', 'LOC-036', 'LIF-067'],
    z.strictObject({ settings: z.array(AuditName).min(1) }),
    'apps/service/src/settings.ts',
  ),
  'content.version_cut': kind(
    ['LIF-067', 'DAT-120'],
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
  // A tenant's model endpoints (the G1 plan, G1-J): no detail holds a value, the key least of all.
  'model_endpoint.made': kind(['LIF-067', 'GEN-027'], empty, MODELS),
  'model_endpoint.changed': kind(
    ['LIF-067', 'GEN-027'],
    z.strictObject({ settings: z.array(AuditName).min(1) }),
    MODELS,
  ),
  'model_endpoint.credential_set': kind(['LIF-067', 'GEN-029'], empty, MODELS),
  'model_endpoint.tested': kind(
    ['LIF-067', 'GEN-027'],
    z.strictObject({ run: Id, outcome: AuditName }),
    MODELS,
  ),
  'model_endpoint.retired': kind(['LIF-067', 'GEN-027'], empty, MODELS),
  'model_route.set': kind(
    ['LIF-067', 'GEN-028'],
    z.strictObject({ purpose: AuditName, endpoint: Id.nullable() }),
    MODELS,
  ),
  'binding.resolved': kind(['LIF-067'], Binding, 'apps/service/src/data/bindings.ts'),
  'binding.checked': kind(['LIF-067'], Binding, 'apps/service/src/data/bindings.ts'),
  'binding.accepted': kind(['LIF-067', 'DAT-037'], Binding, 'apps/service/src/data/bindings.ts'),
  'binding.confirmed': kind(['LIF-067'], Binding, 'apps/service/src/data/bindings.ts'),
  'dataset.named': kind(['LIF-067'], empty, 'packages/db/src/datasets.ts'),
  'asset.ingested': kind(['LIF-069'], empty, 'packages/db/src/assets.ts'),
  'asset.refused': kind(
    ['AST-037', 'LIF-069'],
    z.strictObject({ reason: AuditName }),
    'packages/db/src/assets.ts',
  ),
  'asset.replaced': kind(['LIF-072'], empty, LATER),
  'asset.relicensed': kind(['LIF-072'], empty, LATER),
  'publication.requested': kind(
    ['LIF-067'],
    // `baseline` names the baseline a publish is made from (the BL final review); absent for one
    // of the document as it is.
    z.strictObject({ request: Id, formats: z.array(AuditName).min(1), baseline: Id.optional() }),
    'packages/db/src/publishing.ts',
  ),
  // A publication's events are about the document version it publishes: the subject.
  'publication.produced': kind(
    ['LIF-067', 'LIF-050'],
    z.strictObject({ request: Id, publication: Id }),
    'apps/worker/src/jobs/publish.ts',
  ),
  'publication.failed': kind(
    ['LIF-067'],
    z.strictObject({ request: Id, codes: z.array(AuditName) }),
    'apps/worker/src/jobs/publish.ts',
  ),
  // An export asked for and each download of it handed out (the AU2 plan, AU-N): the audit log's
  // today, the tenant's (the R21 plan, R21-B), a document's when IMP builds one, told apart by `of`.
  'export.produced': kind(['LIF-067', 'LIF-028', 'ADM-039', 'IMP-023'], Exported, AUDIT_LOG),
  'export.downloaded': kind(['LIF-067', 'LIF-028', 'ADM-039', 'IMP-044'], Exported, AUDIT_LOG),
  'audit.label_erased': kind(
    ['VER-038'],
    z.strictObject({ labels: z.int().nonnegative() }),
    'packages/db/migrations/tenant/0087_erasure.sql',
  ),
  // A component or a document moved from one workflow state to another (the WF1 plan, WF-I): by a
  // transition, or by a save of an approved one to the initial state, naming the version approved.
  // Whether a reason was given, never the reason, which is a value: the transition's row keeps it.
  'workflow.transitioned': kind(
    ['LIF-075', 'LIF-061'],
    z.strictObject({
      kind: z.enum(['component', 'document', 'queryDefinition', 'prompt']),
      transition: AuditName.nullable(),
      from: AuditName,
      to: AuditName,
      definition: z.int().positive(),
      reason: z.boolean(),
      approved: Id.optional(),
    }),
    'packages/db/src/workflow.ts',
  ),
  // A kind's workflow definition saved as a new version (WF-I): about the workflow settings.
  'workflow.defined': kind(
    ['LIF-007', 'LIF-067'],
    z.strictObject({
      kind: z.enum(['component', 'document', 'queryDefinition', 'prompt']),
      version: z.int().positive(),
    }),
    'packages/db/src/workflow.ts',
  ),
  // An approval at a gate, counted towards its passing (the WF2 plan, WF2-C, WF2-G): about the
  // artifact, the version approved its subject's.
  'approval.given': kind(
    ['LIF-075', 'LIF-008'],
    z.strictObject({
      kind: z.enum(['component', 'document', 'queryDefinition', 'prompt']),
      transition: AuditName,
      count: z.int().positive(),
      required: z.int().positive(),
    }),
    'packages/db/src/workflow-gates.ts',
  ),
  // A gate refused by an approver, the artifact returned (WF2-E): its own event, never a refusal of
  // access (LIF-053). The reason is kept on the approval's row, as a move's is.
  'gate.rejected': kind(
    ['LIF-074', 'LIF-053', 'LIF-051'],
    z.strictObject({
      kind: z.enum(['component', 'document', 'queryDefinition', 'prompt']),
      transition: AuditName,
      to: AuditName,
    }),
    'packages/db/src/workflow-gates.ts',
  ),
  // A revision designated as a gate passed (WF2-F): about the version designated.
  'revision.designated': kind(
    ['LIF-013', 'VER-014'],
    z.strictObject({
      kind: z.enum(['component', 'document', 'queryDefinition', 'prompt']),
      transition: AuditName,
      revision: z.int().positive(),
      // The axis values it is effective for, fixed as it was designated (LIF-042; the R15 plan, R15-B);
      // absent before R15 and where it is effective everywhere.
      scope: z.array(ScopeValue).max(50).optional(),
    }),
    'packages/db/src/workflow-gates.ts',
  ),
  // A baseline made, and one superseded by a later one (the BL plan): about the document version it
  // pins, the subject; its name is the document's content, never the log's.
  'baseline.made': kind(
    ['LIF-067', 'VER-058'],
    z.strictObject({ baseline: Id }),
    'packages/db/src/baselines.ts',
  ),
  'baseline.superseded': kind(
    ['LIF-067', 'VER-049'],
    z.strictObject({ baseline: Id, by: Id }),
    'packages/db/src/baselines.ts',
  ),
  // A component or a document archived and unarchived (the AH plan, AH-E): about the artifact.
  'artifact.archived': kind(['LIF-073'], empty, 'packages/db/src/archival.ts'),
  'artifact.unarchived': kind(['LIF-073'], empty, 'packages/db/src/archival.ts'),
  // A component or a document deleted and undeleted (the DL plan, DL-B): about the artifact.
  'artifact.deleted': kind(['LIF-073'], empty, 'packages/db/src/deletion.ts'),
  'artifact.undeleted': kind(['LIF-073'], empty, 'packages/db/src/deletion.ts'),
  // A minimum keep set or cleared (the DL plan, DL-G): its key, a kind or a space or both, and its
  // days, null where cleared. About the retention settings, with the space where one is named.
  'retention.changed': kind(
    ['LIF-019', 'LIF-067'],
    z.strictObject({
      kind: z.enum(['component', 'document']).nullable(),
      space: Id.nullable(),
      days: z.int().min(1).max(36_500).nullable(),
    }),
    'packages/db/src/keeps.ts',
  ),
  // A legal hold placed and released (the AH plan, AH-E): about the artifact or the space it holds;
  // its reason is Administration's alone, never the log's (LIF-030).
  'hold.applied': kind(['LIF-073'], z.strictObject({ hold: Id }), 'packages/db/src/holds.ts'),
  'hold.removed': kind(['LIF-073'], z.strictObject({ hold: Id }), 'packages/db/src/holds.ts'),
  // A restore (the RS plan, RS-C): about the new version, the subject; the earlier one it came from.
  'content.restored': kind(
    ['LIF-067', 'CNT-170'],
    z.strictObject({ kind: AuditName, from: Id }),
    'packages/db/src/restore.ts',
  ),
  // A reference taking another version (the RS plan, RS-G): about the document version recording it;
  // its node and component, and its mode before and after.
  'reference.repointed': kind(
    ['CNT-182', 'CNT-183'],
    z.strictObject({ node: Identifier, component: Id, from: ReferenceMode, to: ReferenceMode }),
    'packages/db/src/documents.ts',
  ),
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
  // A thread made internal after it was started (COL-038; the R13 plan, R13-C): kept from outside.
  'thread.made_internal': kind(
    ['COL-038'],
    z.strictObject({ thread: Id }),
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
  // A component's or document's dates set (LIF-015, LIF-016; the WF5 plan, WF5-A): what they now are.
  'dates.set': kind(
    ['LIF-015', 'LIF-016'],
    z.strictObject({
      kind: z.enum(['component', 'document']),
      effectiveAt: z.iso.datetime({ offset: true }).nullable(),
      reviewBy: z.iso.date().nullable(),
      owner: Id.nullable(),
    }),
    'packages/db/src/dates.ts',
  ),
  // The axis values a component's or document's next revision is effective for, set as an act, each
  // with the party who must accept it there (LIF-042, LIF-047; the R15 plan, R15-B).
  'scope.set': kind(
    ['LIF-042', 'LIF-047'],
    z.strictObject({
      kind: z.enum(['component', 'document']),
      scope: z
        .array(
          ScopeValue.extend({
            party: z.strictObject({ kind: z.enum(['principal', 'group']), id: Id }).nullable(),
          }),
        )
        .max(50),
    }),
    'packages/db/src/scopes.ts',
  ),
  // A divergent line of a component's revisions begun from a designated revision (LIF-044; the R16
  // plan, R16-B): the line, its name - the author's words, a label - and what it diverged from.
  'line.diverged': kind(
    ['LIF-044'],
    z.strictObject({
      kind: z.literal('component'),
      line: Id,
      name: z.string().min(1).max(80),
      from: z.strictObject({ revision: z.int().positive(), version: Id }),
    }),
    'packages/db/src/lines.ts',
  ),
  // A line brought back into the main line, block by block, and closed (LIF-045; the R16 plan,
  // R16-F, R16-G): the version it made, and how many blocks were carried across and left behind - the
  // blocks themselves on `line_return`, never here.
  'line.returned': kind(
    ['LIF-045'],
    z.strictObject({
      kind: z.literal('component'),
      line: Id,
      into: Id,
      carried: z.int().nonnegative(),
      left: z.int().nonnegative(),
    }),
    'packages/db/src/lines.ts',
  ),
  // A revision accepted by its party in one scope, so it takes effect there (LIF-047; R15-E).
  'revision.accepted': kind(
    ['LIF-047'],
    z.strictObject({
      kind: z.enum(['component', 'document']),
      revision: z.int().positive(),
      version: Id,
      axis: ScopeKey,
      value: ScopeKey,
    }),
    'packages/db/src/scopes.ts',
  ),
  // A revision approved to take effect later taking it, by nobody (LIF-060; WF5-D).
  'revision.effective': kind(
    ['LIF-060'],
    z.strictObject({
      kind: z.enum(['component', 'document']),
      revision: z.int().positive(),
      version: Id,
      effectiveAt: z.iso.datetime({ offset: true }),
    }),
    'packages/db/src/dates.ts',
  ),
  // A section the template requires removed with a reason (TPL-029; the WF6 plan, WF6-B): its key;
  // the reason on the waiver's row, never here.
  'section.waived': kind(
    ['TPL-029'],
    z.strictObject({ key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) }),
    'packages/db/src/documents.ts',
  ),
  // A review date passing unmet, and what the workflow declared it does (LIF-059; WF5-G).
  'review.lapsed': kind(
    ['LIF-059'],
    z.strictObject({
      kind: z.enum(['component', 'document']),
      reviewBy: z.iso.date(),
      action: z.enum(['visibility', 'move', 'escalate']),
      to: z.union([AuditName, Id]).optional(),
    }),
    'packages/db/src/dates.ts',
  ),
  // A document moved to a newer version of its template (TPL-033; the WF6 plan, WF6-C): from which
  // version to which, and how many values were not carried.
  'template.moved': kind(
    ['TPL-033'],
    z.strictObject({ template: Id, from: Id, to: Id, notCarried: z.int().nonnegative() }),
    'packages/db/src/template-move.ts',
  ),
  'binding.revised': kind(['DAT-058', 'LIF-069'], Revised, 'apps/service/src/data/revisions.ts'),
  // On the relationship's from end, naming its type and itself (the R8 plan, R8-E).
  'relationship.made': kind(['LIF-070', 'REL-011'], Related, 'packages/db/src/relationships.ts'),
  'relationship.changed': kind(['LIF-070', 'REL-033'], Related, 'packages/db/src/relationships.ts'),
  'relationship.removed': kind(['LIF-070', 'REL-011'], Related, 'packages/db/src/relationships.ts'),
  // The assistant (the G2 plan, G2-E): a run ended, and a proposal accepted or discarded.
  'generation.run': kind(
    ['LIF-071'],
    z.strictObject({ run: Id, outcome: AuditName, purpose: AuditName }),
    'packages/db/src/model-endpoints.ts',
  ),
  'generation.accepted': kind(
    ['LIF-071', 'GEN-024', 'LOC-041'],
    z.strictObject({ run: Id, proposal: Id, suggestion: Id }),
    PROPOSALS,
  ),
  'generation.discarded': kind(
    ['LIF-071', 'GEN-040'],
    z.strictObject({ run: Id, proposal: Id, suggestion: Id.optional() }),
    PROPOSALS,
  ),
  // A recipient from outside opening a shared publication, or one of its outputs (the R17 plan, R17-F).
  'publication.shared_accessed': kind(
    ['LIF-070', 'PUB-060'],
    z.strictObject({ output: z.enum(['pdf', 'docx', 'provenance', 'verapdf']).nullable() }),
    'packages/db/src/shares.ts',
  ),
  'support.granted': kind(['LIF-072', 'ADM-042'], empty, LATER),
  'support.used': kind(['LIF-072', 'ADM-024'], empty, LATER),
  'support.revoked': kind(['LIF-072', 'ADM-042'], empty, LATER),
  'channel.changed': kind(['LIF-072'], empty, LATER),
  'tool.used': kind(['LIF-071', 'API-023'], empty, LATER),
  // Declared for the requirements that say their act is audited (LIF-063), each emitted by the design
  // that builds its act.
  'secret.accessed': kind(['ADM-009'], empty, LATER),
  'tenant.closed': kind(['ADM-030', 'LIF-066'], empty, LATER),
  'webhook.changed': kind(['API-055', 'LIF-071'], empty, LATER),
  'extension.changed': kind(['API-059'], empty, LATER),
  'organisation.changed': kind(['IAM-068'], empty, LATER),
  'import.restored': kind(['IMP-048'], empty, LATER),
  'library.changed': kind(['LIB-056'], empty, LATER),
  'line.merged': kind(['LIF-045'], empty, LATER),
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
