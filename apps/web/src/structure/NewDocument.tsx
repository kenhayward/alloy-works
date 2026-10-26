import type { createApiClient } from '@alloy-works/api-client';
import { hasText, outlineDocumentSchema, type TemplateParameter } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { DirectionSelect } from '../editor/DirectionSelect.js';
import { useCreatableSpaces } from '../spaces.js';
import { everyPage } from '../paging.js';
import {
  declarationsIn,
  listed,
  missingParameters,
  ParameterInput,
  refusedParameters,
  startingValue,
  valuesToSend,
  type ParameterValue,
} from './ParameterInput.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** The outline's own tag rule, so the form refuses what the service would, with one rule and not two. */
const language = outlineDocumentSchema.shape.language;

/** A template as the chooser offers it: what it is called and the space it lives in. */
interface TemplateChoice {
  readonly id: string;
  readonly label: string;
}

/**
 * The templates the caller may read, or `'failed'` when they could not be listed - which leaves Blank
 * to choose, and says so, rather than hiding that there may have been more.
 */
function useTemplates(client: Client): readonly TemplateChoice[] | 'failed' | null {
  const [templates, setTemplates] = useState<readonly TemplateChoice[] | 'failed' | null>(null);
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
                label: `${item.name} (${item.space.name})`,
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
 * TP1-I): none for Blank, `'failed'` where the template could not be read - which leaves the service
 * to refuse what is missing, and says so.
 */
function useDeclared(
  client: Client,
  template: string,
): readonly TemplateParameter[] | 'failed' | null {
  const [declared, setDeclared] = useState<{
    readonly template: string;
    readonly parameters: readonly TemplateParameter[] | 'failed';
  } | null>(null);
  useEffect(() => {
    if (template === '') return undefined;
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
  if (template === '') return [];
  return declared?.template === template ? declared.parameters : null;
}

export interface NewDocumentProps {
  readonly client: Client;
  /** Called with the new document's id, so the page can open it. */
  readonly onCreated: (id: string) => void;
}

/**
 * Making a document: where, what it is called, its language and its direction, and the template it
 * starts from or Blank (templates.md, TE-J) - **New component** without a component type, because a
 * document has none. Shown only where there is somewhere the
 * caller may create (the plan's decision 8), so nobody is offered a form that could only refuse them,
 * and built the way `NewComponent` is so the two pages do not disagree about what a person may do.
 */
export function NewDocument({ client, onCreated }: NewDocumentProps) {
  const {
    spaces,
    problem: spacesProblem,
    where,
    setWhere,
    reload: loadSpaces,
  } = useCreatableSpaces(client);
  const [title, setTitle] = useState('');
  const [languageTag, setLanguageTag] = useState('en-GB');
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const templates = useTemplates(client);
  // The empty string is Blank: a document made from nothing sends no template.
  const [template, setTemplate] = useState('');
  const declared = useDeclared(client, template);
  const parameters = useMemo(() => (Array.isArray(declared) ? declared : []), [declared]);
  // What each parameter holds, by name, and what the service said of each: forgotten with the template.
  const [given, setGiven] = useState<Record<string, ParameterValue>>({});
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  const formId = useId();
  const reasonId = `${formId}-reason`;
  const values = useMemo(() => {
    const held: Record<string, ParameterValue> = {};
    for (const parameter of parameters) {
      const value = given[parameter.name] ?? startingValue(parameter);
      if (value !== undefined) held[parameter.name] = value;
    }
    return held;
  }, [given, parameters]);
  const missing = missingParameters(parameters, values);
  const reason =
    declared === null && template !== ''
      ? words('document.wait-for-the-template-s')
      : missing.length > 0
        ? words('document.fill-in-to-create-the', { value1: listed(missing) })
        : null;
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Checked before any await, so a second click that lands before React re-renders sends nothing.
  const pending = useRef(false);

  const create = useCallback(async () => {
    if (pending.current || reason !== null) return;
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
          ...(template === '' ? {} : { template }),
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
            template === ''
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
    // none, which must not vanish along with the form it was said about. Its own sentence, because the
    // standing notice may end "Choose another" beside no chooser.
    if (notice === null) return null;
    return (
      <section aria-labelledby="new-document-heading">
        <h2 id="new-document-heading">{words('document.new-document')}</h2>
        <p role="status">{words('document.there-is-nowhere-left-for')}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="new-document-heading">
      <h2 id="new-document-heading">{words('document.new-document')}</h2>
      <label>
        {words('document.where')}
        <select value={where} onChange={(event) => setWhere(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {words('document.template')}
        <select
          value={template}
          onChange={(event) => {
            setTemplate(event.target.value);
            setGiven({});
            setRefused(new Map());
          }}
        >
          <option value="">{words('document.blank')}</option>
          {Array.isArray(templates) &&
            templates.map((each) => (
              <option key={each.id} value={each.id}>
                {each.label}
              </option>
            ))}
        </select>
      </label>
      {templates === 'failed' && <p>{words('document.the-templates-could-not-be')}</p>}
      {declared === 'failed' && <p>{words('document.the-template-s-parameters-could')}</p>}
      {parameters.length > 0 && (
        <fieldset>
          <legend>{words('document.parameters')}</legend>
          {parameters.map((parameter) => (
            <ParameterInput
              key={`${template}-${parameter.name}`}
              parameter={parameter}
              id={`${formId}-parameter-${parameter.name}`}
              value={values[parameter.name]}
              onChange={(value) => setGiven((held) => ({ ...held, [parameter.name]: value }))}
              {...(refused.has(parameter.name) ? { problem: refused.get(parameter.name)! } : {})}
            />
          ))}
        </fieldset>
      )}
      <label>
        {words('document.title')}
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        {words('document.language')}
        <input value={languageTag} onChange={(event) => setLanguageTag(event.target.value)} />
      </label>
      <label>
        {words('document.direction')}
        <DirectionSelect value={direction} onChange={setDirection} />
      </label>
      {/* Unavailable rather than disabled, so the keyboard reaches it and hears why (TP1-I). */}
      <button
        className="primary"
        type="button"
        disabled={sending}
        aria-disabled={reason !== null || undefined}
        aria-describedby={reason === null ? undefined : reasonId}
        onClick={() => void create()}
      >
        {words('document.create')}
      </button>
      {reason !== null && <p id={reasonId}>{reason}</p>}
      {status}
    </section>
  );
}
