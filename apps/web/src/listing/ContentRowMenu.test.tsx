import { createApiClient } from '@alloy-works/api-client';
import { OUTLINE_SCHEMA_VERSION } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentRowMenu } from './ContentRowMenu.js';

const MANUAL = '3c1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const GENERAL = '1a1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const standing = {
  state: { key: 'draft', name: 'Draft', approved: false },
  states: [
    { key: 'draft', name: 'Draft' },
    { key: 'review', name: 'In review' },
  ],
  transitions: [
    { key: 'submit', name: 'Submit for review', to: { key: 'review', name: 'In review' } },
  ],
  gates: [],
};

const view = (may: boolean) => ({
  id: MANUAL,
  space: { id: GENERAL, name: 'General' },
  version: { id: 'v1', number: '1.2' },
  outline: {
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Operator manual',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [],
  },
  mayEdit: may,
  mayPublish: may,
  mayRetire: true,
  mayMove: may,
  mayHold: may,
  mayDesign: may,
  archived: false,
  ...standing,
});

function client(may = true, kind = 'documents') {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const { pathname } = new URL(request.url);
    asked.push(`${request.method} ${pathname}`);
    if (pathname === `/v1/${kind}/${MANUAL}` && request.method === 'GET') {
      return json(200, view(may));
    }
    if (pathname === `/v1/${kind}/${MANUAL}/transitions`) {
      return json(200, {
        ...standing,
        state: { key: 'review', name: 'In review', approved: false },
      });
    }
    if (pathname === '/v1/access') return json(200, { permissions: [] });
    return json(404, {});
  });
  return {
    api: createApiClient({ baseUrl: 'http://localhost', fetch: fetching }),
    asked,
  };
}

const open = async (title = 'Operator manual') => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `More actions for ${title}` }));
  return user;
};
const rows = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((each) => each.textContent);
const row = (name: string) => screen.getByRole('menuitem', { name });

afterEach(() => {
  window.location.hash = '';
});

describe('a row of content', () => {
  it('SCH-075 offers a document its acts from the list, read only once its menu opens', async () => {
    const { api, asked } = client();
    render(
      <ContentRowMenu
        client={api}
        kind="document"
        id={MANUAL}
        title="Operator manual"
        onChanged={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    expect(asked).toEqual([]);
    await open();
    await waitFor(() => expect(row('Publish...')).toHaveAttribute('aria-disabled', 'false'));
    expect(asked).toContain(`GET /v1/documents/${MANUAL}`);
    expect(rows()).toEqual([
      'Open',
      'Publish...',
      'Copy link',
      'Lifecycle›',
      'Relationships',
      'Duplicate...',
      'Manage access',
      'Move to another space...',
      'Place a hold',
      'Archive',
      'Delete',
    ]);
  });

  it('SCH-075 shows what the caller may not do as unavailable, not hidden', async () => {
    const { api } = client(false);
    render(
      <ContentRowMenu
        client={api}
        kind="document"
        id={MANUAL}
        title="Operator manual"
        onChanged={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    await open();
    await waitFor(() => expect(row('Archive')).toHaveAttribute('aria-disabled', 'false'));
    for (const name of [
      'Publish...',
      'Move to another space...',
      'Place a hold',
      'Manage access',
    ]) {
      expect(row(name)).toHaveAttribute('aria-disabled', 'true');
    }
    expect(row('Open')).toHaveAttribute('aria-disabled', 'false');
  });

  it("SCH-075 takes a lifecycle step from the row, in the workflow's own words", async () => {
    const { api, asked } = client();
    const onChanged = vi.fn();
    render(
      <ContentRowMenu
        client={api}
        kind="document"
        id={MANUAL}
        title="Operator manual"
        onChanged={onChanged}
        onDuplicate={vi.fn()}
      />,
    );
    const user = await open();
    await waitFor(() => expect(row('Lifecycle')).toHaveAttribute('aria-disabled', 'false'));
    await user.click(row('Lifecycle'));
    await user.click(row('Submit for review'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(asked).toContain(`POST /v1/documents/${MANUAL}/transitions`);
  });

  it('opens it, and copies the link to it', async () => {
    const { api } = client();
    const onChanged = vi.fn();
    render(
      <ContentRowMenu
        client={api}
        kind="component"
        id={MANUAL}
        title="Operator manual"
        onChanged={onChanged}
        onDuplicate={vi.fn()}
      />,
    );
    let user = await open();
    await user.click(row('Copy link'));
    // user-event's own clipboard, which it puts in place of the browser's.
    expect(await navigator.clipboard.readText()).toMatch(new RegExp(`#/components/${MANUAL}$`));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith('Copied the link to Operator manual.', false),
    );
    user = await open();
    await user.click(row('Open'));
    expect(window.location.hash).toBe(`#/components/${MANUAL}`);
  });

  it('SCH-075 offers a component Used in, and no Publish', async () => {
    const { api } = client(true, 'components');
    render(
      <ContentRowMenu
        client={api}
        kind="component"
        id={MANUAL}
        title="Operator manual"
        onChanged={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    await open();
    await waitFor(() => expect(row('Archive')).toHaveAttribute('aria-disabled', 'false'));
    expect(rows()).toEqual([
      'Open',
      'Copy link',
      'Lifecycle›',
      'Used in',
      'Relationships',
      'Duplicate...',
      'Manage access',
      'Move to another space...',
      'Place a hold',
      'Archive',
      'Delete',
    ]);
  });

  it('SCH-075 offers a template what can be done to one', async () => {
    const { api } = client(true, 'templates');
    const onGenerate = vi.fn();
    render(
      <ContentRowMenu
        client={api}
        kind="template"
        id={MANUAL}
        title="Operator manual"
        onChanged={vi.fn()}
        onDuplicate={vi.fn()}
        onGenerate={onGenerate}
      />,
    );
    const user = await open();
    await waitFor(() => expect(row('Duplicate...')).toHaveAttribute('aria-disabled', 'false'));
    expect(rows()).toEqual([
      'Generate documents...',
      'Relationships',
      'Duplicate...',
      'Manage access',
    ]);
    await user.click(row('Generate documents...'));
    expect(onGenerate).toHaveBeenCalledOnce();
  });
});
