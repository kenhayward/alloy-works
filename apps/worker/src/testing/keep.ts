import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Typst } from '../typst.js';

/**
 * The corpus's Typst, keeping every PDF it compiles in `directory` for a person to open in a reader:
 * the Matterhorn review PUB-104 asks for is made on the corpus's PDFs (docs/guides/auditing-a-release.md),
 * and the suite otherwise keeps none. Each file is named by the case that compiled it, `name()` asked at
 * the compile - its own title, not its describe's - and numbered in the order that case compiled them. With no directory, Typst as it was.
 */
export function keepingEach(
  typst: Typst,
  directory: string | undefined,
  name: () => string,
): Typst {
  if (directory === undefined || directory === '') return typst;
  const counts = new Map<string, number>();
  return {
    version: () => typst.version(),
    async compile(template, data, createdAt, images) {
      const pdf = await typst.compile(template, data, createdAt, images);
      // The test's own title, after the last ` > `: a describe's title is shared by every test in it,
      // and a long one would fill the name and leave its tests told apart by a number alone.
      const slug = (name().split(' > ').pop() ?? '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 120)
        .toLowerCase();
      const count = (counts.get(slug) ?? 0) + 1;
      counts.set(slug, count);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${slug}-${count}.pdf`), pdf);
      return pdf;
    },
  };
}
