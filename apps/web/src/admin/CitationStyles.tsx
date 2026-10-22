import type { createApiClient } from '@alloy-works/api-client';
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

/** A style as the page lists it (citations.md, "The style"; the CI plan, CI-D). */
interface Listed {
  readonly id: string;
  readonly name: string;
  readonly seeded: boolean;
  readonly version: { readonly id: string; readonly number: string };
}

interface Run {
  readonly text: string;
  readonly marks: readonly { readonly kind: string; readonly href?: string }[];
}

interface Preview {
  readonly title?: string;
  readonly problems: readonly { readonly message: string }[];
  readonly proposed: Readonly<Record<string, readonly string[]>>;
  readonly sample: {
    readonly citations: readonly (readonly Run[])[];
    readonly bibliography: readonly {
      readonly entry: string;
      readonly label?: readonly Run[];
      readonly runs: readonly Run[];
    }[];
  } | null;
}

/** `text` as an http or https address, or undefined where it is anything else. */
export function webAddress(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A run drawn with its marks, innermost last. */
export function Drawn({ run }: { run: Run }) {
  return run.marks.reduceRight<ReactNode>((inner, mark) => {
    switch (mark.kind) {
      case 'emphasis':
        return <em>{inner}</em>;
      case 'strong':
        return <strong>{inner}</strong>;
      case 'underline':
        return <u>{inner}</u>;
      case 'superscript':
        return <sup>{inner}</sup>;
      case 'subscript':
        return <sub>{inner}</sub>;
      // A link only to an http or https address: a style is a tenant's upload, and its runs data.
      case 'hyperlink': {
        const href = webAddress(mark.href);
        return href === undefined ? (
          inner
        ) : (
          <a href={href} rel="noopener noreferrer">
            {inner}
          </a>
        );
      }
      default:
        return inner;
    }
  }, run.text);
}

const Runs = ({ runs }: { runs: readonly Run[] }) => (
  <>
    {runs.map((run, at) => (
      <Drawn key={at} run={run} />
    ))}
  </>
);

/** The invented sample entries as a style sets them: in the text, then the bibliography. */
function Sample({ sample }: { sample: NonNullable<Preview['sample']> }) {
  return (
    <section aria-label="Preview" className={styles['notes']}>
      <h2>In the text</h2>
      <ul>
        {sample.citations.map((runs, at) => (
          <li key={at}>
            <Runs runs={runs} />
          </li>
        ))}
      </ul>
      <h2>Bibliography</h2>
      <ul>
        {sample.bibliography.map((each) => (
          <li key={each.entry}>
            {each.label && (
              <>
                <Runs runs={each.label} />{' '}
              </>
            )}
            <Runs runs={each.runs} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Administration's **Citation styles** (citations.md, "The style"; the CI plan, CI-D): the environment's
 * CSL styles, CSE, Vancouver and Harvard among them; **Preview** sets invented sample entries in one,
 * and a CSL file uploaded is previewed first, its `requires` proposed from what it prints, then added.
 * The service renders every preview: the processor never reaches the browser.
 */
export function CitationStyles({ client }: { client: Client }) {
  const [generation, setGeneration] = useState(0);
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/citation-styles');
    return data ? { items: data.items as Listed[] } : { status: response.status };
  });
  const read = useListing<Listed>(load, true, generation);
  const [shown, setShown] = useState<Preview | null>(null);
  const [csl, setCsl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [requires, setRequires] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const previewOf = async (text: string): Promise<Preview | null> => {
    const { data, error } = await client.POST('/v1/citation-styles/preview', {
      body: { csl: text },
    });
    if (!data) setSaid(refusal(error, 'The style could not be previewed.'));
    return (data as Preview | undefined) ?? null;
  };

  const chosen = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    if (!file) return;
    setSaid('');
    const text = await file.text();
    const preview = await previewOf(text);
    setShown(preview);
    setCsl(preview && preview.problems.length === 0 ? text : null);
    setName(preview?.title ?? file.name.replace(/\.[^.]*$/, ''));
    setRequires(JSON.stringify(preview?.proposed ?? {}, null, 2));
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (csl === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(requires);
    } catch {
      setSaid('What each type requires is not JSON.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/citation-styles', {
        body: {
          style: {
            schemaVersion: 1,
            name: name.trim(),
            csl,
            requires: parsed as Record<string, string[]>,
          },
        },
      });
      if (data) {
        setSaid(`${data.style.name} is added, at ${data.version.number}.`);
        setCsl(null);
        setShown(null);
        setGeneration((was) => was + 1);
      } else setSaid(refusal(error, 'The style could not be added.'));
    } finally {
      setBusy(false);
    }
  };

  const previewHeld = async (style: Listed) => {
    setSaid('');
    setCsl(null);
    const { data, error } = await client.GET('/v1/citation-styles/{id}', {
      params: { path: { id: style.id } },
    });
    if (!data) {
      setSaid(refusal(error, 'The style could not be read.'));
      return;
    }
    setShown(await previewOf(data.style.csl));
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>
          The citation styles a theme may name, each a CSL file. CSE, Vancouver and Harvard are
          given; add any published CSL style by uploading its file, which is previewed with invented
          sources first. A style says what an entry of each type must hold, and an entry lacking it
          fails the publish.
        </p>
      </div>
      <form
        className={styles['toolbar']}
        onSubmit={(event) => void add(event)}
        aria-label="Add a citation style"
        noValidate
      >
        <label className={styles['filter']}>
          CSL file
          <input type="file" accept=".csl,.xml" onChange={(change) => void chosen(change)} />
        </label>
        {csl !== null && (
          <>
            <label className={styles['filter']}>
              Name
              <input value={name} onChange={(change) => setName(change.target.value)} />
            </label>
            <label className={styles['filter']}>
              What each type requires
              <textarea
                rows={6}
                value={requires}
                onChange={(change) => setRequires(change.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
              Add style
            </button>
          </>
        )}
      </form>
      {shown !== null && shown.problems.length > 0 && (
        <ul aria-label="Why the style would be refused">
          {shown.problems.map((problem) => (
            <li key={problem.message}>{problem.message}</li>
          ))}
        </ul>
      )}
      {shown?.sample && <Sample sample={shown.sample} />}
      <Shown read={read} failed="The citation styles could not be loaded.">
        {(rows) => (
          <table aria-label="Citation styles" className={styles['table']}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Version</th>
                <th scope="col">Given</th>
                <th scope="col">
                  <span className={styles['hidden']}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((style) => (
                <tr key={style.id}>
                  <td className={styles['strong']}>{style.name}</td>
                  <td>{style.version.number}</td>
                  <td>{style.seeded ? 'Yes' : 'No'}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Preview ${style.name}`}
                      onClick={() => void previewHeld(style)}
                    >
                      Preview
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Shown>
      <p role="status">{said}</p>
    </>
  );
}
