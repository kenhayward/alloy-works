import type { createApiClient } from '@alloy-works/api-client';
import { hasText, outlineDocumentSchema, type TemplateParameter } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import { useCreatableSpaces, useLanguageField } from '../spaces.js';
import { everyPage } from '../paging.js';
import {
  declarationsIn,
  labelOf,
  listed,
  missingParameters,
  ParameterInput,
  refusedParameters,
  startingValue,
  valuesToSend,
  type ParameterValue,
} from './ParameterInput.js';
import styles from './NewDocument.module.css';
import { TemplateGallery, useNarrow } from './TemplateGallery.js';
import { defaultOffer, offerKey, withBlank, type TemplateOffer } from './galleryOffers.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** The outline's own tag rule, so the form refuses what the service would, with one rule and not two. */
const language = outlineDocumentSchema.shape.language;

/**
 * The templates the caller may read, each with its summary (ND-H), or `'failed'` when they could not
 * be listed - which leaves the Where space's Blank to choose, and says so.
 */
function useTemplates(client: Client): readonly TemplateOffer[] | 'failed' | null {
  const [templates, setTemplates] = useState<readonly TemplateOffer[] | 'failed' | null>(null);
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
        setTemplates(
          'items' in all
            ? all.items.map((item) => ({
                id: item.id,
                name: item.name,
                space: item.space,
                description: item.description ?? null,
                sections: item.sections,
                values: item.values,
                requiredValues: item.requiredValues,
                copied: item.copied,
                referenced: item.referenced,
                headings: item.headings,
                isDefault: item.isDefault,
              }))
            : 'failed',
        );
      } catch {
        if (current) setTemplates('failed');
      }
    })();
    return () => {
      current = false;
    };
  }, [client]);
  return templates;
}

/**
 * The parameters the chosen template declares, read with `GET /v1/templates/{id}` (the TP1 plan,
 * TP1-I): none for a Blank not yet made, `'failed'` where the template could not be read - which
 * leaves the service to refuse what is missing, and says so.
 */
function useDeclared(
  client: Client,
  template: string | null,
): readonly TemplateParameter[] | 'failed' | null {
  const [declared, setDeclared] = useState<{
    readonly template: string;
    readonly parameters: readonly TemplateParameter[] | 'failed';
  } | null>(null);
  useEffect(() => {
    if (template === null) return undefined;
    let current = true;
    client
      .GET('/v1/templates/{id}', { params: { path: { id: template } } })
      .then(({ data }) => {
        if (!current) return;
        const definition: unknown = data?.definition;
        setDeclared({
          template,
          parameters:
            typeof definition === 'object' && definition !== null
              ? declarationsIn((definition as { parameters?: unknown }).parameters)
              : 'failed',
        });
      })
      .catch(() => {
        if (current) setDeclared({ template, parameters: 'failed' });
      });
    return () => {
      current = false;
    };
  }, [client, template]);
  if (template === null) return [];
  return declared?.template === template ? declared.parameters : null;
}

