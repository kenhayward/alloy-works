import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { FOLLOW_CAP_MS, nextFollow, Publishing } from './Publishing.js';

const DOCUMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION = 'dddddddd-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000001';
const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';
const CALIBRATION = 'cccccccccccccccccccccccccc';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** An answer with a status other than 200. */
class Status {
  constructor(
    readonly status: number,
    readonly body: unknown = { code: 'refused', message: 'No.', traceId: 't' },
  ) {}
}

/** No answer at all: the request fails the way a dropped connection does. */
const DROPPED = Symbol('dropped');

/**
 * Canned answers by method and path. A list is answered in turn, its last answer repeating; a function
 * answers by state - which is what a fake needs where StrictMode reads a route twice on mounting - and
 * may take its time, answering with a promise. A `Status` is answered with its status, and `DROPPED`
 * not at all.
 */
function service(answers: Record<string, unknown[] | (() => unknown)>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ method: request.method, url, body });
    const answer = answers[`${request.method} ${url}`];
    if (typeof answer !== 'function' && (!answer || answer.length === 0)) {
      return json(500, { code: 'internal', message: 'x', traceId: 't' });
    }
    const given: unknown =
      typeof answer === 'function'
        ? await answer()
        : answer.length > 1
          ? answer.shift()
          : answer[0];
    if (given === DROPPED) throw new TypeError('Failed to fetch');
    if (given instanceof Status) return json(given.status, given.body);
    return json(200, given);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const open = (fetch: typeof globalThis.fetch, mayPublish = true, followMs = 0) =>
  render(
    <StrictMode>
      <Publishing
        client={createApiClient({ baseUrl: 'http://acme.example.test', fetch })}
        document={DOCUMENT}
        version={VERSION}
        mayPublish={mayPublish}
        placeOf={(node) => (node === HIDDEN ? '1.2 A component' : '1.1 Calibration')}
        followMs={followMs}
      />
    </StrictMode>,
  );

const listed = (items: unknown[]) => ({ items });
const publication = {
  id: PUBLICATION,
  document: DOCUMENT,
  version: { id: VERSION, number: '0.3' },
  title: 'The dosing report',
  publisher: { id: 'p', displayName: 'Ada' },
  publishedAt: '2026-09-19T09:00:00.000Z',
  approval: 'none',
  formats: ['pdf'],
};
const queued = (failures: unknown[] = []) => ({
  id: REQUEST,
  document: DOCUMENT,
  state: 'queued',
  failures,
  publication: null,
});

