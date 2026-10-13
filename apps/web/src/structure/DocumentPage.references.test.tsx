import type { ContentDocument, OutlineNode } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { DocumentPage } from './DocumentPage.js';
import {
  ADA,
  client,
  DOCUMENT,
  HIDDEN,
  INTRODUCTION,
  item,
  json,
  METHOD,
  outline,
  reference,
  referenceTo,
  RESULTS,
  SCOPE,
  SECRET,
  section,
  service,
} from './test/documentPage.js';

// A section's title is a ProseMirror view, which scrolls its selection into view.
shimRangeMeasurement();

const VERSION = 'bbbbbbbb-0000-4000-8000-000000000001';

/** The printer's text: one paragraph, its references as given. */
const printer = (...targets: object[]): ContentDocument =>
  ({
    schemaVersion: 1,
    title: 'Install the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'As set out in ', marks: [] },
          ...targets.map((target, at) => ({
            type: 'crossReference',
            id: `x${at}`,
            target,
            display: 'number',
          })),
        ],
      },
    ],
  }) as ContentDocument;

/** Introduction, whose title refers to Method; Method; the printer, placed once; and Results. */
const introduction: OutlineNode = {
  ...section(INTRODUCTION, 'Introduction'),
  title: [
    { type: 'text', value: 'Introduction, after ', marks: [] },
    { type: 'crossReference', id: 't1', target: { kind: 'node', node: METHOD }, display: 'number' },
  ],
} as OutlineNode;

/**
 * The page, the texts route answering the printer's text as given and every other occurrence withheld:
 * every time, `once` and then never again, or `refused` with a 500.
 */
async function openWith(
  nodes: OutlineNode[],
  content: ContentDocument,
  texts: 'always' | 'once' | 'refused' = 'always',
) {
  const fake = service(outline(nodes), { mayRead: (component) => component !== SECRET });
  let answered = 0;
  const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === `/v1/documents/${DOCUMENT}/texts`) {
      if (texts === 'refused')
        return json(500, { code: 'internal', message: 'Something went wrong.' });
      answered += 1;
      if (texts === 'once' && answered > 1) return new Promise<Response>(() => {});
      const occurrence = (node: string, version: string | null) => ({
        node,
        version,
        mayEdit: false,
        mayComment: false,
        maySuggest: false,
        pendingSuggestions: 0,
        lock: null,
      });
      return json(200, {
        document: DOCUMENT,
        version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
        occurrences: [occurrence(SCOPE, VERSION), occurrence(HIDDEN, null)],
        versions: [{ id: VERSION, number: '0.3', content }],
      });
    }
    return fake.fetch(request);
  }) as typeof globalThis.fetch;
  render(<DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />);
  await screen.findByRole('treeitem', { name: /^Method/ });
  if (texts === 'refused') return fake;
  await within(screen.getByRole('region', { name: "The document's text" })).findByText(
    /As set out in/,
  );
  return fake;
}

const part = () => document.querySelector<HTMLElement>('[data-part="details"]')!;

describe('what in its own document references a node (STR-074)', () => {
  it('STR-074 lists in the Part panel each place in the document that refers to a node, each a link to it', async () => {
    await openWith(
      [
        introduction,
        section(METHOD, 'Method'),
        reference(SCOPE, 'latest'),
        section(RESULTS, 'Results'),
      ],
      printer({ kind: 'node', node: METHOD }, { kind: 'node', node: METHOD }),
    );
    await userEvent.click(item(/^Method/));
    const referring = within(part()).getByRole('list', { name: 'Referenced by' });
    const links = within(referring).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Introduction, after',
      'Install the printer, 2 references',
    ]);
    expect(links[1]).toHaveAttribute('href', expect.stringContaining(`/nodes/${SCOPE}`));

    // A link chooses the place it names.
    await userEvent.click(links[0]!);
    await waitFor(() => expect(item(/^Introduction/)).toHaveAttribute('aria-selected', 'true'));

    // And a node nothing refers to says so.
    await userEvent.click(item(/^Results/));
    expect(within(part()).getByText('Nothing else in this document refers to it.')).toBeVisible();
  });

  it('STR-074 warns before removing a node something refers to, naming each place, and still removes it', async () => {
    const fake = await openWith(
      [
        introduction,
        section(METHOD, 'Method', [section(RESULTS, 'Results')]),
        reference(SCOPE, 'latest'),
      ],
      printer({ kind: 'node', node: RESULTS }),
    );
    await userEvent.click(item(/^Method/));
    await userEvent.keyboard('{Delete}');
    const question = screen.getByRole('group', { name: 'Confirm removal' });
    expect(question).toHaveTextContent(
      'Referenced 2 times elsewhere in this document. Removing it breaks each reference.',
    );
    // Said to whoever reaches Remove, which is where the focus goes.
    const remove = within(question).getByRole('button', { name: 'Remove' });
    expect(remove).toHaveFocus();
    expect(remove).toHaveAccessibleDescription(
      /^Remove Method and everything beneath it\?.*Referenced 2 times elsewhere in this document\./,
    );
    expect(
      within(question)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Introduction, after', 'Install the printer']);
    await userEvent.click(within(question).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(fake.edits().at(-1)?.body).toMatchObject({
        operation: { operation: 'remove', node: METHOD },
      }),
    );
  });

  it('STR-074 SCH-032 counts no reference to an occurrence the reader may not read, which would name its component', async () => {
    await openWith(
      [section(METHOD, 'Method'), reference(SCOPE, 'latest'), referenceTo(HIDDEN, SECRET)],
      printer({ kind: 'component', component: SECRET, block: 's1' }),
    );
    const withheld = screen.getAllByRole('treeitem').at(-1)!;
    await userEvent.click(withheld);
    expect(
      within(part()).getByText('Nothing you can read in this document refers to it.'),
    ).toBeVisible();
    await userEvent.keyboard('{Delete}');
    const question = screen.getByRole('group', { name: 'Confirm removal' });
    expect(question).not.toHaveTextContent(/Referenced/);
  });

  it('STR-074 claims nothing where the texts could not be read, and says the removal could not be checked', async () => {
    await openWith(
      [introduction, section(METHOD, 'Method'), reference(SCOPE, 'latest')],
      printer({ kind: 'node', node: METHOD }),
      'refused',
    );
    await userEvent.click(item(/^Method/));
    expect(await within(part()).findByText('Could not be checked.')).toBeVisible();
    expect(within(part()).queryByText(/refers to it/)).toBeNull();
    await userEvent.keyboard('{Delete}');
    expect(screen.getByRole('group', { name: 'Confirm removal' })).toHaveTextContent(
      'Whether anything else in this document refers to it could not be checked.',
    );
  });

  it('STR-074 still warns of a removal straight after another act, before the texts are read again', async () => {
    const fake = await openWith(
      [section(METHOD, 'Method'), reference(SCOPE, 'latest'), section(RESULTS, 'Results')],
      printer({ kind: 'node', node: METHOD }),
      'once',
    );
    // Results moved above the printer: a new version, whose texts are asked for and never answered.
    await userEvent.click(item(/^Results/));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.click(item(/^Method/));
    await userEvent.keyboard('{Delete}');
    expect(screen.getByRole('group', { name: 'Confirm removal' })).toHaveTextContent(
      'Referenced once elsewhere in this document.',
    );
  });
});
