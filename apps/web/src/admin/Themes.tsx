import type { createApiClient } from '@alloy-works/api-client';
import {
  explainStyle,
  PLACES,
  projectCss,
  projectFontFaces,
  readTheme,
  type CharacterStyle,
  type ParagraphStyle,
  type ResolvedParagraphProperties,
  type ThemeRefusal,
} from '@alloy-works/domain';
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { capHeight, faceUrl } from '../theme/faces.js';
import { words, type WordKey } from '../words/words.js';
import styles from './Administration.module.css';
import own from './Themes.module.css';
import { Shown, useListing } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

interface Summary {
  readonly id: string;
  readonly name: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly isDefault: boolean;
}
interface ThemeView extends Summary {
  readonly content: Record<string, unknown> & { readonly catalogues: Record<string, string> };
  readonly catalogues: readonly { readonly versionId: string; readonly content: unknown }[];
}
interface ParagraphCatalogue {
  readonly kind: 'paragraph';
  readonly base: ResolvedParagraphProperties;
  readonly styles: readonly ParagraphStyle[];
}

interface CharacterCatalogue {
  readonly kind: 'character';
  readonly styles: readonly CharacterStyle[];
}

type Key = keyof ResolvedParagraphProperties;
type Control =
  'number' | 'fraction' | 'check' | 'colour' | 'fill' | 'typeface' | 'alignment' | 'position';

/** Every paragraph property, in the order the form sets them, with its control and its name. */
const PROPERTIES: readonly (readonly [Key, Control, WordKey])[] = [
  ['typeface', 'typeface', 'admin.style-typeface'],
  ['size', 'number', 'admin.style-size'],
  ['bold', 'check', 'admin.style-bold'],
  ['italic', 'check', 'admin.style-italic'],
  ['colour', 'colour', 'admin.style-colour'],
  ['background', 'fill', 'admin.style-background'],
  ['padding', 'number', 'admin.style-padding'],
  ['alignment', 'alignment', 'admin.style-alignment'],
  ['firstLineIndent', 'number', 'admin.style-first-line-indent'],
  ['startIndent', 'number', 'admin.style-start-indent'],
  ['endIndent', 'number', 'admin.style-end-indent'],
  ['spaceBefore', 'number', 'admin.style-space-before'],
  ['spaceAfter', 'number', 'admin.style-space-after'],
  ['lineSpacing', 'number', 'admin.style-line-spacing'],
  ['keepWithNext', 'check', 'admin.style-keep-with-next'],
  ['keepTogether', 'check', 'admin.style-keep-together'],
  ['widowControl', 'check', 'admin.style-widow-control'],
  ['hyphenate', 'check', 'admin.style-hyphenate'],
  ['contextualSpacing', 'check', 'admin.style-contextual-spacing'],
];
const ALIGNMENTS = ['start', 'end', 'centre', 'justify'] as const;
const POSITIONS = ['subscript', 'superscript'] as const;

type CharacterKey = keyof CharacterStyle['properties'];

/** Every character property, in the order the form sets them; each absent one is the run's around it. */
const CHARACTER_PROPERTIES: readonly (readonly [CharacterKey, Control, WordKey])[] = [
  ['typeface', 'typeface', 'admin.style-typeface'],
  ['scale', 'fraction', 'admin.style-scale'],
  ['bold', 'check', 'admin.style-bold'],
  ['italic', 'check', 'admin.style-italic'],
  ['underline', 'check', 'admin.style-underline'],
  ['colour', 'colour', 'admin.style-colour'],
  ['position', 'position', 'admin.style-position'],
];

/** What a property starts at when it is set here; a typeface and a colour, the paragraphs' base. */
const CHARACTER_START: Readonly<
  Record<Exclude<CharacterKey, 'typeface' | 'colour'>, string | boolean>
> = {
  scale: '1',
  bold: false,
  italic: false,
  underline: false,
  position: 'superscript',
};

/** A style being edited: what it states, each value as its control holds it. */
interface Draft {
  readonly isNew: boolean;
  readonly id: string;
  readonly name: string;
  readonly basedOn: string;
  readonly appliesTo: readonly string[];
  readonly stated: Readonly<Partial<Record<Key, string | boolean>>>;
}

const asStated = (properties: ParagraphStyle['properties']): Draft['stated'] =>
  Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value)]),
  );

