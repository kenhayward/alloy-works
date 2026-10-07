// Shared by the DocumentPage test files: fixtures, the service fake and helpers.
import { createApiClient } from '@alloy-works/api-client';
import {
  applyOutlineOperation,
  canonicaliseOutline,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  outlineOperationSchema,
  parseLayout,
  withholdComponents,
  type Layout,
  type OutlineDocument,
  type OutlineNode,
  type OutlineOperation,
} from '@alloy-works/domain';
import { type EditorView } from '@alloy-works/editor';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { expect } from 'vitest';
import { describeEquation } from '../../editor/speech.js';
import { DocumentPage } from '../DocumentPage.js';
import { documentAddress } from '../links.js';

/**
 * Waits out every description an equation dialog has asked for, however long the speech engine takes:
 * it answers one request after another, so one asked for now is answered only after them. The first
 * in a file loads the engine's rules, which on CI's runner can take longer than `waitFor`'s second.
 */
export const described = () =>
  act(() =>
    describeEquation(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
      'en',
    ).then(() => {}),
  );

/** A node of an editor's document, named through the view since this app has no ProseMirror of its own. */
export type ProseMirrorNode = EditorView['state']['doc'];

export const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
export const SPACE = 'aaaaaaaa-0000-4000-8000-000000000001';
export const ADA = 'ffffffff-0000-4000-8000-000000000001';
export const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
export const INTRODUCTION = 'iiiiiiiiiiiiiiiiiiiiiiiiii';
export const SCOPE = 'ssssssssssssssssssssssssss';
export const METHOD = 'mmmmmmmmmmmmmmmmmmmmmmmmmm';
export const RESULTS = 'rrrrrrrrrrrrrrrrrrrrrrrrrr';
export const PREFACE = 'pppppppppppppppppppppppppp';

export const LAYOUT = 'llllllll-0000-4000-8000-000000000001';
export const LAYOUT_V1 = { id: 'llllllll-0000-4000-8000-000000000002', number: '0.1' };
export const LAYOUT_V2 = { id: 'llllllll-0000-4000-8000-000000000003', number: '0.2' };

/**
 * The environment's layout as `DocumentView` carries it (publishing.md, "The layout"): its id, the
 * version read, the language its generated words are in, that version's numbering scheme, and its own
 * words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference
 * prints for above and below (cross-references 2, ruling R9).
 */
export const layoutView = (
  scheme: unknown,
  version = LAYOUT_V1,
  words: unknown = defaultLayout.words,
) => ({
  id: LAYOUT,
  version,
  language: defaultLayout.language,
  scheme,
  words,
});

/**
 * A second version of the environment's layout, numbering the body's sections in upper roman and
 * calling a figure `Fig.` - what task 9's numbering test records against the database, and what this
 * suite's service answers instead. Its scheme is named apart from the default's, because STR-031 keys
 * a numbering by that id.
 */
export const upperRomanLayout: Layout = (() => {
  const sequences = defaultLayout.scheme.sequences;
  const section = sequences['section']!;
  const figure = sequences['figure']!;
  return parseLayout({
    ...defaultLayout,
    scheme: {
      id: 'upper-roman/1',
      sequences: {
        ...sequences,
        section: { ...section, body: { ...section.body, format: ['upperRoman', 'decimal'] } },
        figure: { ...figure, body: { ...figure.body, label: 'Fig.' } },
      },
    },
  });
})();

export const SPACES = {
  items: [
    { id: SPACE, name: 'General', mayCreate: true },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Quality', mayCreate: false },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Regulatory', mayCreate: true },
  ],
  next: null,
};

export const COMPONENTS = {
  items: [
    {
      id: PRINTER,
      title: 'Install the printer',
      space: { id: SPACE, name: 'General' },
      version: '0.3',
    },
  ],
  next: null,
};

export function section(id: string, title: string, children: OutlineNode[] = []): OutlineNode {
  return {
    type: 'section',
    id,
    title: [{ type: 'text', value: title, marks: [] }],
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children,
  };
}

export function reference(id: string, mode: 'latest' | 'approved'): OutlineNode {
  return {
    type: 'reference',
    id,
    component: PRINTER,
    mode: { kind: mode },
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
  };
}

