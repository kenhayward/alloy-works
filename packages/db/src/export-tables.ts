/**
 * **What a whole-tenant export does with each table** (IMP-020; EI-B). Every table in a tenant's schema
 * is named here, so a table a migration adds fails `export-tables.test.ts` until somebody decides. The
 * reasons are written into each archive's manifest, in the reader's words.
 */

/** How a carried row is told from one already there (EI-C). */
export type ExportIdentity = 'kept' | 'natural' | 'singleton' | 'renumbered';

/** A secret's holder: `secrets.jsonl` names `<kind>:<holder>`, and the value never leaves (EI-G). */
export interface ExportSecret {
  readonly kind:
    | 'connection'
    | 'model_endpoint'
    | 'webhook'
    | 'extension'
    | 'identity_provider'
    | 'mail_channel';
  /** The column holding the holder's id. */
  readonly holder: string;
  /** The columns left out of the row, the sealed value among them. */
  readonly columns: readonly string[];
}

export interface CarriedTable {
  readonly fate: 'carried';
  readonly identity: ExportIdentity;
  /** The unique columns a `natural` row is matched by. */
  readonly key?: readonly string[];
  /** A nullable foreign key written null and set afterwards: a cycle has no insert order (EI-C). */
  readonly breaksCycleAt?: readonly string[];
  /** A deferrable foreign key that a check keeps from being null: deferring is what breaks it. */
  readonly deferredAt?: readonly string[];
  /** A nullable foreign key into a table that does not travel, written null on the way back in. */
  readonly pointsOut?: readonly string[];
  readonly secrets?: ExportSecret;
  /** The columns holding a store key whose bytes travel with the row. */
  readonly objects?: readonly string[];
}

export interface OmittedTable {
  readonly fate: 'rebuilt' | 'leftOut';
  readonly why: string;
}

export type ExportTable = CarriedTable | OmittedTable;

type Rest = Omit<CarriedTable, 'fate' | 'identity' | 'key'>;

const kept = (rest: Rest = {}): CarriedTable => ({ fate: 'carried', identity: 'kept', ...rest });
const renumbered = (rest: Rest = {}): CarriedTable => ({
  fate: 'carried',
  identity: 'renumbered',
  ...rest,
});
const singleton = (rest: Rest = {}): CarriedTable => ({
  fate: 'carried',
  identity: 'singleton',
  ...rest,
});
const natural = (key: readonly string[], rest: Rest = {}): CarriedTable => ({
  fate: 'carried',
  identity: 'natural',
  key,
  ...rest,
});
const rebuilt = (why: string): OmittedTable => ({ fate: 'rebuilt', why });
const leftOut = (why: string): OmittedTable => ({ fate: 'leftOut', why });

const SEARCH = rebuilt('The search index, rebuilt from the content.');
const MEANING = rebuilt('Search by meaning, rebuilt from the content by the configured model.');
const SIGN_IN = leftOut('A sign-in in progress or its count, which means nothing elsewhere.');
const PREVIEW = leftOut('A preview of a range, made again when next asked for.');

