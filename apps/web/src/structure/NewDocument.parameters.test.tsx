import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NewDocument } from './NewDocument.js';
import { client, json, DOCUMENT, SPACE, SPACES } from './test/documentPage.js';

const TEMPLATE = 'ee000000-0000-4000-8000-000000000001';
const TEMPLATES = {
  items: [
    {
      id: TEMPLATE,
      name: 'Report',
      space: { id: SPACE, name: 'General' },
      version: { id: 'ee000000-0000-4000-8000-0000000000a1', number: '0.3' },
    },
  ],
  next: null,
};

const feeds = { arguments: true };
/** One parameter of each kind the form asks for. */
const DECLARED = [
  { name: 'due', type: { base: 'date' }, required: true, list: false, changeable: false, feeds },
  {
    name: 'region',
    type: { base: 'text' },
    required: true,
    list: false,
    permitted: { values: ['North', 'South'] },
    changeable: false,
    feeds,
  },
  {
    name: 'reviewer',
    type: { base: 'text' },
    required: false,
    list: false,
    changeable: true,
    feeds,
  },
  {
    name: 'pages',
    type: { base: 'integer' },
    required: false,
    list: false,
    changeable: true,
    feeds,
  },
  {
    name: 'final',
    type: { base: 'boolean' },
    required: false,
    list: false,
    changeable: true,
    feeds,
  },
  {
    name: 'starts',
    type: { base: 'time', fraction: 0 },
    required: false,
    list: false,
    changeable: true,
    feeds,
  },
  {
    name: 'sites',
    type: { base: 'integer' },
    required: false,
    list: true,
    changeable: true,
    feeds,
  },
  {
    name: 'depth',
    type: { base: 'decimal', precision: 6, scale: 2 },
    required: false,
    list: false,
    changeable: true,
    feeds,
  },
];

const template = (parameters: unknown[]) => ({
  id: TEMPLATE,
  space: { id: SPACE, name: 'General' },
  version: { id: 'ee000000-0000-4000-8000-0000000000a1', number: '0.3', note: null },
  definition: {
    schemaVersion: 1,
    name: 'Report',
    theme: 'aaaaaaaa-0000-4000-8000-000000000001',
    layout: 'aaaaaaaa-0000-4000-8000-000000000002',
    schemas: [],
    outline: { sections: [] },
    changes: { add: true, remove: true, reorder: true },
    parameters,
  },
  mayDesign: false,
});

const made = { id: DOCUMENT };

/** The service as the form meets it: the spaces, the templates, the one chosen, and making. */
function service(answer: (body: unknown) => Response = () => json(200, made)) {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    if (url === '/v1/spaces') return json(200, SPACES);
    if (url === '/v1/templates') return json(200, TEMPLATES);
    if (url === `/v1/templates/${TEMPLATE}`) return json(200, template(DECLARED));
    if (url === `/v1/spaces/${SPACE}/documents`) return answer(body);
    return json(500, {});
  }) as typeof globalThis.fetch;
  return { fetch, sent, made: () => sent.filter((each) => each.url.endsWith('/documents')) };
}

async function chooseReport(fetch: typeof globalThis.fetch, onCreated = vi.fn()) {
  render(
    <StrictMode>
      <NewDocument client={client(fetch)} onCreated={onCreated} />
    </StrictMode>,
  );
  await screen.findByRole('option', { name: 'Report (General)' });
  await userEvent.selectOptions(screen.getByLabelText('Template'), 'Report (General)');
  await screen.findByLabelText('due (required)');
  await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
  return onCreated;
}

const create = () => screen.getByRole('button', { name: 'Create' });

