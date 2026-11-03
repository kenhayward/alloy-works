import { describe, expect, it } from 'vitest';

import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import { anchorStands } from '../review/threads.js';
import { applyEdits, proposeEditProblem, toolInputSchemas } from './assistant.js';

const mark = (type: string, id = `m-${type}`) => ({ type, id });
const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const citation = { type: 'citation', entry: '00000000-0000-4000-8000-000000000001' };
const footnote = {
  type: 'footnote',
  id: 'f1',
  content: [{ type: 'paragraph', id: 'n1', style: 'body', content: [text('A note.')] }],
};
const marker = { type: 'indexMarker', id: 'x1', entry: { term: 'weirs' } };
const paragraph = (id: string, ...content: unknown[]) =>
  ({ type: 'paragraph', id, style: 'body', content }) as unknown as BlockNode;
const document = (...content: BlockNode[]) =>
  ({
    schemaVersion: 1,
    title: 'Weirs',
    language: 'en-GB',
    direction: 'ltr',
    content,
  }) as unknown as ContentDocument;
const noMarkdown = () => 'No Markdown here.';

const edit = (content: ContentDocument, find: string, to: string, block = 'p1') =>
  applyEdits(content, [{ in: block, find, to }], noMarkdown);
const inlineOf = (outcome: ReturnType<typeof edit>, at = 0) => {
  if (!outcome.ok) throw new Error(outcome.problem);
  return (outcome.content.content[at] as unknown as { content: unknown[] }).content;
};
const problemOf = (outcome: ReturnType<typeof edit>) => (outcome.ok ? undefined : outcome.problem);

