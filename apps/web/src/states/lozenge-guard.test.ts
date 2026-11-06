import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { KINDS } from '../../eslint/state-words.js';
import catalogue from '../words/en-GB.json';
import { LOZENGE_KINDS } from './Lozenge.js';

/**
 * **A state of content is shown only through `Lozenge`** (ADR-0081). This holds the catalogue, the
 * guide and the code together; `eslint/state-words.js` holds the source. What neither can catch is a
 * new state under a word nobody listed: that is review's.
 */

const SRC = join(import.meta.dirname, '..');
const GUIDE = join(SRC, '..', '..', '..', 'docs', 'interface', 'lifecycle-states.md');
const words = catalogue as Readonly<Record<string, string>>;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

/** "Done" is left out: it is mostly a verb, on a button, so listing it would be all noise. */
const STATE_WORDS = new Set(
  Object.entries(words)
    .filter(([key, value]) => key.startsWith('states.') && value !== 'Done')
    .map(([, value]) => value.toLowerCase()),
);

/** A key that holds a state's word and is not a state shown, by key, with why. */
const NOT_A_STATE: Readonly<Record<string, string>> = {
  'publishing.published': "a column's heading: when it was published",
  'translation.outcome-translated': "a word inside a job's sentence",
  'admin.failed': "an export's outcome: operational (D2), a Chip",
  'admin.diag-failed': "Diagnostics' column of jobs that failed: operational (D2), a heading",
  'admin.approved': "an audit event's name, and the Workflows column for a state's flag",
  'admin.published': "an audit event's name",
  'admin.organisation-change-closed': "what became of a tenant, inside an audit event's words",
  'data.revised-by-hand': "a provenance row's outcome, in its sentence",
  'data.accepted': "a provenance row's outcome, in its sentence",
  'data.resolved': "a provenance row's outcome, in its sentence",
  'search.resolved': 'a search facet over threads, by its own name',
  'admin.signin-closed': "a sign-in provider's status: operational (D2), a Chip",
};

/** A key that opens with a state's word: the facts a lozenge carries, or a sentence that tells it. */
const OPENS_WITH_A_STATE: Readonly<Record<string, string>> = {
  'editor.diverged': 'facts a lozenge carries',
  'search.diverged': 'facts a lozenge carries',
  'document.superseded-by': 'facts a lozenge carries',
  'review.resolved-by': 'facts a lozenge carries',
  'translation.out-of-date-no-retranslation': 'facts a lozenge carries',
  'translation.out-of-date-needs-retranslating': 'facts a lozenge carries',
  'document.accepted-the-part-is-made-not-placed': 'a sentence: what accepting did',
  'document.accepted-the-outline-has-changed': 'a sentence: what accepting did',
  'document.accepted-the-part-is-made': 'a sentence: what accepting did',
  'document.accepted-it-is-a-new': 'a sentence: what accepting did',
  'document.accepted-this-document-now-shows': 'a sentence: what accepting did',
  'document.accepted-this-document-still-shows': 'a sentence: what accepting did',
  'document.accepted-the-comment-is-posted': 'a sentence: what accepting did',
  'document.revised-by-hand': "a sentence: a bound value's revision",
  'publishing.accepted-by-into': "a sentence beside a publication's approvals",
  'publishing.rejected-by': "a sentence beside a publication's approvals",
  'publishing.withdrawn-by': "a sentence beside a publication's approvals",
  'publishing.published-by-on': 'a sentence: who published it, and when',
  'translation.draft-by-machine': "a job's kind",
  'admin.the-default-words': "a setting's label",
  'bibliography.current-the-source-holds-it': "a sentence: the source's answer",
  'bibliography.retracted-by-its-source': "a sentence: the source's answer",
  'bibliography.corrected-by-its-source': "a sentence: the source's answer",
  'bibliography.superseded-by-its-source': "a sentence: the source's answer",
  'metadata.retired-no-longer-offered': "a vocabulary value's sentence (D2)",
};

/** Who may name a state in words without showing it, by file, with why. */
const NAMES_A_STATE: Readonly<Record<string, string>> = {
  'admin/auditWords.ts': "an audit event's name",
  'admin/Spaces.tsx': "a filter's label",
  'editor/ComponentList.tsx': "a filter's removable chip, naming the filter",
  'listing/Listing.tsx': "a filter's label",
  'review/SuggestionsPanel.tsx': "a filter's label",
  'review/ThreadsPanel.tsx': "a filter's label",
  'structure/BaselinesTab.tsx': "a filter's label",
  'structure/dataStates.ts': "a filter's label, and its count",
  'structure/DocumentList.tsx': "a facet's label",
  'structure/RevisionAsk.tsx': "a definition list's term",
  'translation/SpaceTranslations.tsx': "a filter's label",
  'translation/Translations.tsx': 'the words a lozenge is given, with the language',
};

