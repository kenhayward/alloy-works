import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  assetAlternativeSchema,
  carryForward,
  checkDocumentParameters,
  checkWrittenValues,
  definitionsFor,
  parseContentDocument,
  parseOutlineDocument,
  resolveComponentFields,
  seededValues,
  templateProfile,
  type ContentDocument,
  type EffectiveField,
  type ImageHeader,
  type MetadataValues,
  type OutlineDocument,
} from '@alloy-works/domain';
import * as bridge from '@alloy-works/domain/bridge';
import {
  bridgeError,
  changedInTargetDetails,
  documentMissing,
  type BridgeError,
  type ComponentVersion,
  type DecomposedDocument,
  type Receipt,
} from '@kenhayward/bridge-contract';
import { createAssetUpload, holdObject, receiveAssetBytes, recordAsset } from './assets.js';
import {
  readDelivery,
  recordElements,
  type BridgeElement,
  type BridgeSettings,
} from './bridge-store.js';
import { currentDefinitionsFor, defaultComponentType } from './creation.js';
import { profileUnknown, variablesByKey } from './definitions.js';
import { isDeleted } from './deletion.js';
import { resolveForDocument, resolvedFrom } from './documents.js';
import { readLocks } from './editing.js';
import { indexTemplateOf } from './reference-index.js';
import { checkSpaceLive, SpaceArchived } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { documentRules, refusedParameters } from './templates.js';
import {
  createArtifact,
  latestVersion,
  lockArtifact,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';

/**
 * **A decomposed document written whole** (docs/design/ct-studio-sink.md, "A decomposed document"
 * to "Idempotency and atomicity"; the CS plan, Task 6): the document, a component per section's
 * text, the images as assets, the metadata its template's fields take, and the elements it made, in
 * the caller's transaction, then read back for the receipt. An update is refused, changing nothing,
 * when anything CT Studio expects has moved on here.
 */

type CarryEntry = bridge.CarryEntry;

/** An image the worker has read whole (`checkImage`), with the bytes to store. */
export interface CheckedImage {
  /** CT Studio's image id. */
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly header: ImageHeader;
  readonly alternative: string | null;
}

/** One entry of `update.expected`: a component, the document's map or an asset, at a version. */
export type ExpectedComponent = ComponentVersion;
export type SinkReceipt = Receipt;

/** Where an image's bytes are stored: a tenant's object store (`@alloy-works/objects`' `TenantStore`). */
export interface DeliveryObjects {
  put(
    body: Uint8Array,
    contentType: string,
  ): Promise<{ readonly key: string; readonly sha256: string }>;
}

export interface DocumentDelivery {
  readonly deliveryId: string;
  readonly spaceId: string;
  /** The service identity the delivery acts as: every version's author. */
  readonly author: string;
  /** Every version's note (`deliveryNote`). */
  readonly note: string;
  readonly document: DecomposedDocument;
  readonly title: string;
  readonly images: readonly CheckedImage[];
  readonly update?: {
    readonly persistentId: string;
    readonly expected: readonly ExpectedComponent[];
  };
  readonly settings: BridgeSettings;
  readonly store: DeliveryObjects;
  /** The tenant's address, `https://<hostname>`, that the document's page is linked at; no link without. */
  readonly origin?: string;
}

export type DocumentWritten = {
  readonly answer: 'written';
  readonly receipt: SinkReceipt;
  readonly carried: readonly CarryEntry[];
};
export type DocumentRefused = { readonly answer: 'refused'; readonly error: BridgeError };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEAD = '~lead';

/** A version's note (docs/design/ct-studio-sink.md, "Provenance"). */
export function deliveryNote(input: {
  readonly sourceFilename: string;
  readonly decomposerVersion: string | number;
  readonly actingUser: string;
}): string {
  return `Delivered by CT Studio from ${input.sourceFilename} (${input.decomposerVersion}) for ${input.actingUser}`;
}

const refused = (error: BridgeError): DocumentRefused => ({ answer: 'refused', error });
const rejected = (message: string, details: Record<string, unknown>) =>
  refused(bridgeError('content_rejected', message, details));

/** Every section id of the document, at any depth, in document order. */
function sectionIds(document: DecomposedDocument): string[] {
  const ids: string[] = [];
  const walk = (sections: DecomposedDocument['sections']) => {
    for (const section of sections) {
      ids.push(section.id);
      walk(section.sections);
    }
  };
  walk(document.sections);
  return ids;
}

/**
 * Takes the lock every version of these artifacts is cut under (`lockArtifact`), in id order, so two
 * deliveries naming the same artifacts never wait on each other the other way round.
 */
async function lockAll(trx: TenantTransaction, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await lockArtifact(trx, id);
  }
}

