import type { createApiClient } from '@alloy-works/api-client';
import type { ExtensionManifest } from '@alloy-works/domain';
import { useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { connectionLink } from '../data/links.js';
import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** An extension as the page lists it (extensions.md; the EX plan, EX-B to EX-E). */
interface Installed {
  readonly id: string;
  readonly url: string;
  readonly digest: string;
  readonly manifest: ExtensionManifest;
  readonly removedAt: string | null;
  /** A reference extension's: whether its secret is set (XR-J). */
  readonly secretSet?: boolean;
}

interface Preview {
  readonly url: string;
  readonly digest: string;
  readonly manifest: ExtensionManifest;
  readonly changes?: readonly string[];
}

interface Use {
  readonly connection: string;
  readonly name: string;
  readonly retired: boolean;
}

/** What an update changes, in words (API-048). */
const CHANGES: Readonly<Record<string, string>> = {
  get endpoint() {
    return words('admin.its-endpoint');
  },
  get settings() {
    return words('admin.the-settings-a-connection-gives');
  },
  get authentication() {
    return words('admin.the-secret-it-takes');
  },
  get capabilities() {
    return words('admin.what-it-can-do');
  },
  get reference() {
    return words('admin.where-it-is-searched-and');
  },
  get outbound() {
    return words('admin.the-hosts-it-sends-data');
  },
  get about() {
    return words('admin.what-it-says-it-is');
  },
};

/** What kind of extension it is, in words (XR-J). */
const KINDS: Readonly<Record<ExtensionManifest['kind'], string>> = {
  get source() {
    return words('admin.data-source');
  },
  get reference() {
    return words('admin.reference-source');
  },
};

/** Everything a manifest declares, in words, read before it is installed or updated (EX-B). */
function Declared({
  manifest,
  children,
}: {
  manifest: ExtensionManifest;
  children?: React.ReactNode;
}) {
  return (
    <section aria-label={words('admin.what-declares', { name: manifest.name })}>
      <h3>{manifest.name}</h3>
      <dl>
        <dt>{words('admin.version-2')}</dt>
        <dd>{manifest.version}</dd>
        <dt>{words('admin.publisher')}</dt>
        <dd>{manifest.publisher}</dd>
        <dt>{words('admin.what-it-is')}</dt>
        <dd>{manifest.description}</dd>
        <dt>{words('admin.kind')}</dt>
        <dd>{KINDS[manifest.kind]}</dd>
        <dt>{words('admin.endpoint')}</dt>
        <dd className={styles['code']}>{manifest.endpoint}</dd>
        {manifest.kind === 'source' ? (
          <SourceDeclared manifest={manifest} />
        ) : (
          <>
            <dt>{words('admin.reference')}</dt>
            <dd>{readsAt(manifest.reference)}</dd>
            <dt>{words('admin.credential')}</dt>
            <dd>
              {manifest.authentication === 'none'
                ? words('admin.takes-no-secret')
                : words('admin.takes-one-secret', { label: manifest.authentication.label })}
            </dd>
          </>
        )}
        <dt>{words('admin.sends-data-to')}</dt>
        <dd>
          {manifest.outbound.length === 0 ? (
            words('admin.sends-data-to-no-other')
          ) : (
            <ul>
              {manifest.outbound.map((each) => (
                <li key={each.host}>
                  <span className={styles['code']}>{each.host}</span>: {each.purpose}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      {children}
    </section>
  );
}

/** A source extension's settings, credential and capabilities (EX-B). */
function SourceDeclared({
  manifest,
}: {
  manifest: Extract<ExtensionManifest, { kind: 'source' }>;
}) {
  const { capabilities } = manifest;
  return (
    <>
      <dt>{words('admin.settings')}</dt>
      <dd>
        {manifest.settings.length === 0 ? (
          words('admin.none')
        ) : (
          <ul>
            {manifest.settings.map((field) => (
              <li key={field.key}>
                {`${field.label} (${field.type}, ${field.required ? 'required' : words('admin.not-required')})`}
              </li>
            ))}
          </ul>
        )}
      </dd>
      <dt>{words('admin.credential')}</dt>
      <dd>
        {manifest.authentication === 'none'
          ? words('admin.takes-no-secret-so-no')
          : words('admin.takes-one-secret', { label: manifest.authentication.label })}
      </dd>
      <dt>{words('admin.can')}</dt>
      <dd>
        {[
          capabilities.parameters
            ? words('admin.binds-parameters')
            : words('admin.binds-no-parameters'),
          capabilities.keyColumns
            ? words('admin.declares-key-columns')
            : words('admin.declares-no-key-columns'),
          capabilities.rowLimit
            ? words('admin.takes-the-row-limit')
            : words('admin.takes-no-row-limit'),
        ].join('. ')}
        .
      </dd>
    </>
  );
}

/** A secret a reference extension takes, as its manifest names it; none where it takes none. */
const secretLabel = (manifest: ExtensionManifest): string | undefined =>
  manifest.kind === 'reference' && manifest.authentication !== 'none'
    ? manifest.authentication.label
    : undefined;

/**
 * Administration's **Extensions** (extensions.md; the EX plan, EXc): an extension installed by its
 * manifest's URL after reading what it declares; each one's update shown before it is made, its uses,
 * and removing it, after asking, once nothing but a retired connection uses it. A reference
 * extension's secret is set here, write-only (the XR plan, XR-J).
 */
/** Where a reference extension is searched and a record fetched, as its manifest says. */
function readsAt({ search, fetch: record }: { search: string; fetch: string }): string {
  return words('admin.searched-at-a-record-fetched', { search, record });
}

export function Extensions({ client }: { client: Client }) {
  const [generation, setGeneration] = useState(0);
  const [load] = useState(
    () => () =>
      everyPage<Installed>((cursor) =>
        client.GET('/v1/extensions', { params: { query: cursor ? { cursor } : {} } }),
      ),
  );
  const read = useListing<Installed>(load, true, generation);
  const [url, setUrl] = useState('');
  const [said, setSaid] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ of: Installed; to: Preview } | null>(null);
  const [uses, setUses] = useState<{ of: Installed; items: readonly Use[] } | null>(null);
  const [removing, setRemoving] = useState<Installed | null>(null);
  const [secretOf, setSecretOf] = useState<Installed | null>(null);
  const [secret, setSecret] = useState('');
  const again = () => setGeneration((was) => was + 1);

  const look = async (event: FormEvent) => {
    event.preventDefault();
    setPreview(null);
    const { data, error } = await client.POST('/v1/extensions/preview', {
      body: { url: url.trim() },
    });
    if (data) {
      setSaid('');
      setPreview(data);
    } else setSaid(refusal(error, words('admin.the-manifest-could-not-be')));
  };

  const install = async (shown: Preview) => {
    const { data, error } = await client.POST('/v1/extensions', {
      body: { url: shown.url, digest: shown.digest },
    });
    if (data) {
      setSaid(words('admin.installed', { name: data.manifest.name }));
      setPreview(null);
      setUrl('');
      again();
    } else setSaid(refusal(error, words('admin.the-extension-could-not-be')));
  };

  const check = async (extension: Installed) => {
    setUpdate(null);
    const { data, error } = await client.POST('/v1/extensions/{id}/preview', {
      params: { path: { id: extension.id } },
    });
    if (data) setUpdate({ of: extension, to: data });
    else setSaid(refusal(error, words('admin.the-manifest-could-not-be-2')));
  };

  const move = async (extension: Installed, to: Preview) => {
    const { data, error } = await client.POST('/v1/extensions/{id}/update', {
      params: { path: { id: extension.id } },
      body: { digest: to.digest },
    });
    if (data) {
      setSaid(
        words('admin.updated-to', {
          name: extension.manifest.name,
          version: data.manifest.version,
        }),
      );
      setUpdate(null);
      again();
    } else setSaid(refusal(error, words('admin.the-extension-could-not-be-2')));
  };

  const listUses = async (extension: Installed) => {
    const { data, error } = await client.GET('/v1/extensions/{id}/uses', {
      params: { path: { id: extension.id } },
    });
    if (data) setUses({ of: extension, items: data.items });
    else setSaid(refusal(error, words('admin.its-uses-could-not-be')));
  };

  const remove = async (extension: Installed) => {
    const { data, error } = await client.DELETE('/v1/extensions/{id}', {
      params: { path: { id: extension.id } },
    });
    setRemoving(null);
    setSaid(
      data
        ? words('admin.removed-2', { name: extension.manifest.name })
        : refusal(error, words('admin.the-extension-could-not-be-3')),
    );
    again();
  };

  const keep = async (event: FormEvent, extension: Installed) => {
    event.preventDefault();
    const { data, error } = await client.PUT('/v1/extensions/{id}/secret', {
      params: { path: { id: extension.id } },
      body: { secret },
    });
    setSecret('');
    if (data) {
      setSecretOf(null);
      setSaid(words('admin.the-secret-of-is-set', { name: extension.manifest.name }));
      again();
    } else setSaid(refusal(error, words('admin.the-secret-could-not-be')));
  };

  const changed = update?.to.changes ?? [];
  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.a-kind-of-source-the')}</p>
      </div>
      <form
        onSubmit={(event) => void look(event)}
        aria-label={words('admin.install-an-extension')}
        noValidate
      >
        <label className={styles['filter']}>
          {words('admin.manifest-url')}
          <input
            value={url}
            inputMode="url"
            spellCheck={false}
            onChange={(change) => setUrl(change.target.value)}
          />
        </label>
        <button type="submit" disabled={url.trim() === ''}>
          {words('admin.preview')}
        </button>
      </form>
      <p role="status">{said}</p>
      {preview !== null && (
        <Declared manifest={preview.manifest}>
          <button type="button" className="primary" onClick={() => void install(preview)}>
            {words('admin.install')}
          </button>
        </Declared>
      )}
      <Shown read={read} failed={words('admin.the-extensions-could-not-be-loaded')}>
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>{words('admin.no-extension-is-installed')}</p>
          ) : (
            <table aria-label={words('admin.extensions')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.name')}</th>
                  <th scope="col">{words('admin.kind')}</th>
                  <th scope="col">{words('admin.version-2')}</th>
                  <th scope="col">{words('admin.publisher')}</th>
                  <th scope="col">{words('admin.status')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((extension) => {
                  const { name } = extension.manifest;
                  return (
                    <tr key={extension.id}>
                      <td className={styles['strong']}>{name}</td>
                      <td>{KINDS[extension.manifest.kind]}</td>
                      <td>{extension.manifest.version}</td>
                      <td>{extension.manifest.publisher}</td>
                      <td>
                        {extension.removedAt === null ? (
                          <Chip tone="ok">{words('admin.active')}</Chip>
                        ) : (
                          <Chip>{words('admin.removed-3')}</Chip>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={words('admin.what-declares', { name })}
                          aria-expanded={opened === extension.id}
                          onClick={() => setOpened(opened === extension.id ? null : extension.id)}
                        >
                          {words('admin.what-it-declares')}
                        </button>{' '}
                        <button
                          type="button"
                          aria-label={words('admin.uses-of', { name })}
                          onClick={() => void listUses(extension)}
                        >
                          {words('admin.uses')}
                        </button>
                        {extension.removedAt === null && (
                          <>
                            {' '}
                            <button
                              type="button"
                              aria-label={words('admin.check-for-an-update', { name })}
                              onClick={() => void check(extension)}
                            >
                              {words('admin.check-for-update')}
                            </button>{' '}
                            {secretLabel(extension.manifest) !== undefined && (
                              <>
                                <button
                                  type="button"
                                  aria-label={words('admin.set-the-secret-of', { name })}
                                  onClick={() => {
                                    setSecret('');
                                    setSecretOf(extension);
                                  }}
                                >
                                  {extension.secretSet
                                    ? words('admin.replace-secret')
                                    : words('admin.set-secret')}
                                </button>{' '}
                              </>
                            )}
                            <button
                              type="button"
                              aria-label={words('admin.remove', { name })}
                              onClick={() => setRemoving(extension)}
                            >
                              {words('admin.remove-2')}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </Shown>
      {opened !== null && read !== null && typeof read === 'object' && (
        <OpenedDeclared rows={read.rows} id={opened} />
      )}
      {secretOf !== null && (
        <form
          aria-label={words('admin.the-secret-of', { name: secretOf.manifest.name })}
          onSubmit={(event) => void keep(event, secretOf)}
          noValidate
        >
          <label className={styles['filter']}>
            {secretLabel(secretOf.manifest)}
            <input
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(change) => setSecret(change.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={secret.trim() === ''}>
            {words('admin.set')}
          </button>{' '}
          <button type="button" onClick={() => setSecretOf(null)}>
            {words('admin.cancel')}
          </button>
        </form>
      )}
      {update !== null && (
        <section aria-label={words('admin.update', { name: update.of.manifest.name })}>
          <h3>
            {words('admin.update-2')}
            {update.of.manifest.name}
          </h3>
          {update.to.digest === update.of.digest ? (
            <p>{words('admin.its-manifest-has-not-changed')}</p>
          ) : (
            <>
              <p>
                {changed.length === 0
                  ? words('admin.version-changes-nothing-a-connection', {
                      version: update.to.manifest.version,
                    })
                  : words('admin.version-changes', {
                      version: update.to.manifest.version,
                      value2: changed.map((each) => CHANGES[each] ?? each).join(', '),
                    })}
              </p>
              <p className={styles['muted']}>{words('admin.a-connection-keeps-the-manifest')}</p>
              <Declared manifest={update.to.manifest}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void move(update.of, update.to)}
                >
                  {words('admin.update-3')}
                </button>
              </Declared>
            </>
          )}
        </section>
      )}
      {uses !== null && (
        <section aria-label={words('admin.uses-of', { name: uses.of.manifest.name })}>
          <h3>
            {words('admin.connections-using')}
            {uses.of.manifest.name}
          </h3>
          {uses.items.length === 0 ? (
            <p className={styles['muted']}>{words('admin.no-connection-uses-it')}</p>
          ) : (
            <ul aria-label={words('admin.connections-using-2', { name: uses.of.manifest.name })}>
              {uses.items.map((each) => (
                <li key={each.connection}>
                  <a href={connectionLink(each.connection)}>{each.name}</a>
                  {each.retired ? words('admin.retired') : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {removing !== null && (
        <ConfirmDialog
          question={words('admin.remove-3', { name: removing.manifest.name })}
          sentence={
            removing.manifest.kind === 'reference'
              ? words('admin.it-can-no-longer-be')
              : words('admin.no-connection-can-be-made')
          }
          keep={words('admin.keep-it')}
          act={words('admin.remove-2')}
          onKeep={() => setRemoving(null)}
          onAct={() => remove(removing)}
        />
      )}
    </>
  );
}

/** The opened extension's declaration, found among those read. */
function OpenedDeclared({ rows, id }: { rows: readonly Installed[]; id: string }) {
  const extension = rows.find((each) => each.id === id);
  return extension ? <Declared manifest={extension.manifest} /> : null;
}
