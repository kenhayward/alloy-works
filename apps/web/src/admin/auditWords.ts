import type { AuditKind } from '@alloy-works/domain';
import { words } from '../words/words.js';

/**
 * **The audit log's kinds in words** (the AU2 plan, AU-O): what each event says happened, as the Audit
 * log shows it, and each family's name for the filter. Every kind the log holds has words, which a test
 * holds to the domain's list.
 */
export const KIND_WORDS: Readonly<Record<AuditKind, string>> = {
  get 'access.granted'() {
    return words('admin.access-granted');
  },
  get 'access.refused'() {
    return words('admin.refused');
  },
  get 'access.revoked'() {
    return words('admin.access-removed');
  },
  get 'approval.given'() {
    return words('admin.approved');
  },
  get 'artifact.archived'() {
    return words('admin.archived');
  },
  get 'artifact.deleted'() {
    return words('admin.deleted');
  },
  get 'artifact.unarchived'() {
    return words('admin.unarchived');
  },
  get 'artifact.undeleted'() {
    return words('admin.undeleted');
  },
  get 'asset.ingested'() {
    return words('admin.asset-added');
  },
  get 'asset.refused'() {
    return words('admin.asset-refused');
  },
  get 'asset.relicensed'() {
    return words('admin.asset-licence-changed');
  },
  get 'asset.replaced'() {
    return words('admin.asset-replaced');
  },
  get 'audit.label_erased'() {
    return words('admin.a-person-s-names-erased');
  },
  get 'authentication.sign_in_failed'() {
    return words('admin.sign-in-failed');
  },
  get 'authentication.signed_in'() {
    return words('admin.signed-in');
  },
  get 'authentication.signed_out'() {
    return words('admin.signed-out');
  },
  get 'baseline.made'() {
    return words('admin.baseline-made');
  },
  get 'baseline.superseded'() {
    return words('admin.baseline-superseded');
  },
  get 'binding.accepted'() {
    return words('admin.data-accepted');
  },
  get 'binding.checked'() {
    return words('admin.data-checked');
  },
  get 'binding.confirmed'() {
    return words('admin.data-confirmed');
  },
  get 'binding.resolved'() {
    return words('admin.data-fetched');
  },
  get 'binding.revised'() {
    return words('admin.data-revised');
  },
  get 'channel.changed'() {
    return words('admin.channel-changed');
  },
  get 'component.type_changed'() {
    return words('admin.component-type-changed');
  },
  get 'connection.changed'() {
    return words('admin.connection-changed');
  },
  get 'connection.credential_set'() {
    return words('admin.connection-credential-set');
  },
  get 'connection.made'() {
    return words('admin.connection-made');
  },
  get 'connection.retired'() {
    return words('admin.connection-retired');
  },
  get 'connection.tested'() {
    return words('admin.connection-tested');
  },
  get 'content.restored'() {
    return words('admin.restored');
  },
  get 'content.version_cut'() {
    return words('admin.version-saved');
  },
  get 'dataset.named'() {
    return words('admin.dataset-named');
  },
  get 'export.downloaded'() {
    return words('admin.export-downloaded');
  },
  get 'export.produced'() {
    return words('admin.exported');
  },
  get 'extension.changed'() {
    return words('admin.extension-changed');
  },
  get 'gate.rejected'() {
    return words('admin.stopped-at-a-gate');
  },
  get 'generation.accepted'() {
    return words('admin.generated-text-accepted');
  },
  get 'generation.discarded'() {
    return words('admin.generated-text-discarded');
  },
  get 'generation.run'() {
    return words('admin.text-generated');
  },
  get 'group.deleted'() {
    return words('admin.group-deleted');
  },
  get 'group.made'() {
    return words('admin.group-made');
  },
  get 'group.member_added'() {
    return words('admin.added-to-a-group');
  },
  get 'group.member_removed'() {
    return words('admin.removed-from-a-group');
  },
  get 'hold.applied'() {
    return words('admin.hold-placed');
  },
  get 'hold.removed'() {
    return words('admin.hold-released');
  },
  get 'import.accepted'() {
    return words('admin.import-accepted');
  },
  get 'import.abandoned'() {
    return words('admin.import-abandoned');
  },
  get 'import.restored'() {
    return words('admin.import-restored');
  },
  get 'invitation.accepted'() {
    return words('admin.invitation-accepted');
  },
  get 'invitation.sent'() {
    return words('admin.invited');
  },
  get 'invitation.withdrawn'() {
    return words('admin.invitation-withdrawn');
  },
  get 'library.changed'() {
    return words('admin.library-changed');
  },
  get 'line.merged'() {
    return words('admin.lines-merged');
  },
  get 'lock.taken'() {
    return words('admin.lock-taken');
  },
  get 'model_endpoint.changed'() {
    return words('admin.model-endpoint-changed');
  },
  get 'model_endpoint.credential_set'() {
    return words('admin.model-endpoint-key-set');
  },
  get 'model_endpoint.made'() {
    return words('admin.model-endpoint-made');
  },
  get 'model_endpoint.retired'() {
    return words('admin.model-endpoint-retired');
  },
  get 'model_endpoint.tested'() {
    return words('admin.model-endpoint-tested');
  },
  get 'model_route.set'() {
    return words('admin.model-route-set');
  },
  get 'guardrail.set'() {
    return words('admin.guardrail-set');
  },
  get 'guardrail.retired'() {
    return words('admin.guardrail-retired');
  },
  get 'generation.limit_set'() {
    return words('admin.model-rate-limit-set');
  },
  get 'generation.budget_set'() {
    return words('admin.model-budget-set');
  },
  get 'generation.embedding_confirmed'() {
    return words('admin.embedding-model-confirmed');
  },
  get 'organisation.changed'() {
    return words('admin.organisation-changed');
  },
  get 'publication.failed'() {
    return words('admin.publishing-failed');
  },
  get 'publication.produced'() {
    return words('admin.published');
  },
  get 'publication.requested'() {
    return words('admin.publishing-requested');
  },
  get 'publication.shared_accessed'() {
    return words('admin.shared-publication-opened');
  },
  get 'reference.repointed'() {
    return words('admin.reference-repointed');
  },
  get 'relationship.changed'() {
    return words('admin.relationship-changed');
  },
  get 'relationship.made'() {
    return words('admin.relationship-made');
  },
  get 'relationship.removed'() {
    return words('admin.relationship-removed');
  },
  get 'retention.changed'() {
    return words('admin.retention-changed');
  },
  get 'revision.designated'() {
    return words('admin.revision-designated');
  },
  get 'dates.set'() {
    return words('admin.dates-set');
  },
  get 'scope.set'() {
    return words('admin.scope-set');
  },
  get 'line.diverged'() {
    return words('admin.line-begun');
  },
  get 'line.returned'() {
    return words('admin.line-brought-back');
  },
  get 'revision.accepted'() {
    return words('admin.revision-accepted');
  },
  get 'section.waived'() {
    return words('admin.required-section-removed');
  },
  get 'review.lapsed'() {
    return words('admin.review-lapsed');
  },
  get 'revision.effective'() {
    return words('admin.revision-in-effect');
  },
  get 'secret.accessed'() {
    return words('admin.secret-read');
  },
  get 'settings.changed'() {
    return words('admin.settings-changed');
  },
  get 'sign_in_route.closed'() {
    return words('admin.sign-in-route-closed');
  },
  get 'sign_in_route.configured'() {
    return words('admin.sign-in-route-set-up');
  },
  get 'space.archived'() {
    return words('admin.space-archived');
  },
  get 'space.made'() {
    return words('admin.space-made');
  },
  get 'space.renamed'() {
    return words('admin.space-renamed');
  },
  get 'space.restored'() {
    return words('admin.space-restored');
  },
  get 'style.changed'() {
    return words('admin.style-changed');
  },
  get 'thread.started'() {
    return words('admin.thread-started');
  },
  get 'comment.added'() {
    return words('admin.comment-added');
  },
  get 'comment.edited'() {
    return words('admin.comment-edited');
  },
  get 'thread.made_internal'() {
    return words('admin.thread-made-internal');
  },
  get 'thread.resolved'() {
    return words('admin.thread-resolved');
  },
  get 'suggestion.made'() {
    return words('admin.suggestion-made');
  },
  get 'suggestion.accepted'() {
    return words('admin.suggestion-accepted');
  },
  get 'suggestion.rejected'() {
    return words('admin.suggestion-rejected');
  },
  get 'suggestion.withdrawn'() {
    return words('admin.suggestion-withdrawn');
  },
  get 'round.opened'() {
    return words('admin.review-round-opened');
  },
  get 'round.closed'() {
    return words('admin.review-round-closed');
  },
  get 'review.completed'() {
    return words('admin.review-completed');
  },
  get 'review.reopened'() {
    return words('admin.review-reopened');
  },
  get 'support.granted'() {
    return words('admin.support-access-granted');
  },
  get 'support.revoked'() {
    return words('admin.support-access-removed');
  },
  get 'support.used'() {
    return words('admin.support-access-used');
  },
  get 'template.moved'() {
    return words('admin.moved-to-another-template-version');
  },
  get 'tenant.administrator_claimed'() {
    return words('admin.first-administrator-signed-in');
  },
  get 'tenant.administrator_named'() {
    return words('admin.first-administrator-named');
  },
  get 'tenant.closed'() {
    return words('admin.environment-closed');
  },
  get 'tenant.invited'() {
    return words('admin.environment-opened');
  },
  get 'theme.moved'() {
    return words('admin.moved-to-another-theme-version');
  },
  get 'token.issued'() {
    return words('admin.api-token-issued');
  },
  get 'token.revoked'() {
    return words('admin.api-token-revoked');
  },
  get 'token.used'() {
    return words('admin.api-token-used');
  },
  get 'service_identity.created'() {
    return words('admin.service-identity-made');
  },
  get 'service_identity.renamed'() {
    return words('admin.service-identity-renamed');
  },
  get 'service_identity.disabled'() {
    return words('admin.service-identity-disabled');
  },
  get 'tool.used'() {
    return words('admin.tool-used');
  },
  get 'translation.declared'() {
    return words('admin.retranslation-declared');
  },
  get 'translation.marked_current'() {
    return words('admin.translation-marked-current');
  },
  get 'translation.job_sent'() {
    return words('admin.translation-job-sent');
  },
  get 'translation.job_closed'() {
    return words('admin.translation-job-closed');
  },
  get 'translation.job_returned'() {
    return words('admin.translation-job-returned');
  },
  get 'translation.job_decided'() {
    return words('admin.held-translation-decided');
  },
  get 'translation.machine_accepted'() {
    return words('admin.machine-draft-accepted');
  },
  get 'webhook.changed'() {
    return words('admin.webhook-changed');
  },
  get 'workflow.defined'() {
    return words('admin.workflow-saved');
  },
  get 'workflow.transitioned'() {
    return words('admin.workflow-moved-on');
  },
};

