import { describe, expect, it } from 'vitest';

import { draftRequirement } from './draft.js';
import type { Requirement, TraceModel } from './model.js';
import type { FiledRequirement } from './parse/issue.js';
import { parseAreaDocument } from './parse/requirements.js';

const document = 'ZZZ-invented-area.md';

const requirement = (id: string, statement: string): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement,
  tranche: 'T1',
  status: 'Specified',
  document,
  line: 7,
});

const model: TraceModel = {
  requirements: [
    requirement('ZZZ-001', 'A widget must carry its own name'),
    requirement('ZZZ-002', 'A widget must remember its colour'),
    requirement('ZZZ-003', 'A widget must be countable'),
  ],
  nonRequirements: [],
  questions: [],
  designs: [],
  citations: [],
};

const areaDocumentText = [
  '# ZZZ - Invented area',
  '',
  '## 3. Widgets',
  '',
  '| ID          | Requirement                       | Tranche | Status    |',
  '| ----------- | ---------------------------------- | ------- | --------- |',
  '| **ZZZ-001** | A widget must carry its own name  | T1      | Specified |',
  '',
].join('\n');

const filedComplete: FiledRequirement = {
  area: 'ZZZ',
  statement: 'A widget must remember its own name',
  why: 'Because a widget without a name cannot be cited',
  howWeWouldKnow: 'A test asserts the name round-trips through storage',
  tranche: 'T1',
  whoAsked: 'Ada',
};

/** A minimal document to check a produced row against, independent of the fixture above. */
function documentContaining(row: string): string {
  return [
    '| ID          | Requirement | Tranche | Status    |',
    '| ----------- | ----------- | ------- | --------- |',
    row,
    '',
  ].join('\n');
}

describe('drafting a candidate requirement', () => {
  it('allocates the next free identifier for the filed area', () => {
    const draft = draftRequirement(filedComplete, model, areaDocumentText);

    expect(draft.id).toBe('ZZZ-004');
  });

  it('formats a row that parseAreaDocument reads back with the same id, statement and tranche', () => {
    const draft = draftRequirement(filedComplete, model, areaDocumentText);

    const parsed = parseAreaDocument(document, documentContaining(draft.row));

    expect(parsed.requirements).toHaveLength(1);
    expect(parsed.requirements[0]).toMatchObject({
      id: 'ZZZ-004',
      statement: filedComplete.statement,
      tranche: 'T1',
      status: 'Specified',
    });
  });

  it('carries the literal T? placeholder when the filer gave no tranche, rather than guessing one', () => {
    const filedNoTranche: FiledRequirement = { ...filedComplete, tranche: undefined };

    const draft = draftRequirement(filedNoTranche, model, areaDocumentText);

    expect(draft.row).toContain('T?');
  });

  it('is refused by the parser once the T? row is placed in a document, so it cannot be forgotten', () => {
    const filedNoTranche: FiledRequirement = { ...filedComplete, tranche: undefined };
    const draft = draftRequirement(filedNoTranche, model, areaDocumentText);

    expect(() => parseAreaDocument(document, documentContaining(draft.row))).toThrow();
  });

  it('offers only the section headings that already hold a requirements table', () => {
    const text = [
      '# ZZZ - Invented area',
      '',
      '## 1. Empty section',
      '',
      'Prose with no table at all.',
      '',
      '## 2. Widgets',
      '',
      '| ID          | Requirement                       | Tranche | Status    |',
      '| ----------- | ---------------------------------- | ------- | --------- |',
      '| **ZZZ-001** | A widget must carry its own name  | T1      | Specified |',
      '',
      '### 2.1 Gadgets',
      '',
      '| ID          | Requirement               | Tranche | Status    |',
      '| ----------- | -------------------------- | ------- | --------- |',
      '| **ZZZ-002** | A gadget must spin freely | T1      | Specified |',
      '',
    ].join('\n');

    const draft = draftRequirement(filedComplete, model, text);

    expect(draft.sections).toEqual(['2. Widgets', '2.1 Gadgets']);
  });

  it('warns about a missing tranche, a missing test hint, and a statement that binds nothing - never refusing', () => {
    const filedBare: FiledRequirement = {
      area: 'ZZZ',
      statement: 'A widget looks nice',
      why: 'Because someone asked',
      howWeWouldKnow: undefined,
      tranche: undefined,
      whoAsked: undefined,
    };

    const draft = draftRequirement(filedBare, model, areaDocumentText);

    expect(draft.id).toBe('ZZZ-004');
    expect(draft.warnings).toHaveLength(3);
    expect(draft.warnings.some((warning) => /tranche/i.test(warning))).toBe(true);
    expect(draft.warnings.some((warning) => /test hint|how we would know/i.test(warning))).toBe(
      true,
    );
    expect(draft.warnings.some((warning) => /must.*should/i.test(warning))).toBe(true);
  });
});
