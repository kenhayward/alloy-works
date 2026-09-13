import { describe, expect, it } from 'vitest';

import { parseIssue } from './issue.js';

describe('parsing a filed requirement issue', () => {
  it('reads a complete issue', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      '',
      '### How we would know',
      '',
      'A footnote containing a citation survives a Word round trip.',
      '',
      '### Suggested tranche',
      '',
      'T1',
      '',
      '### Who asked',
      '',
      'A reviewer on the pilot',
      '',
    ].join('\n');

    expect(parseIssue(body)).toEqual({
      area: 'CNT',
      statement: 'A footnote must be able to carry a citation.',
      why: 'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      howWeWouldKnow: 'A footnote containing a citation survives a Word round trip.',
      tranche: 'T1',
      whoAsked: 'A reviewer on the pilot',
    });
  });

  it('reads every optional field left as "_No response_" as undefined', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      '',
      '### How we would know',
      '',
      '_No response_',
      '',
      '### Suggested tranche',
      '',
      '_No response_',
      '',
      '### Who asked',
      '',
      '_No response_',
      '',
    ].join('\n');

    const parsed = parseIssue(body);

    expect(parsed.howWeWouldKnow).toBeUndefined();
    expect(parsed.tranche).toBeUndefined();
    expect(parsed.whoAsked).toBeUndefined();
  });

  it('takes the code from the area answer, not the whole dropdown label', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
    ].join('\n');

    expect(parseIssue(body).area).toBe('CNT');
  });

  it('keeps a multi-paragraph answer whole, blank line and all', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers lose their sources when a footnote is stripped on export.',
      '',
      'This has already happened twice on the pilot, and both times the reviewer had to redo the work.',
    ].join('\n');

    expect(parseIssue(body).why).toBe(
      'Reviewers lose their sources when a footnote is stripped on export.\n\n' +
        'This has already happened twice on the pilot, and both times the reviewer had to redo the work.',
    );
  });

  it('reads headings in an order different from the form, since a hand-edited issue may not preserve it', () => {
    const body = [
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Area',
      '',
      'CNT - Content and authoring',
    ].join('\n');

    expect(parseIssue(body)).toEqual({
      area: 'CNT',
      statement: 'A footnote must be able to carry a citation.',
      why: 'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      howWeWouldKnow: undefined,
      tranche: undefined,
      whoAsked: undefined,
    });
  });

  it('parses a statement that says must', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
    ].join('\n');

    expect(parseIssue(body).statement).toBe('A footnote must be able to carry a citation.');
  });

  it('refuses a statement that says neither must nor should', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote carries a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
    ].join('\n');

    expect(() => parseIssue(body)).toThrow(/must say must or should/);
  });

  it('refuses a missing required heading, naming which one', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
    ].join('\n');

    expect(() => parseIssue(body)).toThrow(/The requirement/);
  });

  it('does not let a quoted ### Area heading inside a fenced code block hijack the area or truncate the statement', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'The exported markdown must look like this example:',
      '',
      '```',
      '### Area',
      '',
      'STR - Structure, numbering and cross-references',
      '```',
      '',
      'and nothing else.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
    ].join('\n');

    const parsed = parseIssue(body);

    expect(parsed.area).toBe('CNT');
    expect(parsed.statement).toBe(
      [
        'The exported markdown must look like this example:',
        '',
        '```',
        '### Area',
        '',
        'STR - Structure, numbering and cross-references',
        '```',
        '',
        'and nothing else.',
      ].join('\n'),
    );
  });

  it('refuses a genuinely duplicated heading rather than silently picking one', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      '',
      '### Area',
      '',
      'STR - Structure, numbering and cross-references',
    ].join('\n');

    expect(() => parseIssue(body)).toThrow(/Area/);
  });

  it('does not treat #### inside an answer as a boundary', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must carry a citation, as in:',
      '',
      '#### Example heading',
      '',
      'more detail.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
    ].join('\n');

    const parsed = parseIssue(body);

    expect(parsed.statement).toContain('#### Example heading');
    expect(parsed.statement).toContain('more detail.');
  });

  it.each(['must', 'MUST', 'should', 'Should'])(
    'accepts a statement that says %s, regardless of case - RFC 2119 uppercase is house style for this audience',
    (word) => {
      const body = [
        '### Area',
        '',
        'CNT - Content and authoring',
        '',
        '### The requirement',
        '',
        `A footnote ${word} carry a citation.`,
        '',
        '### Why',
        '',
        'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      ].join('\n');

      expect(parseIssue(body).statement).toBe(`A footnote ${word} carry a citation.`);
    },
  );

  it('treats a tranche heading present but left blank as absent, not the empty string', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      '',
      '### Suggested tranche',
      '',
    ].join('\n');

    expect(parseIssue(body).tranche).toBeUndefined();
  });

  it('reads "Not sure" as tranche as undefined, not the string itself', () => {
    const body = [
      '### Area',
      '',
      'CNT - Content and authoring',
      '',
      '### The requirement',
      '',
      'A footnote must be able to carry a citation.',
      '',
      '### Why',
      '',
      'Reviewers put sources in footnotes, and losing them makes the footnote useless.',
      '',
      '### Suggested tranche',
      '',
      'Not sure',
    ].join('\n');

    expect(parseIssue(body).tranche).toBeUndefined();
  });
});
