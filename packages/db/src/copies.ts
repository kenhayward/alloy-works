import { randomUUID } from 'node:crypto';
import {
  applyOverrides,
  chosenCopies,
  contentDocumentSchema,
  COPY_MAX,
  copyContent,
  copyOutline,
  outlineDocumentSchema,
  readContent,
  readOutline,
  walkOutline,
  type ContentDocument,
  type CopiedComponent,
  type CopyChoice,
  type MetadataFailure,
  type OutlineDocument,
  type Override,
  type Permission,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { isArchived } from './archival.js';
import { artifactPlace, recordEvent } from './audit.js';
import { componentFieldsNow, unstorableValues } from './component-values.js';
import { deletionStored, isDeleted, notDeletedAs } from './deletion.js';
import { readableComponents } from './documents.js';
import { recordOrigin, templateCopiesAmong } from './origins.js';
import { linesStored, translationStored } from './lines.js';
import { resolveOccurrences } from './publishing.js';
import { readableArtifactsAs } from './readable-artifacts.js';
import { indexTemplateOf } from './reference-index.js';
import { readScopes } from './scopes.js';
import { readSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate, readTemplate, type TemplateAnswer } from './templates.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';
import { waivedKeys } from './waivers.js';

/**
 * **Copying** (the RM plan, RM-F to RM-O; REU-056 to REU-058): a document, a component or a template
 * made again under a new title, into a space the caller may create in (design, for a template), each
 * through `createArtifact`, in the caller's transaction. Who may - read on it, create or design at the
 * target - is the caller's to decide first.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export { COPY_MAX };

export interface CopyInput {
  readonly artifactId: string;
  readonly to: string;
  readonly title: string;
  /** A document's components (RM-G): its own copied where absent. Nothing else has any. */
  readonly components?: CopyChoice | undefined;
  readonly by: string;
  readonly scopes?: readonly Permission[] | undefined;
}

/** What a copy makes and leaves, counted (RM-H, RM-J, RM-K): a component's or a template's are zero. */
export interface CopyCounts {
  readonly kind: 'document' | 'component' | 'template';
  /** Another of its kind the caller may read in the target holds this title: warned of, not refused. */
  readonly titleInUse: boolean;
  /** The components a document's copy copies. */
  readonly copied: number;
  /** The components it places that it reuses, of which `required` the template requires (RM-K). */
  readonly reused: number;
  readonly required: number;
  /** Of those reused, deleted or archived ones, which no choice copies (RM-K). */
  readonly kept: number;
  /** Of those it would copy, the ones the caller may not read, which refuse the copy (RM-K). */
  readonly unreadable: number;
  /** References to a copy that tracked the approved revision, made latest (RM-J). */
  readonly approvedToLatest: number;
  /** Components placed at more than one version, copied at the newest shown (RM-J). */
  readonly newestShown: number;
  /** Overrides dropped, their block changed at the version copied (RM-J). */
  readonly overridesDropped: number;
  /** Lines and translations of what is copied, which are not (RM-J). */
  readonly lines: number;
  readonly translations: number;
}

/** What it would leave in the space it came from, where the target is another (RM-O). */
export interface CopyConsequences {
  readonly citations: number;
  readonly terms: number;
  readonly imagesStaying: number;
  readonly bound: number;
}

export type CopyRefusal =
  | { readonly answer: 'artifact.missing' }
  | { readonly answer: 'space.archived' }
  | { readonly answer: 'content.invalid' }
  | { readonly answer: 'copy.too_large' }
  | { readonly answer: 'copy.unreadable'; readonly unreadable: number }
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
  | Exclude<TemplateAnswer, { readonly template: unknown }>;

export type CopyPreview =
  | (CopyCounts & {
      readonly answer: 'previewed';
      readonly consequences: CopyConsequences | null;
    })
  | Exclude<CopyRefusal, { answer: 'copy.too_large' | 'copy.unreadable' }>;

export type CopyAnswer =
  | (CopyCounts & {
      readonly answer: 'copied';
      readonly copy: StoredVersion;
      /** Each component a document's copy made, by the original it was made from. */
      readonly components: readonly { readonly from: string; readonly copy: string }[];
    })
  | CopyRefusal;

const ids = (list: readonly string[]) => sql`${[...list]}::uuid[]`;

