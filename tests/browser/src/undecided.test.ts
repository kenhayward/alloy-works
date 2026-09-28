import { describe, expect, it } from 'vitest';
import { undecided } from './undecided.js';

/** A report as Vitest's JSON reporter writes one, narrowed to what `undecided` reads. */
const report = {
  testResults: [
    {
      name: 'D:/checkout/tests/browser/src/accessibility.test.ts',
      assertionResults: [
        {
          fullName: 'the editor',
          meta: {
            axe: {
              engine: '4.13.0',
              incomplete: {
                'the editor as opened': [
                  { state: 'the editor as opened', rule: 'color-contrast', target: '.a' },
                  { state: 'the editor as opened', rule: 'color-contrast', target: '.b' },
                ],
                'a dialog open': [],
              },
            },
          },
        },
        { fullName: 'a test that ran no axe', meta: {} },
      ],
    },
    {
      name: 'src/outline.test.ts',
      assertionResults: [
        {
          fullName: 'the outline',
          meta: {
            axe: {
              engine: '4.13.0',
              incomplete: {
                'a section added': [
                  { state: 'a section added', rule: 'link-in-text-block', target: 'a' },
                ],
              },
            },
          },
        },
      ],
    },
  ],
};

describe('what axe could not decide, for the audit a person makes', () => {
  it('lists each state axe left something undecided in, with each rule and element, and counts them by rule', () => {
    expect(undecided(report)).toEqual([
      'axe 4.13.0 checked 3 states and left 3 elements for a person, in 2 of them.',
      '',
      'color-contrast: 2',
      'link-in-text-block: 1',
      '',
      'the editor as opened (src/accessibility.test.ts, the editor)',
      '  color-contrast at .a',
      '  color-contrast at .b',
      'a section added (src/outline.test.ts, the outline)',
      '  link-in-text-block at a',
    ]);
  });

  it('says so where the report holds no axe run at all', () => {
    expect(undecided({ testResults: [] })).toEqual([
      'The report holds no axe run: run pnpm test:browser against the stack first.',
    ]);
  });
});
