import type {
  DataFormat,
  HttpBodyNode,
  HttpPart,
  HttpTemplate,
  QueryDefinition,
} from '@alloy-works/domain';

/**
 * An HTTP request template as its page holds it while it is written (the D6 plan, D6-E): each part of
 * the path, each query pair, header and body member either fixed text or a parameter, never text with
 * markers in it, so every value is placed by the builder for its position. The body is a flat JSON
 * object of members; a body nesting deeper is shown, and not edited here. Pure, so each rule is
 * tested without a page.
 */

export interface PartDraft {
  readonly kind: 'fixed' | 'parameter';
  readonly text: string;
}

export interface PairDraft {
  readonly name: string;
  readonly value: PartDraft;
}

/**
 * The format rows are read in, whatever carried them (the D6 plan, D6-F): JSON at a pointer, JSON
 * Lines, or CSV with its delimiter, whether its first record is a header, and its convention for null.
 */
export interface FormatDraft {
  readonly format: 'json' | 'jsonLines' | 'csv';
  /** JSON's pointer to its rows, and to the count it states, where it states one. */
  readonly rows: string;
  readonly count: string;
  readonly delimiter: 'comma' | 'semicolon' | 'tab' | 'pipe';
  readonly headerRow: boolean;
  /** Whether an unquoted empty field is null (`empty`), or every field text (`never`). */
  readonly nulls: 'empty' | 'never';
}

export const NEW_FORMAT: FormatDraft = {
  format: 'json',
  rows: '',
  count: '',
  delimiter: 'comma',
  headerRow: true,
  nulls: 'empty',
};

export interface HttpDraft extends FormatDraft {
  readonly method: 'GET' | 'POST';
  readonly path: readonly PartDraft[];
  readonly query: readonly PairDraft[];
  readonly headers: readonly PairDraft[];
  /** A POST's body: a JSON object, a member each. */
  readonly body: readonly PairDraft[];
}

export const NEW_HTTP: HttpDraft = {
  ...NEW_FORMAT,
  method: 'GET',
  path: [],
  query: [],
  headers: [],
  body: [],
};

export const NEW_PART: PartDraft = { kind: 'fixed', text: '' };
export const NEW_PAIR: PairDraft = { name: '', value: NEW_PART };

export const partOf = (part: PartDraft): HttpPart =>
  part.kind === 'parameter' ? { parameter: part.text.trim() } : { fixed: part.text };

export const draftOfPart = (part: HttpPart): PartDraft =>
  'parameter' in part
    ? { kind: 'parameter', text: part.parameter }
    : { kind: 'fixed', text: part.fixed };

/** The template a draft stands for: the service checks every rule again. */
export function templateOf(http: HttpDraft): HttpTemplate {
  return {
    method: http.method,
    path: http.path.map(partOf),
    query: http.query.map((pair) => ({ name: pair.name, value: partOf(pair.value) })),
    headers: http.headers.map((pair) => ({
      name: pair.name.trim().toLowerCase(),
      value: partOf(pair.value),
    })),
    ...(http.method === 'POST' && http.body.length > 0
      ? {
          body: {
            object: http.body.map((pair) => ({
              name: pair.name,
              value:
                pair.value.kind === 'parameter'
                  ? { parameter: pair.value.text.trim() }
                  : { fixed: pair.value.text },
            })),
          },
        }
      : {}),
  };
}

/** The format a draft reads its rows in. */
export function formatOf(draft: FormatDraft): DataFormat {
  if (draft.format === 'jsonLines') return { kind: 'jsonLines' };
  if (draft.format === 'csv') {
    return {
      kind: 'csv',
      delimiter: draft.delimiter,
      headerRow: draft.headerRow,
      null: draft.nulls,
    };
  }
  return {
    kind: 'json',
    rows: draft.rows.trim(),
    ...(draft.count.trim() === '' ? {} : { count: draft.count.trim() }),
  };
}

/** A stored format as its page holds it. */
export function formatDraftOf(format: DataFormat): FormatDraft {
  if (format.kind === 'csv') {
    return {
      ...NEW_FORMAT,
      format: 'csv',
      delimiter: format.delimiter,
      headerRow: format.headerRow,
      nulls: format.null,
    };
  }
  return {
    ...NEW_FORMAT,
    format: format.kind,
    rows: format.kind === 'json' ? format.rows : '',
    count: format.kind === 'json' ? (format.count ?? '') : '',
  };
}

/** A body the page edits: a flat object whose members are fixed text or a parameter. */
function flatBody(body: HttpBodyNode | undefined): PairDraft[] | undefined {
  if (body === undefined) return [];
  if (!('object' in body)) return undefined;
  const pairs: PairDraft[] = [];
  for (const member of body.object) {
    const { value } = member;
    if ('parameter' in value)
      pairs.push({ name: member.name, value: { kind: 'parameter', text: value.parameter } });
    else if ('fixed' in value && typeof value.fixed === 'string') {
      pairs.push({ name: member.name, value: { kind: 'fixed', text: value.fixed } });
    } else return undefined;
  }
  return pairs;
}

/** A stored HTTP fetch as the page holds it, or why the page cannot show it to edit. */
export function httpDraftOf(
  stored: Extract<QueryDefinition['fetch'], { kind: 'http' }>,
): HttpDraft | { readonly reason: string } {
  const body = flatBody(stored.request.body);
  if (body === undefined) {
    return {
      reason:
        'Its request body holds more than text and parameters, which this page cannot show to edit.',
    };
  }
  return {
    ...formatDraftOf(stored.format),
    method: stored.request.method,
    path: stored.request.path.map(draftOfPart),
    query: stored.request.query.map((pair) => ({
      name: pair.name,
      value: draftOfPart(pair.value),
    })),
    headers: stored.request.headers.map((pair) => ({
      name: pair.name,
      value: draftOfPart(pair.value),
    })),
    body,
  };
}

/** A part as a reader is shown it: fixed text as it is, a parameter by its name in braces. */
export const shownPart = (part: HttpPart) => ('parameter' in part ? `{${part.parameter}}` : part.fixed);

/**
 * A template as its reader is shown it, a line each: the method and the path with its query, then
 * each header and the body. Never a URL: the base URL is the connection's.
 */
export function requestText(template: HttpTemplate): string {
  const path = template.path.map((part) => `/${shownPart(part)}`).join('') || '/';
  const query = template.query.map((pair) => `${pair.name}=${shownPart(pair.value)}`).join('&');
  const lines = [`${template.method} ${path}${query === '' ? '' : `?${query}`}`];
  for (const header of template.headers) lines.push(`${header.name}: ${shownPart(header.value)}`);
  if (template.body !== undefined) lines.push('', JSON.stringify(template.body));
  return lines.join('\n');
}