const NONE: Omit<CopyCounts, 'kind' | 'titleInUse'> = {
  copied: 0,
  reused: 0,
  required: 0,
  kept: 0,
  unreadable: 0,
  approvedToLatest: 0,
  newestShown: 0,
  overridesDropped: 0,
  lines: 0,
  translations: 0,
};

type CopyKind = CopyCounts['kind'];

/** The title as its kind takes it, trimmed, or undefined where its kind refuses it. */
function titleFor(kind: CopyKind, title: string): string | undefined {
  const trimmed = title.trim();
  if (kind === 'document') {
    return outlineDocumentSchema.shape.title.safeParse(trimmed).success ? trimmed : undefined;
  }
  if (kind === 'component') {
    return trimmed !== '' && contentDocumentSchema.shape.title.safeParse(trimmed).success
      ? trimmed
      : undefined;
  }
  return trimmed !== '' && trimmed.length <= 200 ? trimmed : undefined;
}

/** Whether another of this kind the caller may read in the space is titled so (RM-F). */
async function titleInUse(
  trx: TenantTransaction,
  input: { readonly kind: CopyKind; readonly space: string; readonly title: string; by: string },
): Promise<boolean> {
  const readable = await loadReadableSet(trx, input.by);
  if (!readable) return false;
  const member = input.kind === 'template' ? 'name' : 'title';
  const deletion = (await deletionStored(trx)) ? sql`and ${notDeletedAs('a')}` : sql``;
  const { rows } = await sql<{ used: boolean }>`
    select exists (
      select from artifact a
       cross join lateral (
         select v.content from artifact_version v where v.artifact_id = a.id
          order by v.revision_no desc, v.version_no desc limit 1) latest
       where a.space_id = ${input.space} and a.kind = ${input.kind}
         and lower(btrim(latest.content ->> ${member})) = lower(${input.title})
         and ${readableArtifactsAs('a', readable)} ${deletion}
    ) as used`.execute(trx);
  return rows[0]?.used === true;
}

/** The lines and translations of these components, which a copy leaves (RM-J). */
async function linesOf(
  trx: TenantTransaction,
  components: readonly string[],
): Promise<{ readonly lines: number; readonly translations: number }> {
  if (components.length === 0 || !(await linesStored(trx))) return { lines: 0, translations: 0 };
  const language = (await translationStored(trx)) ? sql`to_jsonb(l) ->> 'language'` : sql`null`;
  const { rows } = await sql<{ lines: number; translations: number }>`
    select count(*) filter (where ${language} is null)::int as lines,
           count(*) filter (where ${language} is not null)::int as translations
      from artifact_line l where l.artifact_id = any(${ids(components)})`.execute(trx);
  return rows[0] ?? { lines: 0, translations: 0 };
}

/** One component a document places, as its copy reads it. */
interface Placed {
  readonly component: string;
  /** Placed by a reference the template does not require. */
  candidate: boolean;
  required: boolean;
  unreadable: boolean;
  gone: boolean;
  /** The versions its references show, newest first once read. */
  readonly shown: Set<string>;
}

/** What a document's copy would do, or why not, before anything is written. */
interface DocumentPlan {
  readonly version: StoredVersion;
  readonly outline: OutlineDocument;
  readonly copying: readonly { readonly component: string; readonly version: StoredVersion }[];
  /** The components its template copied for it, required or not: its own (REU-057; ND-G). */
  readonly owned: ReadonlySet<string>;
  readonly counts: Omit<CopyCounts, 'kind' | 'titleInUse'>;
}

/** The overrides an outline's references to a component hold. */
function overridesOf(outline: OutlineDocument, component: string): Override[] {
  const found: Override[] = [];
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'reference' && node.component === component && node.origin === undefined) {
      found.push(...(node.overrides ?? []));
    }
  });
  return found;
}

/** Reads each override's original, then answers which stand at `at`. */
async function overrideKeeps(
  trx: TenantTransaction,
  at: ContentDocument,
  overrides: readonly Override[],
): Promise<(override: Override) => boolean> {
  const originals = new Map<string, ContentDocument>();
  for (const version of new Set(overrides.map((each) => each.against))) {
    const stored = UUID.test(version) ? await readVersion(trx, version) : undefined;
    const read =
      stored?.kind === 'component'
        ? readContent(stored.content, { artifact: stored.artifactId, version })
        : undefined;
    if (read?.ok) originals.set(version, read.document);
  }
  return (override) => {
    const original = originals.get(override.against);
    if (!original) return false;
    return (
      applyOverrides(at, [override], new Map([[override.against, original]])).stale.length === 0
    );
  };
}