/** Each family's name, for the kind filter: every kind before its dot is one. */
export const FAMILY_WORDS: Readonly<Record<string, string>> = {
  get access() {
    return words('admin.access');
  },
  get approval() {
    return words('admin.approval');
  },
  get artifact() {
    return words('admin.archiving-and-deletion');
  },
  get asset() {
    return words('admin.assets');
  },
  get audit() {
    return words('admin.the-log-itself');
  },
  get authentication() {
    return words('admin.signing-in-and-out');
  },
  get baseline() {
    return words('admin.baselines');
  },
  get binding() {
    return words('admin.data-in-documents');
  },
  get channel() {
    return words('admin.channels');
  },
  get comment() {
    return words('admin.comments');
  },
  get component() {
    return words('admin.component-types');
  },
  get connection() {
    return words('admin.connections');
  },
  get content() {
    return words('admin.versions');
  },
  get dataset() {
    return words('admin.datasets');
  },
  get dates() {
    return words('admin.dates');
  },
  get scope() {
    return words('admin.scopes');
  },
  get export() {
    return words('admin.exports');
  },
  get extension() {
    return words('admin.extensions');
  },
  get gate() {
    return words('admin.gates');
  },
  get generation() {
    return words('admin.generated-text');
  },
  get group() {
    return words('admin.groups');
  },
  get hold() {
    return words('admin.legal-holds');
  },
  get import() {
    return words('admin.imports');
  },
  get invitation() {
    return words('admin.invitations');
  },
  get library() {
    return words('admin.libraries');
  },
  get line() {
    return words('admin.lines');
  },
  get lock() {
    return words('admin.locks');
  },
  get model_endpoint() {
    return words('admin.model-endpoints');
  },
  get model_route() {
    return words('admin.model-routes');
  },
  get guardrail() {
    return words('admin.guardrails');
  },
  get organisation() {
    return words('admin.the-organisation');
  },
  get publication() {
    return words('admin.publishing');
  },
  get reference() {
    return words('admin.references');
  },
  get relationship() {
    return words('admin.relationships');
  },
  get retention() {
    return words('admin.retention');
  },
  get review() {
    return words('admin.reviews-2');
  },
  get revision() {
    return words('admin.revisions');
  },
  get round() {
    return words('admin.review-rounds');
  },
  get secret() {
    return words('admin.secrets');
  },
  get section() {
    return words('admin.sections');
  },
  get settings() {
    return words('admin.settings');
  },
  get service_identity() {
    return words('admin.service-identities');
  },
  get sign_in_route() {
    return words('admin.sign-in-routes');
  },
  get space() {
    return words('admin.spaces');
  },
  get style() {
    return words('admin.styles');
  },
  get suggestion() {
    return words('admin.suggestions');
  },
  get support() {
    return words('admin.support-access');
  },
  get template() {
    return words('admin.templates');
  },
  get tenant() {
    return words('admin.the-environment');
  },
  get theme() {
    return words('admin.themes');
  },
  get thread() {
    return words('admin.threads');
  },
  get token() {
    return words('admin.api-tokens');
  },
  get tool() {
    return words('admin.tools');
  },
  get translation() {
    return words('admin.translation');
  },
  get webhook() {
    return words('admin.webhooks');
  },
  get workflow() {
    return words('admin.workflow');
  },
};

/** What an event says happened, or its kind as stored where these words do not know it. */
export const kindWords = (kind: string): string =>
  (KIND_WORDS as Readonly<Record<string, string>>)[kind] ?? kind;