export const EXPORT_TABLES: Readonly<Record<string, ExportTable>> = {
  access_epoch: singleton(),
  access_grant: kept(),
  access_group: kept(),
  access_policy: singleton(),
  api_job: leftOut('Work in progress through the API, which does not move with the tenant.'),
  api_token: leftOut('A token is held only as its hash, so it cannot be restored.'),
  artifact: kept(),
  artifact_archival: renumbered(),
  artifact_dates: renumbered(),
  artifact_deletion: renumbered(),
  artifact_line: kept(),
  artifact_move: renumbered(),
  artifact_origin: kept(),
  artifact_scope: renumbered(),
  artifact_version: kept({
    breaksCycleAt: ['line_id', 'restored_from'],
    deferredAt: ['component_type_version_id'],
  }),
  asset_derivative: rebuilt("An image's other sizes, made again from its bytes."),
  asset_derivative_wanted: rebuilt("An image's other sizes still to be made."),
  asset_rights: kept(),
  asset_upload: leftOut('An upload in progress; a finished one is an asset, which is carried.'),
  audit_event: renumbered(),
  audit_export: leftOut('An earlier export of the log, which this holds whole.'),
  audit_label: kept(),
  audit_restored: kept(),
  background_work: leftOut('What background work last did here, recorded afresh in a copy.'),
  baseline: kept(),
  baseline_binding: kept(),
  baseline_pin: kept(),
  baseline_supersession: kept(),
  bibliography_entry_attempt: kept(),
  bibliography_entry_status: kept(),
  bibliography_entry_told: kept(),
  bibliography_identity: kept(),
  bibliography_key: kept(),
  binding_resolution: renumbered(),
  binding_revision: renumbered({ breaksCycleAt: ['replaces'] }),
  bridge_delivery: leftOut('A receipt of a delivery from CT Studio, naming a token that stays.'),
  bridge_element: kept(),
  bridge_settings: kept(),
  bridge_unlisted_property: kept(),
  capability_usage: leftOut('How each capability did, measured afresh in a copy.'),
  cohort: kept(),
  cohort_row: kept(),
  component_lock: leftOut('Who is editing what at this moment.'),
  component_type_default: singleton(),
  connection_credential: renumbered({
    secrets: { kind: 'connection', holder: 'connection_id', columns: ['sealed'] },
  }),
  connection_test: leftOut('The result of trying a credential that does not travel.'),
  conversation: kept(),
  conversation_context: renumbered(),
  ct_studio: singleton({ pointsOut: ['token_id'] }),
  data_policy: singleton(),
  dataset: kept(),
  dataset_name: renumbered(),
  dataset_pending: leftOut('A refresh in progress, whose job does not move with the tenant.'),
  dataset_take: kept(),
  definition_name: kept(),
  document_template: kept(),
  document_template_move: renumbered(),
  editing_policy: singleton(),
  email_attempt: leftOut('A try at sending a mail, kept a short while.'),
  email_delivery: leftOut('A mail being sent, kept a short while.'),
  embedding: MEANING,
  embedding_lag: MEANING,
  embedding_queued: MEANING,
  embedding_state: MEANING,
  extension: kept(),
  extension_credential: kept({
    secrets: { kind: 'extension', holder: 'extension_id', columns: ['sealed'] },
  }),
  extension_version: renumbered(),
  first_administrator: kept(),
  generation_budget: singleton(),
  generation_budget_alert: kept(),
  generation_budget_recipient: kept(),
  generation_limit: singleton(),
  generation_limit_person: kept(),
  generation_proposal: kept(),
  generation_run: kept({ breaksCycleAt: ['cached_from'] }),
  google_domain: kept(),
  group_member: kept(),
  guardrail: kept(),
  idempotency_record: leftOut('A record that keeps one request from running twice, for a day.'),
  identity_provider: natural(['issuer'], {
    breaksCycleAt: ['scim_identity'],
    secrets: { kind: 'identity_provider', holder: 'id', columns: ['sealed_secret'] },
  }),
  images_policy: singleton(),
  import: kept({ breaksCycleAt: ['earlier', 'place'], objects: ['object_key'] }),
  import_asset: kept({ objects: ['object_key'] }),
  import_attribution: kept(),
  import_edit: kept(),
  import_made: kept(),
  import_part: kept({ breaksCycleAt: ['parent'] }),
  import_policy: singleton(),
  integrity_check: leftOut('When each stored item was last re-verified, checked afresh in a copy.'),
  invitation: kept(),
  invitation_provider: kept(),
  iteration: kept(),
  layout_default: singleton(),
  legal_hold: kept(),
  legal_hold_release: kept(),
  line_closed: kept(),
  line_return: kept(),
  machine_draft: kept(),
  mail_channel: singleton({
    secrets: { kind: 'mail_channel', holder: 'id', columns: ['sealed_password'] },
  }),
  model_credential: kept({
    secrets: { kind: 'model_endpoint', holder: 'endpoint_id', columns: ['sealed', 'sealed_for'] },
  }),
  model_endpoint: kept(),
  model_route: kept(),
  notification: renumbered(),
  notification_email_off: kept(),
  notification_held: renumbered(),
  notification_preference: kept(),
  object_store_credential: leftOut("This environment's own key to its store, made anew for each."),
  personal_prompt: kept(),
  presence: leftOut('Who is looking at what at this moment.'),
  principal: natural(['issuer', 'subject'], { breaksCycleAt: ['provider_id'] }),
  profile: singleton(),
  prompt_library_default: singleton(),
  publication: kept(),
  publication_asset: kept(),
  publication_binding: kept(),
  publication_check: kept({ objects: ['report_key'] }),
  publication_check_given_up: kept(),
  publication_generated: kept(),
  publication_input: kept(),
  publication_output: kept({ objects: ['object_key'] }),
  publication_request: kept(),
  publication_request_asset: kept(),
  publication_request_binding: kept(),
  publication_request_occurrence: kept(),
  publication_request_rights: kept(),
  query_embedding: MEANING,
  query_run: leftOut("A query's run in progress or just ended; the result it stored is carried."),
  query_slot: leftOut('A place in the queue of queries running.'),
  range_page: PREVIEW,
  range_preview: PREVIEW,
  reference: renumbered(),
  reference_source_policy: kept(),
  restoration: leftOut('An earlier restore, which belongs to the environment it happened to.'),
  relationship: kept(),
  retention_keep: renumbered(),
  review_lapse: renumbered(),
  review_round: kept(),
  review_round_event: renumbered(),
  review_round_reviewer: kept(),
  revision_acceptance: kept(),
  revision_designation: kept(),
  revision_effected: kept(),
  revision_effective: kept(),
  revision_scope: kept(),
  role: natural(['name']),
  sample: kept({ objects: ['object_key'] }),
  schema_migration: leftOut('Which migrations have run: the manifest names the last.'),
  scim_group: kept(),
  scim_group_member: kept(),
  search_earlier: SEARCH,
  search_earlier_text: SEARCH,
  search_entry: SEARCH,
  search_history: leftOut("A person's own recent searches, which they can make again."),
  search_passage: MEANING,
  search_text: SEARCH,
  section_waiver: renumbered(),
  service_identity: kept(),
  session: leftOut('Who is signed in at this moment; each signs in again.'),
  session_settings: singleton(),
  sign_in_attempt: SIGN_IN,
  sign_in_failure_tally: SIGN_IN,
  sign_in_handoff: SIGN_IN,
  sign_in_route: SIGN_IN,
  silent_failure_told: leftOut(
    'Which failures administrators were told of, told afresh in a copy.',
  ),
  source_change: renumbered(),
  space: natural(['name'], { breaksCycleAt: ['default_template'] }),
  suggestion: kept(),
  suggestion_resolution: kept(),
  support_grant: leftOut(
    'Support access granted to somebody from outside for a time: granted afresh, and its acts are in the log.',
  ),
  tenant_restore: leftOut(
    'That this environment was restored, which an archive of it does not undo.',
  ),
  tenant_export: leftOut('An earlier export; an archive does not list archives.'),
  theme_default: singleton(),
  thread: kept(),
  thread_comment: kept(),
  thread_comment_text: renumbered(),
  thread_internal: kept(),
  thread_read: kept(),
  thread_resolution: kept(),
  translation_job: kept(),
  translation_job_item: kept(),
  translation_job_return: kept({ objects: ['object_key'] }),
  translation_policy: singleton(),
  translation_policy_change: kept(),
  translation_state: renumbered(),
  unsaved_discarded: kept(),
  usage_day: leftOut('What the environment used, by day, counted afresh in a copy.'),
  version_definition: kept(),
  webhook_attempt: leftOut('A try at sending an event, kept a short while.'),
  webhook_delivery: leftOut('An event being sent, kept a short while.'),
  webhook_subscription: kept({
    secrets: { kind: 'webhook', holder: 'id', columns: ['sealed', 'sealed_previous'] },
  }),
  workflow_approval: renumbered(),
  workflow_definition: natural(['kind', 'version_no']),
  workflow_transition: renumbered(),
};

