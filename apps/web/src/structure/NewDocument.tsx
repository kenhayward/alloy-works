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
      ? "Wait for the template's parameters to load."
      : missing.length > 0
        ? `Fill in ${listed(missing)} to create the document.`
        : null;
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Checked before any await, so a second click that lands before React re-renders sends nothing.
  const pending = useRef(false);

  const create = useCallback(async () => {
    if (pending.current || reason !== null) return;
    if (!hasText(title)) {
      setNotice('A document needs a title.');
      return;
    }
    if (!language.safeParse(languageTag).success) {
      setNotice('A language tag looks like en-GB.');
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
          setNotice('You are signed out. Sign in again to create a document.');
        } else if (response.status === 403) {
          setNotice('You may not create a document here.');
          // A withdrawn grant answers 403 while the space is still readable: read the spaces afresh,
          // so the chooser stops offering one that would only refuse again.
          void loadSpaces();
        } else if (response.status === 404) {
          setNotice(
            template === ''
              ? 'This space is no longer open to you. Choose another.'
              : 'This space or template is no longer open to you. Choose another.',
          );
          void loadSpaces();
        } else if (response.status === 400 && error?.code === 'template_unresolved') {
          setNotice(
            'This template refers to something that no longer exists, so a document cannot be made from it. Choose another, or Blank.',
          );
        } else if (
          response.status === 400 &&
          (error?.code === 'parameter_field' || error?.code === 'parameter_unused')
        ) {
          setNotice(
            "This template's parameters no longer fit its fields, so a document cannot be made from it. Choose another, or Blank.",
          );
        } else if (response.status === 400 && refusedParameters(error).size > 0) {
          // The service's own sentence, and its refusal of each parameter beside it (TPL-045).
          setRefused(refusedParameters(error));
          setNotice(
            typeof error?.message === 'string'
              ? error.message
              : 'A parameter was not accepted. Check them and try again.',
          );
        } else if (response.status === 400) {
          setNotice('The title, language or direction was not accepted. Check them and try again.');
        } else {
          setNotice('The document could not be created. Try again.');
        }
        return;
      }
      onCreated(id);
    } catch {
      setNotice('The document could not be created. Try again.');
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
        <h2 id="new-document-heading">New document</h2>
        {spacesProblem === 'signedOut' ? (
          <p>You are signed out. Sign in again to create a document.</p>
        ) : (
          <>
            <p>The spaces you may create in could not be loaded.</p>
            <button type="button" onClick={() => void loadSpaces()}>
              Try again
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
        <h2 id="new-document-heading">New document</h2>
        <p role="status">There is nowhere left for you to create a document.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="new-document-heading">
      <h2 id="new-document-heading">New document</h2>
      <label>
        Where
        <select value={where} onChange={(event) => setWhere(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Template
        <select
          value={template}
          onChange={(event) => {
            setTemplate(event.target.value);
            setGiven({});
            setRefused(new Map());
          }}
        >
          <option value="">Blank</option>
          {Array.isArray(templates) &&
            templates.map((each) => (
              <option key={each.id} value={each.id}>
                {each.label}
              </option>
            ))}
        </select>
      </label>
      {templates === 'failed' && <p>The templates could not be loaded.</p>}
      {declared === 'failed' && (
        <p>
          {"The template's parameters could not be loaded. The service will say if one is needed."}
        </p>
      )}
      {parameters.length > 0 && (
        <fieldset>
          <legend>Parameters</legend>
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
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Language
        <input value={languageTag} onChange={(event) => setLanguageTag(event.target.value)} />
      </label>
      <label>
        Direction
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
        Create
      </button>
      {reason !== null && <p id={reasonId}>{reason}</p>}
      {status}
    </section>
  );
}