/** A component version's content, read as stored. */
function contentOf(version: StoredVersion): ContentDocument {
  const read = readContent(version.content, { artifact: version.artifactId, version: version.id });
  if (!read.ok) throw new Error(`Component version ${version.id} does not read: ${read.failure}`);
  return read.document;
}

async function planDocument(
  trx: TenantTransaction,
  version: StoredVersion,
  input: CopyInput,
): Promise<DocumentPlan> {
  const read = readOutline(version.content, { artifact: version.artifactId, version: version.id });
  if (!read.ok) throw new Error(`Document version ${version.id} does not read: ${read.failure}`);
  const outline = read.outline;
  const placed = new Map<string, Placed>();
  const nodes = new Map<string, { readonly component: string; readonly origin: boolean }>();
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'reference') return;
    nodes.set(node.id, { component: node.component, origin: node.origin !== undefined });
    const each = placed.get(node.component) ?? {
      component: node.component,
      candidate: false,
      required: false,
      unreadable: false,
      gone: false,
      shown: new Set<string>(),
    };
    if (node.origin === undefined) each.candidate = true;
    else each.required = true;
    placed.set(node.component, each);
  });
  // A required one its template made as this document's copy is the document's own (REU-057; ND-G).
  const owned = await templateCopiesAmong(
    trx,
    [...placed.values()].filter((each) => each.required).map((each) => each.component),
  );
  for (const each of placed.values()) if (owned.has(each.component)) each.candidate = true;
  for (const outcome of await resolveOccurrences(trx, outline, input.by)) {
    const node = nodes.get(outcome.node)!;
    const each = placed.get(node.component)!;
    if (outcome.outcome === 'unreadable') each.unreadable = true;
    if (outcome.outcome === 'gone') each.gone = true;
    if (outcome.outcome === 'resolved' && (!node.origin || owned.has(node.component))) {
      each.shown.add(outcome.version);
    }
  }
  const candidates = [...placed.values()].filter((each) => each.candidate);
  const archived = new Set<string>();
  for (const each of candidates) {
    if (!each.gone && !each.unreadable && (await isArchived(trx, each.component))) {
      archived.add(each.component);
    }
  }
  const elsewhere = await placedElsewhere(
    trx,
    version.artifactId,
    candidates.map((each) => each.component),
  );
  const chosen = chosenCopies(
    input.components ?? 'own',
    candidates.map((each) => ({
      component: each.component,
      own: !elsewhere.has(each.component),
      kept: each.gone || archived.has(each.component),
    })),
  );
  const unreadable = chosen.filter((id) => placed.get(id)!.unreadable);
  const readable = await readableComponents(trx, input.by, chosen);
  const copying: { component: string; version: StoredVersion }[] = [];
  let newestShown = 0;
  for (const component of chosen) {
    if (!readable.has(component)) continue;
    const shown = [...placed.get(component)!.shown];
    if (shown.length > 1) newestShown += 1;
    const versions = (await Promise.all(shown.map((id) => readVersion(trx, id)))).filter(
      (each): each is StoredVersion => each !== undefined,
    );
    versions.sort((a, b) => b.revision - a.revision || b.version - a.version);
    // Shown at none - an approved reference with nothing approved yet - it is copied at its latest.
    const at = versions[0] ?? (await latestVersion(trx, component));
    if (at) copying.push({ component, version: at });
  }
  // The outline's copy, counted against stand-in versions: the real ones are cut when it is made.
  const replaced = new Map<string, CopiedComponent>();
  for (const each of copying) {
    replaced.set(each.component, {
      component: randomUUID(),
      version: randomUUID(),
      keeps: await overrideKeeps(
        trx,
        contentOf(each.version),
        overridesOf(outline, each.component),
      ),
    });
  }
  const { counts } = copyOutline(outline, replaced, owned);
  const reused = [...placed.values()].filter((each) => !chosen.includes(each.component));
  const left = await linesOf(
    trx,
    copying.map((each) => each.component),
  );
  return {
    version,
    outline,
    copying,
    owned,
    counts: {
      copied: chosen.length,
      reused: reused.length,
      required: reused.filter((each) => !each.candidate).length,
      kept: reused.filter((each) => each.candidate && (each.gone || archived.has(each.component)))
        .length,
      unreadable: unreadable.length,
      approvedToLatest: counts.approvedToLatest,
      newestShown,
      overridesDropped: counts.overridesDropped,
      ...left,
    },
  };
}

