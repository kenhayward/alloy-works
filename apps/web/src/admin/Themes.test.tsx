import { createApiClient } from '@alloy-works/api-client';
import { PLACES } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';
import { Themes } from './Themes.js';

const THEME = '4ae73bd5-48cb-422a-a4f8-2183f0f72866';
const COPY = '0b6a1c52-8f43-4c1e-9d7a-5a2f1e3c4d01';

/** The character catalogue as an export gives it. */
const DOCUMENT = {
  format: 'alloy-works.catalogue',
  version: 1,
  catalogue: { kind: 'character', styles: [] },
};

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
    const text = await request.text();
    const body = text === '' ? null : (JSON.parse(text) as Record<string, unknown>);
    sent.push({ method: request.method, path: path + url.search, body });
    if (request.method === 'GET' && path === '/v1/themes') {
      const { id, name, version, isDefault } = view;
      return json(200, { items: [{ id, name, version, isDefault }] });
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
    if (request.method === 'POST' && path === '/v1/themes') {
      return json(200, {
        ...view,
        id: COPY,
        name: body!['name'],
        version: { id: 'cv1', number: '0.1' },
        isDefault: false,
      });
    }
    if (request.method === 'PUT' && path === `/v1/themes/${THEME}/name`) {
      return json(200, { ...view, name: body!['name'], version: { id: 'tv2', number: '0.12' } });
    }
    if (request.method === 'GET' && path === `/v1/themes/${THEME}/catalogues/character`) {
      return json(200, DOCUMENT);
    }
    if (request.method === 'POST' && path === `/v1/themes/${COPY}/default`) {
      return json(200, { ...view, id: COPY, name: 'Field manual', isDefault: true });
    }
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

  it("STY-072 duplicates a theme only once it is named, and declares the copy the environment's default", async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }));
    const asked = await screen.findByRole('dialog', { name: 'Duplicate Default' });
    const duplicate = within(asked).getByRole('button', { name: 'Duplicate' });
    expect(duplicate).toBeDisabled();
    await user.type(within(asked).getByRole('textbox', { name: 'Name' }), 'Field manual');
    await user.click(duplicate);
    expect(sent.find((each) => each.method === 'POST' && each.path === '/v1/themes')!.body).toEqual(
      {
        from: THEME,
        name: 'Field manual',
      },
    );
    expect(await screen.findByRole('heading', { name: 'Field manual' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Field manual made from Default.');

    await user.click(screen.getByRole('button', { name: "Use as the environment's default" }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Field manual is now the environment's default.",
    );
    expect(sent.some((each) => each.path === `/v1/themes/${COPY}/default`)).toBe(true);
  });

  it('STY-072 renames a theme', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    const asked = await screen.findByRole('dialog', { name: 'Rename Default' });
    const name = within(asked).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'House');
    await user.click(within(asked).getByRole('button', { name: 'Rename' }));
    expect(sent.find((each) => each.path === `/v1/themes/${THEME}/name`)!.body).toEqual({
      openedFrom: 'tv1',
      name: 'House',
    });
    expect(await screen.findByRole('heading', { name: 'House' })).toBeInTheDocument();

    // The default theme offers no declaring; it already is.
    expect(
      screen.queryByRole('button', { name: "Use as the environment's default" }),
    ).not.toBeInTheDocument();
  });

  it('STY-029 changes a character style without a release, its sample set as the editor sets the mark', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    const characters = await screen.findByRole('table', { name: 'Character styles' });
    await user.click(within(characters).getByRole('button', { name: 'Edit Inline code' }));
    const form = await screen.findByRole('form', { name: 'Character style Inline code' });
    expect(within(row(form, 'Scale')).getByRole('spinbutton', { name: 'Scale' })).toHaveValue(0.8);
    expect(within(row(form, 'Bold')).getByText('From the text it stands in')).toBeInTheDocument();

    await user.click(within(row(form, 'Bold')).getByRole('button', { name: 'Set here' }));
    await user.click(within(row(form, 'Bold')).getByRole('checkbox', { name: 'Bold' }));
    const sample = within(form).getByTestId('style-sample');
    expect(sample.querySelector('.aw-mark-inlineCode .aw-mark-run')).not.toBeNull();
    expect(sample.querySelector('style')!.textContent).toContain('.aw-mark-inlineCode');

    await user.click(within(form).getByRole('button', { name: 'Save style' }));
    const asked = await screen.findByRole('dialog', { name: 'Save Inline code?' });
    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    const put = sent.find((each) => each.method === 'PUT')!;
    expect(put.path).toBe(`/v1/themes/${THEME}/styles/character/inline-code`);
    expect(put.body!['style']).toEqual({
      id: 'inline-code',
      name: 'Inline code',
      mark: 'inlineCode',
      properties: { typeface: 'mono', scale: 0.8, bold: true },
    });
    expect(sent.find((each) => each.path === `/v1/themes/${THEME}/impact`)!.body).toEqual({
      kind: 'character',
      style: 'inline-code',
    });
  });

  it('STY-033 narrows the styles offered to authors, listing first the documents using what it drops', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    const offered = await screen.findByRole('group', { name: 'Paragraph styles offered' });
    expect(within(offered).getByRole('radio', { name: 'Every style' })).toBeChecked();
    await user.click(within(offered).getByRole('radio', { name: 'Only these' }));
    await user.click(within(offered).getByRole('checkbox', { name: 'Quotation' }));
    await user.click(screen.getByRole('button', { name: 'Save offered styles' }));

    const asked = await screen.findByRole('dialog', { name: 'Save the offered styles?' });
    expect(within(asked).getByText('Flush the line')).toBeInTheDocument();
    expect(sent.find((each) => each.path === `/v1/themes/${THEME}/impact`)!.body).toEqual({
      kind: 'paragraph',
      style: 'quotation',
    });
    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    const put = sent.find((each) => each.path === `/v1/themes/${THEME}/allowed`)!;
    const paragraphs = (
      view.catalogues.find((each) => (each.content as { kind: string }).kind === 'paragraph')!
        .content as { styles: { id: string; appliesTo: string[] }[] }
    ).styles
      // The styles an author chooses: a heading's, a caption's, are the template's.
      .filter((each) =>
        each.appliesTo.some((target) => (PLACES as readonly string[]).includes(target)),
      )
      .map((each) => each.id);
    expect(put.body).toEqual({
      openedFrom: 'tv1',
      allowed: { paragraph: paragraphs.filter((id) => id !== 'quotation') },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The offered styles saved: Default 0.12',
    );
  });

  it('STY-043 exports a catalogue as a file, and imports one into the theme as its next version', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return 'blob:catalogue';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    const catalogues = await screen.findByRole('group', { name: 'Catalogues' });
    await user.selectOptions(
      within(catalogues).getByRole('combobox', { name: 'Kind' }),
      'Character',
    );
    await user.click(within(catalogues).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(JSON.parse(await saved[0]!.text())).toEqual(DOCUMENT);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('default-character.json');
    click.mockRestore();

    const file = new File([JSON.stringify(DOCUMENT)], 'house.json', { type: 'application/json' });
    await user.upload(within(catalogues).getByLabelText('Import a catalogue'), file);
    await waitFor(() =>
      expect(sent.some((each) => each.path === `/v1/themes/${THEME}/catalogues/character`)).toBe(
        true,
      ),
    );
    const put = sent.find(
      (each) => each.method === 'PUT' && each.path === `/v1/themes/${THEME}/catalogues/character`,
    )!;
    expect(put.body).toEqual({ openedFrom: 'tv1', document: DOCUMENT });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Character catalogue imported: Default 0.12',
    );
  });

  it('STY-044 says every refusal of an import, and imports nothing', async () => {
    const user = userEvent.setup();
    const { client } = service({
      status: 400,
      code: 'style_refused',
      message: 'The theme would not read with the change.',
      refusals: [
        {
          code: 'catalogue_malformed',
          message: 'The catalogue does not read, at base: Unrecognized key: "kerning"',
        },
        {
          code: 'typeface_missing',
          message: 'The style lead is set in garamond, which the theme does not declare',
        },
      ],
    } as never);
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    const catalogues = await screen.findByRole('group', { name: 'Catalogues' });
    const file = new File([JSON.stringify(DOCUMENT)], 'house.json', { type: 'application/json' });
    await user.upload(within(catalogues).getByLabelText('Import a catalogue'), file);
    const said = await within(catalogues).findByRole('alert');
    expect(said).toHaveTextContent('Unrecognized key: "kerning"');
    expect(said).toHaveTextContent('garamond');
  });

  it('STY-044 refuses a file that is not JSON before anything is sent', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Themes client={client} />);
    const themes = await screen.findByRole('table', { name: 'Document themes' });
    await user.click(within(themes).getByRole('button', { name: 'Open Default' }));
    const catalogues = await screen.findByRole('group', { name: 'Catalogues' });
    const file = new File(['not json'], 'house.json', { type: 'application/json' });
    await user.upload(within(catalogues).getByLabelText('Import a catalogue'), file);
    expect(await within(catalogues).findByRole('alert')).toHaveTextContent(
      'house.json is not a catalogue document: it does not read as JSON.',
    );
    expect(sent.some((each) => each.path.includes('/catalogues/'))).toBe(false);
  });
});
