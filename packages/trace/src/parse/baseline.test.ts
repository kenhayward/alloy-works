import { describe, expect, it } from 'vitest';

import { parseBaseline } from './baseline.js';

const document = '0.0.0-invented.md';

const doc = (...sections: string[]): string =>
  ['# 0.0.0-invented', '', '> **Declared:** 2026-09-13. For testing.', '', ...sections].join('\n');

const included = [
  '## Included',
  '',
  '| ID          | Why it is in force |',
  '| ----------- | ------------------ |',
  '| **ZZZ-001** | Because it is      |',
  '',
];

describe('parsing a baseline document', () => {
  it('reads the version and the declaration date from the heading and the banner', () => {
    const parsed = parseBaseline(document, doc(...included));

    expect(parsed.name).toBe('0.0.0-invented');
    expect(parsed.declaredAt).toBe('2026-09-13');
  });

  it('reads the included requirements', () => {
    expect(parseBaseline(document, doc(...included)).included).toEqual([
      { id: 'ZZZ-001', why: 'Because it is' },
    ]);
  });

  it('reads an exclusion with its reason', () => {
    const parsed = parseBaseline(
      document,
      doc(
        ...included,
        '## Excluded',
        '',
        '| ID          | Reason        |',
        '| ----------- | ------------- |',
        '| **ZZZ-002** | Not built yet |',
      ),
    );

    expect(parsed.excluded).toEqual([{ id: 'ZZZ-002', reason: 'Not built yet' }]);
  });

  // The one thing the design document insists on: an exclusion without a reason is how a requirement
  // gets quietly dropped, so it is an error rather than a warning.
  it('refuses an exclusion with no reason, naming the document and line', () => {
    const text = doc(
      ...included,
      '## Excluded',
      '',
      '| ID          | Reason |',
      '| ----------- | ------ |',
      '| **ZZZ-002** |        |',
    );

    expect(() => parseBaseline(document, text)).toThrow(/0\.0\.0-invented\.md:\d+/);
  });

  it('reads a verification kind and what it rests on', () => {
    const parsed = parseBaseline(
      document,
      doc(
        ...included,
        '## Verification',
        '',
        '| ID          | Kind        | By                      |',
        '| ----------- | ----------- | ----------------------- |',
        '| **ZZZ-001** | attestation | Ada Lovelace, 2026-09-13 |',
      ),
    );

    expect(parsed.verification).toEqual([
      { id: 'ZZZ-001', kind: 'attestation', by: 'Ada Lovelace, 2026-09-13' },
    ]);
  });

  it('refuses a verification kind it does not know', () => {
    const text = doc(
      ...included,
      '## Verification',
      '',
      '| ID          | Kind    | By  |',
      '| ----------- | ------- | --- |',
      '| **ZZZ-001** | vibes   | Ada |',
    );

    expect(() => parseBaseline(document, text)).toThrow(/vibes|kind/i);
  });

  it('refuses a verification row whose By cell is empty, whatever the kind', () => {
    const text = doc(
      ...included,
      '## Verification',
      '',
      '| ID          | Kind      | By  |',
      '| ----------- | --------- | --- |',
      '| **ZZZ-001** | inherited |     |',
    );

    expect(() => parseBaseline(document, text)).toThrow(/0\.0\.0-invented\.md:\d+/);
  });

  it('treats the three sections as independent, so a baseline may exclude nothing', () => {
    const parsed = parseBaseline(document, doc(...included));

    expect(parsed.excluded).toEqual([]);
    expect(parsed.verification).toEqual([]);
  });

  it('refuses a baseline that includes nothing, which is not a declaration', () => {
    expect(() =>
      parseBaseline(document, doc('## Included', '', '| ID | Why |', '| -- | --- |')),
    ).toThrow(/includes nothing/i);
  });

  // Critical fix-round finding: a second row for the same identifier was silently resolved
  // last-wins, which let an appended attestation launder a requirement no test actually verified.
  // Refusing it here, once, is why the gate never has to detect it again.
  it('refuses a duplicate identifier in Included, naming the document and the second line', () => {
    const text = doc(...included, '| **ZZZ-001** | Because it is again |');

    expect(() => parseBaseline(document, text)).toThrow(
      /0\.0\.0-invented\.md:\d+.*ZZZ-001.*already declared/i,
    );
  });

  it('refuses a duplicate identifier in Excluded, naming the document and the second line', () => {
    const text = doc(
      ...included,
      '## Excluded',
      '',
      '| ID          | Reason        |',
      '| ----------- | ------------- |',
      '| **ZZZ-002** | Not built yet |',
      '| **ZZZ-002** | Also this     |',
    );

    expect(() => parseBaseline(document, text)).toThrow(
      /0\.0\.0-invented\.md:\d+.*ZZZ-002.*already declared/i,
    );
  });

  it('refuses a duplicate identifier in Verification, naming the document and the second line', () => {
    const text = doc(
      ...included,
      '## Verification',
      '',
      '| ID          | Kind        | By                       |',
      '| ----------- | ----------- | ------------------------ |',
      '| **ZZZ-001** | test        | n/a                      |',
      '| **ZZZ-001** | attestation | Ada Lovelace, 2026-09-13 |',
    );

    expect(() => parseBaseline(document, text)).toThrow(
      /0\.0\.0-invented\.md:\d+.*ZZZ-001.*already declared/i,
    );
  });

  it('stops each section at the next heading, so a table below one is not read into it', () => {
    const parsed = parseBaseline(
      document,
      doc(
        ...included,
        '## Notes',
        '',
        '| ID          | Something |',
        '| ----------- | --------- |',
        '| **ZZZ-009** | Not a row |',
      ),
    );

    expect(parsed.included).toEqual([{ id: 'ZZZ-001', why: 'Because it is' }]);
  });
});