/** Which of these components another document, not deleted, places. */
async function placedElsewhere(
  trx: TenantTransaction,
  document: string,
  components: readonly string[],
): Promise<ReadonlySet<string>> {
  if (components.length === 0) return new Set();
  const deletion = (await deletionStored(trx)) ? sql`and ${notDeletedAs('d')}` : sql``;
  const { rows } = await sql<{ id: string }>`
    select distinct r.to_id as id from reference r join artifact d on d.id = r.from_id
     where r.to_id = any(${ids(components)}) and r.to_kind = 'component'
       and r.from_id <> ${document} and d.kind = 'document' ${deletion}`.execute(trx);
  return new Set(rows.map((row) => row.id));
}

/** What it is, where it may go and under what title, or why not; read before anything is written. */
async function begin(
  trx: TenantTransaction,
  input: CopyInput,
): Promise<
  | {
      readonly kind: CopyKind;
      readonly from: string;
      readonly version: StoredVersion;
      readonly title: string;
    }
  | CopyRefusal
> {
  if (!UUID.test(input.artifactId) || !UUID.test(input.to)) return { answer: 'artifact.missing' };
  const artifact = await trx
    .selectFrom('artifact')
    .select(['kind', 'space_id'])
    .where('id', '=', input.artifactId)
    .executeTakeFirst();
  if (!artifact || (await isDeleted(trx, input.artifactId))) return { answer: 'artifact.missing' };
  const kind = artifact.kind;
  if (kind !== 'document' && kind !== 'component' && kind !== 'template') {
    return { answer: 'artifact.missing' };
  }
  const target = await readSpace(trx, input.to);
  if (!target || target.archivedAt !== null) return { answer: 'space.archived' };
  const title = titleFor(kind, input.title);
  if (title === undefined) return { answer: 'content.invalid' };
  const version = await latestVersion(trx, input.artifactId);
  if (!version) return { answer: 'artifact.missing' };
  return { kind, from: artifact.space_id!, version, title };
}

/** What the copy would leave in the space it came from, where it goes to another (RM-O). */
async function consequencesOf(
  trx: TenantTransaction,
  from: readonly string[],
): Promise<CopyConsequences> {
  const { rows } = await sql<CopyConsequences>`
    select
      (select count(*)::int from reference r
        where r.from_id = any(${ids(from)}) and r.to_kind = 'bibliographyEntry') as citations,
      (select count(*)::int from reference r
        where r.from_id = any(${ids(from)}) and r.to_kind = 'term') as terms,
      (select count(distinct r.to_id)::int from reference r
        where r.from_id = any(${ids(from)}) and r.to_kind = 'asset') as "imagesStaying",
      (select count(distinct r.from_id)::int from reference r
        where r.from_id = any(${ids(from)})
          and r.to_kind in ('queryDefinition', 'connection')) as bound`.execute(trx);
  return rows[0]!;
}

/** What `copyArtifact` would make and leave now, or how it would refuse; writes nothing (RM-H). */
export async function previewCopy(trx: TenantTransaction, input: CopyInput): Promise<CopyPreview> {
  const begun = await begin(trx, input);
  if ('answer' in begun) return begun as CopyPreview;
  const inUse = await titleInUse(trx, { ...begun, space: input.to, by: input.by });
  let counts = NONE;
  let from = [input.artifactId];
  if (begun.kind === 'document') {
    const plan = await planDocument(trx, begun.version, input);
    counts = plan.counts;
    from = [input.artifactId, ...plan.copying.map((each) => each.component)];
  } else if (begun.kind === 'component') {
    counts = { ...NONE, ...(await linesOf(trx, [input.artifactId])) };
  }
  return {
    answer: 'previewed',
    kind: begun.kind,
    titleInUse: inUse,
    ...counts,
    consequences: begun.from === input.to ? null : await consequencesOf(trx, from),
  };
}

