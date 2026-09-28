import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Typst } from '../typst.js';
import { keepingEach } from './keep.js';

/** A Typst that answers each compile with the data it was given, as though that were the PDF. */
const echo: Typst = {
  version: async () => '0.0.0',
  compile: async (_template, data) => Buffer.from(data),
};

let directory: string | null = null;
afterEach(async () => {
  if (directory !== null) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe("keeping the corpus's PDFs for a person to read", () => {
  it('leaves Typst as it is where no directory is given', () => {
    expect(keepingEach(echo, undefined, () => 'a case')).toBe(echo);
  });

  it('writes each PDF compiled into the directory, named by the case that compiled it and numbered in order', async () => {
    directory = await mkdtemp(join(tmpdir(), 'alloy-keep-'));
    const kept = join(directory, 'corpus');
    let name = 'case 1: headings, a list / and a figure';
    const typst = keepingEach(echo, kept, () => name);

    expect((await typst.compile('t', 'first', new Date())).toString()).toBe('first');
    await typst.compile('t', 'second', new Date());
    name = 'the keep rules > keep-with-next';
    await typst.compile('t', 'third', new Date());

    expect((await readdir(kept)).sort()).toEqual([
      'case-1-headings-a-list-and-a-figure-1.pdf',
      'case-1-headings-a-list-and-a-figure-2.pdf',
      'the-keep-rules-keep-with-next-1.pdf',
    ]);
    expect(await readFile(join(kept, 'case-1-headings-a-list-and-a-figure-2.pdf'), 'utf8')).toBe(
      'second',
    );
  });
});
