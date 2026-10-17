import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { DocumentPage } from './DocumentPage.js';
import {
  ADA,
  client,
  DOCUMENT,
  HIDDEN,
  item,
  json,
  METHOD,
  outline,
  PRINTER,
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

const MANUAL = 'mmmmmmmm-0000-4000-8000-000000000001';

/** The page over Method, which places the printer and a component the reader may not read, then Results. */
async function open() {
  const fake = service(
    outline([
      section(METHOD, 'Method', [reference(SCOPE, 'latest'), referenceTo(HIDDEN, SECRET)]),
      section(RESULTS, 'Results'),
    ]),
    { mayRead: (component) => component !== SECRET },
  );
  const asked: string[] = [];
  const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/uses')) {
      asked.push(path);
      return json(200, {
        documents: [
          {
            id: MANUAL,
            title: 'Pump manual',
            state: null,
            references: [{ node: 'n1', mode: 'latest', version: null, overridden: false }],
          },
        ],
        unreadableDocuments: false,
        baselines: { named: [], unreadable: false },
        publications: { named: [], unreadable: false },
      });
    }
    return fake.fetch(request);
  }) as typeof globalThis.fetch;
  render(<DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />);
  await screen.findByRole('treeitem', { name: /^Method/ });
  return asked;
}

const part = () => document.querySelector<HTMLElement>('[data-part="details"]')!;

describe('where what a node places is used (the R14 plan, R14-B)', () => {
  it('STR-075 offers, for a section, Used in for each component placed beneath it that the reader may read, naming the other documents', async () => {
    const asked = await open();
    await userEvent.click(item(/^Method/));
    const placed = await within(part()).findByRole('list', { name: 'Used in' });
    const offered = within(placed).getAllByRole('button');
    expect(offered.map((each) => each.textContent)).toEqual(['Where Install the printer is used']);
    await userEvent.click(offered[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Where Install the printer is used' });
    expect(await within(dialog).findByRole('link', { name: 'Pump manual' })).toHaveAttribute(
      'href',
      `#/documents/${MANUAL}`,
    );
    expect(asked).toEqual([`/v1/components/${PRINTER}/uses`]);
  });

  it('STR-075 offers Used in for the component a reference places, and none for a section placing nothing', async () => {
    await open();
    await userEvent.click(item(/^Install the printer/));
    expect(
      within(part()).getByRole('button', { name: 'Where Install the printer is used' }),
    ).toBeVisible();
    await userEvent.click(item(/^Results/));
    expect(within(part()).queryByRole('list', { name: 'Used in' })).toBeNull();
  });
});
