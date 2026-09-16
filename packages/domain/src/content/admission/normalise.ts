import type { ContentDocument } from '../model/document.js';
import { markSchema } from '../model/marks.js';

import type { ReportCollector } from './report.js';

/**
 * The fourth stage, over content sanitise has already made safe and migrate has brought to the
 * current schema.
 *
 * - **Formatting is dropped** (CNT-065). A reader hands over what it found as `presentation`, naming
 *   `typeface`, `size` and `colour` where it can tell; nothing in the model can hold any of it.
 * - **Every string is put in NFC** (CNT-056), so identical text compares and hashes alike.
 * - **Empty runs of text are dropped, then a second empty paragraph beside another** (CNT-023). One
 *   empty paragraph stays: a cursor needs somewhere to be (CNT-124).
 * - **The language the content came from is kept** as a language mark over its text, where it differs
 *   from the receiving component's. A direction that differs cannot be kept - the model has no member
 *   for a run's direction - so it is reported rather than dropped in silence.
 *
 * Every rewrite and every drop is counted and reported. The spike's importer dropped three empty
 * paragraphs and did not count them.
 */
export function normalise(
  candidate: Record<string, unknown>,
  receiver: ContentDocument,
  report: ReportCollector,
): Record<string, unknown> {
  const tally: Tally = {
    typeface: 0,
    size: 0,
    colour: 0,
    appearance: new Map(),
    unicode: 0,
    emptyText: 0,
    emptyParagraph: 0,
  };
  const { language, direction, ...rest } = visit(candidate, tally) as Record<string, unknown>;
  let normalised: Record<string, unknown> = rest;

  for (const subject of ['typeface', 'size', 'colour'] as const) {
    if (tally[subject] > 0)
      report.add('normalise', 'discarded', subject, { count: tally[subject] });
  }
  for (const [property, count] of tally.appearance) {
    report.add('normalise', 'discarded', 'appearance', {
      count,
      ...(property === '' ? {} : { detail: property }),
    });
  }
  if (tally.unicode > 0) report.add('normalise', 'rewritten', 'unicode', { count: tally.unicode });
  if (tally.emptyText > 0) {
    report.add('normalise', 'discarded', 'emptyText', { count: tally.emptyText });
  }
  if (tally.emptyParagraph > 0) {
    report.add('normalise', 'discarded', 'emptyParagraph', { count: tally.emptyParagraph });
  }

  if (typeof language === 'string' && language !== receiver.language) {
    if (markSchema.safeParse({ type: 'language', id: 'probe', tag: language }).success) {
      normalised = withLanguage(normalised, language) as Record<string, unknown>;
      report.add('normalise', 'rewritten', 'language', { detail: language });
    } else {
      report.add('normalise', 'discarded', 'language', { detail: language });
    }
  }
  if (typeof direction === 'string' && direction !== receiver.direction) {
    report.add('normalise', 'discarded', 'direction', { detail: direction });
  }
  return normalised;
}

type Tally = {
  typeface: number;
  size: number;
  colour: number;
  /** Other formatting, by the property name the reader gave it; '' where it gave none. */
  appearance: Map<string, number>;
  unicode: number;
  emptyText: number;
  emptyParagraph: number;
};

function visit(value: unknown, tally: Tally): unknown {
  if (typeof value === 'string') {
    const nfc = value.normalize('NFC');
    if (nfc !== value) tally.unicode += 1;
    return nfc;
  }
  if (Array.isArray(value)) {
    const members = value
      .map((member) => visit(member, tally))
      .filter((member) => {
        if (!isNode(member, 'text') || member.value !== '') return true;
        tally.emptyText += 1;
        return false;
      });
    return members.filter((member, index) => {
      const previous = members[index - 1];
      if (!isEmptyParagraph(member) || !isEmptyParagraph(previous)) return true;
      tally.emptyParagraph += 1;
      return false;
    });
  }
  if (typeof value !== 'object' || value === null) return value;

  // Entries rather than assignment, so a member named `__proto__` stays a member: validation refuses
  // it, rather than the setter swallowing it without a report entry.
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, member]) => {
      if (key !== 'presentation') return [[key, visit(member, tally)]];
      countPresentation(member, tally);
      return [];
    }),
  );
}

function countPresentation(presentation: unknown, tally: Tally): void {
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) {
    tally.appearance.set('', (tally.appearance.get('') ?? 0) + 1);
    return;
  }
  for (const property of Object.keys(presentation)) {
    if (property === 'typeface' || property === 'size' || property === 'colour') {
      tally[property] += 1;
    } else {
      tally.appearance.set(property, (tally.appearance.get(property) ?? 0) + 1);
    }
  }
}

function withLanguage(value: unknown, tag: string): unknown {
  if (Array.isArray(value)) return value.map((member) => withLanguage(member, tag));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, member]) => [key, withLanguage(member, tag)]),
  );
  if (isNode(out, 'text')) {
    const marks = Array.isArray(out.marks) ? out.marks : [];
    if (!marks.some((mark) => isNode(mark, 'language'))) {
      out.marks = [...marks, { type: 'language', tag }];
    }
  }
  return out;
}

function isNode(value: unknown, type: string): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === type
  );
}

function isEmptyParagraph(value: unknown): boolean {
  return isNode(value, 'paragraph') && Array.isArray(value.content) && value.content.length === 0;
}
