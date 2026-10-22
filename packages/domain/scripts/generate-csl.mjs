// Rewrites src/library/csl/files.ts from the CSL files beside it. Run after one changes;
// files.test.ts fails until it has been.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const root = new URL('../src/library/csl/', import.meta.url);
const read = (dir, pattern) =>
  Object.fromEntries(
    readdirSync(new URL(dir, root))
      .filter((name) => pattern.test(name))
      .sort()
      .map((name) => [
        name.replace(pattern, '$1'),
        readFileSync(new URL(dir + name, root), 'utf8'),
      ]),
  );
const lines = (record) =>
  Object.entries(record)
    .map(([name, xml]) => `  ${JSON.stringify(name)}: ${JSON.stringify(xml)},`)
    .join('\n');

const keys = (record) =>
  Object.keys(record)
    .map((name) => JSON.stringify(name).replace(/"/g, "'"))
    .join(' | ');
const styles = read('styles/', /^(.+)\.csl$/);
const locales = read('locales/', /^locales-(.+)\.xml$/);

writeFileSync(
  new URL('files.ts', root),
  `// Generated from the files beside it by \`pnpm --filter @alloy-works/domain generate\`, and compared
// with them in files.test.ts. Licences: README.md.

/** The seeded styles' CSL, by file name. */
export const SEEDED_STYLE_FILES: Readonly<Record<${keys(styles)}, string>> = {
${lines(styles)}
};

/** The CSL locales bundled, by language tag. */
export const CSL_LOCALES: Readonly<Record<${keys(locales)}, string>> = {
${lines(locales)}
};
`,
);