describe('changing words inside a block, keeping what else it holds', () => {
  it('changes words inside one text node, its marks kept', () => {
    const strong = mark('strong');
    expect(
      inlineOf(
        edit(document(paragraph('p1', text('The weir floods.', [strong]))), 'floods', 'holds'),
      ),
    ).toEqual([text('The weir holds.', [strong])]);
  });

  it('changes words across adjacent text nodes, what it writes taking the first node’s marks', () => {
    const emphasis = mark('emphasis');
    const content = document(paragraph('p1', text('The old', [emphasis]), text(' weir floods.')));
    expect(inlineOf(edit(content, 'old weir', 'new sluice'))).toEqual([
      text('The new sluice', [emphasis]),
      text(' floods.'),
    ]);
  });

  it('keeps a citation, a footnote and a binding standing either side', () => {
    const binding = { type: 'binding', id: 'b1', definition: 'd1', take: { column: 'name' } };
    const content = document(
      paragraph('p1', text('Marshes accrete.'), citation, text(' Weirs flood.'), footnote, binding),
    );
    expect(inlineOf(edit(content, 'Weirs flood', 'Weirs hold'))).toEqual([
      text('Marshes accrete.'),
      citation,
      text(' Weirs hold.'),
      footnote,
      binding,
    ]);
  });

  it('keeps an index marker a match runs across, at the match’s start', () => {
    const content = document(paragraph('p1', text('The old '), marker, text('weir floods.')));
    expect(inlineOf(edit(content, 'old weir', 'sluice'))).toEqual([
      text('The sluice'),
      marker,
      text(' floods.'),
    ]);
  });

  it('removes words given none to put, and refuses to leave the paragraph empty', () => {
    const content = document(paragraph('p1', text('The old weir.')));
    expect(inlineOf(edit(content, 'old ', ''))).toEqual([text('The weir.')]);
    expect(problemOf(edit(content, 'The old weir.', ''))).toBe(
      'That would leave the paragraph empty: delete the block instead.',
    );
  });

  it('finds a paragraph in a list, at any depth, by the list', () => {
    const list = {
      type: 'list',
      id: 'l1',
      ordered: false,
      items: [
        {
          id: 'i1',
          content: [
            paragraph('a', text('North weir.')),
            {
              type: 'list',
              id: 'l2',
              ordered: false,
              items: [{ id: 'i2', content: [paragraph('b', text('A gate'), citation)] }],
            },
          ],
        },
      ],
    } as unknown as BlockNode;
    const outcome = edit(document(list), 'A gate', 'A ladder', 'l1');
    if (!outcome.ok) throw new Error(outcome.problem);
    expect(JSON.stringify(outcome.content)).toContain('A ladder');
    expect(JSON.stringify(outcome.content)).toContain('"type":"citation"');
    expect(JSON.stringify(outcome.content)).toContain('North weir.');
  });

  it('refuses words that are not there, or there twice, across a list too', () => {
    const content = document(paragraph('p1', text('The weir and the weir.')));
    expect(problemOf(edit(content, 'sluice', 'x'))).toBe('Block p1 does not hold those words.');
    expect(problemOf(edit(content, 'weir', 'x'))).toBe(
      'Block p1 holds those words 2 times: give enough of them to name one.',
    );
    expect(problemOf(edit(content, 'weir', 'x', 'p9'))).toBe('There is no block p9.');
  });

  it('refuses words crossing a citation or inside a footnote, saying why', () => {
    const content = document(paragraph('p1', text('Marshes accrete.'), citation, text(' Weirs.')));
    expect(inlineOf(edit(content, 'accrete', 'rise'))).toHaveLength(3);
    const [shown] = [`accrete.[`];
    expect(problemOf(edit(content, shown, 'x'))).toMatch(/The words touch a citation/);
    const noted = document(paragraph('p1', text('Weirs.'), footnote));
    expect(problemOf(edit(noted, 'A note', 'x'))).toMatch(/The words touch a footnote/);
  });

  it('refuses words under a mark with a meaning of its own', () => {
    for (const type of ['definedTerm', 'condition', 'suggestion', 'comment', 'language']) {
      const content = document(paragraph('p1', text('The weir.', [mark(type)])));
      expect(problemOf(edit(content, 'weir', 'sluice'))).toBe(
        `The words touch a ${type} mark, which a proposal cannot write. Change the words either side of it.`,
      );
    }
  });

  it('refuses a block that is no paragraph or list, and a line break in the words', () => {
    const table = { type: 'table', id: 't1', rows: [], headerRows: 0 } as unknown as BlockNode;
    expect(problemOf(edit(document(table), 'x', 'y', 't1'))).toBe(
      'Block t1 cannot be changed by its words. It is a table: change it with cell, or with table and rows.',
    );
    const content = document(paragraph('p1', text('The weir.')));
    expect(problemOf(edit(content, 'weir', 'sluice\ngate'))).toBe(
      'The new words hold a line break or a control character.',
    );
  });

  it('takes the block with or without its #', () => {
    const content = document(paragraph('p1', text('The weir.')));
    expect(inlineOf(edit(content, 'weir', 'sluice', '#p1'))).toEqual([text('The sluice.')]);
  });

  it('points a refused replacement at the words, where the words can be changed', () => {
    const content = document(paragraph('p1', text('The weir.'), citation));
    const refused = applyEdits(content, [{ replace: 'p1', markdown: 'A sluice.' }], () => [
      paragraph('p1', text('A sluice.')),
    ]);
    expect(problemOf(refused)).toBe(
      'Block p1 cannot be replaced. It holds a citation, which a proposal cannot write. To change its words, use in, find and to.',
    );
  });

  it('a thread quoting words changed stops standing; one quoting others stands', () => {
    const content = document(paragraph('p1', text('The weir floods in spring.')));
    const outcome = edit(content, 'floods', 'holds');
    if (!outcome.ok) throw new Error(outcome.problem);
    const on = { content: outcome.content };
    expect(anchorStands({ kind: 'span', block: 'p1', quote: 'floods', before: '' }, on)).toBe(
      false,
    );
    expect(anchorStands({ kind: 'span', block: 'p1', quote: 'in spring', before: '' }, on)).toBe(
      true,
    );
  });

  it('takes in, find and to, and says what a wrong shape lacks', () => {
    const component = 'c'.repeat(26);
    const { propose_edit: schema } = toolInputSchemas;
    expect(schema.safeParse({ component, edits: [{ in: 'p1', find: 'a', to: '' }] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ component, edits: [{ in: 'p1', find: '', to: 'b' }] }).success).toBe(
      false,
    );
    expect(proposeEditProblem({ component, edits: [{ in: 'p1', find: 'a', markdown: 'b' }] })).toBe(
      'The arguments are not what this tool takes. Edit 1 changes words in a block, which takes { in, find, to } and nothing else. Take out markdown. It needs to.',
    );
  });
});
