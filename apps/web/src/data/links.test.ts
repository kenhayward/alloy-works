import { describe, expect, it } from 'vitest';

import {
  connectionAddress,
  connectionLink,
  queryDefinitionAddress,
  queryDefinitionLink,
  queryDefinitionTab,
} from './links.js';

const ID = 'ffffffff-0000-4000-8000-000000000002';

describe("a detail page's address", () => {
  it("names a connection's tab after its id, or none for the first, and its access page apart", () => {
    expect(connectionAddress(`#/connections/${ID}/tables`)).toEqual({
      connection: ID,
      access: false,
      tab: 'tables',
    });
    expect(connectionAddress(`#/connections/${ID}`)).toEqual({
      connection: ID,
      access: false,
      tab: null,
    });
    expect(connectionAddress(`#/connections/${ID}/access`)).toEqual({
      connection: ID,
      access: true,
      tab: null,
    });
    expect(connectionAddress(`#/connections/${ID}/Tables`)).toBeNull();
    expect(connectionLink(ID, 'used-by')).toBe(`#/connections/${ID}/used-by`);
    expect(connectionLink(ID)).toBe(`#/connections/${ID}`);
  });

  it("names a query definition's tab after its id, the definition itself unchanged", () => {
    expect(queryDefinitionAddress(`#/query-definitions/${ID}/sample`)).toBe(ID);
    expect(queryDefinitionTab(`#/query-definitions/${ID}/sample`)).toBe('sample');
    expect(queryDefinitionTab(`#/query-definitions/${ID}`)).toBeNull();
    expect(queryDefinitionAddress('#/query-definitions/new/query')).toBe('new');
    expect(queryDefinitionAddress(`#/query-definitions/${ID}/`)).toBeNull();
    expect(queryDefinitionLink(ID, 'columns')).toBe(`#/query-definitions/${ID}/columns`);
  });
});
