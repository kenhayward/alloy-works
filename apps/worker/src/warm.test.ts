import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  type ContentDocument,
} from '@alloy-works/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts, readPinnedFaces } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { defaultTheme } from './testing/theme.js';
import { createTypst, typstBinaryPath } from './typst.js';
import { PREVIEW_PPI, startWarmCompile, type WarmCompile } from './warm.js';

const run = promisify(execFile);
const fonts = await loadPinnedFonts();
const binary = typstBinaryPath();
const typst = createTypst({ binary, fonts });
const at = new Date('2026-10-18T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const CHAPTERS = 12;

const PROSE =
  'Ada checked each pump against the log, noting the pressure, the flow and the temperature at the inlet and the outlet before signing the sheet for Grace. ';

/** A chapter of prose, its first paragraph `lead`. */
const chapter = (at: number, lead: string): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: `Chapter ${at + 1}`,
    language: 'en-GB',
    direction: 'ltr',
    content: Array.from({ length: 30 }, (_, index) => ({
      type: 'paragraph',
      id: `p${index}`,
      style: 'body',
      content: [{ type: 'text', value: index === 0 ? lead : PROSE.repeat(3), marks: [] }],
    })),
  });

/** The document the job would hand the template: twelve chapters, the sixth's lead `lead`. */
function documentWith(lead: string): string {
  const nodes = Array.from({ length: CHAPTERS }, (_, at) => ({
    type: 'reference' as const,
    id: id(`chapter${String.fromCharCode(97 + at)}`),
    component: `00000000-0000-4000-8000-${String(at + 1).padStart(12, '0')}`,
    mode: { kind: 'latest' as const },
    numbered: true,
    matter: 'body' as const,
    pageBreak: 'none' as const,
    values: {},
    children: [],
  }));
  const made = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The pump log',
      language: 'en-GB',
      direction: 'ltr',
      nodes,
    }),
    occurrences: new Map(nodes.map((node, at) => [node.id, chapter(at, at === 5 ? lead : PROSE)])),
    refused: [],
    layout: parseLayout({
      ...defaultLayout,
      matter: { cover: false, contents: null, appendices: { newPage: false }, lists: [] },
    }),
    theme: defaultTheme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  return JSON.stringify(made.document);
}

const template = (data: string) =>
  PUBLICATION_TEMPLATE[TEMPLATE_READING[(JSON.parse(data) as { schema: 'publishing/1' }).schema]]
    .file;

/** A clean compile of the same input into PNG pages, as a cold Typst makes them. */
async function cleanPages(data: string): Promise<Buffer[]> {
  const root = await mkdtemp(join(tmpdir(), 'aw-clean-'));
  try {
    await copyFile(template(data), join(root, 'main.typ'));
    await writeFile(join(root, 'data.json'), data);
    await mkdir(join(root, 'fonts'));
    for (const face of await readPinnedFaces(fonts.directory)) {
      await writeFile(join(root, 'fonts', face.file), face.bytes);
    }
    await mkdir(join(root, 'pages'));
    await run(
      binary,
      [
        'compile',
        '--root',
        root,
        '--ignore-system-fonts',
        '--ignore-embedded-fonts',
        '--font-path',
        join(root, 'fonts'),
        '--features',
        'a11y-extras',
        '--creation-timestamp',
        String(Math.floor(at.getTime() / 1000)),
        '--ppi',
        String(PREVIEW_PPI),
        join(root, 'main.typ'),
        join(root, 'pages', 'page-{p}.png'),
      ],
      { env: {} },
    );
    const files = (await readdir(join(root, 'pages'))).sort(
      (a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]),
    );
    return Promise.all(files.map((file) => readFile(join(root, 'pages', file))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('the warm range preview compile (the R22 plan, R22-A)', () => {
  let warm: WarmCompile | undefined;

  afterAll(async () => {
    await warm?.close();
  });

  it('PUB-076 compiles an edit warm to the same bytes, page for page, as a clean compile of the same input', async () => {
    const before = documentWith(PROSE);
    const started = await startWarmCompile({
      binary,
      fonts,
      template: template(before),
      data: before,
      createdAt: at,
    });
    warm = started.warm;
    expect(started.first.pages).toBeGreaterThan(20);

    // An edit in the sixth chapter: rewritten from where it lands, and nothing before it.
    const after = documentWith(`Grace replaced the seal on pump four. ${PROSE.repeat(4)}`);
    const edited = await warm.update(after);
    expect(edited.changed.length).toBeGreaterThan(0);
    expect(edited.changed[0]).toBeGreaterThan(1);

    const clean = await cleanPages(after);
    expect(edited.pages).toBe(clean.length);
    for (let page = 1; page <= clean.length; page += 1) {
      expect((await warm.page(page)).equals(clean[page - 1]!), `page ${page}`).toBe(true);
    }
  }, 120_000);

  it('PUB-076 publishes the same PDF from a warm compile as from a clean one of the same input', async () => {
    // The tagged PDF as a publish makes it, compiled twice cold, and once warm through `typst watch`
    // over the earlier input first: the bytes of the three are one.
    const before = documentWith(PROSE);
    const after = documentWith(`Grace replaced the seal on pump four. ${PROSE}`);
    const clean = await typst.compile(template(after), after, at);
    expect((await typst.compile(template(after), after, at)).equals(clean)).toBe(true);

    const root = await mkdtemp(join(tmpdir(), 'aw-warm-pdf-'));
    try {
      await copyFile(template(before), join(root, 'main.typ'));
      await writeFile(join(root, 'data.json'), before);
      await mkdir(join(root, 'fonts'));
      for (const face of await readPinnedFaces(fonts.directory)) {
        await writeFile(join(root, 'fonts', face.file), face.bytes);
      }
      const watched = execFile(
        binary,
        [
          'watch',
          '--root',
          root,
          '--ignore-system-fonts',
          '--ignore-embedded-fonts',
          '--font-path',
          join(root, 'fonts'),
          '--package-path',
          join(root, 'no-packages'),
          '--package-cache-path',
          join(root, 'no-packages'),
          '--pdf-standard',
          'ua-1',
          '--features',
          'a11y-extras',
          '--creation-timestamp',
          String(Math.floor(at.getTime() / 1000)),
          '--diagnostic-format',
          'short',
          '--no-serve',
          join(root, 'main.typ'),
          join(root, 'out.pdf'),
        ],
        { env: {} },
      );
      let said = '';
      let ended = 0;
      const compiles = (count: number) =>
        new Promise<void>((resolve) => {
          const hear = (chunk: Buffer | string) => {
            said += String(chunk);
            ended = (said.match(/compiled (successfully|with warnings)/g) ?? []).length;
            if (ended >= count) resolve();
          };
          watched.stdout?.on('data', hear);
          watched.stderr?.on('data', hear);
        });
      await compiles(1);
      await writeFile(join(root, 'data.json'), after);
      await compiles(2);
      watched.kill();
      expect((await readFile(join(root, 'out.pdf'))).equals(clean)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
