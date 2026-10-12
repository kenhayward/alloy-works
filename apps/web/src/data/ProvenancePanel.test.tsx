import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { bindingStatesIn } from '../structure/bindingContexts.js';
import { ProvenancePanel } from './ProvenancePanel.js';

const NODE = 'n'.repeat(26);

describe('the provenance of a value revised by hand (the RV plan, RV-I)', () => {
  it('DAT-062 gives both halves: the value as revised, what the query returned, and the revision by whom, when and why', () => {
    const state = bindingStatesIn({
      bindings: [
        {
          node: NODE,
          binding: {
            type: 'binding',
            id: 'v1',
            query: '44444444-4444-4444-8444-444444444441',
            parameters: {},
            mode: 'checked',
            take: { column: 'name' },
          },
          held: {
            resolution: '12',
            dataset: '55555555-5555-4555-8555-555555555555',
            version: '66666666-6666-4666-8666-666666666666',
            number: '0.1',
            provenance: {
              parameters: {},
              ran: { sql: null },
              identity: { kind: 'service' },
              at: '2026-10-05T09:00:00.000Z',
              rowCount: 1,
              checksum: '0'.repeat(64),
            },
            name: null,
            stale: false,
            taken: { value: 'Atlas', column: { name: 'name', type: { base: 'text' } } },
            act: 'resolve',
            keepable: false,
            by: { id: 'p', displayName: 'Ada' },
            at: '2026-10-05T09:00:00.000Z',
          },
          waiting: null,
          definition: { title: 'Sites', version: '0.2' },
          connection: null,
          definitionChanged: false,
          sincePublished: null,
          mayCheck: true,
          mayResolve: true,
          revisions: [
            {
              id: '7',
              cell: null,
              value: 'Atlas Quay',
              reason: 'The site was renamed.',
              by: { id: 'p', displayName: 'Grace' },
              at: '2026-10-12T09:00:00.000Z',
              stands: true,
            },
          ],
        },
      ],
    })![0]!;
    render(
      <ProvenancePanel
        client={createApiClient({ baseUrl: 'http://provenance.test' })}
        document="99999999-9999-4999-8999-999999999999"
        language="en-GB"
        state={state}
        onClose={() => undefined}
      />,
    );
    const term = (words: string) => screen.getByText(words, { selector: 'dt' }).nextElementSibling;
    expect(term('Value')).toHaveTextContent('Atlas Quay');
    expect(term('As the query returned it')).toHaveTextContent('Atlas');
    expect(term('Revised by hand')).toHaveTextContent(
      /^Atlas Quay, by Grace, .+: The site was renamed\.$/,
    );
  });
});
