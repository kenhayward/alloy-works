/**
 * The browser suite in parts, so CI runs each against a stack of its own at once rather than every file
 * after the one before. Balanced by CI's own times (the 0.220.0 full run, 1018 s): accessibility alone
 * is about 310 s, and each other part is held near it. `rest` runs every file no part names, so a new
 * file runs somewhere without being listed. Unset, the whole suite runs, as on a person's machine.
 */
export const BROWSER_PARTS = {
  accessibility: ['src/accessibility.test.ts'],
  navigation: [
    'src/navigation.test.ts',
    'src/api-documentation.test.ts',
    'src/values.test.ts',
    'src/outline.test.ts',
    'src/bound-tables.test.ts',
  ],
  surfaces: [
    'src/pseudo.test.ts',
    'src/document-arguments.test.ts',
    'src/message-forms.test.ts',
    'src/canvas.test.ts',
    'src/html.test.ts',
    'src/data-tab.test.ts',
    'src/styles.test.ts',
    'src/parameters.test.ts',
    'src/table-notes.test.ts',
    'src/placing.test.ts',
    'src/audit.test.ts',
  ],
} as const satisfies Record<string, readonly string[]>;

export interface BrowserPart {
  /** The files this part runs, or null for every file `without` leaves. */
  readonly only: readonly string[] | null;
  readonly without: readonly string[];
  /** Its report's name in `.trace-results`. */
  readonly report: string;
}

/** The part `ALLOY_BROWSER_PART` names, or the whole suite where it is unset. */
export function browserPart(name: string | undefined): BrowserPart {
  if (name === undefined || name === '') return { only: null, without: [], report: 'browser.json' };
  if (name === 'rest') {
    return {
      only: null,
      without: Object.values(BROWSER_PARTS).flat(),
      report: 'browser-rest.json',
    };
  }
  if (!Object.hasOwn(BROWSER_PARTS, name)) {
    const known = [...Object.keys(BROWSER_PARTS), 'rest'].join(', ');
    throw new Error(`ALLOY_BROWSER_PART is "${name}": one of ${known}.`);
  }
  return {
    only: BROWSER_PARTS[name as keyof typeof BROWSER_PARTS],
    without: [],
    report: `browser-${name}.json`,
  };
}
