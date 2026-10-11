import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordedOutputs } from './recorded.js';

let directory = '';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alloy-recorded-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);
// SHA-256 of 'first' and 'second'.
const FIRST = 'a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e';
const SECOND = '16367aacb67a4a017c8da8ab95682ccb390863780f7114dda0a0e0c55644c7c4';

const pinsAt = async (pins: Record<string, string>) => {
  const path = join(directory, 'outputs.json');
  await writeFile(path, JSON.stringify(pins));
  return path;
};

describe('the recorded outputs of the publishing regression corpus', () => {
  // Cites PUB-075 once phase 3 adds baselines to the set and publishing.md claims it (the AU2 plan, AU-L).
  it('passes an output whose bytes are those recorded for its case, and fails one that differs, naming the case and keeping its bytes', async () => {
    const pins = await pinsAt({ 'case-1-1.pdf': FIRST, 'case-1-2.pdf': FIRST });
    const kept = join(directory, 'kept');
    const outputs = await recordedOutputs({ pins, mode: 'check', keep: kept });

    outputs.check('the corpus > case 1', 'pdf', bytes('first'));
    expect(() => outputs.check('the corpus > case 1', 'pdf', bytes('second'))).toThrow(
      /case-1-2\.pdf differs from its recorded output/,
    );
    expect(await readdir(kept)).toEqual(['case-1-2.pdf']);
    expect(await readFile(join(kept, 'case-1-2.pdf'), 'utf8')).toBe('second');
  });

  it('fails an output with nothing recorded for it, saying how to record it', async () => {
    const outputs = await recordedOutputs({ pins: await pinsAt({}), mode: 'check' });
    expect(() => outputs.check('case 2', 'docx', bytes('first'))).toThrow(
      /case-2-1\.docx has no recorded output: record it with `pnpm --filter @alloy-works\/worker record`/,
    );
  });

  it('counts each case from one again when it runs again, as a retried test does', async () => {
    const outputs = await recordedOutputs({
      pins: await pinsAt({ 'case-1-1.pdf': FIRST }),
      mode: 'check',
    });
    outputs.check('case 1', 'pdf', bytes('first'));
    outputs.reset();
    outputs.check('case 1', 'pdf', bytes('first'));
  });

  it('records what is new without rewriting what is recorded, and accepts a difference only when told to', async () => {
    const pins = await pinsAt({ 'case-1-1.pdf': FIRST });
    const recording = await recordedOutputs({ pins, mode: 'record' });
    recording.check('case 2', 'pdf', bytes('second'));
    expect(() => recording.check('case 1', 'pdf', bytes('second'))).toThrow(/differs/);
    await recording.write();
    expect(JSON.parse(await readFile(pins, 'utf8'))).toEqual({
      'case-1-1.pdf': FIRST,
      'case-2-1.pdf': SECOND,
    });

    const accepting = await recordedOutputs({ pins, mode: 'accept' });
    accepting.check('case 1', 'pdf', bytes('second'));
    await accepting.write();
    expect(JSON.parse(await readFile(pins, 'utf8'))['case-1-1.pdf']).toBe(SECOND);
  });

  it('writes nothing when checking', async () => {
    const pins = await pinsAt({ 'case-1-1.pdf': FIRST });
    const outputs = await recordedOutputs({ pins, mode: 'check' });
    expect(() => outputs.check('case 3', 'pdf', bytes('first'))).toThrow();
    await outputs.write();
    expect(JSON.parse(await readFile(pins, 'utf8'))).toEqual({ 'case-1-1.pdf': FIRST });
  });
});
