import {
  planTemplateMove,
  readOutline,
  resolveTemplate,
  templateDefinitionSchema,
  type MoveReport,
  type TemplateDefinition,
  type UnresolvedReference,
} from '@alloy-works/domain';
import { artifactPlace, recordEvent } from './audit.js';
import { isArchived } from './archival.js';
import { isDeleted } from './deletion.js';
import { indexTemplateOf } from './reference-index.js';
import type { TenantTransaction } from './tables.js';
import { documentTemplate, templateReferences } from './templates.js';
import {
  latestVersion,
  lockArtifact,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';
import { waivedKeys } from './waivers.js';

/**
 * **Moving forward** (templates.md; the WF6 plan, WF6-C to WF6-F; TPL-033, TPL-034, TPL-058): a
 * document moved to its template's newest version as an explicit act, against the document version
 * its author saw. One resolution answers the preview and the move alike, so the move does what the
 * preview said; the preview records nothing, and the author may leave it there.
 */

export type MoveRefusal =
  | { readonly answer: 'document.missing' }
  /** Made blank: there is no template to move to. */
  | { readonly answer: 'template.none' }
  /** Already at the template's newest version: nothing to move to. */
  | { readonly answer: 'template.current' }
  /** Asked for a version that is not the template's newest. */
  | { readonly answer: 'template.not_latest'; readonly latest: string }
  /** The newer version names something that does not resolve now (TPL-004). */
  | { readonly answer: 'template.unresolved'; readonly unresolved: readonly UnresolvedReference[] }
  | { readonly answer: 'artifact.archived' };

export interface MovePreview {
  readonly answer: 'previewed';
  readonly template: string;
  readonly from: string;
  readonly to: string;
  /** The document version the move is against. */
  readonly latest: string;
  readonly report: MoveReport;
}

async function fieldsOf(trx: TenantTransaction, definition: TemplateDefinition) {
  const resolved = resolveTemplate(definition, await templateReferences(trx, definition));
  return resolved;
}

async function resolveMove(
  trx: TenantTransaction,
  input: { readonly documentId: string; readonly to: string },
) {
  const latest = await latestVersion(trx, input.documentId);
  if (!latest || latest.kind !== 'document' || (await isDeleted(trx, input.documentId))) {
    return { refusal: { answer: 'document.missing' } as const };
  }
  if (await isArchived(trx, input.documentId)) {
    return { refusal: { answer: 'artifact.archived' } as const };
  }
  const link = await documentTemplate(trx, input.documentId);
  if (!link) return { refusal: { answer: 'template.none' } as const };
  const newest = await latestVersion(trx, link.template);
  if (!newest) throw new Error(`The template ${link.template} a document names is gone`);
  if (newest.id === link.version) return { refusal: { answer: 'template.current' } as const };
  if (input.to !== newest.id) {
    return { refusal: { answer: 'template.not_latest', latest: newest.id } as const };
  }
  const fromVersion = await readVersion(trx, link.version);
  if (!fromVersion)
    throw new Error(`The template version ${link.version} a document names is gone`);
  const fromDefinition = templateDefinitionSchema.parse(fromVersion.content);
  const toDefinition = templateDefinitionSchema.parse(newest.content);
  const to = await fieldsOf(trx, toDefinition);
  if (!to.ok)
    return { refusal: { answer: 'template.unresolved', unresolved: to.unresolved } as const };
  // What the document holds was written against the fields its recorded version applies now (TE-K).
  const from = await fieldsOf(trx, fromDefinition);
  const read = readOutline(latest.content, { artifact: input.documentId, version: latest.id });
  if (!read.ok) throw new Error(`The document ${input.documentId} at ${latest.id} does not read`);
  const plan = planTemplateMove({
    from: {
      definition: fromDefinition,
      document: from.ok ? from.document : [],
      section: from.ok ? from.section : [],
    },
    to: { definition: toDefinition, document: to.document, section: to.section },
    outline: read.outline,
    values: latest.values,
    waived: new Set((await waivedKeys(trx, input.documentId)).keys()),
  });
  return { latest, link, to: newest.id, plan };
}

/** What moving a document to its template's newest version would change (TPL-034); records nothing. */
export async function previewTemplateMove(
  trx: TenantTransaction,
  input: { readonly documentId: string; readonly to: string },
): Promise<MovePreview | MoveRefusal> {
  const resolved = await resolveMove(trx, input);
  if ('refusal' in resolved) return resolved.refusal;
  return {
    answer: 'previewed',
    template: resolved.link.template,
    from: resolved.link.version,
    to: resolved.to,
    latest: resolved.latest.id,
    report: resolved.plan.report,
  };
}

export type MoveAnswer =
  | { readonly answer: 'moved'; readonly version: StoredVersion; readonly report: MoveReport }
  | { readonly answer: 'version.precondition'; readonly current: string }
  | MoveRefusal;

/**
 * Moves a document to its template's newest version (TPL-033): against the document version `latest`
 * its author previewed, refused where it has moved since; records a version with its values carried
 * forward, the move, and `template.moved`. Never forced: the author asks for it.
 */
export async function moveDocumentTemplate(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly latest: string;
    readonly to: string;
    readonly by: string;
  },
): Promise<MoveAnswer> {
  // Under its lock, so two moves at once take turns and the second finds it moved (the final review).
  await lockArtifact(trx, input.documentId);
  const resolved = await resolveMove(trx, input);
  if ('refusal' in resolved) return resolved.refusal;
  const { latest, link, plan } = resolved;
  if (latest.id !== input.latest) return { answer: 'version.precondition', current: latest.id };
  const recorded = await recordVersion(trx, {
    artifactId: input.documentId,
    openedFrom: latest.id,
    author: input.by,
    substance: {
      kind: 'document',
      content: plan.outline,
      values: plan.values,
      parameters: latest.parameters,
    },
  });
  // Nothing the document holds changes: the move is the binding's alone, against the version it is.
  if (recorded.answer === 'version.precondition' || recorded.answer === 'artifact.missing') {
    return { answer: 'version.precondition', current: latest.id };
  }
  const version = recorded.answer === 'recorded' ? recorded.version : recorded.current;
  await trx
    .insertInto('document_template_move')
    .values({
      document_id: input.documentId,
      template_id: link.template,
      from_version_id: link.version,
      to_version_id: resolved.to,
      version_id: version.id,
      by: input.by,
    })
    .execute();
  await indexTemplateOf(trx, input.documentId);
  const place = await artifactPlace(trx, input.documentId, version.id);
  await recordEvent(
    trx,
    {
      kind: 'template.moved',
      subject: { kind: 'document', id: input.documentId, version: version.id },
      space: place.space,
      detail: {
        template: link.template,
        from: link.version,
        to: resolved.to,
        notCarried: plan.report.notCarried.length,
      },
    },
    place.labels,
  );
  return { answer: 'moved', version, report: plan.report };
}
