import type { HttpBodyNode, HttpFetch, HttpPart, HttpTemplate } from '@alloy-works/domain';

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

export interface HttpDraft {
  readonly method: 'GET' | 'POST';
  readonly path: readonly PartDraft[];
  readonly query: readonly PairDraft[];
  readonly headers: readonly PairDraft[];
  /** A POST's body: a JSON object, a member each. */
  readonly body: readonly PairDraft[];
  readonly format: 'json' | 'jsonLines';
  /** JSON's pointer to its rows, and to the count it states, where it states one. */
  readonly rows: string;
  readonly count: string;
}

export const NEW_HTTP: HttpDraft = {
  method: 'GET',
  path: [],
  query: [],
  headers: [],
  body: [],
  format: 'json',
  rows: '',
  count: '',
};

export const NEW_PART: PartDraft = { kind: 'fixed', text: '' };
export const NEW_PAIR: PairDraft = { name: '', value: NEW_PART };

const partOf = (part: PartDraft): HttpPart =>
  part.kind === 'parameter' ? { parameter: part.text.trim() } : { fixed: part.text };

const draftOfPart = (part: HttpPart): PartDraft =>
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
export function formatOf(http: HttpDraft): HttpFetch['format'] {
  if (http.format === 'jsonLines') return { kind: 'jsonLines' };
  return {
    kind: 'json',
    rows: http.rows.trim(),
    ...(http.count.trim() === '' ? {} : { count: http.count.trim() }),
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
export function httpDraftOf(stored: HttpFetch): HttpDraft | { readonly reason: string } {
  const body = flatBody(stored.request.body);
  if (body === undefined) {
    return {
      reason:
        'Its request body holds more than text and parameters, which this page cannot show to edit.',
    };
  }
  return {
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
    format: stored.format.kind,
    rows: stored.format.kind === 'json' ? stored.format.rows : '',
    count: stored.format.kind === 'json' ? (stored.format.count ?? '') : '',
  };
}

/** A part as a reader is shown it: fixed text as it is, a parameter by its name in braces. */
const shownPart = (part: HttpPart) => ('parameter' in part ? `{${part.parameter}}` : part.fixed);

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