export function outline(nodes: OutlineNode[]): OutlineDocument {
  return {
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const PUBLISH_REQUEST = '99999999-0000-4000-8000-000000000001';
/** A publish asked for from the page, as `GET /v1/publication-requests/{id}` answers it once failed. */
export const publishRequest = {
  id: PUBLISH_REQUEST,
  document: DOCUMENT,
  kind: 'publish',
  state: 'failed',
  failures: [],
  publication: null,
  preview: null,
};

export const PREVIEW_REQUEST = '99999999-0000-4000-8000-000000000002';
/** A preview asked for from the page, as the service answers it once asked for. */
export const previewRequest = {
  ...publishRequest,
  id: PREVIEW_REQUEST,
  kind: 'preview',
  state: 'queued',
};
/** Its links and expiry once made. */
export const previewLinks = {
  view: 'https://store.example.test/p.pdf?view',
  download: 'https://store.example.test/p.pdf?download',
  expiresAt: '2026-09-27T14:02:00.000Z',
};

/**
 * The service, as a model rather than a table of canned answers (pre-flight S23): it keeps the
 * document's version chain and applies each operation with the domain's own `applyOutlineOperation`,
 * after parsing the body with the route's own schema - so a body the renderer sends that the route
 * would refuse is refused here too, and the position convention the panel uses is the one the service
 * applies. It answers the way `apps/service/src/documents.ts` does: a stale `openedFrom` is `409
 * version_precondition` carrying the document as it now stands, an act that changes nothing is `200`
 * at the same version (decision K), and one refused against the latest is `400 outline_invalid`.
 * `theirs` records a version as somebody else, and `refuse` answers a path with a bare status.
 *
 * Built on the house shape (`NewComponent.test.tsx`): `openapi-fetch` calls `fetch` with a `Request`.
 */
export function service(
  start: OutlineDocument,
  options: {
    mayEdit?: boolean;
    mayPublish?: boolean;
    /** What a publish asked for from this page is answered with, once the job has run: it failed. */
    publishFailures?: unknown[];
    components?: unknown;
    /** Whether the caller may read a component: one they may not is withheld, as the service does. */
    mayRead?: (component: string) => boolean;
    /** The layout every answer carries; the environment's own, at its first version, by default. */
    layout?: unknown;
    /** Whether the caller may administer the document, as `GET /v1/access` answers it. */
    administers?: boolean;
    /** What each component's head contributes, by component; nothing where it is not named. */
    holds?: Record<
      string,
      { block: string; sequence: string; numbered: boolean; caption: string | null }[]
    >;
    /**
     * The template's parameters and the values the document was made with (the TP1 plan, TP1-H): the
     * view names a template and carries them, and the parameters routes answer as the service does.
     */
    parameters?: { declarations: unknown[]; values: Record<string, unknown> };
  } = {},
) {
  const sent: { url: string; body: unknown }[] = [];
  const refusals = new Map<
    string,
    { status: number; body?: unknown; once?: boolean } | 'network'
  >();
  // An outline request waits on this before it is answered, so a test can act while one is in flight.
  let gate: Promise<void> = Promise.resolve();
  // A bare status for the outline request that arrives n-th, counted from the first.
  const numbered = new Map<number, number>();
  let outlineRequests = 0;
  let unchangedNext = false;
  // The next contributions request, once held, waits on this; the answer is what stood when it arrived.
  let contributionsGate: Promise<void> | null = null;
  let contributionsAnswered = 0;
  // How many contributions answers the page has read the body of, counted once the body resolves.
  let contributionsRead = 0;
  const chain: { id: string; number: string; outline: OutlineDocument }[] = [
    { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1', outline: start },
  ];
  let allocated = 0;
  const newIdentifier = () => {
    allocated += 1;
    return `nnnnnnnnnnnnnnnnnnnnnnnn${BASE32[Math.floor(allocated / 32)]}${BASE32[allocated % 32]}`;
  };
  const latest = () => chain[chain.length - 1]!;
  // The parameters as they stand, and each version that changed them, newest last.
  let parameters: Record<string, unknown> = { ...options.parameters?.values };
  const changes: {
    version: { id: string; number: string };
    parameters: Record<string, unknown>;
    changed: string[];
  }[] = [
    {
      version: { id: chain[0]!.id, number: chain[0]!.number },
      parameters,
      changed: Object.keys(parameters),
    },
  ];
  const view = (version = latest()) => ({
    id: DOCUMENT,
    space: { id: SPACE, name: 'General' },
    version: {
      id: version.id,
      number: version.number,
      author: ADA,
      createdAt: '2026-09-18T09:00:00.000Z',
      note: null,
    },
    // As the service shows it: the stored outline, with what the caller may not read withheld.
    outline: withholdComponents(version.outline, options.mayRead ?? (() => true)),
    mayEdit: options.mayEdit ?? true,
    mayPublish: options.mayPublish ?? false,
    layout: options.layout ?? layoutView(defaultLayout.scheme),
    ...(options.parameters === undefined
      ? {}
      : {
          parameters,
          template: {
            id: 'ee000000-0000-4000-8000-000000000001',
            name: 'Report',
            version: { id: 'ee000000-0000-4000-8000-0000000000a1', number: '0.3' },
          },
        }),
  });
  const record = (next: OutlineDocument) => {
    const count = chain.length + 1;
    chain.push({
      id: `dddddddd-0000-4000-8000-${String(count).padStart(12, '0')}`,
      number: `0.${count}`,
      outline: next,
    });
  };

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    // An outline answer waits on the gate first, whatever it is going to be.
    if (url.endsWith('/outline')) {
      outlineRequests += 1;
      const arrived = outlineRequests;
      await gate;
      const status = numbered.get(arrived);
      if (status !== undefined)
        return json(status, { code: 'refused', message: 'No.', traceId: 't' });
    }
    const refused = refusals.get(url);
    if (refused === 'network') throw new TypeError('Failed to fetch');
    if (refused !== undefined) {
      if (refused.once) refusals.delete(url);
      return json(
        refused.status,
        refused.body ?? { code: 'refused', message: 'No.', traceId: 't' },
      );
    }
    if (url === '/v1/components') return json(200, options.components ?? COMPONENTS);
    if (url === '/v1/access' && options.administers !== undefined) {
      return json(200, {
        target: `artifact:${DOCUMENT}`,
        permissions: [
          { permission: 'read', allowed: true },
          { permission: 'administer', allowed: options.administers },
        ],
      });
    }
    if (url === `/v1/documents/${DOCUMENT}/publications`) {
      if (request.method === 'GET') return json(200, { items: [], next: null });
      return json(200, { ...publishRequest, state: 'queued' });
    }
    if (url === `/v1/publication-requests/${PUBLISH_REQUEST}`) {
      return json(200, { ...publishRequest, failures: options.publishFailures ?? [] });
    }
    // A preview asked for from the page, answered at once as made (W10.3).
    if (url === `/v1/documents/${DOCUMENT}/previews`) return json(200, previewRequest);
    if (url === `/v1/publication-requests/${PREVIEW_REQUEST}`) {
      return json(200, { ...previewRequest, state: 'done', preview: previewLinks });
    }
    if (url === `/v1/documents/${DOCUMENT}`) return json(200, view());
    if (url === `/v1/documents/${DOCUMENT}/parameters` && options.parameters !== undefined) {
      if (request.method === 'GET') {
        const history = [...changes].reverse().map((each) => ({
          ...each,
          createdAt: '2026-09-18T09:00:00.000Z',
          author: { id: ADA, name: 'Ada' },
        }));
        const cursor = new URL(request.url).searchParams.get('cursor');
        const limit = Number(new URL(request.url).searchParams.get('limit') ?? '50');
        const from = cursor === null ? 0 : Number(cursor);
        return json(200, {
          declarations: options.parameters.declarations,
          parameters,
          history: history.slice(from, from + limit),
          next: from + limit < history.length ? String(from + limit) : null,
        });
      }
      const sentParameters = body as { openedFrom: string; parameters: Record<string, unknown> };
      if (sentParameters.openedFrom !== latest().id) {
        return json(409, {
          code: 'version_precondition',
          message: 'This document has a newer version than the one this page opened.',
          traceId: 't',
          current: view(),
        });
      }
      const changed = [
        ...new Set([...Object.keys(parameters), ...Object.keys(sentParameters.parameters)]),
      ].filter(
        (name) =>
          JSON.stringify(parameters[name]) !== JSON.stringify(sentParameters.parameters[name]),
      );
      if (changed.length > 0) {
        record(latest().outline);
        parameters = sentParameters.parameters;
        changes.push({
          version: { id: latest().id, number: latest().number },
          parameters,
          changed,
        });
      }
      return json(200, view());
    }
    if (url === `/v1/documents/${DOCUMENT}/contributions`) {
      // As `getContributions` answers: every reference of the latest version, in outline order, and
      // a version the caller may read named once with what it holds - never one they may not.
      const occurrences: { node: string; version: string | null }[] = [];
      const versions = new Map<string, unknown>();
      const walk = (nodes: readonly OutlineNode[]) => {
        for (const node of nodes) {
          if (node.type === 'reference') {
            const readable = (options.mayRead ?? (() => true))(node.component);
            const version = readable ? `vvvvvvvv${node.component.slice(8)}` : null;
            occurrences.push({ node: node.id, version });
            if (version !== null) {
              versions.set(version, {
                id: version,
                contributions: options.holds?.[node.component] ?? [],
              });
            }
          }
          walk(node.children);
        }
      };
      walk(latest().outline.nodes);
      const answer = {
        document: DOCUMENT,
        version: { id: latest().id, number: latest().number },
        occurrences,
        versions: [...versions.values()],
      };
      const held = contributionsGate;
      contributionsGate = null;
      if (held !== null) await held;
      contributionsAnswered += 1;
      // The client reads a body without a length as text, so that is what is counted.
      const response = json(200, answer);
      const body = response.text.bind(response);
      response.text = async () => {
        const read = await body();
        contributionsRead += 1;
        return read;
      };
      return response;
    }
    if (url === `/v1/documents/${DOCUMENT}/outline`) {
      if (unchangedNext) {
        unchangedNext = false;
        return json(200, view());
      }
      const { openedFrom, operation } = body as { openedFrom: string; operation: unknown };
      const parsed = outlineOperationSchema.safeParse(operation);
      if (!parsed.success)
        return json(400, { code: 'invalid_request', message: 'x', traceId: 't' });
      if (openedFrom !== latest().id) {
        return json(409, {
          code: 'version_precondition',
          message: 'This document has a newer version than the one this page opened.',
          traceId: 't',
          current: view(),
        });
      }
      const result = applyOutlineOperation(latest().outline, parsed.data, newIdentifier);
      if (!result.applied) {
        return json(400, {
          code: 'outline_invalid',
          message: 'This change does not apply to the outline as it stands.',
          traceId: 't',
          reason: result.reason,
        });
      }
      if (canonicaliseOutline(result.outline) !== canonicaliseOutline(latest().outline)) {
        record(result.outline);
      }
      return json(200, view());
    }
    return json(500, { code: 'internal', message: 'x', traceId: 't' });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    sent,
    edits: () => sent.filter((request) => request.url.endsWith('/outline')),
    refuse: (url: string, status: number, body?: unknown) => refusals.set(url, { status, body }),
    /** No answer at all: the request fails the way a dropped connection does. */
    fail: (url: string) => refusals.set(url, 'network'),
    /** A bare status for the outline request that arrives n-th, counting every one so far. */
    refuseRequest: (n: number, status: number) => numbered.set(n, status),
    /** A bare status for the next request to this path only. */
    refuseNext: (url: string, status: number) => refusals.set(url, { status, once: true }),
    /** What was recorded last, as the service would now answer it. */
    latest: () => view(),
    restore: (url: string) => refusals.delete(url),
    /** Holds every outline answer until the returned function is called. */
    /**
     * Holds the next contributions request - only that one - until the returned function is called,
     * and answers it then with what stood when it arrived.
     */
    holdContributions: () => {
      let release = () => {};
      contributionsGate = new Promise((resolve) => (release = resolve));
      return release;
    },
    /** How many contributions requests have been answered so far. */
    contributionsAnswered: () => contributionsAnswered,
    /** How many contributions answers have had their body read, once each body has resolved. */
    contributionsRead: () => contributionsRead,
    hold: () => {
      let release = () => {};
      gate = new Promise((resolve) => (release = resolve));
      return release;
    },
    /** Answers the next act at the same version, as the service does for one that changes nothing. */
    unchanged: () => {
      unchangedNext = true;
    },
    /** Somebody else's act, recorded straight into the chain. */
    theirs: (operation: OutlineOperation) => {
      const result = applyOutlineOperation(latest().outline, operation, newIdentifier);
      if (!result.applied) throw new Error(result.reason);
      record(result.outline);
    },
  };
}

export const client = (fetch: typeof globalThis.fetch) =>
  createApiClient({ baseUrl: 'http://acme.example.test', fetch });

/**
 * Inside `<StrictMode>`, always: the application runs under it (apps/web/src/main.tsx), and editor 2
 * learned the hard way that a field reconciled by counting renders passes a bare render and eats
 * keystrokes in the real application.
 */
export function open(fetch: typeof globalThis.fetch) {
  return render(
    <StrictMode>
      <DocumentPage client={client(fetch)} id={DOCUMENT} />
    </StrictMode>,
  );
}

export const item = (name: RegExp | string) => screen.getByRole('treeitem', { name });

/** Undo stays focusable when there is nothing to undo, so it says so through `aria-disabled`. */
export const undoable = () =>
  screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled') !== 'true';

/** Waits for the act in flight to be answered: the tree says it is busy until then. */
export const settled = () =>
  waitFor(() => expect(screen.getByRole('tree')).toHaveAttribute('aria-busy', 'false'));

/**
 * A section's title field: since equations 3 a one-line editor, not a text input (ruling R1), so it
 * is read by what it shows and typed into where the caret is, rather than by a value. jsdom lays out
 * nothing, so a click cannot put the caret there; the caret is put at the end of what the field holds,
 * which is where a text input's own typing began, and the keys are typed from there.
 */
export const titleField = () => screen.getByRole('textbox', { name: 'Title' });
/** What the title field shows, as a text input's value was read. */
export const shownTitle = () => titleField().textContent;
/** Gives the title field the focus, with the caret at its end or all of it selected. */
export function selectInTitle(whole: boolean) {
  const field = titleField();
  field.focus();
  const selection = document.getSelection()!;
  selection.selectAllChildren(field);
  if (!whole) selection.collapseToEnd();
  document.dispatchEvent(new Event('selectionchange'));
}
/** Keys typed at the end of the title, as `userEvent.type` typed them at the end of a text input. */
export async function typeTitle(keys: string) {
  selectInTitle(false);
  await userEvent.keyboard(keys);
}
/** Empties the title, as `userEvent.clear` emptied a text input. */
export async function clearTitle() {
  selectInTitle(true);
  await userEvent.keyboard('{Backspace}');
}

export const OUTLINE_URL = `/v1/documents/${DOCUMENT}/outline`;
export const SOMEBODY_ELSE = 'Somebody else changed this document. This is how it stands now.';

/** The page at an address naming one of its nodes, as `Workspace` opens it. */
export function openAt(fetch: typeof globalThis.fetch, node: string, arrival = 0) {
  const page = (linked: string, at: number) => (
    <StrictMode>
      <DocumentPage client={client(fetch)} id={DOCUMENT} linked={{ node: linked, arrival: at }} />
    </StrictMode>
  );
  const rendered = render(page(node, arrival));
  return {
    ...rendered,
    arriveAgain: (linked: string, at: number) => rendered.rerender(page(linked, at)),
  };
}

/** The node an address the page showed names, read the way the workspace reads its own address. */
export function nodeIn(shown: string): string {
  const address = documentAddress(new URL(shown).hash);
  if (address?.kind !== 'document' || address.node === null) {
    throw new Error(`${shown} names no node`);
  }
  return address.node;
}

export const SECRET = 'cccccccc-0000-4000-8000-000000000002';
export const AGAIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';

/** A reference to a named component, at latest. */
export function referenceTo(id: string, component: string): OutlineNode {
  return { ...reference(id, 'latest'), component } as OutlineNode;
}

export const tray = { block: 'f1', sequence: 'figure', numbered: true, caption: 'The paper tray' };
export const parts = { block: 't1', sequence: 'table', numbered: true, caption: 'Parts' };
export const sum = { block: 'e1', sequence: 'equation', numbered: true, caption: null };
export const aside = { block: 'e2', sequence: 'equation', numbered: false, caption: null };

export const listed = (heading: string) =>
  within(screen.getByRole('region', { name: heading }))
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);