/** Copies it, in the caller's transaction, or says why not, nothing written (RM-F to RM-N). */
export async function copyArtifact(trx: TenantTransaction, input: CopyInput): Promise<CopyAnswer> {
  const begun = await begin(trx, input);
  if ('answer' in begun) return begun;
  const inUse = await titleInUse(trx, { ...begun, space: input.to, by: input.by });
  if (begun.kind === 'template') {
    const made = await copyTemplate(trx, input, begun.title);
    if (made.answer !== 'copied') return made;
    return { ...made, kind: 'template', titleInUse: inUse, ...NONE, components: [] };
  }
  if (begun.kind === 'component') {
    const made = await copyComponent(trx, {
      version: begun.version,
      id: randomUUID(),
      to: input.to,
      title: begun.title,
      by: input.by,
      remap: new Map(),
    });
    if (made.answer !== 'copied') return made;
    return {
      answer: 'copied',
      kind: 'component',
      titleInUse: inUse,
      ...NONE,
      ...(await linesOf(trx, [input.artifactId])),
      copy: made.copy,
      components: [],
    };
  }
  return copyDocument(trx, input, begun.version, begun.title, inUse);
}

/** A component's version made again as a new component's 0.1 (RM-J, RM-M), audited. */
export async function copyComponent(
  trx: TenantTransaction,
  input: {
    readonly version: StoredVersion;
    readonly id: string;
    readonly to: string;
    /** Its own title where absent. */
    readonly title?: string;
    readonly by: string;
    /** Each other component copied with it, to its copy. */
    readonly remap: ReadonlyMap<string, string>;
    /** The template version making it, where a template copies it (the ND plan, ND-C). */
    readonly template?: { readonly id: string; readonly version: string } | undefined;
  },
): Promise<
  | { readonly answer: 'copied'; readonly copy: StoredVersion }
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
> {
  const substance = substanceOf(input.version);
  if (substance.kind !== 'component') throw new Error('Only a component version copies so');
  const { effective } = await componentFieldsNow(trx, input.version);
  // Checked with the original's as `previous`, so a value it already held stands (MET-003).
  const failures = await unstorableValues(trx, effective, substance.values, substance.values);
  if (failures.length > 0) return { answer: 'values.invalid', failures };
  const remapped = copyContent(contentOf(input.version), input.remap).content;
  const copy = await createArtifact(trx, {
    author: input.by,
    spaceId: input.to,
    artifactId: input.id,
    substance: {
      ...substance,
      content: { ...remapped, ...(input.title === undefined ? {} : { title: input.title }) },
    },
  });
  await copyScope(trx, input.version.artifactId, copy.artifactId, 'component', input.by);
  await recordCopied(trx, copy, input.version.artifactId);
  // What it was made from, at which version (REU-059).
  await recordOrigin(trx, copy.artifactId, {
    from: { id: input.version.artifactId, version: input.version.id },
    template: input.template,
  });
  return { answer: 'copied', copy };
}

/** Its scope, where one was set, as the copy's (RM-J, RM-L). */
async function copyScope(
  trx: TenantTransaction,
  from: string,
  to: string,
  kind: 'component' | 'document',
  by: string,
): Promise<void> {
  const scope = (await readScopes(trx, [from])).get(from);
  if (!scope) return;
  await trx
    .insertInto('artifact_scope')
    .values({ artifact_id: to, kind, scope: JSON.stringify(scope.scope), by })
    .execute();
}

/** `artifact.copied` (RM-N): about the copy, at its first version, naming what it was made from. */
async function recordCopied(
  trx: TenantTransaction,
  copy: StoredVersion,
  from: string,
): Promise<void> {
  const place = await artifactPlace(trx, copy.artifactId, copy.id);
  await recordEvent(
    trx,
    {
      kind: 'artifact.copied',
      subject: { kind: copy.kind, id: copy.artifactId, version: copy.id },
      space: place.space,
      detail: { from },
    },
    place.labels,
  );
}

/** A template's definition under the new name, made as a new one is (RM-M). */
async function copyTemplate(
  trx: TenantTransaction,
  input: CopyInput,
  name: string,
): Promise<
  | { readonly answer: 'copied'; readonly copy: StoredVersion }
  | Exclude<TemplateAnswer, { readonly template: unknown }>
> {
  const template = await readTemplate(trx, input.artifactId);
  if (!template) return { answer: 'template.missing' };
  const made = await createTemplate(trx, {
    spaceId: input.to,
    author: input.by,
    definition: { ...template.definition, name },
  });
  if (!('template' in made)) return made;
  await recordCopied(trx, made.template.version, input.artifactId);
  return { answer: 'copied', copy: made.template.version };
}

