import type { createApiClient } from '@alloy-works/api-client';
import { contentDocumentSchema } from '@alloy-works/domain';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { DeclaredLanguages } from '../parts/DeclaredLanguages.js';
import { PlaceHoldDialog } from '../lifecycle/Hold.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A space as Administration's Spaces lists it. */
export interface SpaceRow {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly mayCreate: boolean;
  readonly language?: string | null;
  /** The template a document made here with none named starts from; null until chosen (TPL-074). */
  readonly defaultTemplate?: string | null;
}

/** What is being done to a space, while its dialog is open. */
export type SpaceAct =
  | { readonly kind: 'new' }
  | {
      readonly kind: 'rename' | 'language' | 'template' | 'archive' | 'restore' | 'hold';
      readonly space: SpaceRow;
    };

/**
 * Making or renaming a space (the SP1 plan, SP-G): a name, which the service normalises, trims and
 * checks, saying why where it refuses one.
 */
function Naming({
  client,
  space,
  onDone,
  onClose,
}: {
  client: Client;
  space: SpaceRow | null;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(space?.name ?? '');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const heading =
    space === null ? words('admin.new-space') : words('admin.rename', { name: space.name });
  const failed =
    space === null
      ? words('admin.the-space-could-not-be')
      : words('admin.could-not-be-renamed', { name: space.name });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setSaid(words('admin.give-the-space-a-name'));
      return;
    }
    // In code points, as the service counts (SP-B): `maxLength` would count UTF-16 units, and stop a
    // name of 200 characters from outside the Basic Multilingual Plane at 100.
    if ([...trimmed.normalize('NFC')].length > 200) {
      setSaid(words('admin.a-space-name-is-at'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } =
        space === null
          ? await client.POST('/v1/spaces', { body: { name: trimmed } })
          : await client.PATCH('/v1/spaces/{id}', {
              params: { path: { id: space.id } },
              body: { name: trimmed },
            });
      if (data) {
        onDone(
          space === null
            ? words('admin.made-the-space', { name: data.name })
            : words('admin.renamed-to', { from: space.name, to: data.name }),
        );
      } else setSaid(refusal(error, failed));
    } catch {
      setSaid(failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="space-name-heading" onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void save(event)}>
        <h2 id="space-name-heading">{heading}</h2>
        <label>
          {words('admin.name')}
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className={styles['muted']}>
          {space === null
            ? words('admin.grant-roles-on-it-from')
            : words('admin.only-the-name-changes-what')}
        </p>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {space === null ? words('admin.make-space') : words('admin.rename-space')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A space's default language, which new work there and CT Studio's deliveries take: empty is none. */
function Language({
  client,
  space,
  onDone,
  onClose,
}: {
  client: Client;
  space: SpaceRow;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const [tag, setTag] = useState(space.language ?? '');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const offered = useId();
  const failed = words('admin.the-language-could-not-be-set');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const given = tag.trim();
    if (given !== '' && !contentDocumentSchema.shape.language.safeParse(given).success) {
      setSaid(words('editor.a-language-tag-looks-like'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.PATCH('/v1/spaces/{id}', {
        params: { path: { id: space.id } },
        body: { language: given === '' ? null : given },
      });
      if (data) {
        onDone(
          given === ''
            ? words('admin.space-has-no-default-language', { name: space.name })
            : words('admin.space-starts-in-language', { name: space.name, language: given }),
        );
      } else setSaid(refusal(error, failed));
    } catch {
      setSaid(failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="space-language-heading" onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void save(event)}>
        <h2 id="space-language-heading">
          {words('admin.default-language-of', { name: space.name })}
        </h2>
        <label>
          {words('document.language')}
          <input list={offered} value={tag} onChange={(event) => setTag(event.target.value)} />
        </label>
        <DeclaredLanguages id={offered} />
        <p className={styles['muted']}>{words('admin.space-language-explained')}</p>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {words('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * A space's default template (TPL-074; the ND plan, ND-A): one of the space's own templates, which a
 * document made there with none named starts from and New document offers first. Until one is
 * chosen it is Blank, made when a document first needs it (ND-N).
 */
function DefaultTemplate({
  client,
  space,
  onDone,
  onClose,
}: {
  client: Client;
  space: SpaceRow;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<readonly { id: string; name: string }[] | null>(null);
  const [chosen, setChosen] = useState(space.defaultTemplate ?? '');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const failed = words('admin.the-default-template-could-not-be-set');

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const all = await everyPage((cursor) =>
          client.GET('/v1/templates', {
            params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
          }),
        );
        if (!current) return;
        if ('items' in all) {
          setTemplates(
            all.items
              .filter((each) => each.space.id === space.id)
              .map((each) => ({ id: each.id, name: each.name })),
          );
        } else setSaid(words('admin.the-templates-could-not-be-loaded'));
      } catch {
        if (current) setSaid(words('admin.the-templates-could-not-be-loaded'));
      }
    })();
    return () => {
      current = false;
    };
  }, [client, space.id]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const template = templates?.find((each) => each.id === chosen);
    if (template === undefined) return;
    setBusy(true);
    try {
      const { response, error } = await client.PUT('/v1/spaces/{space}/default-template', {
        params: { path: { space: space.id } },
        body: { template: template.id },
      });
      if (response.ok) {
        onDone(
          words('admin.is-the-default-template-in', { template: template.name, name: space.name }),
        );
      } else setSaid(refusal(error, failed));
    } catch {
      setSaid(failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="space-template-heading" onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void save(event)}>
        <h2 id="space-template-heading">
          {words('admin.default-template-of', { name: space.name })}
        </h2>
        {templates !== null && (
          <label>
            {words('admin.default-template')}
            <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
              {chosen === '' && <option value="">{words('admin.blank-when-first-needed')}</option>}
              {templates.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className={styles['muted']}>{words('admin.default-template-explained')}</p>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy}
            aria-disabled={chosen === '' || undefined}
          >
            {words('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Archiving or restoring a space, after saying what it changes and what it does not (SP-C, SP-G). A
 * refusal - the last space not archived - is said in Spaces once the dialog has gone.
 */
function Archiving({
  client,
  space,
  restore,
  onDone,
  onClose,
}: {
  client: Client;
  space: SpaceRow;
  restore: boolean;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const failed = words('admin.could-not-be', {
    name: space.name,
    change: restore ? 'restore' : 'archive',
  });

  const change = async () => {
    setBusy(true);
    try {
      const { data, error } = await client.PATCH('/v1/spaces/{id}', {
        params: { path: { id: space.id } },
        body: { archived: !restore },
      });
      if (data)
        onDone(
          words('admin.space-changed', {
            change: restore ? 'restore' : 'archive',
            name: data.name,
          }),
        );
      else onDone(refusal(error, failed));
    } catch {
      onDone(failed);
    }
  };

  return (
    <Modal labelledBy="space-archive-heading" onClose={onClose}>
      <section aria-labelledby="space-archive-heading" className={styles['dialog']}>
        <h2 id="space-archive-heading">
          {words('admin.space-change-question', {
            change: restore ? 'restore' : 'archive',
            name: space.name,
          })}
        </h2>
        {restore ? (
          <p>{words('admin.new-components-documents-and-the')}</p>
        ) : (
          <p>{words('admin.nothing-new-can-be-made')}</p>
        )}
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button
            type="button"
            className={restore ? 'primary' : 'danger'}
            disabled={busy}
            onClick={() => void change()}
          >
            {restore ? words('admin.restore-space') : words('admin.archive-space')}
          </button>
        </div>
      </section>
    </Modal>
  );
}

/** The dialog for what is being done to a space; `onDone` says what came of it. */
export function SpaceDialog({
  client,
  act,
  onDone,
  onClose,
}: {
  client: Client;
  act: SpaceAct;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  if (act.kind === 'new') {
    return <Naming client={client} space={null} onDone={onDone} onClose={onClose} />;
  }
  if (act.kind === 'hold') {
    return (
      <PlaceHoldDialog
        client={client}
        target={{ space: act.space.id }}
        title={act.space.name}
        onDone={onDone}
        onClose={onClose}
      />
    );
  }
  if (act.kind === 'rename') {
    return <Naming client={client} space={act.space} onDone={onDone} onClose={onClose} />;
  }
  if (act.kind === 'template') {
    return <DefaultTemplate client={client} space={act.space} onDone={onDone} onClose={onClose} />;
  }
  if (act.kind === 'language') {
    return <Language client={client} space={act.space} onDone={onDone} onClose={onClose} />;
  }
  return (
    <Archiving
      client={client}
      space={act.space}
      restore={act.kind === 'restore'}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