/** The draft as the catalogue holds a style: a number's text read as a number, for the reader to judge. */
function styleOf(draft: Draft): ParagraphStyle {
  const properties: Record<string, unknown> = {};
  for (const [key, control] of PROPERTIES) {
    const value = draft.stated[key];
    if (value === undefined) continue;
    properties[key] =
      control === 'number' && typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : value;
  }
  return {
    id: draft.id,
    name: draft.name,
    ...(draft.basedOn === '' ? {} : { basedOn: draft.basedOn }),
    appliesTo: draft.appliesTo,
    properties,
  } as ParagraphStyle;
}

/**
 * Administration's **Document themes** (the SY plan, SY-F): the environment's themes; a theme's
 * paragraph styles, each a form of its properties saying where each value comes from (STY-057) beside
 * a sample set by the editor's own CSS projection of the unsaved style; the documents a change reaches,
 * listed before it is saved (STY-034, STY-067); and what the theme reader refuses, said as it is set.
 */
export function Themes({ client }: { client: Client }) {
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/themes');
    return data ? { items: data.items as Summary[] } : { status: response.status };
  });
  const [generation, setGeneration] = useState(0);
  const read = useListing<Summary>(load, true, generation);
  const [theme, setTheme] = useState<ThemeView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [said, setSaid] = useState('');

  const open = async (id: string) => {
    const { data, error } = await client.GET('/v1/themes/{id}', { params: { path: { id } } });
    if (!data) return setSaid(refusal(error, words('admin.theme-could-not-be-loaded')));
    setTheme(data as unknown as ThemeView);
    setDraft(null);
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.themes-lead')}</p>
      </div>
      <Shown read={read} failed={words('admin.themes-could-not-be-loaded')}>
        {(rows) => (
          <table aria-label={words('admin.document-themes')} className={styles['table']}>
            <thead>
              <tr>
                <th scope="col">{words('admin.name')}</th>
                <th scope="col">{words('admin.theme-version')}</th>
                <th scope="col">
                  <span className={styles['hidden']}>{words('admin.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((each) => (
                <tr key={each.id}>
                  <th scope="row" className={styles['strong']} data-content>
                    {each.name}
                    {each.isDefault && ` (${words('admin.theme-default')})`}
                  </th>
                  <td>{each.version.number}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={words('admin.open-theme', { name: each.name })}
                      onClick={() => void open(each.id)}
                    >
                      {words('admin.open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Shown>
      {theme !== null && (
        <ThemeStyles
          actions={
            <ThemeActions
              client={client}
              theme={theme}
              onDone={(next, message) => {
                setTheme(next);
                setDraft(null);
                setSaid(message);
                setGeneration((now) => now + 1);
              }}
              onSaid={setSaid}
            />
          }
          client={client}
          theme={theme}
          draft={draft}
          setDraft={setDraft}
          onSaved={(next, message) => {
            setTheme(next);
            setDraft(null);
            setSaid(message);
          }}
          onSaid={setSaid}
        />
      )}
      <p role="status">{said}</p>
    </>
  );
}

/**
 * A theme's own acts (the SY plan, SY-G, STY-072): **Duplicate** it under a name, **Rename** it, and
 * **Use as the environment's default** for the documents made from no template.
 */
function ThemeActions({
  client,
  theme,
  onDone,
  onSaid,
}: {
  client: Client;
  theme: ThemeView;
  onDone: (theme: ThemeView, message: string) => void;
  onSaid: (message: string) => void;
}) {
  const asking = useId();
  const [naming, setNaming] = useState<{ act: 'duplicate' | 'rename'; name: string } | null>(null);

  const named = async (event: FormEvent) => {
    event.preventDefault();
    if (naming === null) return;
    const name = naming.name.trim();
    setNaming(null);
    if (naming.act === 'duplicate') {
      const { data, error } = await client.POST('/v1/themes', { body: { from: theme.id, name } });
      if (!data) return onSaid(refusal(error, words('admin.theme-could-not-be-duplicated')));
      return onDone(
        data as unknown as ThemeView,
        words('admin.theme-duplicated', { name, from: theme.name }),
      );
    }
    const { data, error } = await client.PUT('/v1/themes/{id}/name', {
      params: { path: { id: theme.id } },
      body: { openedFrom: theme.version.id, name },
    });
    if (!data) return onSaid(refusal(error, words('admin.theme-could-not-be-renamed')));
    onDone(data as unknown as ThemeView, words('admin.theme-renamed', { name }));
  };
  const declare = async () => {
    const { data, error } = await client.POST('/v1/themes/{id}/default', {
      params: { path: { id: theme.id } },
    });
    if (!data) return onSaid(refusal(error, words('admin.theme-could-not-be-declared')));
    onDone(data as unknown as ThemeView, words('admin.theme-declared', { name: theme.name }));
  };

  return (
    <div className={`${own['actions']} ${own['acts']}`}>
      <button type="button" onClick={() => setNaming({ act: 'duplicate', name: '' })}>
        {words('admin.theme-duplicate')}
      </button>
      <button type="button" onClick={() => setNaming({ act: 'rename', name: theme.name })}>
        {words('admin.theme-rename')}
      </button>
      {!theme.isDefault && (
        <button type="button" onClick={() => void declare()}>
          {words('admin.theme-use-as-default')}
        </button>
      )}
      {naming !== null && (
        <Modal labelledBy={asking} size="dialog" onClose={() => setNaming(null)}>
          <form className={own['naming']} onSubmit={(event) => void named(event)} noValidate>
            <h2 id={asking}>
              {words(naming.act === 'duplicate' ? 'admin.duplicate-theme' : 'admin.rename-theme', {
                name: theme.name,
              })}
            </h2>
            <label className={own['field']}>
              {words('admin.name')}
              <input
                value={naming.name}
                required
                onChange={(change) => setNaming({ ...naming, name: change.target.value })}
              />
            </label>
            <div className={own['actions']}>
              <button type="button" onClick={() => setNaming(null)}>
                {words('admin.cancel')}
              </button>
              <button type="submit" className="primary" disabled={naming.name.trim() === ''}>
                {words(naming.act === 'duplicate' ? 'admin.theme-duplicate' : 'admin.theme-rename')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ThemeStyles({
  actions,
  client,
  theme,
  draft,
  setDraft,
  onSaved,
  onSaid,
}: {
  actions: ReactNode;
  client: Client;
  theme: ThemeView;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  onSaved: (theme: ThemeView, message: string) => void;
  onSaid: (message: string) => void;
}) {
  const paragraphVersion = theme.content.catalogues['paragraph']!;
  const catalogue = theme.catalogues.find((each) => each.versionId === paragraphVersion)!
    .content as ParagraphCatalogue;
  const names = new Map(catalogue.styles.map((style) => [style.id, style.name]));
  const characterVersion = theme.content.catalogues['character']!;
  const characters = theme.catalogues.find((each) => each.versionId === characterVersion)!
    .content as CharacterCatalogue;
  const [character, setCharacter] = useState<CharacterStyle | null>(null);
  const saved = (next: ThemeView, message: string) => {
    setCharacter(null);
    onSaved(next, message);
  };
  return (
    <section aria-labelledby="theme-styles">
      <h2 id="theme-styles">{theme.name}</h2>
      {actions}
      <table aria-label={words('admin.paragraph-styles')} className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">{words('admin.name')}</th>
            <th scope="col">{words('admin.style-based-on')}</th>
            <th scope="col">
              <span className={styles['hidden']}>{words('admin.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {catalogue.styles.map((style) => (
            <tr key={style.id}>
              <th scope="row" data-content>
                {style.name}
              </th>
              <td data-content>
                {style.basedOn === undefined ? '' : (names.get(style.basedOn) ?? style.basedOn)}
              </td>
              <td>
                <button
                  type="button"
                  aria-label={words('admin.edit', { name: style.name })}
                  onClick={() => {
                    setCharacter(null);
                    setDraft({
                      isNew: false,
                      id: style.id,
                      name: style.name,
                      basedOn: style.basedOn ?? '',
                      appliesTo: style.appliesTo,
                      stated: asStated(style.properties),
                    });
                  }}
                >
                  {words('admin.edit-2')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => {
          setCharacter(null);
          setDraft({ isNew: true, id: '', name: '', basedOn: '', appliesTo: ['text'], stated: {} });
        }}
      >
        {words('admin.add-paragraph-style')}
      </button>
      {draft !== null && (
        <StyleForm
          key={draft.isNew ? 'new' : draft.id}
          client={client}
          theme={theme}
          catalogue={catalogue}
          draft={draft}
          setDraft={setDraft}
          onSaved={saved}
          onSaid={onSaid}
        />
      )}
      <table aria-label={words('admin.character-styles')} className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">{words('admin.name')}</th>
            <th scope="col">
              <span className={styles['hidden']}>{words('admin.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {characters.styles.map((style) => (
            <tr key={style.id}>
              <th scope="row" data-content>
                {style.name}
              </th>
              <td>
                <button
                  type="button"
                  aria-label={words('admin.edit', { name: style.name })}
                  onClick={() => {
                    setDraft(null);
                    setCharacter(style);
                  }}
                >
                  {words('admin.edit-2')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {character !== null && (
        <CharacterForm
          key={character.id}
          client={client}
          theme={theme}
          catalogue={characters}
          style={character}
          setStyle={setCharacter}
          onSaved={saved}
          onSaid={onSaid}
        />
      )}
      <OfferedStyles
        key={theme.version.id}
        client={client}
        theme={theme}
        onSaved={saved}
        onSaid={onSaid}
      />
    </section>
  );
}

function StyleForm({
  client,
  theme,
  catalogue,
  draft,
  setDraft,
  onSaved,
  onSaid,
}: {
  client: Client;
  theme: ThemeView;
  catalogue: ParagraphCatalogue;
  draft: Draft;
  setDraft: (draft: Draft | null) => void;
  onSaved: (theme: ThemeView, message: string) => void;
  onSaid: (message: string) => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const style = styleOf(draft);
  const shownName = draft.name.trim() === '' ? draft.id : draft.name;

  // The catalogue as it would be, read by the reader every output reads it by.
  const proposed = useMemo(() => {
    const styles = draft.isNew
      ? [...catalogue.styles, style]
      : catalogue.styles.map((each) => (each.id === draft.id ? style : each));
    const next = { ...catalogue, styles };
    const version = theme.content.catalogues['paragraph']!;
    const read = readTheme(
      theme.content,
      new Map(
        theme.catalogues.map((each) => [
          each.versionId,
          each.versionId === version ? next : each.content,
        ]),
      ),
    );
    return { next, read, explained: explainStyle(next, draft.id) };
    // The style is derived from the draft, which is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, theme, draft]);

  const named = draft.id !== '' && draft.name.trim() !== '';
  // Said once the style is named: a new style's empty identifier is no refusal of the reader's to say.
  const refusals: readonly ThemeRefusal[] = !named
    ? []
    : [
        ...(proposed.read.ok ? [] : proposed.read.refusals),
        ...(proposed.explained.ok || !proposed.read.ok ? [] : proposed.explained.refusals),
      ];
  const css = proposed.read.ok
    ? projectFontFaces(proposed.read.theme, faceUrl).css +
      projectCss(proposed.read.theme, { capHeight })
    : '';
  const others = catalogue.styles.filter((each) => each.id !== draft.id);
  const nameOf = (id: string | null) =>
    id === null
      ? words('admin.style-from-base')
      : words('admin.style-from', {
          name: catalogue.styles.find((each) => each.id === id)?.name ?? id,
        });
  const place = (key: Key, value: string | boolean | undefined) => {
    const stated = { ...draft.stated };
    if (value === undefined) delete stated[key];
    else stated[key] = value;
    setDraft({ ...draft, stated });
  };

  const weigh = async (event: FormEvent) => {
    event.preventDefault();
    const { data, error } = await client.POST('/v1/themes/{id}/impact', {
      params: { path: { id: theme.id } },
      body: { kind: 'paragraph', style: draft.id },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-saved')));
    setImpact(data);
  };
  const save = async () => {
    setImpact(null);
    const { data, error } = await client.PUT('/v1/themes/{id}/styles/{kind}/{style}', {
      params: { path: { id: theme.id, kind: 'paragraph', style: draft.id } },
      body: { openedFrom: theme.version.id, style: style as unknown as Record<string, unknown> },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-saved')));
    onSaved(
      data as unknown as ThemeView,
      words('admin.style-saved', {
        name: shownName,
        theme: data.name,
        number: data.version.number,
      }),
    );
  };
  const remove = async () => {
    setDeleting(false);
    const { data, error } = await client.DELETE('/v1/themes/{id}/styles/{kind}/{style}', {
      params: {
        path: { id: theme.id, kind: 'paragraph', style: draft.id },
        query: { openedFrom: theme.version.id },
      },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-deleted')));
    onSaved(data as unknown as ThemeView, words('admin.style-deleted', { name: shownName }));
  };

  return (
    <form
      aria-label={
        draft.isNew
          ? words('admin.new-paragraph-style')
          : words('admin.paragraph-style-named', { name: draft.name })
      }
      onSubmit={(event) => void weigh(event)}
      noValidate
    >
      <div className={own['editor']}>
        <div>
          <div className={own['heading']}>
            <label className={own['field']}>
              {words('admin.name')}
              <input
                value={draft.name}
                onChange={(change) => setDraft({ ...draft, name: change.target.value })}
              />
            </label>
            {draft.isNew && (
              <label className={own['field']}>
                {words('admin.style-identifier')}
                <input
                  value={draft.id}
                  onChange={(change) => setDraft({ ...draft, id: change.target.value.trim() })}
                />
              </label>
            )}
            <label className={own['field']}>
              {words('admin.style-based-on')}
              <select
                value={draft.basedOn}
                onChange={(change) => setDraft({ ...draft, basedOn: change.target.value })}
              >
                <option value="">{words('admin.style-based-on-nothing')}</option>
                {others.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {PROPERTIES.map(([key, control, label]) => {
            const stated = draft.stated[key];
            const explained = proposed.explained.ok
              ? proposed.explained.properties[key]
              : undefined;
            const name = words(label);
            return (
              <fieldset key={key} className={own['property']}>
                <legend>{name}</legend>
                {stated === undefined ? (
                  <>
                    <span>{explained === undefined ? '' : shown(control, explained.value)}</span>
                    <span className={own['from']}>
                      {explained === undefined ? '' : nameOf(explained.from)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        place(
                          key,
                          typeof explained?.value === 'boolean'
                            ? explained.value
                            : String(explained?.value ?? ''),
                        )
                      }
                    >
                      {words('admin.style-set-here')}
                    </button>
                  </>
                ) : (
                  <>
                    <Field
                      control={control}
                      label={name}
                      value={stated}
                      typefaces={(
                        (theme.content['typefaces'] as readonly { id: string }[] | undefined) ?? []
                      ).map((each) => each.id)}
                      onChange={(value) => place(key, value)}
                    />
                    <span className={own['from']}>{words('admin.style-set-here-said')}</span>
                    <button type="button" onClick={() => place(key, undefined)}>
                      {words('admin.style-use-inherited')}
                    </button>
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
        <div className={own['side']}>
          <div className={own['sample']} data-testid="style-sample">
            {css !== '' && <style>{css}</style>}
            <div className="aw-canvas">
              <p data-style={draft.id === '' ? 'body' : draft.id} data-place={draft.appliesTo[0]}>
                {words('admin.style-sample')}
              </p>
            </div>
          </div>
          {refusals.length > 0 && (
            <ul role="alert">
              {refusals.map((each) => (
                <li key={each.code + each.message}>{each.message}</li>
              ))}
            </ul>
          )}
          <div className={own['actions']}>
            <button type="submit" className="primary" disabled={!named || refusals.length > 0}>
              {words('admin.save-style')}
            </button>
            {!draft.isNew && (
              <button type="button" onClick={() => setDeleting(true)}>
                {words('admin.delete-style')}
              </button>
            )}
            <button type="button" onClick={() => setDraft(null)}>
              {words('admin.cancel')}
            </button>
          </div>
        </div>
      </div>
      {impact !== null && (
        <Reach
          question={words('admin.save-style-question', { name: shownName })}
          impact={impact}
          onCancel={() => setImpact(null)}
          onSave={() => void save()}
        />
      )}
      {deleting && (
        <ConfirmDialog
          question={words('admin.delete-style-question', { name: shownName })}
          sentence={words('admin.delete-style-sentence')}
          keep={words('admin.cancel')}
          act={words('admin.delete')}
          onKeep={() => setDeleting(false)}
          onAct={remove}
        />
      )}
    </form>
  );
}

/** The documents a style change reaches, as `POST /v1/themes/{id}/impact` answers. */
interface Impact {
  readonly documents: readonly { readonly id: string; readonly title: string }[];
  readonly unreadable: number;
}

/** The reach of a change, asked before it is saved (STY-034, STY-067). */
function Reach({
  question,
  impact,
  onCancel,
  onSave,
}: {
  question: string;
  impact: Impact;
  onCancel: () => void;
  onSave: () => void;
}) {
  const asking = useId();
  return (
    <Modal labelledBy={asking} size="dialog" onClose={onCancel}>
      <h2 id={asking}>{question}</h2>
      <p>
        {impact.documents.length + impact.unreadable === 0
          ? words('admin.style-reaches-nothing')
          : words('admin.style-reaches', {
              count: impact.documents.length + impact.unreadable,
            })}
      </p>
      {impact.documents.length > 0 && (
        // Scrolled where long, so the keyboard reaches it too.
        <ul className={own['reach']} tabIndex={0} aria-label={words('admin.style-reach')}>
          {impact.documents.map((each) => (
            <li key={each.id} data-content>
              {each.title}
            </li>
          ))}
        </ul>
      )}
      {impact.unreadable > 0 && (
        <p>{words('admin.style-reaches-unreadable', { count: impact.unreadable })}</p>
      )}
      <div className={own['actions']}>
        <button type="button" data-autofocus onClick={onCancel}>
          {words('admin.cancel')}
        </button>
        <button type="button" className="primary" onClick={onSave}>
          {words('admin.save')}
        </button>
      </div>
    </Modal>
  );
}

/** The kinds of style a theme may narrow what authors are offered of (STY-033). */
const OFFERED_KINDS = ['paragraph', 'table', 'image'] as const;
type OfferedKind = (typeof OFFERED_KINDS)[number];
type Offered = Partial<Record<OfferedKind, string[]>>;

/**
 * **The styles offered to authors** (the SY plan, SY-H; STY-033): by kind, every style or only those
 * chosen. Saving first lists the documents using a style it drops, as a style change does (SY-D).
 */
function OfferedStyles({
  client,
  theme,
  onSaved,
  onSaid,
}: {
  client: Client;
  theme: ThemeView;
  onSaved: (theme: ThemeView, message: string) => void;
  onSaid: (message: string) => void;
}) {
  const named = useId();
  // A paragraph style only a role takes is the template's to set, never an author's to choose.
  const listed = (kind: OfferedKind) =>
    (
      theme.catalogues.find((each) => each.versionId === theme.content.catalogues[kind])!
        .content as { styles: readonly { id: string; name: string; appliesTo: string[] }[] }
    ).styles.filter(
      (style) =>
        kind !== 'paragraph' ||
        style.appliesTo.some((target) => (PLACES as readonly string[]).includes(target)),
    );
  const stated = (theme.content['allowed'] as Offered | undefined) ?? {};
  const [offered, setOffered] = useState<Offered>(stated);
  const [impact, setImpact] = useState<Impact | null>(null);
  const changed = JSON.stringify(offered) !== JSON.stringify(stated);
  const offer = (kind: OfferedKind, ids: string[] | undefined) => {
    const next = { ...offered };
    if (ids === undefined) delete next[kind];
    else next[kind] = ids;
    setOffered(next);
  };

  const weigh = async () => {
    const dropped = OFFERED_KINDS.flatMap((kind) => {
      const now = offered[kind];
      if (now === undefined) return [];
      const before = stated[kind] ?? listed(kind).map((each) => each.id);
      return before.filter((id) => !now.includes(id)).map((style) => ({ kind, style }));
    });
    const answers = await Promise.all(
      dropped.map((body) =>
        client.POST('/v1/themes/{id}/impact', { params: { path: { id: theme.id } }, body }),
      ),
    );
    const failed = answers.find((each) => !each.data);
    if (failed) return onSaid(refusal(failed.error, words('admin.offered-could-not-be-saved')));
    const documents = new Map<string, { id: string; title: string }>();
    for (const each of answers) for (const one of each.data!.documents) documents.set(one.id, one);
    setImpact({
      documents: [...documents.values()],
      unreadable: Math.max(0, ...answers.map((each) => each.data!.unreadable)),
    });
  };
  const save = async () => {
    setImpact(null);
    const { data, error } = await client.PUT('/v1/themes/{id}/allowed', {
      params: { path: { id: theme.id } },
      body: { openedFrom: theme.version.id, allowed: offered },
    });
    if (!data) return onSaid(refusal(error, words('admin.offered-could-not-be-saved')));
    onSaved(
      data as unknown as ThemeView,
      words('admin.offered-saved', { theme: data.name, number: data.version.number }),
    );
  };

  return (
    <section aria-labelledby={named}>
      <h3 id={named}>{words('admin.offered-to-authors')}</h3>
      <p>{words('admin.offered-lead')}</p>
      {OFFERED_KINDS.map((kind) => {
        const only = offered[kind];
        return (
          <fieldset key={kind} className={own['offered']}>
            <legend>{words(`admin.offered-${kind}` as WordKey)}</legend>
            <label>
              <input
                type="radio"
                name={`${named}-${kind}`}
                checked={only === undefined}
                onChange={() => offer(kind, undefined)}
              />
              {words('admin.offered-every')}
            </label>
            <label>
              <input
                type="radio"
                name={`${named}-${kind}`}
                checked={only !== undefined}
                onChange={() =>
                  offer(
                    kind,
                    listed(kind).map((each) => each.id),
                  )
                }
              />
              {words('admin.offered-only')}
            </label>
            {only !== undefined && (
              <div className={own['choices']}>
                {listed(kind).map((style) => (
                  <label key={style.id} data-content>
                    <input
                      type="checkbox"
                      checked={only.includes(style.id)}
                      onChange={(change) =>
                        offer(
                          kind,
                          change.target.checked
                            ? listed(kind)
                                .map((each) => each.id)
                                .filter((id) => id === style.id || only.includes(id))
                            : only.filter((id) => id !== style.id),
                        )
                      }
                    />
                    {style.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        );
      })}
      <div className={own['actions']}>
        <button type="button" className="primary" disabled={!changed} onClick={() => void weigh()}>
          {words('admin.offered-save')}
        </button>
      </div>
      {impact !== null && (
        <Reach
          question={words('admin.offered-save-question')}
          impact={impact}
          onCancel={() => setImpact(null)}
          onSave={() => void save()}
        />
      )}
    </section>
  );
}

/**
 * A character style's form (the SY plan, SY-F): one mark's look, each property stated here or left
 * to the text it stands in, beside a paragraph with the mark in it, set by the editor's CSS.
 */
function CharacterForm({
  client,
  theme,
  catalogue,
  style,
  setStyle,
  onSaved,
  onSaid,
}: {
  client: Client;
  theme: ThemeView;
  catalogue: CharacterCatalogue;
  style: CharacterStyle;
  setStyle: (style: CharacterStyle | null) => void;
  onSaved: (theme: ThemeView, message: string) => void;
  onSaid: (message: string) => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const version = theme.content.catalogues['character']!;
  // The scale as the catalogue holds it, a number, for the reader to judge.
  const proposed = useMemo<CharacterStyle>(() => {
    const scale = style.properties.scale as number | string | undefined;
    return {
      ...style,
      properties: {
        ...style.properties,
        ...(typeof scale === 'string' ? { scale: Number(scale) } : {}),
      },
    };
  }, [style]);
  const read = useMemo(
    () =>
      readTheme(
        theme.content,
        new Map(
          theme.catalogues.map((each) => [
            each.versionId,
            each.versionId === version
              ? {
                  ...catalogue,
                  styles: catalogue.styles.map((one) => (one.id === style.id ? proposed : one)),
                }
              : each.content,
          ]),
        ),
      ),
    [theme, catalogue, proposed, style.id, version],
  );
  const css = read.ok
    ? projectFontFaces(read.theme, faceUrl).css + projectCss(read.theme, { capHeight })
    : '';
  const paragraphs = theme.content.catalogues['paragraph']!;
  const { base } = theme.catalogues.find((each) => each.versionId === paragraphs)!
    .content as ParagraphCatalogue;
  const faces = ((theme.content['typefaces'] as readonly { id: string }[] | undefined) ?? []).map(
    (each) => each.id,
  );
  const place = (key: CharacterKey, value: string | boolean | undefined) => {
    const properties: Record<string, unknown> = { ...style.properties };
    if (value === undefined) delete properties[key];
    else properties[key] = value;
    setStyle({ ...style, properties: properties as CharacterStyle['properties'] });
  };

  const weigh = async (event: FormEvent) => {
    event.preventDefault();
    const { data, error } = await client.POST('/v1/themes/{id}/impact', {
      params: { path: { id: theme.id } },
      body: { kind: 'character', style: style.id },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-saved')));
    setImpact(data);
  };
  const save = async () => {
    setImpact(null);
    const { data, error } = await client.PUT('/v1/themes/{id}/styles/{kind}/{style}', {
      params: { path: { id: theme.id, kind: 'character', style: style.id } },
      body: { openedFrom: theme.version.id, style: proposed as unknown as Record<string, unknown> },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-saved')));
    onSaved(
      data as unknown as ThemeView,
      words('admin.style-saved', {
        name: style.name,
        theme: data.name,
        number: data.version.number,
      }),
    );
  };

  return (
    <form
      aria-label={words('admin.character-style-named', { name: style.name })}
      onSubmit={(event) => void weigh(event)}
      noValidate
    >
      <div className={own['editor']}>
        <div>
          {CHARACTER_PROPERTIES.map(([key, control, label]) => {
            const stated = style.properties[key] as string | number | boolean | undefined;
            const name = words(label);
            return (
              <fieldset key={key} className={own['property']}>
                <legend>{name}</legend>
                {stated === undefined ? (
                  <>
                    <span className={own['from']}>{words('admin.style-from-the-text')}</span>
                    <button
                      type="button"
                      onClick={() =>
                        place(
                          key,
                          key === 'typeface' || key === 'colour' ? base[key] : CHARACTER_START[key],
                        )
                      }
                    >
                      {words('admin.style-set-here')}
                    </button>
                  </>
                ) : (
                  <>
                    <Field
                      control={control}
                      label={name}
                      value={typeof stated === 'number' ? String(stated) : stated}
                      typefaces={faces}
                      onChange={(value) => place(key, value)}
                    />
                    <span className={own['from']}>{words('admin.style-set-here-said')}</span>
                    <button type="button" onClick={() => place(key, undefined)}>
                      {words('admin.style-use-inherited')}
                    </button>
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
        <div className={own['side']}>
          <div className={own['sample']} data-testid="style-sample">
            {css !== '' && <style>{css}</style>}
            <div className="aw-canvas">
              <p data-style="body" data-place="text">
                {words('admin.style-sample-before')}{' '}
                <span className={`aw-mark-${style.mark}`}>
                  <span className="aw-mark-below">
                    <span className="aw-mark-run">{words('admin.style-sample-marked')}</span>
                  </span>
                </span>{' '}
                {words('admin.style-sample-after')}
              </p>
            </div>
          </div>
          {!read.ok && (
            <ul role="alert">
              {read.refusals.map((each) => (
                <li key={each.code + each.message}>{each.message}</li>
              ))}
            </ul>
          )}
          <div className={own['actions']}>
            <button type="submit" className="primary" disabled={!read.ok}>
              {words('admin.save-style')}
            </button>
            <button type="button" onClick={() => setStyle(null)}>
              {words('admin.cancel')}
            </button>
          </div>
        </div>
      </div>
      {impact !== null && (
        <Reach
          question={words('admin.save-style-question', { name: style.name })}
          impact={impact}
          onCancel={() => setImpact(null)}
          onSave={() => void save()}
        />
      )}
    </form>
  );
}

/** A value as a person reads it: yes or no, a length in points, an alignment's name. */
function shown(control: Control, value: unknown): string {
  if (typeof value === 'boolean') return value ? words('admin.yes') : words('admin.no');
  if (control === 'number') return words('admin.style-points', { value: String(value) });
  if (control === 'alignment') return words(`admin.style-align-${String(value)}` as WordKey);
  return String(value);
}

function Field({
  control,
  label,
  value,
  typefaces,
  onChange,
}: {
  control: Control;
  label: string;
  value: string | boolean;
  typefaces: readonly string[];
  onChange: (value: string | boolean) => void;
}) {
  if (control === 'check') {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        onChange={(change) => onChange(change.target.checked)}
      />
    );
  }
  if (control === 'typeface' || control === 'alignment' || control === 'position') {
    const options =
      control === 'typeface' ? typefaces : control === 'alignment' ? ALIGNMENTS : POSITIONS;
    return (
      <select
        aria-label={label}
        value={String(value)}
        onChange={(change) => onChange(change.target.value)}
      >
        {options.map((each) => (
          <option key={each} value={each}>
            {control === 'alignment'
              ? words(`admin.style-align-${each}` as WordKey)
              : control === 'position'
                ? words(`admin.style-position-${each}` as WordKey)
                : each}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      {...(control === 'number' || control === 'fraction' ? { type: 'number', step: 'any' } : {})}
      value={String(value)}
      onChange={(change) => onChange(change.target.value)}
    />
  );
}
