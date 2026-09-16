import type { BlockNode } from '../model/blocks.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument } from '../model/document.js';

import { exceedsLimits } from './limits.js';
import { migrateCandidate } from './migrate.js';
import { normalise } from './normalise.js';
import { reidentify, type Receiver } from './reidentify.js';
import { createReport, type ReportEntry } from './report.js';
import { sanitise } from './sanitise.js';

/**
 * What a reader hands the pipeline: a content-document-shaped value and what the reader itself could
 * not represent. There is no member naming the source, on purpose - one pipeline serves a foreign
 * paste and an internal copy (CNT-135), and a pipeline that knew which it had would be two.
 *
 * `candidate` is `{ schemaVersion, content, language?, direction? }`, where `language` and
 * `direction` are the source's own. It is untrusted, whoever built it, and walked as plain JSON until
 * validation. Beyond the model's own nodes and marks, a reader uses exactly this vocabulary for what
 * the pipeline must remove, and never removes it itself - so that sanitising happens in one place,
 * on one set of terms:
 *
 * - `{ type: 'script', name }` and `{ type: 'embeddedObject', name }`, wherever a node can stand;
 * - `handlers: string[]`, the event handler names, on any node or mark;
 * - `presentation: { typeface?, size?, colour?, [other]: string }` on any node;
 * - a `hyperlink` mark with whatever target arrived, and an equation's MathML as it arrived;
 * - any block, footnote or mark without an `id`.
 *
 * Anything else the model does not define is not removed. Validation refuses it, and with it the
 * whole admission.
 */
export type AdmissionInput = {
  readonly candidate: unknown;
  readonly report: readonly ReportEntry[];
};

export type AdmissionRefusal =
  'oversized' | 'unreadable' | 'schemaVersion' | 'identifiers' | 'invalid' | 'empty';

export type AdmissionRefused = {
  readonly ok: false;
  readonly refusal: AdmissionRefusal;
  /** For the developer. The author is shown the report, whose last entry says why. */
  readonly failure: string;
  readonly report: readonly ReportEntry[];
};

export type AdmissionOutcome =
  | {
      readonly ok: true;
      readonly content: readonly BlockNode[];
      readonly report: readonly ReportEntry[];
    }
  | AdmissionRefused;

/**
 * The admission pipeline: sanitise, migrate, normalise, re-identify, validate, in that order, with one
 * report threaded through them all and returned with the content (CNT-063). The order is load-bearing:
 * sanitise before normalise, so nothing hostile is rewritten into something that passes; migrate
 * before re-identify, so identifiers are allocated in the current schema's terms; validate last, over
 * what the others produced rather than what arrived.
 *
 * An outcome, never an exception, and never part of the content: either every block that survived,
 * validated as a whole, or a named refusal and nothing (CNT-010). The blocks are for the caller to
 * place in the receiving component - where a paste lands is the editor's.
 */
export function admit(input: AdmissionInput, receiver: Receiver): AdmissionOutcome {
  const report = createReport(input.report);
  const refuse = (refusal: AdmissionRefusal, failure: string): AdmissionRefused => ({
    ok: false,
    refusal,
    failure,
    report: report.entries,
  });

  const oversized = exceedsLimits(input.candidate);
  if (oversized !== undefined) {
    report.add('sanitise', 'refused', 'oversized');
    return refuse('oversized', `The content holds ${oversized}`);
  }

  const sanitised = sanitise(input.candidate, report);

  const migrated = migrateCandidate(sanitised, report);
  if (!migrated.ok) return refuse('schemaVersion', migrated.failure);

  const normalised = normalise(migrated.value, receiver.document, report);

  const identified = reidentify(normalised, receiver, report);
  if (!identified.ok) return refuse('identifiers', identified.failure);

  const content = identified.value.content;
  if (Array.isArray(content) && content.length === 0) {
    report.add('validate', 'refused', 'empty');
    return refuse('empty', 'Nothing was left to admit');
  }
  try {
    const { title, language, direction } = receiver.document;
    const document = parseContentDocument({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      title,
      language,
      direction,
      content,
    });
    return { ok: true, content: document.content, report: report.entries };
  } catch (error) {
    report.add('validate', 'refused', 'invalid');
    return refuse('invalid', error instanceof Error ? error.message : String(error));
  }
}