/** A publish that is asked for, then answered as failed with these failures. */
const failing = (failures: unknown[]) =>
  service({
    [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([])],
    [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
    [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(failures), state: 'failed' }],
  });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('publishing from the document page', () => {
  it('publishes the version on screen, follows the request, and lists the new publication', async () => {
    let asked = 0;
    let done = false;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed(done ? [publication] : []),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Still queued the first time it is asked about, and made the second.
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        done = asked > 1;
        return done ? { ...queued(), state: 'done', publication: PUBLICATION } : queued();
      },
    });
    open(fake.fetch);
    expect(
      await screen.findByText('Nothing has been published from this document.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish as PDF' }));
    expect(await screen.findByRole('link', { name: 'Open the publication' })).toHaveAttribute(
      'href',
      `#/publications/${PUBLICATION}`,
    );
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toHaveAttribute('href', `#/publications/${PUBLICATION}`);
    expect(fake.sent.find((each) => each.method === 'POST')?.body).toEqual({
      version: VERSION,
      formats: ['pdf'],
    });
  });

  it('names every failure by its place, and a component the author may not read as nothing more than that', async () => {
    const failures = [
      { stage: 'resolve', code: 'occurrence_unreadable', node: HIDDEN, block: null, detail: null },
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: CALIBRATION,
        block: 'b1',
        detail: 'table',
      },
      { stage: 'compose', code: 'glyph_missing', node: CALIBRATION, block: 'b2', detail: 'U+0627' },
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: CALIBRATION,
        block: 'D1',
        detail: 'comment',
      },
    ];
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([])],
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued(failures.slice(0, 1))],
      [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(failures), state: 'failed' }],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent('1.2 A component: A component you may not read is placed here.');
    expect(why).toHaveTextContent('1.1 Calibration: A table cannot be published yet.');
    expect(why).toHaveTextContent(
      '1.1 Calibration: The character U+0627 is in no typeface this publication can use.',
    );
    // Not "this paragraph": `assemble` raises this code for a definition list's **term** as well as
    // for a paragraph, naming the list, and a sentence that says paragraph then points at a list is
    // a sentence an author cannot act on.
    expect(why).toHaveTextContent(
      '1.1 Calibration: This text holds formatting or an inline item that cannot be published yet.',
    );
  });

  it('names a language the publication cannot take, and what a publication takes', async () => {
    const takes =
      'a publication takes a language of two or three letters and, if any, a region of two, such as en-GB.';
    const fake = failing([
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: null,
        block: null,
        detail: 'en-Latn-GB',
      },
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: CALIBRATION,
        block: null,
        detail: 'x-klingon',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(`The language en-Latn-GB cannot be published: ${takes}`);
    expect(why).toHaveTextContent(
      `1.1 Calibration: The language x-klingon cannot be published: ${takes}`,
    );
    expect(why).not.toHaveTextContent('The publication could not be made');
  });

  it('says there is nothing to publish, rather than asking for another attempt that cannot succeed', async () => {
    const fake = failing([
      { stage: 'compose', code: 'nothing_to_publish', node: null, block: null, detail: null },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'There is nothing to publish: no part of the outline is left, and the layout sets no cover.',
    );
    expect(why).not.toHaveTextContent('Publish again');
  });

  it('says what a preformatted line and the monospace face need, in words an author can act on', async () => {
    const fake = failing([
      { stage: 'compose', code: 'code_glyph_missing', node: null, block: 'p1', detail: 'U+2016' },
      {
        stage: 'compose',
        code: 'line_too_wide',
        node: null,
        block: 'p1',
        detail: 'line 2, 84 of 83 columns',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'The character U+2016 is not in the monospace typeface that preformatted text and inline code are set in.',
    );
    expect(why).toHaveTextContent(
      'A line of this preformatted text is too wide for the page, so it would be cut off: line 2, 84 of 83 columns. Shorten the line or break it.',
    );
  });

  it('says a character an equation holds is not in the maths typeface, not that no typeface has it', async () => {
    const fake = failing([
      { stage: 'compose', code: 'math_glyph_missing', node: null, block: 'e1', detail: 'U+0663' },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'The maths typeface that equations are set in cannot set the character U+0663 in this equation.',
    );
    expect(why).not.toHaveTextContent('in no typeface');
  });

  it("says a style is used where it does not apply, and that a typeface's licence forbids embedding it, blaming the theme for the second", async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'style_not_applicable',
        node: null,
        block: 'b1',
        detail: 'heading-1',
      },
      {
        stage: 'compose',
        code: 'typeface_not_embeddable',
        node: null,
        block: null,
        detail: 'Alloy Sans',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'This paragraph, table or figure uses the style heading-1, which cannot be used where it stands.',
    );
    // Nothing in the document can mend a face the theme may not embed, so the sentence says it is the
    // theme's to change and never asks for another attempt.
    expect(why).toHaveTextContent(
      "The typeface Alloy Sans cannot be embedded in a PDF: its licence does not permit it. The publication's theme has to change before this document can be published.",
    );
    expect(why).not.toHaveTextContent('Publish again');
  });

  it('says a typeface the theme names is not one the publisher holds, blaming the theme', async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'typeface_unavailable',
        node: null,
        block: null,
        detail: 'Alloy Sans',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    // Nothing in the document names a typeface, and another attempt finds the same faces: the theme's
    // to change, never the author's to try again.
    expect(why).toHaveTextContent(
      "The typeface Alloy Sans is not one this publication can be set in: the publishing service does not hold it. The publication's theme has to change before this document can be published.",
    );
    expect(why).not.toHaveTextContent('Publish again');
  });

  it('says what a table needs before it can be published, in words an author can act on', async () => {
    const fake = failing([
      { stage: 'compose', code: 'table_without_caption', node: null, block: 't1', detail: null },
      { stage: 'compose', code: 'table_header_spans_body', node: null, block: 't1', detail: null },
      { stage: 'compose', code: 'style_missing', node: null, block: 't1', detail: 'wide' },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'A table has no caption. Give it one: the caption names the table in the PDF and to a screen reader.',
    );
    expect(why).toHaveTextContent(
      'A header cell of this table spans down into rows that are not header rows, so the PDF would present them as headers too. Shorten its span, or make those rows header rows.',
    );
    // A table has a style as a paragraph does, and a figure an image style, so the sentence names all
    // three rather than calling one of them a paragraph.
    // The theme holds the styles since themes 1, so the sentence blames the theme and names the style.
    expect(why).toHaveTextContent(
      "This paragraph, table or figure uses the style wide, which the publication's theme does not have.",
    );
    expect(why).not.toHaveTextContent('template');
  });

  it('says what a figure needs before it can be published, and names nothing of an image it may not read', async () => {
    const fake = failing([
      { stage: 'compose', code: 'figure_without_caption', node: null, block: 'f1', detail: null },
      { stage: 'compose', code: 'alternative_missing', node: null, block: 'f2', detail: null },
      { stage: 'resolve', code: 'asset_unreadable', node: null, block: 'f3', detail: null },
      { stage: 'compose', code: 'caption_too_long', node: null, block: 'f4', detail: null },
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: null,
        block: 'b5',
        detail: 'image',
      },
      { stage: 'compose', code: 'image_too_wide', node: null, block: 'b6', detail: null },
      { stage: 'compose', code: 'image_in_caption', node: null, block: 'b7', detail: null },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'A figure has no caption. Give it one: the caption names the figure in the PDF and to a screen reader.',
    );
    expect(why).toHaveTextContent(
      "This has no way to be read aloud: an image with no description, and its figure not given one either, or an equation with no alternative text. Describe an image in its figure's panel, or mark it decorative; write an equation's alternative by opening it again.",
    );
    expect(why).toHaveTextContent(
      'A figure shows an image you may not see, so you cannot publish it.',
    );
    expect(why).toHaveTextContent(
      "A figure's caption is too long to stand on a page with its image. Shorten the caption.",
    );
    // An image in a line of text, named as one rather than as formatting or an inline item.
    expect(why).toHaveTextContent('An image in a line of text cannot be published yet.');
    expect(why).toHaveTextContent(
      'An image in a line of text is wider than the room it stands in. Use a narrower image, or make it a figure.',
    );
    expect(why).toHaveTextContent(
      'A caption holds an image, which a caption cannot publish. Take the image out of the caption.',
    );
  });

  it('says where a footnote cannot stand, which cell its anchor lacks, and that it has no text (footnotes 2)', async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'footnote_not_publishable_here',
        node: null,
        block: 't1',
        detail: null,
      },
      {
        stage: 'compose',
        code: 'footnote_anchor_unresolved',
        node: null,
        block: 'f1',
        detail: null,
      },
      { stage: 'compose', code: 'footnote_empty', node: null, block: 'f2', detail: null },
      { stage: 'compose', code: 'footnote_unnumbered', node: null, block: 'f3', detail: null },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      "A footnote stands where it cannot be published. A footnote can stand only in a paragraph's text; a note on a whole table is the table's note.",
    );
    expect(why).toHaveTextContent('A footnote is anchored to a cell its table does not have.');
    expect(why).toHaveTextContent('A footnote has no text. Write it, or delete its mark.');
    expect(why).toHaveTextContent(
      'A footnote here would print with no number: the layout numbers footnotes within sections, and no numbered section comes before it.',
    );
  });

  it('names an equation, in a line of text or a block of its own, as something a request made before layouts cannot publish (equations 2)', async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: null,
        block: 'e1',
        detail: 'equation',
      },
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: null,
        block: 'b1',
        detail: 'equation',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    // Both by name, never as formatting or an inline item. An equation now publishes under a layout
    // (equations 2), so this is reachable only from a request with none, worded as the cross-reference
    // one is: the request has no layout at all, so neither names one.
    const said = within(why)
      .getAllByRole('listitem')
      .map((each) => each.textContent);
    expect(said).toHaveLength(2);
    for (const each of said) {
      expect(each).toContain('An equation cannot be published from this request. Publish again.');
    }
  });

  it('says why an equation cannot be published, naming the construct never its text, and that it would print with no number (equations 2)', async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e1',
        detail: 'merror',
      },
      { stage: 'compose', code: 'equation_unrenderable', node: null, block: 'e2', detail: 'rtl' },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e3',
        detail: 'multiscripts',
      },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e4',
        detail: 'voffset',
      },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e5',
        detail: 'spanningCell',
      },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e6',
        detail: 'mathvariant',
      },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e7',
        detail: 'element',
      },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e8',
        detail: 'attribute',
      },
      { stage: 'compose', code: 'equation_unrenderable', node: null, block: 'e9', detail: 'text' },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e10',
        detail: 'unreadable',
      },
      // The final review of equations 2: a space no line holds, an accent of two characters, and an
      // equation that draws nothing.
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e12',
        detail: 'space',
      },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e13',
        detail: 'accent',
      },
      {
        stage: 'compose',
        code: 'equation_unrenderable',
        node: null,
        block: 'e14',
        detail: 'empty',
      },
      { stage: 'compose', code: 'equation_unnumbered', node: null, block: 'e11', detail: null },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'An equation holds an error mark, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).toHaveTextContent(
      'An equation is written with maths right to left, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).toHaveTextContent(
      'An equation holds more than one prescript or postscript on one side, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).toHaveTextContent(
      'An equation holds a raised or lowered box, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).toHaveTextContent(
      'An equation holds a cell spanning others, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    // mathvariant, element, attribute and text never quote what the equation held, so all four read
    // the same: one sentence said four times, once per failure.
    const genericCount = within(why)
      .getAllByRole('listitem')
      .filter((each) =>
        (each.textContent ?? '').includes(
          'An equation holds something the typesetter cannot set, so it cannot be published. Open it and rewrite it, or delete it.',
        ),
      ).length;
    expect(genericCount).toBe(4);
    expect(why).toHaveTextContent(
      'An equation is MathML that cannot be read at all, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).toHaveTextContent(
      'An equation holds a space too wide to be set, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).toHaveTextContent(
      'An equation holds an accent made of more than one character, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).toHaveTextContent(
      'An equation draws nothing, so it cannot be published. Open it and rewrite it, or delete it.',
    );
    expect(why).not.toHaveTextContent('merror');
    expect(why).not.toHaveTextContent('mathvariant');
    expect(why).toHaveTextContent(
      'An equation here would print with no number: the layout numbers equations within sections, and no numbered section comes before it.',
    );
  });

  it('names a cross-reference as something a request made before layouts cannot publish (cross-references 2)', async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: null,
        block: 'b1',
        detail: 'crossReference',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    // The request has no layout at all, so the sentence names none; a publish now is made under one.
    expect(why).toHaveTextContent(
      'A cross-reference cannot be published from this request. Publish again.',
    );
  });

  it('says a cross-reference points at something this document does not hold, or holds more than once (cross-references 2)', async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'cross_reference_unresolved',
        node: null,
        block: 'x1',
        detail: 'block gone',
      },
      {
        stage: 'compose',
        code: 'cross_reference_unresolved',
        node: CALIBRATION,
        block: 'x2',
        detail: 'component cccccccc-0000-4000-8000-000000000002 block x2',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'A cross-reference points at something this document does not hold, or at a component it holds more than once.',
    );
    expect(why).toHaveTextContent(
      '1.1 Calibration: A cross-reference points at something this document does not hold, or at a component it holds more than once.',
    );
  });

  it("names the form a cross-reference asked for that what it points at cannot show, never the author's text (cross-references 2)", async () => {
    const fake = failing([
      {
        stage: 'compose',
        code: 'cross_reference_form_unavailable',
        node: null,
        block: 'x1',
        detail: 'number',
      },
      {
        stage: 'compose',
        code: 'cross_reference_form_unavailable',
        node: null,
        block: 'x2',
        detail: 'title',
      },
      {
        stage: 'compose',
        code: 'cross_reference_form_unavailable',
        node: null,
        block: 'x3',
        detail: 'numberAndTitle',
      },
      {
        stage: 'compose',
        code: 'cross_reference_form_unavailable',
        node: null,
        block: 'x4',
        detail: 'page',
      },
      {
        stage: 'compose',
        code: 'cross_reference_form_unavailable',
        node: null,
        block: 'x5',
        detail: 'relative',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      'A cross-reference asks for a number, and what it points at has none: a paragraph, a list, or a section with no number of its own.',
    );
    expect(why).toHaveTextContent(
      'A cross-reference asks for a title, and what it points at has none: a paragraph, a list, a footnote, or an equation. A section or a caption holding an equation has none either, since the equation cannot be printed as a title.',
    );
    expect(why).toHaveTextContent(
      'A cross-reference asks for a number and a title, and what it points at is missing one: a paragraph, a list, a footnote, an equation, or a section with no number of its own. A section or a caption holding an equation is missing one too, since the equation cannot be printed as a title.',
    );
    expect(why).toHaveTextContent(
      "A cross-reference asks for a page. A section's title cannot hold one, since the running heads and the contents set the title again in a different place; nor can something standing in a table's header row, which the page repeats.",
    );
    expect(why).toHaveTextContent(
      "A cross-reference asks for above or below. Either this publication's layout has no words for them, or what it points at stands in a table's header row, which repeats.",
    );
  });

  it("blames the layout, not the document, for the layout's own words and language", async () => {
    const fake = failing([
      { stage: 'compose', code: 'layout_glyph_missing', node: null, block: null, detail: 'U+0627' },
      {
        stage: 'compose',
        code: 'layout_language_not_publishable',
        node: null,
        block: null,
        detail: 'sr-Latn',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(
      "This publication's layout uses a character, U+0627, that no typeface it can use has. The layout has to change before this document can be published.",
    );
    expect(why).toHaveTextContent(
      "This publication's layout is in the language sr-Latn, which cannot be published. The layout has to change before this document can be published.",
    );
    expect(why).not.toHaveTextContent('Publish again');
    expect(why).not.toHaveTextContent('is in no typeface this publication can use');
  });

  it('says a failure of the engine or the store is nothing in the document, and to publish again', async () => {
    for (const [stage, code, words] of [
      ['engine', 'engine_failed', 'The publication could not be made. Publish again.'],
      ['store', 'store_failed', 'The publication could not be stored. Publish again.'],
    ] as const) {
      const fake = failing([{ stage, code, node: null, block: null, detail: null }]);
      const { unmount } = open(fake.fetch);
      await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
      const why = await screen.findByRole('list', { name: 'Why it could not be published' });
      expect(why).toHaveTextContent(words);
      expect(
        screen.getByText(
          'The publication could not be made, and nothing in the document caused it. Publish again later.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Put these right/)).toBeNull();
      unmount();
    }
  });

  it("still asks the author to put the document right when one failure is the document's and one the engine's", async () => {
    const fake = failing([
      { stage: 'compose', code: 'style_missing', node: CALIBRATION, block: 'b1', detail: 'note' },
      { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(
      screen.getByText('The document could not be published. Put these right and publish again:'),
    ).toBeInTheDocument();
  });

  it('asks about a waiting publish one request at a time under StrictMode, and not once it is made', async () => {
    let asked = 0;
    let waiting = 0;
    let most = 0;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Each answer takes a little while, so two pollers running at once would be seen overlapping.
      [`GET /v1/publication-requests/${REQUEST}`]: async () => {
        asked += 1;
        waiting += 1;
        most = Math.max(most, waiting);
        const made = asked >= 4;
        await pause(5);
        waiting -= 1;
        return made ? { ...queued(), state: 'done', publication: PUBLICATION } : queued();
      },
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    await screen.findByRole('link', { name: 'Open the publication' });
    await pause(50);
    expect(most).toBe(1);
    expect(asked).toBe(4);
  });

  it('stops asking about a waiting publish once the page is closed with an answer on its way', async () => {
    let asked = 0;
    let answer = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Never made: a queue with no worker. The third ask is still on its way when the page closes.
      [`GET /v1/publication-requests/${REQUEST}`]: async () => {
        asked += 1;
        if (asked === 3) await held;
        return queued();
      },
    });
    const { unmount } = open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(await screen.findByText('Publishing...')).toBeInTheDocument();
    await waitFor(() => expect(asked).toBe(3));
    unmount();
    answer();
    await pause(100);
    expect(asked).toBe(3);
  });

  it('asks nothing once the page is closed while it waits to ask again', async () => {
    let asked = 0;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        return queued();
      },
    });
    // Asked about 200 ms after the request is made: the page closes well inside that.
    const { unmount } = open(fake.fetch, true, 200);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(await screen.findByText('Publishing...')).toBeInTheDocument();
    // Long enough for the request to be answered and the next ask put off; well short of 200 ms.
    await pause(20);
    unmount();
    await pause(300);
    expect(asked).toBe(0);
  });

  it('waits twice as long after each answer that it is still queued, up to half a minute', async () => {
    // The schedule, from the real first wait: doubling, then held at the cap.
    const waits = [1000];
    while (waits.length < 8) waits.push(nextFollow(waits[waits.length - 1]!));
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(FOLLOW_CAP_MS).toBe(30000);

    // And the page keeps it: each ask comes at least twice as long after the last as the one before.
    const at: number[] = [];
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Queued, then no answer at all, then queued: a failed ask is waited out the same way.
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        at.push(performance.now());
        if (at.length === 2) return DROPPED;
        return at.length >= 4 ? { ...queued(), state: 'done', publication: PUBLICATION } : queued();
      },
    });
    open(fake.fetch, true, 20);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    await screen.findByRole('link', { name: 'Open the publication' });
    const gaps = at.slice(1).map((each, index) => each - at[index]!);
    // Timers never fire early by more than a rounding; they may fire late.
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeGreaterThanOrEqual(40 - 2);
    expect(gaps[1]).toBeGreaterThanOrEqual(80 - 2);
    expect(gaps[2]).toBeGreaterThanOrEqual(160 - 2);
  });

  it('says a publish refused because the author may not publish, and offers it again', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [
        new Status(403, {
          code: 'forbidden',
          message: 'This needs the publish permission.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText('You may read this document but not publish it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it('says a publish refused because the document has changed, and offers it again', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [
        new Status(409, {
          code: 'version_precondition',
          message: 'This document has a newer version than the one this page opened.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText(
        'This document has changed since the page opened. Reload it and publish again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it("says why a publish was refused at the door, in the service's words", async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [
        new Status(400, {
          code: 'layout_language',
          message:
            'This document is in fr, and its layout is written in en. It can be published only under a layout in its own language.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText(
        'This document is in fr, and its layout is written in en. It can be published only under a layout in its own language.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it('says a publish could not be asked for, whether the service failed or never answered', async () => {
    for (const answer of [new Status(500), DROPPED]) {
      const fake = service({
        [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
        [`POST /v1/documents/${DOCUMENT}/publications`]: [answer],
      });
      const { unmount } = open(fake.fetch);
      await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
      expect(
        await screen.findByText('The publish could not be asked for. Try again.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
      unmount();
    }
  });

  it('says a publish could not be followed when the service will not say how it stands', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [
        new Status(404, {
          code: 'not_found',
          message: 'There is nothing at this address.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText('The publish could not be followed. Look for it below later.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it('says the publications could not be read, and reads them again when asked', async () => {
    let broken = true;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () =>
        broken ? new Status(500) : listed([publication]),
    });
    open(fake.fetch);
    expect(await screen.findByText('The publications could not be read.')).toBeInTheDocument();
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('The publications could not be read.')).toBeNull();
  });

  it('offers no Publish to somebody who may only read, and still lists what was published', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([publication])],
    });
    open(fake.fetch, false);
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish as PDF' })).toBeNull();
  });
});
