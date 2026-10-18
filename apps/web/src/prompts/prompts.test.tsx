import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LibraryPage, PromptLibraries } from './Libraries.js';
import { PromptPage } from './PromptPage.js';
import { Prompts } from './Prompts.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const PROMPT = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const PARAGRAPH = '44444444-4444-4444-8444-444444444444';
const LIBRARY = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const prompt = {
  schemaVersion: 1,
  title: 'Summarise the section',
  description: 'A short summary.',
  instructions: 'Summarise this for {{audience}}.',
  context: [
    { source: 'outline', scope: 'section' },
    { source: 'parameters', names: ['audience'] },
  ],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['claude-sonnet-5-5'] },
};

const view = (over: Record<string, unknown> = {}) => ({
  id: PROMPT,
  space: { id: GENERAL, name: 'General' },
  version: { id: VERSION, number: '0.1', author: null, createdAt: '2026-10-18T09:00:00.000Z' },
  prompt,
  mayEdit: true,
  state: { key: 'draft', name: 'Draft', approved: false },
  transitions: [
    {
      key: 'submit',
      name: 'Submit',
      to: { key: 'in_review', name: 'In review' },
      reasonRequired: false,
    },
  ],
  gates: [],
  revision: null,
  ...over,
});

const library = (over: Record<string, unknown> = {}) => ({
  id: LIBRARY,
  version: { id: VERSION, number: '0.1', author: null, createdAt: '2026-10-18T09:00:00.000Z' },
  library: { schemaVersion: 1, name: 'Reports', prompts: [PROMPT, OTHER] },
  isDefault: false,
  prompts: [
    {
      id: PROMPT,
      state: 'approved',
      revision: { number: 2, versionId: VERSION },
      prompt,
      space: { id: GENERAL, name: 'General' },
    },
    { id: OTHER, state: 'hidden' },
  ],
  mayEdit: true,
  ...over,
});

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function service(options: { held?: unknown; refuse?: boolean } = {}) {
  const asked: Asked[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    const path = url.pathname;
    asked.push({ method: request.method, path, body });
    if (path === '/v1/spaces') {
      return json(200, {
        items: [{ id: GENERAL, name: 'General', archived: false, mayCreate: true }],
        next: null,
      });
    }
    if (path === '/v1/connections') {
      return json(200, { items: [], next: null, total: 0, facets: { spaces: [] } });
    }
    if (path === '/v1/access') {
      return json(200, {
        target: url.searchParams.get('target'),
        permissions: [{ permission: 'edit', allowed: true }],
      });
    }
    if (path === '/v1/definitions') {
      return json(200, {
        items: [
          {
            id: PARAGRAPH,
            kind: 'componentType',
            name: 'Paragraph',
            version: { id: VERSION, number: '0.1' },
          },
        ],
        next: null,
      });
    }
    if (request.method === 'GET' && path === '/v1/prompts') {
      return json(200, {
        items: [
          {
            id: PROMPT,
            title: 'Summarise the section',
            space: { id: GENERAL, name: 'General' },
            purpose: 'summarising',
            version: { id: VERSION, number: '0.1' },
            changedAt: '2026-10-18T09:00:00.000Z',
          },
        ],
        next: null,
        total: 1,
        facets: { spaces: [{ value: GENERAL, label: 'General', count: 1 }] },
      });
    }
    if (request.method === 'GET' && path === `/v1/prompts/${PROMPT}`) {
      return json(200, options.held ?? view());
    }
    if (request.method === 'POST' && path === `/v1/spaces/${GENERAL}/prompts`) {
      return json(200, view());
    }
    if (request.method === 'POST' && path === `/v1/prompts/${PROMPT}/versions`) {
      if (options.refuse) {
        return json(400, {
          code: 'prompt_invalid',
          message: 'The prompt is not valid.',
          problems: [
            {
              rule: 'prompt_invalid',
              path: 'instructions',
              message: '{{region}} names no parameter the context declares',
            },
          ],
        });
      }
      return json(200, view({ version: { id: PARAGRAPH, number: '0.2' } }));
    }
    if (request.method === 'GET' && path === '/v1/prompt-libraries') {
      return json(200, {
        items: [
          {
            id: LIBRARY,
            name: 'No prompts',
            isDefault: true,
            prompts: 0,
            version: { id: VERSION, number: '0.1' },
          },
        ],
      });
    }
    if (path === `/v1/prompt-libraries/${LIBRARY}`) {
      return json(200, library());
    }
    if (request.method === 'POST' && path === `/v1/prompt-libraries/${LIBRARY}/versions`) {
      return json(200, library({ version: { id: PARAGRAPH, number: '0.2' } }));
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  });
  return { client: createApiClient({ baseUrl: 'http://prompts.test', fetch: fetching }), asked };
}

