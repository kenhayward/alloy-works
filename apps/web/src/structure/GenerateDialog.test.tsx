import { createApiClient } from '@alloy-works/api-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GenerateDialog } from './GenerateDialog.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SPACE = '00000000-0000-4000-8000-0000000000e1';
const TEMPLATE = '00000000-0000-4000-8000-0000000000e2';
const COHORT = '00000000-0000-4000-8000-0000000000e3';

function service() {
  const asked: { path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push({ path: url.pathname, body: JSON.parse(await request.text()) as unknown });
    return json(200, { cohort: { id: COHORT }, job: { id: 'j1' } });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://generate.test', fetch: fetching }), asked };
}

describe('Generate documents (the R7 plan, R7-B, R7-C)', () => {
  it('REU-031 REU-032 asks for a document for each row of a CSV file, titled from a pattern', async () => {
    const { client, asked } = service();
    const generated = vi.fn();
    render(
      <GenerateDialog
        client={client}
        template={{ id: TEMPLATE, name: 'Site report', space: SPACE }}
        onGenerated={generated}
        onCancel={() => undefined}
      />,
    );
    const file = new File(['site,name\n1,Harbour\n2,Quay\n'], 'sites.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('A CSV file of rows'), { target: { files: [file] } });
    expect(await screen.findByText('2 rows, giving site, name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Each title')).toHaveValue('Site report: {site}');
    await userEvent.click(screen.getByRole('button', { name: 'Generate 2 documents' }));
    await waitFor(() => expect(generated).toHaveBeenCalledWith(COHORT));
    expect(asked).toEqual([
      {
        path: `/v1/spaces/${SPACE}/cohorts`,
        body: {
          template: TEMPLATE,
          title: 'Site report: {site}',
          language: 'en-GB',
          direction: 'ltr',
          rows: [
            { site: '1', name: 'Harbour' },
            { site: '2', name: 'Quay' },
          ],
        },
      },
    ]);
  });

  it('TPL-047 asks for a run that stops at the first failed row where the requester ticks it, and carries on otherwise', async () => {
    const { client, asked } = service();
    render(
      <GenerateDialog
        client={client}
        template={{ id: TEMPLATE, name: 'Site report', space: SPACE }}
        onGenerated={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await userEvent.type(screen.getByLabelText('Or paste the rows'), 'site{enter}1{enter}2');
    const stop = screen.getByRole('checkbox', { name: 'Stop at the first row that fails' });
    expect(stop).not.toBeChecked();
    await userEvent.click(stop);
    await userEvent.click(screen.getByRole('button', { name: 'Generate 2 documents' }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]!.body).toMatchObject({ onFailure: 'stop' });
  });

  it('says what is wrong with pasted rows, and asks for nothing', async () => {
    const { client, asked } = service();
    render(
      <GenerateDialog
        client={client}
        template={{ id: TEMPLATE, name: 'Site report', space: SPACE }}
        onGenerated={() => undefined}
        onCancel={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('Or paste the rows'), {
      target: { value: 'site\n1,2' },
    });
    expect(
      screen.getByText('Line 2 has more cells than the first line names.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate documents' })).toBeDisabled();
    expect(asked).toEqual([]);
  });
});