/** The version an artifact is at now, or null when it is gone or was never made. */
async function currentOf(trx: TenantTransaction, id: string): Promise<StoredVersion | null> {
  if (!UUID.test(id)) return null;
  const latest = await latestVersion(trx, id);
  if (!latest) return null;
  if ((latest.kind === 'component' || latest.kind === 'document') && (await isDeleted(trx, id))) {
    return null;
  }
  return latest;
}

/**
 * The version each artifact was at when CT Studio last had it from this document's deliveries: the
 * newest written receipt that lists it. A component a later delivery left out (its section no longer
 * sent) is held to that, so a person's edit to it since is never written over.
 */
async function lastDelivered(
  trx: TenantTransaction,
  persistentId: string,
): Promise<Map<string, string>> {
  const rows = await trx
    .selectFrom('bridge_delivery')
    .select('receipt')
    .where('persistent_id', '=', persistentId)
    .where('state', '=', 'written')
    .orderBy('finished_at', 'desc')
    .execute();
  const versions = new Map<string, string>();
  for (const row of rows) {
    const receipt = row.receipt as Partial<SinkReceipt> | null;
    for (const each of receipt?.document?.components ?? []) {
      if (!versions.has(each.id)) versions.set(each.id, each.version);
    }
  }
  return versions;
}

/** The images the document names: in figures and image blocks, inline, and an image-only equation's. */
function namedImages(document: DecomposedDocument): Set<string> {
  const images = new Set<string>();
  const equations = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const each of value) walk(each);
    } else if (typeof value === 'object' && value !== null) {
      const node = value as { imageId?: unknown; equationId?: unknown };
      if (typeof node.imageId === 'string') images.add(node.imageId);
      if (typeof node.equationId === 'string') equations.add(node.equationId);
      for (const each of Object.values(value)) walk(each);
    }
  };
  walk([document.blocks, document.sections, document.notes]);
  for (const equation of document.equations) {
    if (equations.has(equation.id) && equation.mathml === null) images.add(equation.imageId);
  }
  return images;
}

const hasValue = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  !(Array.isArray(value) && value.length === 0);

/** The latest version of an asset in the space whose bytes are these, so an image is never made twice. */
async function assetHolding(
  trx: TenantTransaction,
  spaceId: string,
  key: string,
): Promise<{ readonly artifactId: string; readonly versionId: string } | undefined> {
  const { rows } = await sql<{ artifact_id: string; id: string; object: string | null }>`
    select distinct on (v.artifact_id) v.artifact_id, v.id, v.content ->> 'object' as object
      from artifact_version v
      join artifact a on a.id = v.artifact_id
     where a.space_id = ${spaceId}
       and a.kind = 'asset'
       and v.artifact_id in (
         select artifact_id from artifact_version where content ->> 'object' = ${key})
     order by v.artifact_id, v.revision_no desc, v.version_no desc`.execute(trx);
  const latest = rows.find((row) => row.object === key);
  return latest && { artifactId: latest.artifact_id, versionId: latest.id };
}

/** The document fields a delivery's properties may fill, and the values a new document starts with. */
type Fields =
  | {
      readonly answer: 'fields';
      readonly fields: readonly EffectiveField[];
      readonly base: MetadataValues;
      readonly bind?: {
        readonly template: string;
        readonly version: string;
        readonly profile: NonNullable<OutlineDocument['profile']>;
      };
    }
  | DocumentRefused;

/**
 * A new document's fields: its template's document fields as `createDocument` resolves them, read where
 * the identity may read the template, with each default as its first values. No template, no fields.
 */