afterEach(() => {
  window.location.hash = '';
});

describe('the prompts', () => {
  it('lists each prompt with its space and purpose, and offers a new one', async () => {
    const { client } = service();
    render(<Prompts client={client} />);
    expect(await screen.findByRole('link', { name: 'Summarise the section' })).toHaveAttribute(
      'href',
      `#/prompts/${PROMPT}`,
    );
    expect(screen.getByText('Summarising')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'New prompt' })).toBeInTheDocument();
  });
});

describe('the prompt page', () => {
  it('makes a prompt from what is typed, its sources, output and models', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<PromptPage client={client} id="new" />);
    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Summarise');
    await user.type(screen.getByRole('textbox', { name: /^Instructions/ }), 'Summarise for ');
    await user.type(screen.getByRole('textbox', { name: /^Instructions/ }), '{{{{audience}}');
    await user.click(screen.getByRole('button', { name: 'Add a source' }));
    await user.type(screen.getByRole('textbox', { name: 'Parameter names' }), 'audience');
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'The text of a part of type' }),
      'Paragraph',
    );
    await user.type(screen.getByRole('textbox', { name: /^Models accepted/ }), 'claude-sonnet-5-5');
    await user.click(screen.getByRole('button', { name: 'Make prompt' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/prompts/${PROMPT}`));
    const made = asked.find((each) => each.path === `/v1/spaces/${GENERAL}/prompts`);
    expect(made?.body).toEqual({
      prompt: {
        schemaVersion: 1,
        title: 'Summarise',
        description: '',
        instructions: 'Summarise for {{audience}}',
        context: [
          { source: 'outline', scope: 'part' },
          { source: 'parameters', names: ['audience'] },
        ],
        output: { componentType: PARAGRAPH },
        models: { purpose: 'drafting', accepts: ['claude-sonnet-5-5'] },
      },
    });
  });

  it('shows where a prompt stands, and each problem a refused save names', async () => {
    const user = userEvent.setup();
    const { client } = service({ refuse: true });
    render(<PromptPage client={client} id={PROMPT} />);
    expect(
      await screen.findByRole('heading', { name: 'Summarise the section' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    expect(
      await screen.findByText('instructions: {{region}} names no parameter the context declares'),
    ).toBeInTheDocument();
  });

  it('shows a reader the prompt and nothing to change it with', async () => {
    const { client } = service({ held: view({ mayEdit: false, transitions: [] }) });
    render(<PromptPage client={client} id={PROMPT} />);
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
  });
});

describe('the prompt libraries', () => {
  it('lists the default first, saying so', async () => {
    const { client } = service();
    render(<PromptLibraries client={client} />);
    expect(await screen.findByRole('link', { name: 'No prompts' })).toHaveAttribute(
      'href',
      `#/prompts/libraries/${LIBRARY}`,
    );
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('shows each prompt at the revision it runs, one the reader may not read unnamed, and saves a removal', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<LibraryPage client={client} id={LIBRARY} />);
    const listed = await screen.findByRole('list', { name: 'Prompts it lists' });
    expect(listed).toHaveTextContent('Summarise the section Runs revision 2');
    expect(listed).toHaveTextContent('A prompt you may not read');
    await user.click(screen.getByRole('button', { name: 'Remove A prompt you may not read' }));
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    expect(await screen.findByText('Saved as version 0.2.')).toBeInTheDocument();
    expect(asked.find((each) => each.path.endsWith('/versions'))?.body).toEqual({
      openedFrom: VERSION,
      library: { schemaVersion: 1, name: 'Reports', prompts: [PROMPT] },
    });
  });
});
