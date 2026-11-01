import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';
import { Themes } from './Themes.js';

const THEME = '4ae73bd5-48cb-422a-a4f8-2183f0f72866';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const view = {
  id: THEME,
  name: 'Default',
  version: { id: 'tv1', number: '0.11' },
  isDefault: true,
  content: DEFAULT_PRESENTATION.theme.content,
  catalogues: DEFAULT_PRESENTATION.theme.catalogues,
};

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
}

/** The theme routes, answering as SYa's do, and what the page sent them. */
function service(refuse?: { status: number; code: string; message: string }) {
  const sent: Sent[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const path = url.pathname;
    const body =
      request.method === 'GET' || request.method === 'DELETE'
        ? null
        : ((await request.json()) as Record<string, unknown>);
    sent.push({ method: request.method, path: path + url.search, body });
    if (request.method === 'GET' && path === '/v1/themes') {
      const { content: _content, catalogues: _catalogues, ...summary } = view;
      return json(200, { items: [summary] });
    }
    if (request.method === 'GET' && path === `/v1/themes/${THEME}`) return json(200, view);
    if (request.method === 'POST' && path === `/v1/themes/${THEME}/impact`) {
      return json(200, {
        documents: [
          { id: 'd1', title: 'Flush the line' },
          { id: 'd2', title: 'Pump checks' },
        ],
        unreadable: 1,
      });
    }
    if (refuse) return json(refuse.status, { ...refuse, traceId: 't' });
    if (request.method === 'PUT' || request.method === 'DELETE') {
      return json(200, { ...view, version: { id: 'tv2', number: '0.12' } });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

/** The page open on the default theme's Heading 4, as an administrator reaches it. */
async function editing(name: string, refuse?: Parameters<typeof service>[0]) {
  const user = userEvent.setup();
  const { client, sent } = service(refuse);
  render(<Themes client={client} />);
  const themes = await screen.findByRole('table', { name: 'Document themes' });
  await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
  const paragraphs = await screen.findByRole('table', { name: 'Paragraph styles' });
  await user.click(within(paragraphs).getByRole('button', { name: `Edit ${name}` }));
  const form = await screen.findByRole('form', { name: `Paragraph style ${name}` });
  return { user, sent, form };
}

const row = (form: HTMLElement, property: string) =>
  within(form).getByRole('group', { name: property });

describe("Administration's Document themes (the SY plan, SY-F)", () => {
  it('STY-057 shows where each value of a derived style comes from, the nearest style stating it', async () => {
    const { form } = await editing('Heading 4');
    expect(within(row(form, 'Size')).getByText('From Heading 3')).toBeInTheDocument();
    expect(within(row(form, 'Bold')).getByText('From Heading 1')).toBeInTheDocument();
    expect(
      within(row(form, 'Typeface')).getByText("From the catalogue's base"),
    ).toBeInTheDocument();
  });

  it('sets the sample in the style as it stands unsaved, by the CSS the editor sets text by', async () => {
    const { user, form } = await editing('Heading 4');
    await user.click(within(row(form, 'Size')).getByRole('button', { name: 'Set here' }));
    const size = within(row(form, 'Size')).getByRole('spinbutton', { name: 'Size' });
    await user.clear(size);
    await user.type(size, '13');
    const sample = within(form).getByTestId('style-sample');
    expect(sample.querySelector('[data-style="heading-4"]')).not.toBeNull();
    const css = sample.querySelector('style')!.textContent ?? '';
    expect(css).toContain('[data-style="heading-4"]');
    expect(css).toContain('13pt');
  });

  it('STY-034 STY-067 lists the documents a change reaches before it is saved, and saves it only when asked', async () => {
    const { user, sent, form } = await editing('Heading 4');
    await user.click(within(row(form, 'Italic')).getByRole('button', { name: 'Set here' }));
    await user.click(within(row(form, 'Italic')).getByRole('checkbox', { name: 'Italic' }));
    await user.click(within(form).getByRole('button', { name: 'Save style' }));

    const asked = await screen.findByRole('dialog', { name: 'Save Heading 4?' });
    expect(within(asked).getByText('Flush the line')).toBeInTheDocument();
    expect(within(asked).getByText('Pump checks')).toBeInTheDocument();
    expect(within(asked).getByText('And 1 more you may not open.')).toBeInTheDocument();
    expect(sent.filter((each) => each.method === 'PUT')).toEqual([]);

    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    const put = sent.find((each) => each.method === 'PUT')!;
    expect(put.path).toBe(`/v1/themes/${THEME}/styles/paragraph/heading-4`);
    expect(put.body).toMatchObject({
      openedFrom: 'tv1',
      style: { id: 'heading-4', basedOn: 'heading-3', properties: { italic: true } },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Heading 4 saved: Default 0.12');
  });

  it('STY-057 drops a stated value with Use inherited, so the style inherits it again', async () => {
    const { user, sent, form } = await editing('Heading 2');
    await user.click(within(row(form, 'Size')).getByRole('button', { name: 'Use inherited' }));
    expect(within(row(form, 'Size')).getByText('From Heading 1')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Save style' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Save Heading 2?' })).getByRole('button', {
        name: 'Save',
      }),
    );
    const put = sent.find((each) => each.method === 'PUT')!;
    expect((put.body!['style'] as { properties: object }).properties).not.toHaveProperty('size');
  });

  it('STY-069 says what the theme reader refuses as the style is set, and offers no save', async () => {
    const { user, form } = await editing('Heading 4');
    await user.click(within(row(form, 'Colour')).getByRole('button', { name: 'Set here' }));
    const colour = within(row(form, 'Colour')).getByRole('textbox', { name: 'Colour' });
    await user.clear(colour);
    await user.type(colour, '#eeeeee');
    expect(within(form).getByRole('alert')).toHaveTextContent(/below the 4.5:1/);
    expect(within(form).getByRole('button', { name: 'Save style' })).toBeDisabled();
  });

  it('STY-031 says why a style in use is not deleted', async () => {
    const { user, form } = await editing('Heading 4', {
      status: 400,
      code: 'style_in_use',
      message: '3 components use this style, so it cannot be deleted.',
    });
    await user.click(within(form).getByRole('button', { name: 'Delete style' }));
    const asked = await screen.findByRole('dialog', { name: 'Delete Heading 4?' });
    await user.click(within(asked).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      '3 components use this style, so it cannot be deleted.',
    );
  });

  it('STY-029 adds a paragraph style based on another, without a release', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    await user.click(await screen.findByRole('button', { name: 'Add paragraph style' }));
    const form = await screen.findByRole('form', { name: 'New paragraph style' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Warning');
    await user.type(within(form).getByRole('textbox', { name: 'Identifier' }), 'warning');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Based on' }), 'Body');
    await user.click(within(form).getByRole('button', { name: 'Save style' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Save Warning?' })).getByRole('button', {
        name: 'Save',
      }),
    );
    const put = sent.find((each) => each.method === 'PUT')!;
    expect(put.path).toBe(`/v1/themes/${THEME}/styles/paragraph/warning`);
    expect(put.body!['style']).toEqual({
      id: 'warning',
      name: 'Warning',
      basedOn: 'body',
      appliesTo: ['text'],
      properties: {},
    });
  });
});
