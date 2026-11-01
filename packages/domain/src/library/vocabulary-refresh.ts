import {
  holdsVocabularyText,
  isVocabularyKey,
  parseVocabulary,
  VOCABULARY_LIMITS,
  type Vocabulary,
  type VocabularyValue,
} from './vocabulary.js';

/** A value as its source gives it (LIB-058): its identifier there, and its words by language. */
export interface SourcedValue {
  readonly source: string;
  /** The id the source suggests, a SKOS notation; taken where it is a value id's form and free. */
  readonly notation?: string;
  readonly labels: readonly { readonly language: string; readonly text: string }[];
  readonly descriptions: readonly { readonly language: string; readonly text: string }[];
}

/** What a refresh did (the VO plan, VO-J), by value id; a row it could not hold by its identifier. */
export interface VocabularyRefreshReport {
  readonly added: string[];
  readonly relabelled: string[];
  readonly retired: string[];
  /** Retired here, and in the source again: kept retired, for the administrator to restore. */
  readonly returned: string[];
  readonly unchanged: number;
  /** The first 1,000; `refusedTotal` counts them all. */
  readonly refused: { readonly source: string; readonly reason: string }[];
  readonly refusedTotal: number;
}

const REFUSED_MOST = 1_000;

/** An id in a value's form from an identifier's last part: `v_` before one not starting a letter. */
function idFrom(source: string): string {
  const tail =
    source
      .split(/[/#:]/)
      .filter((each) => each !== '')
      .pop() ?? '';
  const slug = tail
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 56);
  return slug === '' ? 'value' : /^[a-z]/.test(slug) ? slug : `v_${slug}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * **A vocabulary's next version from what its source gives** (LIB-058; the VO plan, VO-J): each value
 * kept by its source identifier, its words the source's; one new to the source added active, by its
 * notation where that is a free value id, else an id made of its identifier, allocated once; one gone
 * from the source retired, never dropped (LIB-023). A value's state is otherwise its administrator's,
 * and a value made by hand stays. Pure; the caller fetches and records.
 */
export function refreshVocabulary(
  previous: Vocabulary,
  fetched: readonly SourcedValue[],
): { readonly next: Vocabulary; readonly report: VocabularyRefreshReport } {
  const refused: { source: string; reason: string }[] = [];
  let refusedTotal = 0;
  const refuse = (source: string, reason: string) => {
    refusedTotal += 1;
    if (refused.length < REFUSED_MOST) refused.push({ source, reason });
  };
  const bySource = new Map(
    previous.values.filter((each) => each.source !== undefined).map((each) => [each.source!, each]),
  );
  const taken = new Set(previous.values.map((each) => each.id));
  const seen = new Set<string>();
  const updated = new Map<string, VocabularyValue>();
  const added: VocabularyValue[] = [];
  const report = { relabelled: [] as string[], returned: [] as string[], unchanged: 0 };
  for (const row of fetched) {
    if (row.source.trim() === '') {
      refuse(row.source, 'no identifier');
      continue;
    }
    if (row.source.length > VOCABULARY_LIMITS.sourceIdentifier) {
      refuse(row.source.slice(0, 200), 'an identifier longer than a value holds');
      continue;
    }
    if (seen.has(row.source)) {
      refuse(row.source, 'a second value with this identifier');
      continue;
    }
    seen.add(row.source);
    if (!row.labels.some((each) => each.language === previous.base)) {
      refuse(row.source, `no label in the base language, ${previous.base}`);
      continue;
    }
    if (row.labels.some((each) => !holdsVocabularyText('label', each.text))) {
      refuse(row.source, 'a label longer than a value holds');
      continue;
    }
    if (row.descriptions.some((each) => !holdsVocabularyText('description', each.text))) {
      refuse(row.source, 'a description longer than a value holds');
      continue;
    }
    const words = { labels: [...row.labels], descriptions: [...row.descriptions] };
    const held = bySource.get(row.source);
    if (held) {
      if (same(held.labels, words.labels) && same(held.descriptions, words.descriptions)) {
        report.unchanged += 1;
      } else {
        report.relabelled.push(held.id);
      }
      if (held.state === 'retired') report.returned.push(held.id);
      updated.set(held.id, { ...held, ...words });
      continue;
    }
    if (previous.values.length + added.length >= VOCABULARY_LIMITS.values) {
      refuse(row.source, `past ${VOCABULARY_LIMITS.values.toLocaleString('en')} values`);
      continue;
    }
    const base =
      row.notation !== undefined && isVocabularyKey(row.notation)
        ? row.notation
        : idFrom(row.source);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
    taken.add(id);
    added.push({ id, source: row.source, ...words, state: 'active' });
  }
  const retired: string[] = [];
  const values = previous.values.map((each) => {
    const kept = updated.get(each.id);
    if (kept) return kept;
    if (each.source === undefined || each.state === 'retired') return each;
    retired.push(each.id);
    const next: VocabularyValue = { ...each, state: 'retired' };
    delete next.replacedBy;
    return next;
  });
  return {
    next: parseVocabulary({ ...previous, values: [...values, ...added] }),
    report: {
      added: added.map((each) => each.id),
      relabelled: report.relabelled,
      retired,
      returned: report.returned,
      unchanged: report.unchanged,
      refused,
      refusedTotal,
    },
  };
}

/**
 * What a hand change to a sourced vocabulary may not do (LIB-058; VO-J): its values are its source's,
 * so only their states and replacements change by hand. Its source changed or taken away, any change
 * stands. A message per value refused.
 */
export function sourcedEditRefusals(previous: Vocabulary | undefined, next: Vocabulary): string[] {
  if (previous?.source === undefined || !same(previous.source, next.source)) return [];
  const before = new Map(previous.values.map((each) => [each.id, each]));
  return next.values.flatMap((value) => {
    const held = before.get(value.id);
    if (held === undefined) return [`${value.id}: a value comes from the source`];
    return same(held.labels, value.labels) &&
      same(held.descriptions, value.descriptions) &&
      held.source === value.source
      ? []
      : [`${value.id}: its labels and descriptions are its source's`];
  });
}
