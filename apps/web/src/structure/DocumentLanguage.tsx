import type { createApiClient } from '@alloy-works/api-client';
import { contentDocumentSchema, declaredLanguageOf } from '@alloy-works/domain';
import { useId, useImperativeHandle, useState, type Ref } from 'react';

import { Modal } from '../layouts/Modal.js';
import { DeclaredLanguages } from '../parts/DeclaredLanguages.js';
import { words } from '../words/words.js';
import styles from './DocumentLanguage.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Skips {
  readonly notPermitted: number;
  readonly locked: number;
  readonly pinnedBehind: number;
  readonly translated: number;
  readonly missing: number;
}

/** What a change did, in one notice; only what happened is said (the DL plan, L8). */
function saidOf(language: string, changed: number, skipped: Skips, asked: boolean): string {
  const left = [
    skipped.notPermitted > 0 &&
      words('document.language-left-not-permitted', { count: skipped.notPermitted }),
    skipped.locked > 0 && words('document.language-left-locked', { count: skipped.locked }),
    skipped.pinnedBehind > 0 &&
      words('document.language-left-pinned', { count: skipped.pinnedBehind }),
    skipped.translated > 0 &&
      words('document.language-left-translated', { count: skipped.translated }),
    skipped.missing > 0 && words('document.language-left-missing', { count: skipped.missing }),
  ].filter((each) => each !== false);
  return [
    words('document.language-changed', { language }),
    ...(asked && changed > 0
      ? [words('document.language-components-changed', { count: changed })]
      : []),
    ...(left.length > 0
      ? [
          words('document.language-left', {
            parts: left.join(words('document.language-left-joined')),
          }),
        ]
      : []),
  ].join(' ');
}

/**
 * A document's language (the DL plan, L9): what the Document menu and the language icon open, a tag typed
 * or chosen from the declared list, with its components too if asked. The answer carries the document,
 * since its version and pins have moved, so the page shows that rather than merging a member.
 */
export function DocumentLanguage({
  act,
  client,
  id,
  version,
  language,
  onChanged,
  onStale,
}: {
  act: Ref<() => void>;
  client: Client;
  id: string;
  version: string;
  language: string;
  onChanged: (document: unknown, said: string, components: readonly string[]) => void;
  onStale: (current: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(act, () => () => setOpen(true), []);
  return open ? (
    <Dialog
      client={client}
      id={id}
      version={version}
      language={language}
      onClose={() => setOpen(false)}
      onChanged={(document, said, components) => {
        setOpen(false);
        onChanged(document, said, components);
      }}
      onStale={(current) => {
        setOpen(false);
        onStale(current);
      }}
    />
  ) : null;
}

function Dialog({
  client,
  id,
  version,
  language,
  onClose,
  onChanged,
  onStale,
}: {
  client: Client;
  id: string;
  version: string;
  language: string;
  onClose: () => void;
  onChanged: (document: unknown, said: string, components: readonly string[]) => void;
  onStale: (current: unknown) => void;
}) {
  const heading = useId();
  const offered = useId();
  const [tag, setTag] = useState(language);
  const [components, setComponents] = useState(false);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const failed = words('document.the-language-could-not-be-changed');
  const given = tag.trim();
  const isTag = contentDocumentSchema.shape.language.safeParse(given).success;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isTag) {
      setSaid(words('document.a-language-tag-looks-like'));
      return;
    }
    setBusy(true);
    try {
      const { data, error, response } = await client.POST('/v1/documents/{id}/language', {
        params: { path: { id } },
        body: { openedFrom: version, language: given, components },
      });
      if (data) {
        const { changed, skipped } = data.components;
        onChanged(data.document, saidOf(given, changed.length, skipped, components), changed);
        return;
      }
      if (response.status === 409) {
        onStale((error as { current?: unknown } | undefined)?.current);
        return;
      }
      setSaid(
        response.status === 400 && (error as { reason?: unknown } | undefined)?.reason !== undefined
          ? words('document.language-title-translated')
          : failed,
      );
    } catch {
      setSaid(failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy={heading} onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void save(event)}>
        <h2 id={heading}>{words('document.language-of-this-document')}</h2>
        <label>
          {words('document.language')}
          <input list={offered} value={tag} onChange={(event) => setTag(event.target.value)} />
        </label>
        <DeclaredLanguages id={offered} />
        {isTag && declaredLanguageOf(given) === undefined && (
          <p>{words('editor.language-not-declared', { tag: given })}</p>
        )}
        <label className={styles['check']}>
          <input
            type="checkbox"
            checked={components}
            onChange={(event) => setComponents(event.target.checked)}
          />
          {words('document.language-set-components')}
        </label>
        {components && <p>{words('document.language-set-components-explained')}</p>}
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('document.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {words('document.change-language')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
