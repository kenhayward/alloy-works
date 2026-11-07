import type { Permission } from '../access/permissions.js';

/**
 * **Everything that can leave a tenant** (secrets.md, "The boundary"; ADM-041; the SA plan, SA-J): one
 * row per way out, saying what may leave, whether it is on by default, the operation and permission
 * that change it, and any residency. A test holds the rows to every module of the service, worker and
 * connector that sends out, so a way out cannot be added without a row.
 */
export const OUTBOUND_WAYS = [
  'model_endpoint',
  'embedding',
  'translation',
  'reference_source',
  'malware_scanning',
  'data_connection',
  'webhook',
  'mail',
  'extension',
  'vocabulary_source',
  'ct_studio',
] as const;
export type OutboundWay = (typeof OUTBOUND_WAYS)[number];

/**
 * `endpoint`: each endpoint states its `boundary`, inside or outside, chosen by an administrator and
 * never inferred (GEN-031); `not_declared`: nothing states one. ADM-Q01 (what residency is promised)
 * is open, so no other residency is claimed.
 */
export type OutboundResidency = 'endpoint' | 'not_declared';

export interface Outbound {
  readonly way: OutboundWay;
  /** What may leave, in plain words. */
  readonly what: string;
  readonly onByDefault: boolean;
  /** The operation that turns it on or changes where it goes, and the permission it needs. */
  readonly changedBy: { readonly operation: string; readonly permission: Permission } | null;
  readonly residency: OutboundResidency;
  /** The modules that send it out, repository-relative. */
  readonly senders: readonly string[];
  /** Why nothing sends it, where nothing does. */
  readonly absent?: string;
}

const CONNECTOR = 'apps/connector/src';

export const OUTBOUND: readonly Outbound[] = [
  {
    way: 'model_endpoint',
    what: 'What drafting, chat and summarising send: the content asked about, the words a person wrote and the instructions, to the endpoint each purpose is routed to.',
    onByDefault: false,
    changedBy: { operation: 'setModelRoute', permission: 'configure_services' },
    residency: 'endpoint',
    senders: [`${CONNECTOR}/model.ts`],
  },
  {
    way: 'embedding',
    what: "Every component's text, to be read for meaning, to the endpoint embedding is routed to.",
    onByDefault: false,
    changedBy: { operation: 'setModelRoute', permission: 'configure_services' },
    residency: 'endpoint',
    senders: [`${CONNECTOR}/model.ts`],
  },
  {
    way: 'translation',
    what: "A component's text and its terms, for a machine draft, to the endpoint translation is routed to, where the translation policy allows that endpoint's boundary.",
    onByDefault: false,
    changedBy: { operation: 'setTranslationSettings', permission: 'administer' },
    residency: 'endpoint',
    senders: [`${CONNECTOR}/model.ts`],
  },
  {
    way: 'reference_source',
    what: 'The words searched for, or the identifier of a record, to the source asked: Crossref, PubMed or a reference extension. Nightly re-checks send the identifiers of entries a live document cites.',
    onByDefault: true,
    changedBy: { operation: 'setReferenceSource', permission: 'configure_services' },
    residency: 'not_declared',
    senders: [`${CONNECTOR}/reference.ts`],
  },
  {
    way: 'malware_scanning',
    what: 'Nothing: no upload is sent to be scanned.',
    onByDefault: false,
    changedBy: null,
    residency: 'not_declared',
    senders: [],
    absent: 'No scanning service exists; which one, and whether it may sit outside, is AST-Q03.',
  },
  {
    way: 'data_connection',
    what: "A query or request, with the connection's credential and the values bound, to the database, HTTP source or bucket it names; rows come back.",
    onByDefault: false,
    changedBy: { operation: 'createConnection', permission: 'configure_services' },
    residency: 'not_declared',
    senders: [`${CONNECTOR}/postgres.ts`, `${CONNECTOR}/http-source.ts`, `${CONNECTOR}/s3.ts`],
  },
  {
    way: 'webhook',
    what: "An event's kind, the ids and versions it names and when, never content, signed, to the subscription's address.",
    onByDefault: false,
    changedBy: { operation: 'createWebhook', permission: 'configure_webhooks' },
    residency: 'not_declared',
    senders: [`${CONNECTOR}/deliver.ts`],
  },
  {
    way: 'mail',
    what: "A notification's subject and words and the recipient's address, to the operator's relay or the environment's own.",
    onByDefault: false,
    changedBy: { operation: 'setMailChannel', permission: 'configure_services' },
    residency: 'not_declared',
    senders: [`${CONNECTOR}/mail.ts`],
  },
  {
    way: 'extension',
    what: "What its manifest declares and nothing more: its settings, its one credential, a definition's request and the values bound, or a reference search; and a request for its manifest at the address it was installed from.",
    onByDefault: false,
    changedBy: { operation: 'installExtension', permission: 'administer' },
    residency: 'not_declared',
    senders: [`${CONNECTOR}/extension-source.ts`, `${CONNECTOR}/manifest.ts`],
  },
  {
    way: 'vocabulary_source',
    what: "A request for the SKOS address a vocabulary names, and nothing of the environment's; its values come back.",
    onByDefault: false,
    changedBy: { operation: 'importVocabulary', permission: 'manage_definitions' },
    residency: 'not_declared',
    senders: [`${CONNECTOR}/vocabulary-source.ts`],
  },
  {
    way: 'ct_studio',
    what: 'Nothing is sent: CT Studio delivers in, as its own service identity, to the spaces connected; the receipt it is answered names what was written.',
    onByDefault: false,
    changedBy: { operation: 'connectCtStudio', permission: 'administer' },
    residency: 'not_declared',
    senders: [],
  },
];

/** What sends but is no way out of a tenant, and why. */
export const OUTBOUND_EXCLUSIONS: readonly {
  readonly what: string;
  readonly modules: readonly string[];
  readonly why: string;
}[] = [
  {
    what: "The connector's guarded exchange",
    modules: [`${CONNECTOR}/https.ts`],
    why: 'The one HTTP way every connector sender above takes, to public addresses only; each caller is named by its row.',
  },
  {
    what: "The service's and the worker's way to the connector",
    modules: [
      'apps/service/src/data/connector.ts',
      'apps/worker/src/deliverer.ts',
      'apps/worker/src/embedder.ts',
      'apps/worker/src/mailer.ts',
      'apps/worker/src/referencer.ts',
    ],
    why: 'A hop inside the deployment, each with a key of its own; the connector is what sends out, by the rows above.',
  },
  {
    what: "The product's own database and service",
    modules: ['apps/worker/src/main.ts'],
    why: "The worker's own database, and the probe of the service's own health: the product's store, inside the boundary.",
  },
  {
    what: 'Sign-in',
    modules: ['apps/service/src/oidc-fetch.ts'],
    why: 'The identity provider an administrator added is asked to sign a person in and answers who they are; nothing of the content leaves.',
  },
  {
    what: 'The API reference page',
    modules: ['apps/service/src/docs.ts'],
    why: "A script the reader's own browser runs, calling the same origin with the reader's own token.",
  },
];

export const outbound = (way: OutboundWay): Outbound => OUTBOUND.find((each) => each.way === way)!;
