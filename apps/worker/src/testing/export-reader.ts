import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

/**
 * **An archive read as an outsider would** (IMP-043): written from `docs/guides/export-format.md`
 * alone. It imports Node and nothing of this product, and a test holds it to that, so what it can read
 * is what the guide says rather than what the product happens to do.
 */

export interface ReadArchive {
  readonly entries: readonly string[];
  readonly bytes: (name: string) => Buffer | undefined;
  readonly manifest: Record<string, unknown>;
  readonly schema: Record<string, unknown>;
  readonly secrets: readonly Record<string, string>[];
  readonly rows: (table: string) => readonly Record<string, unknown>[];
}

/** The guide's "Opening an archive": 512-byte blocks, an entry's size in octal at offset 124. */
function readTar(archive: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let at = 0;
  let paxSize: number | undefined;
  while (at + 512 <= archive.length) {
    const block = archive.subarray(at, at + 512);
    if (block.every((byte) => byte === 0)) break;
    const name = block.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const type = block.toString('utf8', 156, 157);
    const size = parseInt(block.toString('utf8', 124, 135), 8);
    const body = at + 512;
    const content = archive.subarray(body, body + (paxSize ?? size));
    if (type === 'x') {
      const match = /\d+ size=(\d+)\n/.exec(archive.toString('utf8', body, body + size));
      paxSize = match ? Number(match[1]) : undefined;
      at = body + Math.ceil(size / 512) * 512;
      continue;
    }
    files.set(name, content);
    at = body + Math.ceil((paxSize ?? size) / 512) * 512;
    paxSize = undefined;
  }
  return files;
}

export function readArchive(archive: Buffer): ReadArchive {
  const files = readTar(archive);
  const lines = (text: string) =>
    text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    entries: [...files.keys()],
    bytes: (name) => files.get(name),
    manifest: JSON.parse(files.get('manifest.json')!.toString('utf8')) as Record<string, unknown>,
    schema: JSON.parse(files.get('schema.json')!.toString('utf8')) as Record<string, unknown>,
    secrets: lines(files.get('secrets.jsonl')!.toString('utf8')) as Record<string, string>[],
    rows: (table) => lines(gunzipSync(files.get(`tables/${table}.jsonl.gz`)!).toString('utf8')),
  };
}

const lower = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The guide's "Checking a version": members sorted, strings in NFC, no whitespace. */
function canonical(value: unknown, marksAreASet: boolean): string {
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) {
    return `[${value.map((each) => canonical(each, marksAreASet)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      lower(a, b),
    );
    return `{${members
      .map(([name, member]) => {
        const ordered =
          marksAreASet && name === 'marks' && Array.isArray(member)
            ? [...(member as { type: string; id: string }[])].sort(
                (a, b) => lower(a.type, b.type) || lower(a.id, b.id),
              )
            : member;
        return `${JSON.stringify(name)}:${canonical(ordered, marksAreASet)}`;
      })
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const TEXT_KINDS = new Set(['component', 'document', 'template']);

/** The guide's `content_hash`: the SHA-256 of the content's canonical text. */
export const contentHashOf = (version: Record<string, unknown>): string =>
  sha256(canonical(version['content'], TEXT_KINDS.has(version['kind'] as string)));

/**
 * The guide's `version_digest`: the SHA-256 of one object of the version's canonical parts, its
 * definitions being the rows of `version_definition` naming it.
 */
export function versionDigestOf(
  version: Record<string, unknown>,
  definitions: readonly Record<string, unknown>[],
): string {
  const refs = definitions
    .map((each) => ({
      id: each['definition_artifact_id'] as string,
      kind: each['definition_kind'] as string,
      version: each['definition_version_id'] as string,
    }))
    .sort((a, b) => lower(a.kind, b.kind) || lower(a.id, b.id) || lower(a.version, b.version));
  const type = refs.find((each) => each.kind === 'componentType');
  const parameters = (version['parameters'] ?? {}) as Record<string, unknown>;
  const notCarried = [...(version['not_carried'] as { field: string }[])].sort((a, b) =>
    lower(a.field, b.field),
  );
  const members: [string, string][] = [
    ['componentType', canonical(version['kind'] === 'component' ? type!.version : null, false)],
    ['content', canonical(version['content'], TEXT_KINDS.has(version['kind'] as string))],
    ['definitions', canonical(refs, false)],
    ['notCarried', canonical(notCarried, false)],
    ...(Object.keys(parameters).length === 0
      ? []
      : ([['parameters', canonical(parameters, false)]] as [string, string][])),
    ['values', canonical(version['metadata_values'], false)],
  ];
  return sha256(`{${members.map(([name, part]) => `${JSON.stringify(name)}:${part}`).join(',')}}`);
}
