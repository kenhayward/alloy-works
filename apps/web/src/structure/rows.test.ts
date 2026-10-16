import { describe, expect, it } from 'vitest';

import { rowsFrom } from './rows.js';

describe('rows read from a file or a pasted list (the R7 plan, R7-B)', () => {
  it('REU-032 reads a CSV, its first line naming the parameters, each line after it a row', () => {
    expect(rowsFrom('site,name\n1,Harbour\n2,"Quay, north"\n')).toEqual({
      ok: true,
      names: ['site', 'name'],
      rows: [
        { site: '1', name: 'Harbour' },
        { site: '2', name: 'Quay, north' },
      ],
    });
  });

  it('reads a list pasted from a spreadsheet, by tabs, and leaves an empty cell out of its row', () => {
    expect(rowsFrom('site\tname\r\n1\t\r\n\r\n2\tQuay')).toEqual({
      ok: true,
      names: ['site', 'name'],
      rows: [{ site: '1' }, { site: '2', name: 'Quay' }],
    });
  });

  it('says why where there is nothing to read, or a line holds more cells than the first names', () => {
    expect(rowsFrom('')).toEqual({ ok: false, problem: 'There are no rows to read.' });
    expect(rowsFrom('site\n')).toEqual({ ok: false, problem: 'There are no rows to read.' });
    expect(rowsFrom('site\n1,2')).toEqual({
      ok: false,
      problem: 'Line 2 has more cells than the first line names.',
    });
    expect(rowsFrom('site,\n1,2')).toEqual({
      ok: false,
      problem: 'The first line names a parameter twice, or leaves one unnamed.',
    });
  });
});