async function fieldsForCreate(trx: TenantTransaction, input: DocumentDelivery): Promise<Fields> {
  const templateId = input.settings.template;
  if (templateId === null) return { answer: 'fields', fields: [], base: {} };
  const resolution = await resolveForDocument(trx, input.author, templateId);
  if (resolution.answer !== 'resolved') {
    return rejected('The space is set up with a template the delivery cannot use', {
      reason: 'template_unresolved',
      template: templateId,
    });
  }
  const { definition } = resolution.resolution;
  const resolved = resolvedFrom(resolution.resolution);
  // Its parameters as createDocument checks them (TP1-G): a delivery gives none, so a parameter
  // declared without one the template can do without - a required one - leaves it unusable.
  const declared = definition.parameters ?? [];
  const unusable = () =>
    rejected('The space is set up with a template the delivery cannot use', {
      reason: 'template_unresolved',
      template: templateId,
    });
  if (!resolved.ok || checkDocumentParameters(declared, {}) !== null) return unusable();
  if (refusedParameters(definition, resolved, await variablesByKey(trx)) !== null)
    return unusable();
  const profile = templateProfile(definition, {});
  if ((await profileUnknown(trx, profile)).length > 0) return unusable();
  return {
    answer: 'fields',
    fields: resolved.document,
    base: { ...carryForward({}, resolved.document).values, ...seededValues(declared, {}) },
    bind: { template: templateId, version: resolution.resolution.template.version, profile },
  };
}

/** An existing document's fields: those of the template it is bound to now, its values as they stand. */
async function fieldsForUpdate(trx: TenantTransaction, document: StoredVersion): Promise<Fields> {
  const rules = await documentRules(trx, document.artifactId);
  const fields = rules.bound && rules.resolved.ok ? rules.resolved.document : [];
  return { answer: 'fields', fields, base: document.values };
}

/**
 * The document's values: what it starts with or holds, and each property its field takes. One the
 * field's rules refuse once written whole (a fixed field, say) is left out and reported. Then every
 * field is held to its rules: values that still fail, or a required field left without one, refuse
 * the delivery as `metadata_incomplete`.
 */
function valuesFor(
  input: DocumentDelivery,
  fields: readonly EffectiveField[],
  base: MetadataValues,
): { values: MetadataValues; carried: CarryEntry[] } | DocumentRefused {
  const mapped = bridge.mapProperties(
    input.document.properties,
    input.settings.propertyMap,
    fields,
  );
  const values: Record<string, unknown> = { ...base, ...mapped.values };
  const carried = [...mapped.carried];
  for (const failure of checkWrittenValues(fields, values)) {
    if (!Object.hasOwn(mapped.values, failure.field)) continue;
    if (Object.hasOwn(base, failure.field)) values[failure.field] = base[failure.field];
    else delete values[failure.field];
    for (const [name, field] of Object.entries(input.settings.propertyMap)) {
      if (field !== failure.field) continue;
      if (!input.document.properties.some((property) => property.name === name)) continue;
      carried.push(bridge.carry('property_unconverted', name, `${field}: ${failure.rule}`));
    }
  }
  const failures = checkWrittenValues(fields, values);
  if (failures.length > 0) {
    return rejected('The document metadata does not fit its template', {
      reason: 'metadata_incomplete',
      failures: failures.map((failure) => ({ field: failure.field, rule: failure.rule })),
    });
  }
  const missing = fields
    .filter((each) => each.required && !hasValue(values[each.field.id]))
    .map((each) => each.field.id);
  if (missing.length > 0) {
    return rejected('A field the template requires has no value', {
      reason: 'metadata_incomplete',
      fields: missing,
    });
  }
  return { values, carried };
}

