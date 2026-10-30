import { describe, expect, it } from 'vitest';
import { parseContentDocument } from '../content/model/document.js';
import {
  TRANSLATE_INSTRUCTIONS,
  TRANSLATE_INSTRUCTIONS_VERSION,
  machineAllowed,
  missedTerms,
  translationCall,
  translationPieces,
  xliffInReply,
} from './machine.js';
import { writeXliff } from './xliff.js';

const term = (id: string, term: string) => ({ type: 'definedTerm', id, term });
const document = (content: unknown[]) =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Sampling',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });
const paragraph = (id: string, content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });

describe('a machine draft', () => {
  it('LOC-023 sends a file as data, under instructions that ask it back with each target and every code kept', () => {
    const call = translationCall('model-a', '<xliff version="2.1"/>');
    expect(call.system).toBe(TRANSLATE_INSTRUCTIONS);
    expect(call.tools).toEqual([]);
    // A form's arms (the MF plan, MF-F): what a plural note says, and a number that may go.
    expect(TRANSLATE_INSTRUCTIONS).toContain('a <ph/> without canDelete="no" is a number');
    expect(TRANSLATE_INSTRUCTIONS).toContain('a note of category "plural"');
    expect(TRANSLATE_INSTRUCTIONS_VERSION).toBe('translate-2');
    expect(call.messages[0]!.content[0]).toEqual({
      type: 'text',
      text: '<content source="xliff">\n<xliff version="2.1"/>\n</content>',
    });
  });

  it('sends a component in pieces of at most so many bytes, a unit too large a piece of its own', () => {
    const content = document([
      paragraph('p1', [text('a'.repeat(40))]),
      paragraph('p2', [text('b'.repeat(40))]),
      paragraph('p3', [text('c'.repeat(100))]),
      paragraph('p4', [text('d'.repeat(10))]),
    ]);
    expect(translationPieces(content, 'fr', 90).map((piece) => [...piece])).toEqual([
      ['b.p1', 'b.p2'],
      ['b.p3'],
      ['b.p4'],
    ]);
    const file = writeXliff({
      job: 'draft',
      source: 'en-GB',
      target: 'fr-FR',
      files: [{ component: 'c1', title: 'Sampling', type: '', content, units: new Set(['b.p3']) }],
      terms: new Map(),
    });
    expect(file.match(/<unit /g)).toHaveLength(1);
    // Its neighbours still go as context.
    expect(file).toContain(`<note category="context">${'b'.repeat(40)}</note>`);
  });

  it('reads the file a reply holds, fenced or said around, and none where it holds none', () => {
    expect(xliffInReply('Here it is:\n```xml\n<?xml version="1.0"?><xliff></xliff>\n```')).toBe(
      '<?xml version="1.0"?><xliff></xliff>',
    );
    expect(xliffInReply('<xliff version="2.1"><file/></xliff> done')).toBe(
      '<xliff version="2.1"><file/></xliff>',
    );
    expect(xliffInReply('I cannot translate this.')).toBeUndefined();
  });

  it('LOC-025 names each term the draft does not translate by one of its labels', () => {
    const draft = document([
      paragraph('p1', [
        text('Un '),
        text('étang', [term('m1', 'pond')]),
        text(' et une '),
        text('mare', [term('m2', 'pool')]),
        text(' et un '),
        text('lac', [term('m3', 'lake')]),
      ]),
    ]);
    const labels = new Map([
      ['pond', ['Étang']],
      ['pool', ['bassin', 'piscine']],
    ]);
    expect(missedTerms(draft, labels)).toEqual(['pool']);
  });

  it('LOC-026 sends nothing while the policy is off, and only inside where it says so', () => {
    expect(machineAllowed('off', 'inside')).toBe(false);
    expect(machineAllowed('inside', 'inside')).toBe(true);
    expect(machineAllowed('inside', 'outside')).toBe(false);
    expect(machineAllowed('any', 'outside')).toBe(true);
  });
});
