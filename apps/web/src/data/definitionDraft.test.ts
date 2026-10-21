import type { QueryDefinition } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { definitionOf, draftOf, extensionRequestOf, sqlOf } from './definitionDraft.js';

const GAUGES = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';

const onExtension = {
  schemaVersion: 1,
  title: 'Gauge readings',
  description: '',
  connection: GAUGES,
  parameters: [],
  fetch: { kind: 'extension', request: { readings: 'daily', sites: ['north'] } },
  columns: [{ name: 'site', from: { pointer: '/site' }, type: { base: 'text' } }],
  key: [],
  order: 'multiset',
  empty: 'valid',
  limits: { rows: 1000, bytes: 1048576, seconds: 30 },
  retired: false,
} as unknown as QueryDefinition;

describe("an extension's definition as its page holds it (the EX plan, EX-G)", () => {
  it('opens and saves an extension definition as it was, its request and its pointers kept', () => {
    const draft = draftOf(onExtension);
    expect(draft.mode).toBe('extension');
    expect(definitionOf(draft)).toEqual(onExtension);
    expect(sqlOf(onExtension)).toContain('"readings": "daily"');
  });

  it('takes a request that is a JSON object of at most 64 KiB, and says why not otherwise', () => {
    expect(extensionRequestOf('{"a": 1}')).toEqual({ a: 1 });
    expect(extensionRequestOf('[1]')).toBe('The request is a JSON object, in braces.');
    expect(extensionRequestOf('{')).toBe('The request is not JSON: check its brackets and quotes.');
    expect(extensionRequestOf(`{"a": "${'x'.repeat(64 * 1024)}"}`)).toBe(
      'The request is at most 64 KiB.',
    );
  });
});
