import { describe, expect, it } from 'vitest';

import { markSchema, markTypes } from './marks.js';

describe('the mark vocabulary', () => {
  it('CNT-006 is closed, and the set is the thirteen the design names', () => {
    expect([...markTypes].sort()).toEqual(
      [
        'comment',
        'condition',
        'definedTerm',
        'emphasis',
        'hyperlink',
        'inlineCode',
        'language',
        'quotedPhrase',
        'strong',
        'subscript',
        'suggestion',
        'superscript',
        'underline',
      ].sort(),
    );
  });

  it('CNT-006 refuses a mark type outside the set', () => {
    expect(() => markSchema.parse({ type: 'highlight', id: 'm1' })).toThrow();
  });

  it('CNT-004 requires an identifier on every mark', () => {
    for (const type of markTypes) {
      expect(() => markSchema.parse({ type })).toThrow();
    }
  });

  it('CNT-008 refuses a mark carrying appearance', () => {
    expect(() => markSchema.parse({ type: 'strong', id: 'm1', colour: 'red' })).toThrow();
    expect(() => markSchema.parse({ type: 'strong', id: 'm1', fontSize: 12 })).toThrow();
  });

  it('CNT-032 carries an axis and permitted values on a condition', () => {
    const mark = markSchema.parse({
      type: 'condition',
      id: 'm1',
      axis: 'jurisdiction',
      values: ['uk'],
    });
    expect(mark).toEqual({ type: 'condition', id: 'm1', axis: 'jurisdiction', values: ['uk'] });
  });

  it('CNT-033 carries an operation and an author on a suggestion', () => {
    const mark = markSchema.parse({
      type: 'suggestion',
      id: 'm1',
      operation: 'delete',
      author: 'Ada',
    });
    expect(mark.type).toBe('suggestion');
  });

  it('CNT-034 carries a thread identity on a comment anchor', () => {
    expect(markSchema.parse({ type: 'comment', id: 'm1', threadId: 't1' }).type).toBe('comment');
  });

  it('LIB-015 makes a defined term carry a term identity and no text', () => {
    expect(markSchema.parse({ type: 'definedTerm', id: 'm1', term: 'term-7' }).type).toBe(
      'definedTerm',
    );
    expect(() => markSchema.parse({ type: 'definedTerm', id: 'm1', text: 'Widget' })).toThrow();
  });

  it('CNT-127 refuses a hyperlink whose scheme is not allowlisted', () => {
    expect(
      markSchema.parse({ type: 'hyperlink', id: 'm1', href: 'https://example.test/a' }).type,
    ).toBe('hyperlink');
    expect(() =>
      markSchema.parse({ type: 'hyperlink', id: 'm1', href: 'javascript:alert(1)' }),
    ).toThrow();
    expect(() =>
      markSchema.parse({ type: 'hyperlink', id: 'm1', href: 'file:///etc/passwd' }),
    ).toThrow();
  });

  it('CNT-140 requires a BCP 47 tag on a language mark, with its region where it has one', () => {
    expect(markSchema.parse({ type: 'language', id: 'm1', tag: 'pt-BR' }).type).toBe('language');
    expect(() => markSchema.parse({ type: 'language', id: 'm1', tag: 'portuguese' })).toThrow();
  });
});