const REPO_FILES = sources(SRC);

describe('a state has one wording (ADR-0081)', () => {
  it('holds no state’s word under another key, but those listed with a reason', () => {
    const found = Object.entries(words)
      .filter(
        ([key, value]) => !key.startsWith('states.') && STATE_WORDS.has(value.trim().toLowerCase()),
      )
      .map(([key]) => key)
      .sort();
    expect(found).toEqual(Object.keys(NOT_A_STATE).sort());
  });

  it('opens no other key with a state’s word, but those listed with a reason', () => {
    const opens = (value: string) =>
      [...STATE_WORDS].some((word) =>
        [' by ', ': ', ', '].some((after) => value.toLowerCase().startsWith(word + after)),
      );
    const found = Object.entries(words)
      .filter(([key, value]) => !key.startsWith('states.') && opens(value))
      .map(([key]) => key)
      .sort();
    expect(found).toEqual(Object.keys(OPENS_WITH_A_STATE).sort());
  });
});

describe('the kinds, the guide and the code agree (ADR-0081)', () => {
  it('has a row in the guide for each kind, and a kind for each row', () => {
    const guide = readFileSync(GUIDE, 'utf8');
    const table = guide.slice(guide.indexOf('## The states'), guide.indexOf('## Which things'));
    const once = [...table.matchAll(/^\| `([a-zA-Z]+)` +\|/gm)].map((match) => match[1]!);
    expect(once.sort()).toEqual([...LOZENGE_KINDS].sort());
  });

  it('has a word under states.* for each kind but a tenant’s, and none spare', () => {
    const kebab = (kind: string) => kind.replace(/[A-Z]/g, (cap) => `-${cap.toLowerCase()}`);
    expect(
      Object.keys(words)
        .filter((key) => key.startsWith('states.'))
        .sort(),
    ).toEqual(
      LOZENGE_KINDS.filter((kind) => kind !== 'state')
        .map((kind) => `states.${kebab(kind)}`)
        .sort(),
    );
  });

  it('holds the lint rule’s kinds to the code’s', () => {
    expect([...KINDS].sort()).toEqual([...LOZENGE_KINDS].sort());
  });
});

/** Relative luminance of a `#rrggbb`, as WCAG defines it. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (one: string, two: string) => {
  const [hi, lo] = [luminance(one), luminance(two)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('a lozenge can be read', () => {
  const tokens = readFileSync(join(SRC, 'theme', 'tokens.css'), 'utf8');
  const theme = (name: string) => {
    const at = tokens.indexOf(`[data-theme='${name}']`);
    const open = at < 0 ? tokens.indexOf(`[data-theme="${name}"]`) : at;
    const body = tokens.slice(open, tokens.indexOf('}', open));
    return (token: string) => {
      const value = new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`).exec(body)?.[1];
      if (value === undefined) throw new Error(`no --${token} in ${name}`);
      return value;
    };
  };

  it.each(['light', 'dark'])('holds its words at 4.5:1 on every ground, in %s', (name) => {
    const of = theme(name);
    const pairs = [
      ['text', 'sunken'],
      ['info', 'info-bg'],
      ['ok', 'ok-bg'],
      ['warn', 'warn-bg'],
      ['muted', 'surface'],
      ['muted', 'sunken'],
      ['muted', 'accent-weak'],
      ['danger', 'danger-bg'],
    ] as const;
    for (const [ink, ground] of pairs) {
      expect(contrast(of(ink), of(ground)), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('a state is shown, not named (ADR-0081)', () => {
  it('calls stateWord only where a filter or a term names a state, each listed with why', () => {
    const callers = REPO_FILES.filter(
      (file) =>
        !file.endsWith(join('states', 'Lozenge.tsx')) &&
        /\bstateWord\(/.test(readFileSync(file, 'utf8')),
    ).map((file) => relative(SRC, file).replaceAll('\\', '/'));
    expect(callers.sort()).toEqual(Object.keys(NAMES_A_STATE).sort());
  });
});
