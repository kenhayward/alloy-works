import type { createApiClient } from '@alloy-works/api-client';
import { useId, useState, type FormEvent } from 'react';

import { useCreatableSpaces } from '../spaces.js';
import styles from './Import.module.css';
import { IMPORT_HELP } from './ImportHelp.js';
import { importLink } from './links.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** The kind of file a name says it is (IM-B), or null for one an import does not take. */
export function fileTypeOf(name: string): 'docx' | 'markdown' | 'html' | null {
  if (/\.docx$/i.test(name)) return 'docx';
  if (/\.(md|markdown)$/i.test(name)) return 'markdown';
  if (/\.html?$/i.test(name)) return 'html';
  return null;
}

const NOT_PERMITTED = (): string => words('imports.choose-a-word-document-docx');

const SAID: Readonly<Record<string, string>> = {
  get import_file_not_permitted() {
    return words('imports.this-file-is-not-a');
  },
  get import_too_large() {
    return words('imports.this-file-is-larger-than');
  },
  get forbidden() {
    return words('imports.you-may-not-import-into');
  },
};

/**
 * Makes an import of a file in a space and sends its bytes as bytes: its id, or what to say. The
 * import dialog's way in, and a paste broken out (CNT-187).
 */
export async function importFile(
  client: Client,
  space: string,
  file: {
    readonly name: string;
    readonly type: 'docx' | 'markdown' | 'html';
    readonly bytes: Uint8Array;
  },
): Promise<
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly said: string }
> {
  try {
    const made = await client.POST('/v1/spaces/{space}/imports', {
      params: { path: { space } },
      body: { fileName: file.name, fileType: file.type },
    });
    if (!made.data) {
      const code = (made.error as { code?: string } | undefined)?.code;
      return {
        ok: false,
        said: (code && SAID[code]) ?? words('imports.the-file-could-not-be'),
      };
    }
    const filled = await client.PUT('/v1/imports/{id}/file', {
      params: { path: { id: made.data.id } },
      // The bytes as they are, never serialised as JSON (as an image's are).
      body: file.bytes as unknown as string,
      bodySerializer: (body: unknown) => body as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    });
    if (!filled.data) {
      const code = (filled.error as { code?: string } | undefined)?.code;
      return { ok: false, said: (code && SAID[code]) ?? words('imports.the-file-could-not-be-2') };
    }
    return { ok: true, id: made.data.id };
  } catch {
    return { ok: false, said: words('imports.the-file-could-not-be') };
  }
}

/**
 * **Import a file into a space** (the IM plan, IMa): the space and the file chosen, the import made,
 * its bytes sent as bytes, and its page opened, where the worker's reading of it is followed. Nothing
 * is made in the space until its proposal is accepted there.
 */
export function ImportFile({ client }: { client: Client }) {
  const ids = useId();
  const { spaces, problem, where, setWhere } = useCreatableSpaces(client);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (file === null || where === '') return;
    const fileType = fileTypeOf(file.name);
    if (fileType === null) {
      setNotice(NOT_PERMITTED());
      return;
    }
    setBusy(true);
    setNotice(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const made = await importFile(client, where, { name: file.name, type: fileType, bytes });
    setBusy(false);
    if (made.ok) window.location.hash = importLink(made.id);
    else setNotice(made.said);
  };

  return (
    <section aria-labelledby="import-heading" className={styles['dialog']}>
      <h2 id="import-heading">{words('imports.import')}</h2>
      <p className={styles['muted']}>
        {words('imports.a-word-document-markdown-or')}{' '}
        <a href={IMPORT_HELP}>{words('imports.what-arrives-and-what-does')}</a>
      </p>
      {problem !== null ? (
        <p role="status">{words('imports.the-spaces-you-may-create')}</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className={styles['dialog']}>
          <label>
            {words('imports.where')}
            <select value={where} onChange={(event) => setWhere(event.target.value)}>
              {(spaces ?? []).map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${ids}-file`}>{words('imports.file')}</label>
          <input
            id={`${ids}-file`}
            type="file"
            accept=".docx,.md,.markdown,.html,.htm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <div className={styles['actions']}>
            <button type="submit" className="primary" disabled={busy || file === null}>
              {words('imports.import-file')}
            </button>
          </div>
        </form>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
