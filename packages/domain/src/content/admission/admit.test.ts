import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../model/document.js';

import { admit, type AdmissionInput } from './admit.js';
import { MATHML_NAMESPACE } from './mathml.js';
import type { Receiver } from './reidentify.js';
import { admissionStages, readerEntry, type ReportEntry } from './report.js';

const document: ContentDocument = {
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: 'Leeds', marks: [{ type: 'strong', id: 'm1' }] }],
    },
  ],
};

const receiver = (): Receiver => {
  let next = 0;
  return { document, conditionAxes: [], newIdentifier: () => `a${(next += 1)}` };
};

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'paragraph',
  style: 'body',
  content,
  ...extra,
});
const foreign = (content: unknown[], report: ReportEntry[] = []): AdmissionInput => ({
  candidate: { schemaVersion: 1, content },
  report,
});

/** The report without its messages, which report.test.ts pins; what happened is what these assert. */
const happened = (report: readonly ReportEntry[]) =>
  report.map(({ message: _, ...entry }) => entry);

describe('admitting content', () => {
  it('admits clean content as blocks for the receiving component, reporting the new identifiers', () => {
    const outcome = admit(foreign([paragraph([text('York', [{ type: 'emphasis' }])])]), receiver());
    expect(outcome.ok && outcome.content).toEqual([
      paragraph([text('York', [{ type: 'emphasis', id: 'a2' }])], { id: 'a1' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('hands back a footnote as parsed, with the defaults the parse fills in everywhere else', () => {
    const note = {
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content: [{ type: 'paragraph', id: 'fb1', content: [{ type: 'text', value: 'Ibid.' }] }],
    };
    const outcome = admit(foreign([paragraph([text('York'), note])]), receiver());
    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [text('York'), { ...note, id: 'a2', content: [paragraph([text('Ibid.')], { id: 'a3' })] }],
        { id: 'a1' },
      ),
    ]);
  });

  it('never stores a script, an event handler, an embedded object or a link whose scheme is not allowlisted', () => {
    const outcome = admit(
      foreign([
        { type: 'script', name: 'script' },
        paragraph(
          [
            text('Open ', []),
            text('this', [{ type: 'hyperlink', href: 'javascript:alert(1)' }]),
            {
              type: 'equation',
              mathml: '<math><mi href="javascript:alert(2)" onclick="alert(3)">x</mi></math>',
            },
          ],
          { handlers: ['onclick'] },
        ),
        { type: 'embeddedObject', name: 'iframe' },
      ]),
      receiver(),
    );

    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('Open '),
          text('this'),
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
        ],
        { id: 'a1' },
      ),
    ]);
    expect(JSON.stringify(outcome.ok && outcome.content)).not.toMatch(
      /script|onclick|iframe|embeddedObject|handlers|href/,
    );
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(2)',
      },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'embeddedObject', detail: 'iframe' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  // One `it` rather than `it.each`: the trace reads a citation from a title written as a string
  // literal, and `it.each(...)('...')` puts the table between the call and the title.
  it('CNT-127 refuses a link whose scheme is not allowlisted on entry, however it is spelled, and never stores it', () => {
    for (const href of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      '\u{1}javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'ftp://example.test/file',
      'file:///C:/Users/Ada/notes.txt',
    ]) {
      const outcome = admit(
        foreign([paragraph([text('Notes', [{ type: 'hyperlink', href }])])]),
        receiver(),
      );
      expect(outcome.ok && outcome.content, href).toEqual([
        paragraph([text('Notes')], { id: 'a1' }),
      ]);
      expect(happened(outcome.report), href).toEqual([
        { stage: 'sanitise', action: 'discarded', subject: 'hyperlink', detail: href },
        { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      ]);
    }
  });

  it('CNT-131 names each link it dropped or rewrote in the report, with the target it had', () => {
    const outcome = admit(
      foreign([
        paragraph([
          text('one', [{ type: 'hyperlink', href: 'javascript:void(0)' }]),
          text('two', [{ type: 'hyperlink', href: 'javascript:void(0)' }]),
          text('three', [{ type: 'hyperlink', href: 'https://example.test/\na' }]),
          text('four', [{ type: 'hyperlink', href: 'https://example.test/kept' }]),
        ]),
      ]),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('one'),
          text('two'),
          text('three', [{ type: 'hyperlink', id: 'a2', href: 'https://example.test/a' }]),
          text('four', [{ type: 'hyperlink', id: 'a3', href: 'https://example.test/kept' }]),
        ],
        { id: 'a1' },
      ),
    ]);
    expect(happened(outcome.report)).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:void(0)',
      },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:void(0)',
      },
      {
        stage: 'sanitise',
        action: 'rewritten',
        subject: 'hyperlink',
        detail: 'https://example.test/\na',
      },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 2 },
    ]);
  });

  it('CNT-065 carries no typeface, size or colour into the model, from text or from an equation', () => {
    const outcome = admit(
      foreign([
        paragraph(
          [
            {
              ...text('Warning'),
              presentation: { typeface: 'Leeds Sans', size: '18pt', colour: '#c00' },
            },
            { type: 'equation', mathml: '<math><mi mathcolor="#c00" mathsize="2em">x</mi></math>' },
          ],
          { presentation: { colour: 'red' } },
        ),
      ]),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('Warning'),
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
        ],
        { id: 'a1' },
      ),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'mathAttribute', detail: 'mathcolor' },
      { stage: 'sanitise', action: 'discarded', subject: 'mathAttribute', detail: 'mathsize' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'size', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'colour', count: 2 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('CNT-056 stores text in one Unicode normalisation form', () => {
    const outcome = admit(foreign([paragraph([text('Cafe\u{301} in Leeds')])]), receiver());
    expect(outcome.ok && outcome.content).toEqual([
      paragraph([text('Caf\u{E9} in Leeds')], { id: 'a1' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('keeps an equation in the form sanitise wrote, which NFC cannot turn back into markup', () => {
    const outcome = admit(
      foreign([
        paragraph([
          { type: 'equation', mathml: '<math><mi>\u{338} onmouseover=alert(1) x=</mi></math>' },
        ]),
      ]),
      receiver(),
    );
    const stored = `<math xmlns="${MATHML_NAMESPACE}"><mi>&#x338; onmouseover=alert(1) x=</mi></math>`;
    expect(outcome.ok && outcome.content).toEqual([
      paragraph([{ type: 'equation', mathml: stored }], { id: 'a1' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('sanitises before it normalises, so a script dressed as formatting is reported as a script', () => {
    const outcome = admit(
      foreign([
        paragraph([text('x')], {
          presentation: { typeface: 'Leeds Sans', width: 'expression(alert(1))' },
        }),
      ]),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([paragraph([text('x')], { id: 'a1' })]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'executableStyle', detail: 'width' },
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('validates last, over what the stages produced rather than what arrived', () => {
    // `presentation` is not a member the model defines; validating what arrived would refuse it.
    const outcome = admit(
      foreign([paragraph([text('x')], { presentation: { size: '9pt' } })]),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([paragraph([text('x')], { id: 'a1' })]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'normalise', action: 'discarded', subject: 'size', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('reports in the order the stages ran, after what the reader could not represent', () => {
    const outcome = admit(
      foreign(
        [
          paragraph([text('Cafe\u{301}', [{ type: 'comment', id: 'c1', threadId: 't1' }])], {
            handlers: ['onclick'],
          }),
        ],
        [readerEntry('a heading')],
      ),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([paragraph([text('Caf\u{E9}')], { id: 'a1' })]);
    const stages = outcome.report.map((entry) => admissionStages.indexOf(entry.stage));
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(happened(outcome.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'unrepresentable', detail: 'a heading' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 1 },
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('CNT-064 names in the report everything it removed, and the test asserts both halves', () => {
    const outcome = admit(
      {
        candidate: {
          schemaVersion: 1,
          language: 'en-GB',
          direction: 'ltr',
          content: [
            { type: 'script', name: 'script' },
            paragraph(
              [
                text('Visit '),
                text('the site', [{ type: 'hyperlink', href: 'javascript:alert(1)' }]),
                text(' or '),
                text('the guide', [
                  { type: 'hyperlink', href: 'https://example.test/guide', handlers: ['onclick'] },
                ]),
                {
                  type: 'equation',
                  mathml: '<math><mi mathcolor="red" onmouseover="alert(2)">x</mi></math>',
                },
              ],
              {
                handlers: ['onload'],
                presentation: {
                  typeface: 'Leeds Sans',
                  colour: 'red',
                  width: 'expression(alert(3))',
                },
              },
            ),
            { type: 'embeddedObject', name: 'object' },
            paragraph([]),
            paragraph([text('')]),
            paragraph([
              text('Cafe\u{301}', [
                { type: 'comment', id: 'c1', threadId: 't1' },
                { type: 'suggestion', id: 's1', operation: 'insert', author: 'Grace' },
                { type: 'condition', id: 'k1', axis: 'jurisdiction', values: ['uk'] },
              ]),
            ]),
          ],
        },
        report: [readerEntry('an image')],
      },
      receiver(),
    );

    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('Visit '),
          text('the site'),
          text(' or '),
          text('the guide', [{ type: 'hyperlink', id: 'a2', href: 'https://example.test/guide' }]),
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
        ],
        { id: 'a1' },
      ),
      paragraph([], { id: 'a3' }),
      paragraph([text('Caf\u{E9}')], { id: 'a4' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'unrepresentable', detail: 'an image' },
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'mathAttribute', detail: 'mathcolor' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onmouseover' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onload' },
      { stage: 'sanitise', action: 'discarded', subject: 'executableStyle', detail: 'width' },
      { stage: 'sanitise', action: 'discarded', subject: 'embeddedObject', detail: 'object' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'colour', count: 1 },
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'emptyText', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'emptyParagraph', count: 1 },
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'discarded', subject: 'condition', detail: 'jurisdiction' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 3 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('leaves the reader output it was given untouched', () => {
    const input = foreign([
      paragraph([text('x', [{ type: 'hyperlink', href: 'javascript:alert(1)' }])]),
    ]);
    const arrived = structuredClone(input);
    const outcome = admit(input, receiver());
    expect(input).toEqual(arrived);
    expect(outcome.ok && outcome.content).toEqual([paragraph([text('x')], { id: 'a1' })]);
    expect(happened(outcome.report)).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });
});

describe('refusing an admission', () => {
  it('refuses content from a schema version newer than the build can read, by name, and admits nothing', () => {
    const outcome = admit(
      { candidate: { schemaVersion: 2, content: [paragraph([text('x')])] }, report: [] },
      receiver(),
    );
    expect(outcome).toEqual({
      ok: false,
      refusal: 'schemaVersion',
      failure:
        "Stored content was written against schema version 2, which is newer than this build's 1",
      report: [
        {
          stage: 'migrate',
          action: 'refused',
          subject: 'schemaVersion',
          message:
            'Nothing was added, because the content was written in a version of the format this build cannot read.',
        },
      ],
    });
    expect(outcome).not.toHaveProperty('content');
  });

  it('refuses content the model cannot hold as a whole, rather than keeping the part it can', () => {
    const outcome = admit(
      foreign([
        paragraph([text('Kept?')], { handlers: ['onclick'] }),
        { type: 'heading', level: 1, content: [] },
      ]),
      receiver(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome).not.toHaveProperty('content');
    expect(!outcome.ok && outcome.refusal).toBe('invalid');
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 2 },
      { stage: 'validate', action: 'refused', subject: 'invalid' },
    ]);
  });

  it('refuses content with nothing left in it to keep, saying what was removed', () => {
    const outcome = admit(foreign([{ type: 'script', name: 'script' }]), receiver());
    expect(outcome).toMatchObject({ ok: false, refusal: 'empty' });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      { stage: 'validate', action: 'refused', subject: 'empty' },
    ]);
  });

  it('refuses content nested past the limit before any stage walks it', () => {
    let nested: unknown = paragraph([text('x')], { handlers: ['onclick'] });
    for (let level = 0; level < 100_000; level += 1)
      nested = { type: 'blockquote', content: [nested] };
    const outcome = admit(foreign([nested], [readerEntry('a table')]), receiver());
    expect(outcome).toMatchObject({
      ok: false,
      refusal: 'oversized',
      failure: 'The content holds nested more than 128 deep',
    });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'unrepresentable', detail: 'a table' },
      { stage: 'sanitise', action: 'refused', subject: 'oversized' },
    ]);
  });

  it('refuses when no new identifier can be allocated, and admits nothing', () => {
    const outcome = admit(foreign([paragraph([text('x')])]), {
      ...receiver(),
      newIdentifier: () => 'b1',
    });
    expect(outcome).toMatchObject({ ok: false, refusal: 'identifiers' });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'refused', subject: 'identifiers' },
    ]);
  });

  it('refuses a member named __proto__ rather than losing it without a report entry', () => {
    // JSON.parse makes `__proto__` an ordinary member. Copied by assignment it would call the
    // prototype setter instead, and the member would disappear with nothing said about it.
    const input: AdmissionInput = {
      candidate: JSON.parse(
        '{"schemaVersion":1,"content":[{"type":"paragraph","style":"body","content":[],"__proto__":{"polluted":true}}]}',
      ),
      report: [],
    };
    const outcome = admit(input, receiver());
    expect(outcome).toMatchObject({ ok: false, refusal: 'invalid' });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'validate', action: 'refused', subject: 'invalid' },
    ]);
  });
});