/**
 * Columns never written: another cluster's transaction id could read as the future and hide the row
 * (audit.md), so each takes the restore's own.
 */
export const EXPORT_NOT_CARRIED_COLUMNS: readonly string[] = ['written_by', 'xact'];

/** A column named like a secret that holds none, each with its reason. */
export const NOT_SECRETS: Readonly<Record<string, string>> = {
  'artifact_version.content_hash': 'The digest of the version, which a reader recomputes.',
  'identity_provider.secret_name': 'The name of an environment variable, not its value.',
  'identity_provider.client_id': 'Public by OAuth, sent in the browser.',
  // When a secret was last replaced (0220; secrets.md): a time, never the value.
  'identity_provider.secret_set_at': 'When its secret was last set, not the secret.',
  'mail_channel.password_set_at': 'When its password was last set, not the password.',
  'webhook_subscription.secret_set_at': 'When its secret was last set, not the secret.',
};

/** A column named like a store key whose bytes do not travel, each with its reason. */
export const NOT_OBJECTS: Readonly<Record<string, string>> = {
  'publication_request.preview_key': 'A preview, swept after a while and made again.',
};

/** The carried tables, in name order. */
export const carriedTables = (): readonly (readonly [string, CarriedTable])[] =>
  Object.entries(EXPORT_TABLES)
    .filter((entry): entry is [string, CarriedTable] => entry[1].fate === 'carried')
    .sort(([a], [b]) => (a < b ? -1 : 1));