/** Whether a scrolling box has more above and below it, for its fades. */
function useOverflow(box: React.RefObject<HTMLElement | null>, deps: readonly unknown[]) {
  const [more, setMore] = useState({ above: false, below: false });
  const measure = useCallback(() => {
    const element = box.current;
    if (!element) return;
    const above = element.scrollTop > 0;
    const below = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    setMore((was) => (was.above === above && was.below === below ? was : { above, below }));
  }, [box]);
  useLayoutEffect(() => {
    measure();
    const element = box.current;
    if (!element || typeof ResizeObserver !== 'function') return undefined;
    const watching = new ResizeObserver(measure);
    watching.observe(element);
    return () => watching.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);
  return { more, measure };
}

export interface NewDocumentProps {
  readonly client: Client;
  /** Called with the new document's id, so the page can open it. */
  readonly onCreated: (id: string) => void;
  /** Closes the dialog holding it. */
  readonly onCancel?: () => void;
}

/**
 * Making a document (the ND plan; the handoff in `docs/interface/handoffs/new-document/`): a gallery
 * of templates beside what is chosen, its title, its values in a region of their own that scrolls,
 * and where, language and direction. A template is always chosen (TPL-074): the Where space's
 * default, its Blank until another is chosen. Shown only where there is somewhere the caller may
 * create, so nobody is offered a form that could only refuse them.
 */
export function NewDocument({ client, onCreated, onCancel }: NewDocumentProps) {
  const {
    spaces,
    problem: spacesProblem,
    where,
    setWhere,
    reload: loadSpaces,
  } = useCreatableSpaces(client);
  const [title, setTitle] = useState('');
  const [languageTag, setLanguageTag] = useLanguageField(spaces, where);
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const templates = useTemplates(client);
  const whereSpace = spaces?.find((each) => each.id === where);
  const offers = useMemo(
    () =>
      withBlank(
        Array.isArray(templates) ? templates : [],
        whereSpace === undefined ? undefined : { id: whereSpace.id, name: whereSpace.name },
        words('document.blank'),
      ),
    [templates, whereSpace],
  );
  // The offer chosen by its key; null until the person picks one, so the choice follows Where to its
  // space's default (ND-I).
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = offers.find((each) => offerKey(each) === picked) ?? defaultOffer(offers, where);
  const template = chosen?.id ?? null;
  const declared = useDeclared(client, template);
  const parameters = useMemo(() => (Array.isArray(declared) ? declared : []), [declared]);
  // What each parameter holds, by name, and what the service said of each: forgotten with the template.
  const [given, setGiven] = useState<Record<string, ParameterValue>>({});
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  // Whether a required value left empty is edged yet: only once Create or the count asked (ND-K).
  const [insisted, setInsisted] = useState(false);
  const formId = useId();
  const reasonId = `${formId}-reason`;
  const valuesId = `${formId}-values`;
  const fieldId = (name: string) => `${formId}-parameter-${name}`;
  const values = useMemo(() => {
    const held: Record<string, ParameterValue> = {};
    for (const parameter of parameters) {
      const value = given[parameter.name] ?? startingValue(parameter);
      if (value !== undefined) held[parameter.name] = value;
    }
    return held;
  }, [given, parameters]);
  const missing = missingParameters(parameters, values);
  const missingLabels = missing.map((name) =>
    labelOf(parameters.find((each) => each.name === name)!),
  );
  const reason =
    templates === null || (declared === null && template !== null)
      ? words('document.wait-for-the-template-s')
      : missing.length > 0
        ? words('document.fill-in-to-create-the', { value1: listed(missingLabels) })
        : null;
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Checked before any await, so a second click that lands before React re-renders sends nothing.
  const pending = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const { more, measure } = useOverflow(scroller, [parameters, template]);
  const narrow = useNarrow();

  const choose = (key: string) => {
    if (key === (chosen === undefined ? null : offerKey(chosen))) return;
    setPicked(key);
    setGiven({});
    setRefused(new Map());
    setInsisted(false);
  };

  // A value the service refused is scrolled into view, the first of them.
  useEffect(() => {
    const first = [...refused.keys()][0];
    if (first === undefined) return;
    document.getElementById(fieldId(first))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refused]);

  const goToFirstMissing = () => {
    setInsisted(true);
    const first = missing[0];
    if (first === undefined) return;
    const field =
      document.getElementById(fieldId(first)) ?? document.getElementById(`${fieldId(first)}-1`);
    field?.scrollIntoView?.({ block: 'nearest' });
    field?.focus();
  };

  const create = useCallback(async () => {
    if (pending.current) return;
    if (reason !== null) {
      setInsisted(true);
      return;
    }
    if (!hasText(title)) {
      setNotice(words('document.a-document-needs-a-title'));
      return;
    }
    if (!language.safeParse(languageTag).success) {
      setNotice(words('document.a-language-tag-looks-like'));
      return;
    }
    const sent = valuesToSend(parameters, values);
    pending.current = true;
    setSending(true);
    setNotice(null);
    setRefused(new Map());
    try {
      const { data, error, response } = await client.POST('/v1/spaces/{space}/documents', {
        params: { path: { space: where } },
        body: {
          title,
          language: languageTag,
          direction,
          // A Blank not yet made sends none: the service takes the space's default (TPL-074).
          ...(template === null ? {} : { template }),
          ...(Object.keys(sent).length === 0 ? {} : { parameters: sent }),
        },
      });
      const id = typeof data === 'object' && data !== null && 'id' in data ? data.id : undefined;
      if (typeof id !== 'string') {
        if (response.status === 401) {
          setNotice(words('document.you-are-signed-out-sign-5'));
        } else if (response.status === 403) {
          setNotice(words('document.you-may-not-create-a'));
          // A withdrawn grant answers 403 while the space is still readable: read the spaces afresh,
          // so the chooser stops offering one that would only refuse again.
          void loadSpaces();
        } else if (response.status === 404) {
          setNotice(
            template === null
              ? words('document.this-space-is-no-longer')
              : words('document.this-space-or-template-is'),
          );
          void loadSpaces();
        } else if (response.status === 409 && error?.code === 'creation_failed') {
          // A query a required component holds failed (TPL-024): the service's sentence names it.
          setNotice(
            typeof error?.message === 'string'
              ? error.message
              : words('document.a-value-the-template-fills'),
          );
        } else if (response.status === 409 && error?.code === 'space_archived') {
          // Archived since the spaces were read (the SP1 plan, SP-C): the re-read stops offering it.
          setNotice(words('document.this-space-has-been-archived'));
          void loadSpaces();
        } else if (response.status === 400 && error?.code === 'template_unresolved') {
          setNotice(words('document.this-template-refers-to-something'));
        } else if (
          response.status === 400 &&
          (error?.code === 'parameter_field' || error?.code === 'parameter_unused')
        ) {
          setNotice(words('document.this-template-s-parameters-no'));
        } else if (response.status === 400 && refusedParameters(error).size > 0) {
          // The service's own sentence, and its refusal of each parameter beside it (TPL-045).
          setRefused(refusedParameters(error));
          setNotice(
            typeof error?.message === 'string'
              ? error.message
              : words('document.a-parameter-was-not-accepted'),
          );
        } else if (response.status === 400) {
          setNotice(words('document.the-title-language-or-direction'));
        } else {
          setNotice(words('document.the-document-could-not-be-2'));
        }
        return;
      }
      onCreated(id);
    } catch {
      setNotice(words('document.the-document-could-not-be-2'));
    } finally {
      pending.current = false;
      setSending(false);
    }
  }, [
    client,
    direction,
    languageTag,
    loadSpaces,
    onCreated,
    template,
    title,
    where,
    reason,
    parameters,
    values,
  ]);

  const status = <p role="status">{notice}</p>;

  if (spacesProblem !== null) {
    return (
      <section aria-labelledby="new-document-heading">
        <h2 id="new-document-heading">{words('document.new-document')}</h2>
        {spacesProblem === 'signedOut' ? (
          <p>{words('document.you-are-signed-out-sign-5')}</p>
        ) : (
          <>
            <p>{words('document.the-spaces-you-may-create')}</p>
            <button type="button" onClick={() => void loadSpaces()}>
              {words('document.try-again')}
            </button>
          </>
        )}
        {status}
      </section>
    );
  }
  if (spaces === null || spaces.length === 0) {
    // Nothing to create in says nothing at all - unless a refusal just re-read the spaces and left
    // none, which must not vanish along with the form it was said about.
    if (notice === null) return null;
    return (
      <section aria-labelledby="new-document-heading">
        <h2 id="new-document-heading">{words('document.new-document')}</h2>
        <p role="status">{words('document.there-is-nowhere-left-for')}</p>
      </section>
    );
  }

  const components = (chosen?.copied ?? 0) + (chosen?.referenced ?? 0);
  const startsBlank = chosen !== undefined && chosen.sections === 0 && chosen.values === 0;
  const ready =
    chosen === undefined
      ? null
      : chosen.sections > 0
        ? words('document.creates-sections-from-the-template', {
            sections: chosen.sections,
            space: whereSpace?.name ?? '',
          })
        : words('document.creates-a-document-with-components', {
            components,
            space: whereSpace?.name ?? '',
          });
  const left = missing.length;
  const gallery = (
    <TemplateGallery
      id={`${formId}-gallery`}
      offers={offers}
      where={where}
      spaceOrder={spaces.map((each) => each.id)}
      chosen={chosen === undefined ? null : offerKey(chosen)}
      onChoose={choose}
      narrow={narrow}
    />
  );

  return (
    <div className={styles['dialog']} data-narrow={narrow || undefined}>
      <div className={styles['side']}>
        <header className={styles['brand']}>
          <span className={styles['tile']}>
            <Icon name="New document" size={18} />
          </span>
          <h2 id="new-document-heading">{words('document.new-document')}</h2>
        </header>
        {!narrow && gallery}
        {templates === 'failed' && (
          <p className={styles['said']}>{words('document.the-templates-could-not-be')}</p>
        )}
      </div>
      <div className={styles['main']}>
        <div className={styles['chosen']}>
          {chosen !== undefined && (
            <div className={styles['previewed']}>
              <div className={styles['page']} aria-hidden="true">
                <span className={styles['pageTitle']}>{chosen.name}</span>
                {chosen.headings.map((heading, index) => (
                  <span key={index} className={styles['pageHeading']}>
                    {heading}
                  </span>
                ))}
              </div>
              <p className={styles['caption']}>
                {chosen.sections > 0
                  ? words('document.template-sections-and-components', {
                      sections: chosen.sections,
                      components,
                    })
                  : words('document.components-ready-to-write-in', { components })}
              </p>
            </div>
          )}
          <div className={styles['about']}>
            {narrow && gallery}
            {chosen !== undefined && (
              <>
                <p className={styles['kicker']}>
                  {words('document.template-in-space', { space: chosen.space.name })}
                </p>
                <h3 className={styles['name']}>{chosen.name}</h3>
                {chosen.description !== null && (
                  <p className={styles['description']}>{chosen.description}</p>
                )}
              </>
            )}
            <label className={styles['title']}>
              {words('document.title')}
              <input
                data-autofocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className={styles['values']}>
          {parameters.length > 0 ? (
            <>
              <div className={styles['line']}>
                <h3 id={valuesId}>{words('document.values-for-this-template')}</h3>
                <span className={styles['count']}>
                  {words('document.values-and-required', {
                    values: parameters.length,
                    required: parameters.filter((each) => each.required).length,
                  })}
                </span>
                {left > 0 && (
                  <button type="button" className={styles['pill']} onClick={goToFirstMissing}>
                    {words('document.required-values-left', { left })}
                  </button>
                )}
              </div>
              <div
                ref={scroller}
                role="group"
                aria-labelledby={valuesId}
                // So a keyboard can scroll it.
                tabIndex={0}
                className={styles['scroll']}
                data-above={more.above || undefined}
                data-below={more.below || undefined}
                onScroll={measure}
              >
                <div className={styles['fields']}>
                  {parameters.map((parameter) => (
                    <ParameterInput
                      key={`${template}-${parameter.name}`}
                      parameter={parameter}
                      id={fieldId(parameter.name)}
                      value={values[parameter.name]}
                      onChange={(value) =>
                        setGiven((held) => ({ ...held, [parameter.name]: value }))
                      }
                      warn={insisted && missing.includes(parameter.name)}
                      {...(refused.has(parameter.name)
                        ? { problem: refused.get(parameter.name)! }
                        : {})}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : declared === 'failed' ? (
            <p className={styles['note']}>{words('document.the-template-s-parameters-could')}</p>
          ) : chosen !== undefined && declared !== null ? (
            <p className={styles['note']}>
              {startsBlank && components === 1
                ? words('document.asks-for-nothing-one-component', { name: chosen.name })
                : words('document.asks-for-no-values', { name: chosen.name })}
            </p>
          ) : null}
        </div>
        <div className={styles['row']}>
          <label className={styles['where']}>
            {words('document.where')}
            <span className={styles['iconed']}>
              <Icon name="Folder" size={16} />
              <select value={where} onChange={(event) => setWhere(event.target.value)}>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className={styles['language']}>
            {words('document.language')}
            <span className={styles['iconed']}>
              <Icon name="Language" size={16} />
              <input value={languageTag} onChange={(event) => setLanguageTag(event.target.value)} />
            </span>
          </label>
          <div
            role="radiogroup"
            aria-label={words('document.direction')}
            className={styles['direction']}
          >
            {(['ltr', 'rtl'] as const).map((each) => {
              const name =
                each === 'ltr' ? words('editor.left-to-right-2') : words('editor.right-to-left-2');
              return (
                <label key={each} className={styles['way']} title={name}>
                  <input
                    type="radio"
                    name={`${formId}-direction`}
                    value={each}
                    aria-label={name}
                    checked={direction === each}
                    onChange={() => setDirection(each)}
                  />
                  <Icon name={each === 'ltr' ? 'Left to right' : 'Right to left'} size={16} />
                </label>
              );
            })}
          </div>
        </div>
        <div className={styles['foot']}>
          <div className={styles['say']}>
            {status}
            {notice === null && (reason !== null || ready !== null) && (
              <p id={reasonId} data-warn={reason !== null || undefined}>
                {reason ?? ready}
              </p>
            )}
            {notice !== null && reason !== null && (
              <p id={reasonId} className="aw-visually-hidden">
                {reason}
              </p>
            )}
          </div>
          {onCancel !== undefined && (
            <button type="button" onClick={onCancel}>
              {words('document.cancel')}
            </button>
          )}
          {/* Unavailable rather than disabled, so the keyboard reaches it and hears why (TP1-I). */}
          <button
            className="primary"
            type="button"
            disabled={sending}
            aria-disabled={reason !== null || undefined}
            aria-describedby={reason === null ? undefined : reasonId}
            onClick={() => void create()}
          >
            <Icon name="New document" size={16} />
            {words('document.create-document')}
          </button>
        </div>
      </div>
    </div>
  );
}