/** The first component the model refuses, or the outline, named; undefined when every one parses. */
function modelRefusal(
  mapped: bridge.MappedDocument,
  pins: ReadonlyMap<string, string>,
): DocumentRefused | undefined {
  for (const component of mapped.components) {
    try {
      parseContentDocument(component.content);
    } catch (error) {
      return rejected(`Section ${component.section} is not content the model holds`, {
        reason: 'content_invalid',
        element: component.section,
        failure: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    parseOutlineDocument(mapped.outline(pins));
  } catch (error) {
    return rejected('The document is not an outline the model holds', {
      reason: 'outline_invalid',
      failure: error instanceof Error ? error.message : String(error),
    });
  }
  return undefined;
}

/** The document mapped, or the mapping's refusal, which names the element (IMP-N03). */
function mapped(
  input: DocumentDelivery,
  persistentId: string,
  assets: ReadonlyMap<string, string>,
): bridge.MappedDocument | DocumentRefused {
  try {
    return bridge.mapDocument(input.document, { persistentId, title: input.title, assets });
  } catch (error) {
    return rejected('The document holds something the delivery cannot map', {
      reason: 'mapping_refused',
      failure: error instanceof Error ? error.message : String(error),
    });
  }
}
const isRefused = (value: object): value is DocumentRefused =>
  'answer' in value && value.answer === 'refused';

/**
 * Each image as an asset version of the space: one whose bytes the space already holds at an asset's
 * latest version is that version, and any other is stored by hash and recorded through the asset door
 * unqueued, as an accepted import's are, with the delivery's note.
 */
async function assetsFor(
  trx: TenantTransaction,
  input: DocumentDelivery,
  images: readonly CheckedImage[],
): Promise<Map<string, { readonly artifactId: string; readonly versionId: string }>> {
  // Every object held before the first is stored, in hash order, so two deliveries sharing images
  // never wait on each other the other way round.
  for (const sha256 of [...new Set(images.map((image) => image.sha256))].sort()) {
    await holdObject(trx, sha256);
  }
  const made = new Map<string, { readonly artifactId: string; readonly versionId: string }>();
  for (const image of images) {
    const stored = await input.store.put(image.bytes, `image/${image.header.format}`);
    if (stored.sha256 !== image.sha256) {
      throw new Error(`Image ${image.id} was stored as ${stored.sha256}, not ${image.sha256}`);
    }
    const held = await assetHolding(trx, input.spaceId, stored.key);
    if (held) {
      made.set(image.id, held);
      continue;
    }
    const alternative = assetAlternativeSchema.safeParse({
      text: image.alternative ?? '',
      language: 'und',
    });
    const upload = await createAssetUpload(trx, {
      spaceId: input.spaceId,
      uploader: input.author,
      alternative: alternative.success ? alternative.data : null,
    });
    await receiveAssetBytes(
      trx,
      upload.id,
      { key: stored.key, format: image.header.format, bytes: image.bytes.length },
      false,
    );
    const version = await recordAsset(trx, upload.id, image.header, { note: input.note });
    made.set(image.id, { artifactId: version.artifactId, versionId: version.id });
  }
  return made;
}

/** What a delivered component's first version is written against: the settings' type, else the default. */
async function componentTypeFor(trx: TenantTransaction, settings: BridgeSettings) {
  const typeId = settings.componentType ?? (await defaultComponentType(trx));
  return typeId === undefined ? undefined : currentDefinitionsFor(trx, typeId);
}

/** A component's first version: its type's definitions and defaults, as `createComponent` makes one. */
function firstComponent(
  trx: TenantTransaction,
  input: DocumentDelivery,
  definitions: NonNullable<Awaited<ReturnType<typeof componentTypeFor>>>,
  artifactId: string,
  content: ContentDocument,
): Promise<StoredVersion> {
  const effective = resolveComponentFields(
    definitions.type.definition,
    definitions.schemas.map((each) => each.definition),
    definitions.fields.map((each) => each.definition),
  );
  const carried = carryForward({}, effective);
  return createArtifact(trx, {
    author: input.author,
    note: input.note,
    spaceId: input.spaceId,
    artifactId,
    substance: {
      kind: 'component',
      content,
      values: carried.values,
      notCarried: carried.notCarried,
      definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
    },
  });
}

/**
 * Writes a decomposed document delivery into the space, in the caller's transaction
 * (docs/design/ct-studio-sink.md, "Versions, updates and the receipt"). Every artifact it names is
 * locked first, in id order. A create makes the document at the persistent id it gives out, its
 * components at their derived ids and its images' assets, each at 0.1. An update is refused, with
 * nothing written, when the document is gone (`documentMissing`), in another space
 * (`document_in_another_space`), when any expected version, or the map's or a component's not sent
 * back against its last delivery, has moved on (`changed_in_target`) or when a person holds a
 * component's lock; otherwise each component cuts a
 * version, or keeps its own when nothing changed, and the document cuts one pinning them. What the
 * mapping or the model refuses is refused before anything is written too. The receipt holds what was
 * written and what it reads back as (API-067, API-069, API-070, API-071, API-073).
 *
 * Who may write here is `create` in the space for a new document and `edit` for an update, decided for
 * the author by the caller before this is called and in the same transaction (Task 10), as
 * `createComponent` leaves it to its caller. The read-back runs inside this transaction too, after the
 * writes, on the versions as stored.
 */
export async function writeDocumentDelivery(
  trx: TenantTransaction,
  input: DocumentDelivery,
): Promise<DocumentWritten | DocumentRefused> {
  const { update, document } = input;
  const delivery = await readDelivery(trx, input.deliveryId);
  if (delivery?.state !== 'running' || delivery.family !== 'document') {
    throw new Error(`Delivery ${input.deliveryId} is not a document delivery running`);
  }
  if (delivery.spaceId !== input.spaceId) {
    throw new Error(`Delivery ${input.deliveryId} is for another space`);
  }
  const persistentId = update?.persistentId ?? randomUUID();
  if (update && !UUID.test(persistentId)) {
    return refused(documentMissing(persistentId, 'This environment holds no such document'));
  }
  const componentIds = [
    ...(document.blocks.length > 0 ? [bridge.componentIdFor(persistentId, LEAD)] : []),
    ...sectionIds(document).map((section) => bridge.componentIdFor(persistentId, section)),
  ];
  const expected = update?.expected ?? [];
  await lockAll(trx, [
    persistentId,
    ...componentIds,
    ...expected.map((each) => each.id).filter((id) => UUID.test(id)),
  ]);

  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return refused(bridgeError('not_found', 'This environment holds no such space'));
  try {
    await checkSpaceLive(trx, input.spaceId);
  } catch (error) {
    if (error instanceof SpaceArchived) {
      return refused(bridgeError('not_found', 'The space is archived: nothing new is made in it'));
    }
    throw error;
  }

  let existing: StoredVersion | null = null;
  if (update) {
    existing = await currentOf(trx, persistentId);
    if (!existing || existing.kind !== 'document') {
      return refused(documentMissing(persistentId, 'The document is no longer in Alloy Works'));
    }
    const home = await trx
      .selectFrom('artifact')
      .select('space_id')
      .where('id', '=', persistentId)
      .executeTakeFirstOrThrow();
    // Found in another space is not gone: the contract keeps `documentMissing` for a document gone,
    // which CT Studio answers by forgetting the link (Ruling 35).
    if (home.space_id !== input.spaceId) {
      return rejected('The document is in another space than the delivery is for', {
        reason: 'document_in_another_space',
      });
    }
    const changed: { id: string; expected: string; actual: string | null }[] = [];
    for (const each of expected) {
      const actual = (await currentOf(trx, each.id))?.id ?? null;
      if (actual !== each.version) changed.push({ id: each.id, expected: each.version, actual });
    }
    // The document's map and every component this delivery writes that CT Studio did not send back
    // are held to the version their last delivery left them at, so an edit made since is refused
    // rather than written over; a document no delivery wrote compares against 'not delivered',
    // whatever `expected` names for it.
    const named = new Set(expected.map((each) => each.id));
    const delivered = await lastDelivered(trx, persistentId);
    for (const component of [persistentId, ...componentIds]) {
      if (named.has(component) && !(component === persistentId && !delivered.has(component)))
        continue;
      const actual = (await currentOf(trx, component))?.id;
      if (actual === undefined) continue;
      const was = delivered.get(component) ?? 'not delivered';
      if (actual !== was) changed.push({ id: component, expected: was, actual });
    }
    if (changed.length > 0) {
      return refused(
        bridgeError(
          'changed_in_target',
          'The document has changed in Alloy Works since it was delivered',
          changedInTargetDetails(changed),
        ),
      );
    }
  }
  const locks = await readLocks(trx, [
    ...componentIds,
    ...expected.filter((each) => each.kind === 'component').map((each) => each.id),
  ]);
  const [held] = locks;
  if (held) {
    const [component, lock] = held;
    return rejected('A person is editing a component of the document', {
      reason: 'component_locked',
      component,
      holder: { id: lock.holder, name: lock.holderName },
    });
  }
  // A component of this document deleted here stays deleted: nothing brings it back unasked.
  let fresh = false;
  for (const component of componentIds) {
    if ((await currentOf(trx, component)) !== null) continue;
    if (await latestVersion(trx, component)) {
      return rejected('A component of the document was deleted in Alloy Works', {
        reason: 'component_deleted',
        component,
      });
    }
    fresh = true;
  }
  // Read only when a component is to be made, so an update that makes none never needs it.
  const componentType = fresh ? await componentTypeFor(trx, input.settings) : null;
  if (componentType === undefined) {
    return rejected('The space is set up with a component type this environment does not hold', {
      reason: 'component_type_missing',
    });
  }

  const fields = existing
    ? await fieldsForUpdate(trx, existing)
    : await fieldsForCreate(trx, input);
  if (fields.answer === 'refused') return fields;
  const metadata = valuesFor(input, fields.fields, fields.base);
  if ('answer' in metadata) return metadata;

  // An image the document never names is neither stored nor listed, and is reported.
  const named = namedImages(input.document);
  const images = input.images.filter((image) => named.has(image.id));
  const unreferenced = input.images
    .filter((image) => !named.has(image.id))
    .map((image) => bridge.carry('image_unreferenced', image.id));

  // Mapped and checked once with stand-in assets, so a refusal comes before anything is written.
  const standIn = new Map(images.map((image) => [image.id, randomUUID()]));
  const trial = mapped(input, persistentId, standIn);
  if (isRefused(trial)) return trial;
  const standInPins = new Map(trial.components.map((each) => [each.artifactId, randomUUID()]));
  const invalid = modelRefusal(trial, standInPins);
  if (invalid) return invalid;

  const assets = await assetsFor(trx, input, images);
  const assetVersions = new Map([...assets].map(([image, asset]) => [image, asset.versionId]));
  const final = mapped(input, persistentId, assetVersions);
  if (isRefused(final)) throw new Error('A mapping that held with stand-in assets refused');

  const pins = new Map<string, StoredVersion>();
  for (const component of final.components) {
    const current = await currentOf(trx, component.artifactId);
    if (current === null) {
      if (!componentType) throw new Error(`Component ${component.artifactId} was not to be made`);
      pins.set(
        component.artifactId,
        await firstComponent(trx, input, componentType, component.artifactId, component.content),
      );
      continue;
    }
    const answer = await recordVersion(trx, {
      artifactId: component.artifactId,
      openedFrom: current.id,
      author: input.author,
      note: input.note,
      substance: {
        kind: 'component',
        content: component.content,
        values: current.values,
        notCarried: current.notCarried,
        definitions: current.definitions,
      },
    });
    if (answer.answer === 'recorded') pins.set(component.artifactId, answer.version);
    else if (answer.answer === 'version.unchanged') pins.set(component.artifactId, answer.current);
    else
      throw new Error(`Component ${component.artifactId} under its lock answered ${answer.answer}`);
  }

  const { values } = metadata;
  const versionIds = new Map([...pins].map(([id, version]) => [id, version.id]));
  const drawn = final.outline(versionIds);
  let written: StoredVersion;
  if (existing) {
    const before = existing.content as OutlineDocument;
    const outline: OutlineDocument = {
      ...drawn,
      ...(before.profile === undefined ? {} : { profile: before.profile }),
    };
    const answer = await recordVersion(trx, {
      artifactId: persistentId,
      openedFrom: existing.id,
      author: input.author,
      note: input.note,
      substance: { kind: 'document', content: outline, values, parameters: existing.parameters },
    });
    if (answer.answer === 'recorded') written = answer.version;
    else if (answer.answer === 'version.unchanged') written = answer.current;
    else throw new Error(`Document ${persistentId} under its lock answered ${answer.answer}`);
  } else {
    const bind = fields.bind;
    written = await createArtifact(trx, {
      author: input.author,
      note: input.note,
      spaceId: input.spaceId,
      artifactId: persistentId,
      substance: {
        kind: 'document',
        content: bind === undefined ? drawn : { ...drawn, profile: bind.profile },
        values,
        parameters: {},
      },
    });
    if (bind !== undefined) {
      await trx
        .insertInto('document_template')
        .values({
          document_id: persistentId,
          template_id: bind.template,
          template_version_id: bind.version,
        })
        .execute();
      await indexTemplateOf(trx, persistentId);
    }
  }

  await recordElements(trx, persistentId, elementsOf(input.document, persistentId, final, assets));
  const carried = [...final.carried, ...metadata.carried, ...unreferenced];
  const readBack = await readBackOf(trx, input.document, persistentId, assetVersions, carried);
  return {
    answer: 'written',
    receipt: receiptOf(input, { persistentId, written, final, pins, assets, readBack }),
    carried,
  };
}

/** What each CT Studio element became: the lead and each section, its node, and each image's asset. */
function elementsOf(
  document: DecomposedDocument,
  persistentId: string,
  final: bridge.MappedDocument,
  assets: ReadonlyMap<string, { readonly artifactId: string }>,
): BridgeElement[] {
  const components = new Set(final.components.map((each) => each.section));
  const lead = components.has(LEAD)
    ? [{ element: LEAD, artifactId: bridge.componentIdFor(persistentId, LEAD), node: null }]
    : [];
  return [
    ...lead,
    ...sectionIds(document).map((section) => ({
      element: section,
      artifactId: components.has(section)
        ? bridge.componentIdFor(persistentId, section)
        : persistentId,
      node: bridge.elementIdFor(persistentId, section),
    })),
    ...[...assets].map(([image, asset]) => ({
      element: image,
      artifactId: asset.artifactId,
      node: null,
    })),
  ];
}

/**
 * What was stored, read back from the versions themselves - the document's latest and each version it
 * pins - and compared with the package through the contract's forms (`bridge.readBack`).
 */
async function readBackOf(
  trx: TenantTransaction,
  document: DecomposedDocument,
  persistentId: string,
  assets: ReadonlyMap<string, string>,
  carried: readonly CarryEntry[],
): Promise<bridge.ReadBack> {
  const stored = await latestVersion(trx, persistentId);
  if (!stored) return { ok: false, at: 'document', detail: 'the document was not read back' };
  const outline = stored.content as OutlineDocument;
  const components = new Map<string, ContentDocument>();
  type Node = OutlineDocument['nodes'][number];
  const references = (nodes: readonly Node[]): { component: string; version: string }[] =>
    nodes.flatMap((node) =>
      node.type === 'reference'
        ? node.mode.kind === 'pinned'
          ? [{ component: node.component, version: node.mode.version }]
          : []
        : references(node.children),
    );
  for (const { component, version } of references(outline.nodes)) {
    const read = await readVersion(trx, version);
    if (read?.kind === 'component') components.set(component, read.content as ContentDocument);
  }
  return bridge.readBack(document, { persistentId, outline, components, assets, carried });
}

/**
 * The receipt (docs/design/ct-studio-sink.md, "Versions, updates and the receipt"): the document, its
 * components and its assets written, and as `document.components` everything a later update is held
 * to - the document's map, each component and each image's asset - at the version this delivery left
 * it at.
 */
function receiptOf(
  input: DocumentDelivery,
  made: {
    readonly persistentId: string;
    readonly written: StoredVersion;
    readonly final: bridge.MappedDocument;
    readonly pins: ReadonlyMap<string, StoredVersion>;
    readonly assets: ReadonlyMap<
      string,
      { readonly artifactId: string; readonly versionId: string }
    >;
    readonly readBack: bridge.ReadBack;
  },
): SinkReceipt {
  const { persistentId, written, final, pins, assets, readBack } = made;
  const url = input.origin === undefined ? null : `${input.origin}/#/documents/${persistentId}`;
  const components = final.components.map((each) => ({
    each,
    version: pins.get(each.artifactId)!,
  }));
  const distinctAssets = [
    ...new Map([...assets.values()].map((asset) => [asset.versionId, asset])).values(),
  ];
  return {
    written: [
      { kind: 'document', id: written.id, label: input.title, url },
      ...components.map(({ each, version }) => ({
        kind: 'component',
        id: version.id,
        label: each.title,
        url: null,
      })),
      ...distinctAssets.map((asset) => ({
        kind: 'asset',
        id: asset.versionId,
        label: null,
        url: null,
      })),
    ],
    document: {
      persistentId,
      components: [
        { kind: 'map', id: persistentId, version: written.id, element: null },
        ...components.map(({ each, version }) => ({
          kind: 'component',
          id: each.artifactId,
          version: version.id,
          element: each.section,
        })),
        ...[...assets].map(([image, asset]) => ({
          kind: 'asset',
          id: asset.artifactId,
          version: asset.versionId,
          element: image,
        })),
      ],
      readBack,
    },
  };
}
