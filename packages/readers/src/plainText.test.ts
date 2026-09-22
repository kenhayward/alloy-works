import { admissionLimits } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { readPlainText } from './plainText.js';

const paragraph = (value: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', value, marks: [] }],
});

/** What the reader handed over, or the test fails saying it refused. */
function read(text: string, into: 'blocks' | 'preformatted') {
  const result = readPlainText(text, into);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.input;
}

describe('reading plain text', () => {
  it('makes a paragraph of each line and skips the blank ones between them', () => {
    const input = read('York\r\n\r\n  Leeds\nHull\u2028Wakefield\n', 'blocks');
    expect(input.candidate).toEqual({
      schemaVersion: 1,
      content: [paragraph('York'), paragraph('  Leeds'), paragraph('Hull'), paragraph('Wakefield')],
    });
    // Blank lines separate paragraphs in plain text; they are not paragraphs left out.
    expect(input.report).toEqual([]);
  });

  it('turns a tab in a paragraph into a space, and removes a control character, counting it', () => {
    const input = read('Yo\u0000rk\u0007\tMinster\u0085', 'blocks');
    expect(input.candidate).toEqual({ schemaVersion: 1, content: [paragraph('York Minster')] });
    expect(input.report).toEqual([
      {
        stage: 'read',
        action: 'discarded',
        subject: 'control',
        message: 'Invisible control characters were removed.',
        count: 3,
      },
    ]);
  });

  it('keeps text for preformatted text exactly, as one block, with one spelling of a line break', () => {
    const input = read('if (a) {\r\n\treturn;\r}\u2028  done\n', 'preformatted');
    expect(input.candidate).toEqual({
      schemaVersion: 1,
      content: [{ type: 'preformatted', text: 'if (a) {\n\treturn;\n}\n  done\n' }],
    });
    expect(input.report).toEqual([]);
  });

  it('removes from preformatted text what it may not hold, and counts it', () => {
    const input = read('a\u000bb\u000cc\u0000', 'preformatted');
    expect(input.candidate).toEqual({
      schemaVersion: 1,
      content: [{ type: 'preformatted', text: 'abc' }],
    });
    expect(input.report).toMatchObject([{ subject: 'control', count: 3 }]);
  });

  it('hands over nothing for text with no line in it, which the pipeline refuses as empty', () => {
    expect(read('\n \n', 'blocks').candidate).toEqual({ schemaVersion: 1, content: [] });
  });

  it('refuses text longer than one addition can hold, before reading it', () => {
    const result = readPlainText('a'.repeat(admissionLimits.characters + 1), 'blocks');
    expect(result).toMatchObject({ ok: false, refusal: 'oversized' });
    expect(!result.ok && result.report).toMatchObject([
      { stage: 'read', action: 'refused', subject: 'oversized' },
    ]);
  });
});