/** A document copied with its components as chosen (RM-G to RM-L), audited. */
async function copyDocument(
  trx: TenantTransaction,
  input: CopyInput,
  version: StoredVersion,
  title: string,
  inUse: boolean,
): Promise<CopyAnswer> {
  const plan = await planDocument(trx, version, input);
  if (plan.counts.unreadable > 0) {
    return { answer: 'copy.unreadable', unreadable: plan.counts.unreadable };
  }
  if (plan.counts.copied > COPY_MAX) return { answer: 'copy.too_large' };

  const remap = new Map(plan.copying.map((each) => [each.component, randomUUID()]));
  const replaced = new Map<string, CopiedComponent>();
  for (const each of plan.copying) {
    const made = await copyComponent(trx, {
      version: each.version,
      id: remap.get(each.component)!,
      to: input.to,
      by: input.by,
      remap,
    });
    if (made.answer !== 'copied') return made;
    replaced.set(each.component, {
      component: made.copy.artifactId,
      version: made.copy.id,
      keeps: await overrideKeeps(
        trx,
        contentOf(made.copy),
        overridesOf(plan.outline, each.component),
      ),
    });
  }
  const copied = copyOutline(plan.outline, replaced, plan.owned).outline;
  // Its translated titles translate the original's title, which the copy no longer holds.
  const { titles: translated, ...heading } = copied;
  void translated;
  const substance = substanceOf(version);
  if (substance.kind !== 'document') throw new Error('Only a document version copies so');
  const copy = await createArtifact(trx, {
    author: input.by,
    spaceId: input.to,
    substance: { ...substance, content: { ...heading, title } },
  });
  const document = copy.artifactId;

  // Its template at its effective version: the latest move's, or the one it was made from (RM-L).
  const { rows: templates } = await sql<{ template_id: string; version: string }>`
    select d.template_id, coalesce(
      (select m.to_version_id from document_template_move m
        where m.document_id = d.document_id order by m.id desc limit 1),
      d.template_version_id) as version
      from document_template d where d.document_id = ${version.artifactId}`.execute(trx);
  const template = templates[0];
  if (template) {
    await trx
      .insertInto('document_template')
      .values({
        document_id: document,
        template_id: template.template_id,
        template_version_id: template.version,
      })
      .execute();
    await indexTemplateOf(trx, document);
  }
  for (const [key, reason] of await waivedKeys(trx, version.artifactId)) {
    await trx
      .insertInto('section_waiver')
      .values({ document_id: document, key, reason, version_id: copy.id, by: input.by })
      .execute();
  }
  await copyScope(trx, version.artifactId, document, 'document', input.by);
  await copyBindings(trx, version.artifactId, document, input.by);
  await recordCopied(trx, copy, version.artifactId);
  return {
    answer: 'copied',
    kind: 'document',
    titleInUse: inUse,
    ...plan.counts,
    copy,
    components: plan.copying.map((each) => ({
      from: each.component,
      copy: remap.get(each.component)!,
    })),
  };
}

/**
 * Each bound part's latest resolution, as a `resolve` by the copier, and the revisions standing on it
 * in front of the copy's (RM-L): never resolved afresh, so the copy holds what the original showed.
 */
async function copyBindings(
  trx: TenantTransaction,
  from: string,
  to: string,
  by: string,
): Promise<void> {
  const { rows } = await sql<{
    id: string;
    node_id: string;
    binding_id: string;
    binding_digest: string;
    dataset_version: string;
    dataset_id: string;
  }>`
    select distinct on (node_id, binding_id)
           id::text, node_id, binding_id, binding_digest, dataset_version, dataset_id
      from binding_resolution where document_id = ${from}
     order by node_id, binding_id, id desc`.execute(trx);
  for (const row of rows) {
    const made = await trx
      .insertInto('binding_resolution')
      .values({
        document_id: to,
        node_id: row.node_id,
        binding_id: row.binding_id,
        binding_digest: row.binding_digest,
        dataset_version: row.dataset_version,
        dataset_id: row.dataset_id,
        replaces: null,
        act: 'resolve',
        resolved_by: by,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`
      insert into binding_revision
        (document_id, node_id, binding_id, cell, resolution, act, value, reason, replaces, revised_by)
      select ${to}, node_id, binding_id, cell, ${made.id}, 'revise', value, reason, null, ${by}
        from (select distinct on (cell) * from binding_revision
               where resolution = ${row.id}::bigint order by cell, id desc) latest
       where act = 'revise'
       order by id`.execute(trx);
  }
}
