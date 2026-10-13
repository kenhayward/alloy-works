import { createApiClient } from '@alloy-works/api-client';
import { OUTLINE_SCHEMA_VERSION } from '@alloy-works/domain';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentVersionPage, DocumentVersionPage } from './VersionPages.js';

const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const EARLIER = 'eeeeeeee-0000-4000-8000-000000000001';
const LATEST = 'eeeeeeee-0000-4000-8000-000000000002';
const SECTION = 'ssssssssssssssssssssssssss';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';
const base = { numbered: true, matter: 'body', pageBreak: 'none', values: {}, children: [] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const clientAnswering = (status: number, body: unknown, asked: string[] = []) =>
  createApiClient({
    baseUrl: 'http://acme.test',
    fetch: (async (input: Request) => {
      asked.push(new URL(input.url).pathname);
      return json(status, body);
    }) as unknown as typeof fetch,
  });

const heading = (id: string, number: string) => ({
  id,
  number,
  createdAt: '2026-10-02T09:00:00.000Z',
  note: null,
  author: { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Ada' },
});

afterEach(() => {
  window.location.hash = '';
});

describe('one earlier version, read only', () => {
  it("SCH-058 shows a component's earlier version at the block its address names, and names the latest", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const asked: string[] = [];
    render(
      <StrictMode>
        <ComponentVersionPage
          client={clientAnswering(
            200,
            {
              component: COMPONENT,
              title: 'Pump checks',
              version: heading(EARLIER, '1.3'),
              latest: { id: LATEST, number: '1.7' },
              content: {
                schemaVersion: 1,
                title: 'Pump checks',
                language: 'en-GB',
                direction: 'ltr',
                content: [
                  {
                    type: 'paragraph',
                    id: 'p1',
                    style: 'body',
                    content: [{ type: 'text', value: 'Prime the quokka valve', marks: [] }],
                  },
                ],
              },
              values: {},
              archived: false,
            },
            asked,
          )}
          component={COMPONENT}
          version={EARLIER}
          block="p1"
        />
      </StrictMode>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Pump checks' })).toBeVisible();
    expect(await screen.findByText('Prime the quokka valve')).toBeInTheDocument();
    expect(
      screen.getByText('An earlier version, 1.3, by Ada on 2 October 2026. The latest is 1.7.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the latest' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}`,
    );
    expect(document.querySelector('[data-block="p1"]')).toHaveAttribute('data-marked', 'true');
    expect(scrolled).toHaveBeenCalled();
    expect(asked.every((path) => path === `/v1/components/${COMPONENT}/versions/${EARLIER}`)).toBe(
      true,
    );
  });

  it("opens the live page for the latest version's address", async () => {
    render(
      <ComponentVersionPage
        client={clientAnswering(200, {
          component: COMPONENT,
          title: 'Pump checks',
          version: heading(LATEST, '1.7'),
          latest: { id: LATEST, number: '1.7' },
          content: {
            schemaVersion: 1,
            title: 'x',
            language: 'en-GB',
            direction: 'ltr',
            content: [],
          },
          values: {},
          archived: false,
        })}
        component={COMPONENT}
        version={LATEST}
        block="p1"
      />,
    );
    await vi.waitFor(() =>
      expect(window.location.hash).toBe(`#/components/${COMPONENT}/blocks/p1`),
    );
  });

  it('says when there is no such version, or it has been deleted', async () => {
    const { unmount } = render(
      <ComponentVersionPage
        client={clientAnswering(404, { code: 'not_found', message: 'x', traceId: 't' })}
        component={COMPONENT}
        version={EARLIER}
        block={null}
      />,
    );
    expect(await screen.findByText('There is no such version.')).toBeInTheDocument();
    unmount();
    render(
      <DocumentVersionPage
        client={clientAnswering(410, { code: 'artifact_deleted', message: 'x', traceId: 't' })}
        document={DOCUMENT}
        version={EARLIER}
        node={null}
      />,
    );
    expect(await screen.findByText('This document has been deleted.')).toBeInTheDocument();
  });

  it("SCH-058 shows a document's earlier version, its outline at the node its address names, a component it may not read withheld", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <DocumentVersionPage
        client={clientAnswering(200, {
          document: DOCUMENT,
          title: 'Field report',
          version: heading(EARLIER, '0.2'),
          latest: { id: LATEST, number: '0.5' },
          outline: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'Field report',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [
              {
                type: 'section',
                id: SECTION,
                title: [{ type: 'text', value: 'Dunnart findings', marks: [] }],
                ...base,
              },
              { type: 'reference', id: HIDDEN, component: null, mode: { kind: 'latest' }, ...base },
            ],
          },
          titles: [],
          values: {},
          archived: false,
        })}
        document={DOCUMENT}
        version={EARLIER}
        node={SECTION}
      />,
    );
    expect(await screen.findByText('Dunnart findings')).toBeInTheDocument();
    expect(screen.getByText('A component you cannot open')).toBeInTheDocument();
    expect(
      screen.getByText('An earlier version, 0.2, by Ada on 2 October 2026. The latest is 0.5.'),
    ).toBeInTheDocument();
    expect(document.querySelector(`[data-node="${SECTION}"]`)).toHaveAttribute(
      'data-marked',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Open the latest' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
  });
});