describe("New document's parameters (the TP1 plan, TP1-I)", () => {
  it('asks for each parameter by its type: a date, a choice of its permitted values, a box, a check box, a time and a list of entries', async () => {
    const { fetch } = service();
    await chooseReport(fetch);

    expect(screen.getByLabelText('due (required)')).toHaveAttribute('type', 'date');
    const region = screen.getByLabelText('region (required)');
    expect([...region.querySelectorAll('option')].map((each) => each.textContent)).toEqual([
      'Not chosen',
      'North',
      'South',
    ]);
    expect(screen.getByLabelText('reviewer')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('pages')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText('pages')).toHaveAccessibleDescription('A whole number.');
    expect(screen.getByLabelText('final')).toHaveAttribute('type', 'checkbox');
    expect(screen.getByLabelText('starts')).toHaveAttribute('type', 'time');
    const sites = screen.getByRole('group', { name: 'sites' });
    await userEvent.click(within(sites).getByRole('button', { name: 'Add an entry to sites' }));
    expect(within(sites).getByLabelText('sites, entry 1')).toBeInTheDocument();
  });

  it('keeps Create unavailable, saying which required parameters it waits for, until each is filled', async () => {
    const { fetch, made } = service();
    await chooseReport(fetch);

    expect(create()).toHaveAttribute('aria-disabled', 'true');
    expect(create()).toHaveAccessibleDescription('Fill in due and region to create the document.');
    await userEvent.click(create());
    expect(made()).toEqual([]);

    fireEvent.change(screen.getByLabelText('due (required)'), { target: { value: '2026-10-31' } });
    expect(create()).toHaveAccessibleDescription('Fill in region to create the document.');
    await userEvent.selectOptions(screen.getByLabelText('region (required)'), 'North');
    expect(create()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('TPL-026 sends the template and its parameters as the API takes them, each in its canonical form and nothing for one left empty', async () => {
    const { fetch, made } = service();
    const onCreated = await chooseReport(fetch);

    fireEvent.change(screen.getByLabelText('due (required)'), { target: { value: '2026-10-31' } });
    await userEvent.selectOptions(screen.getByLabelText('region (required)'), 'South');
    await userEvent.type(screen.getByLabelText('pages'), ' 12 ');
    await userEvent.click(screen.getByLabelText('final'));
    fireEvent.change(screen.getByLabelText('starts'), { target: { value: '09:30' } });
    const sites = screen.getByRole('group', { name: 'sites' });
    await userEvent.click(within(sites).getByRole('button', { name: 'Add an entry to sites' }));
    await userEvent.type(within(sites).getByLabelText('sites, entry 1'), '4');
    await userEvent.click(within(sites).getByRole('button', { name: 'Add an entry to sites' }));
    await userEvent.click(create());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DOCUMENT));
    expect(made()).toEqual([
      {
        url: `/v1/spaces/${SPACE}/documents`,
        body: {
          title: 'The dosing report',
          language: 'en-GB',
          direction: 'ltr',
          template: TEMPLATE,
          parameters: {
            due: '2026-10-31',
            region: 'South',
            pages: '12',
            final: true,
            starts: '09:30:00',
            sites: ['4'],
          },
        },
      },
    ]);
  });

  it("TPL-045 shows the service's refusal beside each parameter it names, in the API's words, and keeps what was typed", async () => {
    const { fetch } = service(() =>
      json(400, {
        code: 'parameter_invalid',
        message: 'A value does not fit its parameter.',
        traceId: 't',
        problems: [
          { parameter: 'pages', rule: 'type', value: '1.5' },
          { parameter: 'reviewer', rule: 'maxLength', value: 'Grace', field: 'f1' },
          { parameter: 'sites', rule: 'duplicate', value: '4' },
        ],
      }),
    );
    await chooseReport(fetch);
    fireEvent.change(screen.getByLabelText('due (required)'), { target: { value: '2026-10-31' } });
    await userEvent.selectOptions(screen.getByLabelText('region (required)'), 'South');
    await userEvent.type(screen.getByLabelText('pages'), '1.5');
    await userEvent.type(screen.getByLabelText('reviewer'), 'Grace');
    await userEvent.click(create());

    expect(await screen.findByRole('status')).toHaveTextContent(
      'A value does not fit its parameter.',
    );
    const pages = screen.getByLabelText('pages');
    expect(pages).toHaveAttribute('aria-invalid', 'true');
    expect(pages).toHaveAccessibleDescription('A whole number. pages is not of its type: 1.5.');
    expect(screen.getByLabelText('reviewer')).toHaveAccessibleDescription(
      'reviewer is longer than the field it fills allows: Grace.',
    );
    expect(screen.getByRole('group', { name: 'sites' })).toHaveAccessibleDescription(
      'A whole number. sites holds an entry more than once: 4.',
    );
    expect(screen.getByLabelText('due (required)')).not.toHaveAttribute('aria-invalid');
    expect(pages).toHaveValue('1.5');
  });

  it('sends a number in its canonical form, so 1.50 is sent as 1.5 and 012 as 12', async () => {
    const { fetch, made } = service();
    const onCreated = await chooseReport(fetch);
    fireEvent.change(screen.getByLabelText('due (required)'), { target: { value: '2026-10-31' } });
    await userEvent.selectOptions(screen.getByLabelText('region (required)'), 'South');
    await userEvent.type(screen.getByLabelText('pages'), '012');
    await userEvent.type(screen.getByLabelText('depth'), '1.50');
    await userEvent.click(create());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((made()[0]?.body as { parameters: unknown }).parameters).toEqual({
      due: '2026-10-31',
      region: 'South',
      final: false,
      pages: '12',
      depth: '1.5',
    });
  });

  it('says a template whose parameters no longer fit its fields cannot be used, rather than blaming the title', async () => {
    const { fetch } = service(() =>
      json(400, {
        code: 'parameter_field',
        message: 'A parameter seeds a field the document does not hold.',
        traceId: 't',
        parameters: [{ parameter: 'reviewer', field: 'f1' }],
      }),
    );
    await chooseReport(fetch);
    fireEvent.change(screen.getByLabelText('due (required)'), { target: { value: '2026-10-31' } });
    await userEvent.selectOptions(screen.getByLabelText('region (required)'), 'South');
    await userEvent.click(create());
    expect(await screen.findByRole('status')).toHaveTextContent(
      "This template's parameters no longer fit its fields, so a document cannot be made from it. Choose another, or Blank.",
    );
  });

  it('says the space has been archived on a 409 space_archived, and re-reads the spaces it offers', async () => {
    const { fetch, sent } = service(() =>
      json(409, { code: 'space_archived', message: 'Archived.', traceId: 't' }),
    );
    await chooseReport(fetch);
    await userEvent.type(screen.getByLabelText('due (required)'), '2026-10-01');
    await userEvent.selectOptions(screen.getByLabelText('region (required)'), 'North');
    const spacesRead = sent.filter((each) => each.url === '/v1/spaces').length;
    await userEvent.click(create());
    expect(
      await screen.findByText('This space has been archived. Choose another.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(sent.filter((each) => each.url === '/v1/spaces').length).toBeGreaterThan(spacesRead),
    );
  });

  it('asks for no parameters and sends none for a template that declares none, or for Blank', async () => {
    const { fetch, made } = service();
    const declaresNone = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === `/v1/templates/${TEMPLATE}`) {
        return json(200, template([]));
      }
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    const onCreated = vi.fn();
    render(<NewDocument client={client(declaresNone)} onCreated={onCreated} />);
    await screen.findByRole('option', { name: 'Report (General)' });
    await userEvent.selectOptions(screen.getByLabelText('Template'), 'Report (General)');
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.click(create());

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(made()[0]?.body).toEqual({
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      template: TEMPLATE,
    });
    expect(screen.queryByRole('group', { name: 'Parameters' })).toBeNull();
  });

  it('forgets the values given when another template, or Blank, is chosen', async () => {
    const { fetch, made } = service();
    const onCreated = await chooseReport(fetch);
    await userEvent.type(screen.getByLabelText('reviewer'), 'Grace');
    await userEvent.selectOptions(screen.getByLabelText('Template'), 'Blank');
    expect(screen.queryByLabelText('reviewer')).toBeNull();
    await userEvent.click(create());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(made()[0]?.body).toEqual({
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
    });
  });
});
