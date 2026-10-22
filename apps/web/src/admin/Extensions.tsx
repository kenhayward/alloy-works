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
  endpoint: 'its endpoint',
  settings: 'the settings a connection gives it',
  authentication: 'the secret it takes',
  capabilities: 'what it can do',
  reference: 'where it is searched and fetched',
  outbound: 'the hosts it sends data to',
  about: 'what it says it is',
};

/** What kind of extension it is, in words (XR-J). */
const KINDS: Readonly<Record<ExtensionManifest['kind'], string>> = {
  source: 'Data source',
  reference: 'Reference source',
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
    <section aria-label={`What ${manifest.name} declares`}>
      <h3>{manifest.name}</h3>
      <dl>
        <dt>Version</dt>
        <dd>{manifest.version}</dd>
        <dt>Publisher</dt>
        <dd>{manifest.publisher}</dd>
        <dt>What it is</dt>
        <dd>{manifest.description}</dd>
        <dt>Kind</dt>
        <dd>{KINDS[manifest.kind]}</dd>
        <dt>Endpoint</dt>
        <dd className={styles['code']}>{manifest.endpoint}</dd>
        {manifest.kind === 'source' ? (
          <SourceDeclared manifest={manifest} />
        ) : (
          <>
            <dt>Reference</dt>
            <dd>{readsAt(manifest.reference)}</dd>
            <dt>Credential</dt>
            <dd>
              {manifest.authentication === 'none'
                ? 'Takes no secret'
                : `Takes one secret: ${manifest.authentication.label}`}
            </dd>
          </>
        )}
        <dt>Sends data to</dt>
        <dd>
          {manifest.outbound.length === 0 ? (
            'Sends data to no other host, as it says'
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
      <dt>Settings</dt>
      <dd>
        {manifest.settings.length === 0 ? (
          'None'
        ) : (
          <ul>
            {manifest.settings.map((field) => (
              <li key={field.key}>
                {`${field.label} (${field.type}, ${field.required ? 'required' : 'not required'})`}
              </li>
            ))}
          </ul>
        )}
      </dd>
      <dt>Credential</dt>
      <dd>
        {manifest.authentication === 'none'
          ? 'Takes no secret, so no connection can be made to it yet'
          : `Takes one secret: ${manifest.authentication.label}`}
      </dd>
      <dt>Can</dt>
      <dd>
        {[
          capabilities.parameters ? 'Binds parameters' : 'Binds no parameters',
          capabilities.keyColumns ? 'Declares key columns' : 'Declares no key columns',
          capabilities.rowLimit ? 'Takes the row limit' : 'Takes no row limit',
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
  return `Searched at ${search}, a record fetched at ${record}`;
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
    } else setSaid(refusal(error, 'The manifest could not be read.'));
  };

  const install = async (shown: Preview) => {
    const { data, error } = await client.POST('/v1/extensions', {
      body: { url: shown.url, digest: shown.digest },
    });
    if (data) {
      setSaid(`Installed ${data.manifest.name}.`);
      setPreview(null);
      setUrl('');
      again();
    } else setSaid(refusal(error, 'The extension could not be installed.'));
  };

  const check = async (extension: Installed) => {
    setUpdate(null);
    const { data, error } = await client.POST('/v1/extensions/{id}/preview', {
      params: { path: { id: extension.id } },
    });
    if (data) setUpdate({ of: extension, to: data });
    else setSaid(refusal(error, 'The manifest could not be read again.'));
  };

  const move = async (extension: Installed, to: Preview) => {
    const { data, error } = await client.POST('/v1/extensions/{id}/update', {
      params: { path: { id: extension.id } },
      body: { digest: to.digest },
    });
    if (data) {
      setSaid(`Updated ${extension.manifest.name} to ${data.manifest.version}.`);
      setUpdate(null);
      again();
    } else setSaid(refusal(error, 'The extension could not be updated.'));
  };

  const listUses = async (extension: Installed) => {
    const { data, error } = await client.GET('/v1/extensions/{id}/uses', {
      params: { path: { id: extension.id } },
    });
    if (data) setUses({ of: extension, items: data.items });
    else setSaid(refusal(error, 'Its uses could not be read.'));
  };

  const remove = async (extension: Installed) => {
    const { data, error } = await client.DELETE('/v1/extensions/{id}', {
      params: { path: { id: extension.id } },
    });
    setRemoving(null);
    setSaid(
      data
        ? `Removed ${extension.manifest.name}.`
        : refusal(error, 'The extension could not be removed.'),
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
      setSaid(`The secret of ${extension.manifest.name} is set.`);
      again();
    } else setSaid(refusal(error, 'The secret could not be set.'));
  };

  const changed = update?.to.changes ?? [];
  return (
    <>
      <div className={styles['lead']}>
        <p>
          A kind of source the product does not build in: a manifest at an HTTPS URL and the service
          it names, hosted by whoever wrote it. Read what it declares, and where it says it sends
          data, before installing it.
        </p>
      </div>
      <form onSubmit={(event) => void look(event)} aria-label="Install an extension" noValidate>
        <label className={styles['filter']}>
          Manifest URL
          <input
            value={url}
            inputMode="url"
            spellCheck={false}
            onChange={(change) => setUrl(change.target.value)}
          />
        </label>
        <button type="submit" disabled={url.trim() === ''}>
          Preview
        </button>
      </form>
      <p role="status">{said}</p>
      {preview !== null && (
        <Declared manifest={preview.manifest}>
          <button type="button" className="primary" onClick={() => void install(preview)}>
            Install
          </button>
        </Declared>
      )}
      <Shown read={read} failed="The extensions could not be loaded.">
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>No extension is installed.</p>
          ) : (
            <table aria-label="Extensions" className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Version</th>
                  <th scope="col">Publisher</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
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
                          <Chip tone="ok">Active</Chip>
                        ) : (
                          <Chip>Removed</Chip>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={`What ${name} declares`}
                          aria-expanded={opened === extension.id}
                          onClick={() => setOpened(opened === extension.id ? null : extension.id)}
                        >
                          What it declares
                        </button>{' '}
                        <button
                          type="button"
                          aria-label={`Uses of ${name}`}
                          onClick={() => void listUses(extension)}
                        >
                          Uses
                        </button>
                        {extension.removedAt === null && (
                          <>
                            {' '}
                            <button
                              type="button"
                              aria-label={`Check ${name} for an update`}
                              onClick={() => void check(extension)}
                            >
                              Check for update
                            </button>{' '}
                            {secretLabel(extension.manifest) !== undefined && (
                              <>
                                <button
                                  type="button"
                                  aria-label={`Set the secret of ${name}`}
                                  onClick={() => {
                                    setSecret('');
                                    setSecretOf(extension);
                                  }}
                                >
                                  {extension.secretSet ? 'Replace secret' : 'Set secret'}
                                </button>{' '}
                              </>
                            )}
                            <button
                              type="button"
                              aria-label={`Remove ${name}`}
                              onClick={() => setRemoving(extension)}
                            >
                              Remove
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
          aria-label={`The secret of ${secretOf.manifest.name}`}
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
            Set
          </button>{' '}
          <button type="button" onClick={() => setSecretOf(null)}>
            Cancel
          </button>
        </form>
      )}
      {update !== null && (
        <section aria-label={`Update ${update.of.manifest.name}`}>
          <h3>Update {update.of.manifest.name}</h3>
          {update.to.digest === update.of.digest ? (
            <p>Its manifest has not changed.</p>
          ) : (
            <>
              <p>
                {changed.length === 0
                  ? `Version ${update.to.manifest.version} changes nothing a connection reads.`
                  : `Version ${update.to.manifest.version} changes: ${changed.map((each) => CHANGES[each] ?? each).join(', ')}.`}
              </p>
              <p className={styles['muted']}>
                A connection keeps the manifest it was saved against until it is saved again; one
                whose endpoint moves needs its secret set again.
              </p>
              <Declared manifest={update.to.manifest}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void move(update.of, update.to)}
                >
                  Update
                </button>
              </Declared>
            </>
          )}
        </section>
      )}
      {uses !== null && (
        <section aria-label={`Uses of ${uses.of.manifest.name}`}>
          <h3>Connections using {uses.of.manifest.name}</h3>
          {uses.items.length === 0 ? (
            <p className={styles['muted']}>No connection uses it.</p>
          ) : (
            <ul aria-label={`Connections using ${uses.of.manifest.name}`}>
              {uses.items.map((each) => (
                <li key={each.connection}>
                  <a href={connectionLink(each.connection)}>{each.name}</a>
                  {each.retired ? ', retired' : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {removing !== null && (
        <ConfirmDialog
          question={`Remove ${removing.manifest.name}?`}
          sentence={
            removing.manifest.kind === 'reference'
              ? 'It can no longer be searched, and the entries obtained from it are kept but no longer checked. It must be switched off under Reference sources first.'
              : 'No connection can be made to it again. Its manifests are kept, so what used it still names it; a connection not retired keeps it installed.'
          }
          keep="Keep it"
          act="Remove"
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
