import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import { routes } from '@alloy-works/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATA, tools } from './mcp/tools.js';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

interface ToolUsed {
  kind: string;
  actor_kind: string;
  actor: string;
  token: string;
  subject_kind: string;
  subject: string | null;
  outcome: string;
  detail: { tool: string; arguments: Record<string, unknown>; outcome: string; code?: string };
}

describe('the MCP surface (ADR-0065; the G8 plan, G8-A to G8-F)', () => {
  let h: Harness;
  const secrets: Record<string, string> = {};
  let component = '';

  /** Fetch that reaches the service in process, as the SDK client's transport calls it. */
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const text = request.method === 'GET' ? undefined : await request.text();
    const answer = await h.app.inject({
      method: request.method as 'GET' | 'POST' | 'DELETE',
      url: `${url.pathname}${url.search}`,
      headers: { ...headers, host: HOST },
      ...(text === undefined || text === '' ? {} : { payload: text }),
    });
    return new Response(answer.statusCode === 202 ? null : answer.body, {
      status: answer.statusCode,
      headers: answer.headers as Record<string, string>,
    });
  }) as typeof fetch;

  const connect = async (as: string) => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      // The SDK's own types are not written for exactOptionalPropertyTypes.
      new StreamableHTTPClientTransport(new URL(`http://${HOST}/mcp`), {
        fetch: fetching,
        requestInit: { headers: { authorization: `Bearer ${secrets[as]!}` } },
      }) as never,
    );
    return client;
  };

  /** One message posted raw, to see what the endpoint answers in HTTP. */
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        host: HOST,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      payload: JSON.stringify(body),
    });

  const toolEvents = () =>
    h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select([
          'kind',
          'actor_kind',
          'actor',
          'token',
          'subject_kind',
          'subject',
          'outcome',
          'detail',
        ])
        .where('kind', '=', 'tool.used')
        .orderBy('sequence')
        .execute(),
    ) as Promise<ToolUsed[]>;

  beforeAll(async () => {
    h = await startHarness();
    for (const [user, as, scopes] of [
      ['ada', 'ada', []],
      ['ivy', 'ivy', []],
      ['alice', 'alice', ['comment', 'suggest', 'create']],
      ['ada', 'adaWrites', ['comment', 'suggest', 'create']],
    ] as const) {
      const issued = await h.call(user, 'POST', '/v1/tokens', {
        name: 'Agent',
        scopes,
        expiresAt: inAMonth(),
      });
      expect(issued.statusCode, issued.body).toBe(200);
      secrets[as] = issued.json<{ secret: string }>().secret;
    }
    const made = await h.component(h.general, 'Weir notes');
    await h.place(made, { type: 'text', value: 'The north weir floods each spring.', marks: [] });
    component = made.id;
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('API-019 describes each tool for a model: what it is for, when to use it, and what it returns', async () => {
    const client = await connect('ada');
    const { tools: listed } = await client.listTools();
    expect(listed.map((each) => each.name)).toEqual([
      'search',
      'read_document',
      'read_component',
      'related',
      'comment',
      'suggest_edit',
      'draft_component',
    ]);
    for (const tool of tools) {
      const shown = listed.find((each) => each.name === tool.name)!;
      expect(shown.description).toBe(
        `${tool.purpose} Use it ${tool.when} It returns ${tool.returns} ${DATA}`,
      );
      for (const part of [tool.purpose, tool.when, tool.returns]) {
        expect(part.length, tool.name).toBeGreaterThan(20);
      }
      expect(shown.description!.length, tool.name).toBeLessThanOrEqual(400);
      expect(shown.inputSchema.type).toBe('object');
      expect(shown.outputSchema?.type).toBe('object');
    }
    await client.close();
  });

  it('API-021 marks a tool that changes anything apart from one that reads, in its annotations and its title', async () => {
    const client = await connect('ada');
    const { tools: listed } = await client.listTools();
    for (const shown of listed) {
      const reads = tools.find((each) => each.name === shown.name)!.reads;
      expect(shown.annotations).toEqual({
        title: shown.title,
        readOnlyHint: reads,
        destructiveHint: false,
        idempotentHint: reads,
        openWorldHint: false,
      });
      expect(shown.title!.startsWith('Changes:'), shown.name).toBe(!reads);
    }
    await client.close();
  });

  it('API-052 wraps only version 1 of the API in every tool', () => {
    for (const tool of tools) {
      expect(tool.wraps.length, tool.name).toBeGreaterThan(0);
      for (const operation of tool.wraps) {
        expect(routes[operation].path, `${tool.name} ${operation}`).toMatch(/^\/v1\//);
      }
    }
  });

  it('API-020 reads as the caller through the SDK client, each answer the structured JSON its schema says', async () => {
    const client = await connect('ada');
    const found = await client.callTool({ name: 'search', arguments: { query: 'weir' } });
    expect(found.isError).toBeFalsy();
    const results = (found.structuredContent as { answer: { items: { artifactId: string }[] } })
      .answer;
    expect(results.items.map((each) => each.artifactId)).toContain(component);
    expect(JSON.parse((found.content as { text: string }[])[0]!.text)).toEqual(
      found.structuredContent,
    );
    const read = await client.callTool({ name: 'read_component', arguments: { component } });
    expect(read.isError).toBeFalsy();
    expect((read.structuredContent as { blocks: string }).blocks).toBe(
      '[#p1] paragraph\nThe north weir floods each spring.',
    );
    await client.close();
    // Ivy holds nothing, so reads what she may: nothing.
    const hers = await connect('ivy');
    const refused = await hers.callTool({ name: 'read_component', arguments: { component } });
    expect(refused.isError).toBe(true);
    expect(JSON.parse((refused.content as { text: string }[])[0]!.text)).toMatchObject({
      code: 'not_found',
    });
    const none = await hers.callTool({ name: 'search', arguments: { query: 'weir' } });
    const theirs = (none.structuredContent as { answer: { outcome: string; items?: unknown[] } })
      .answer;
    expect(theirs.items ?? []).toEqual([]);
    await hers.close();
  });

  it('REL-021 traverses through MCP on the same terms as the API, answering and refusing as the route does', async () => {
    for (const user of ['ada', 'ivy']) {
      const client = await connect(user);
      const viaTool = await client.callTool({
        name: 'related',
        arguments: { artifact: component },
      });
      const viaApi = await h.bearer(
        secrets[user]!,
        'GET',
        `/v1/artifacts/${component}/relationships`,
      );
      if (viaApi.statusCode === 200) {
        expect(viaTool.isError, user).toBeFalsy();
        expect(viaTool.structuredContent, user).toEqual({ neighbours: viaApi.json() });
      } else {
        expect(viaTool.isError, user).toBe(true);
        // The route's own refusal, its trace id the call's.
        const shown = JSON.parse((viaTool.content as { text: string }[])[0]!.text) as Record<
          string,
          unknown
        >;
        const refused = viaApi.json<Record<string, unknown>>();
        expect({ ...shown, traceId: null }, user).toEqual({ ...refused, traceId: null });
      }
      await client.close();
    }
  });

  it('API-023 audits each call with the identity, the tool, its arguments and the outcome, never its words', async () => {
    const before = (await toolEvents()).length;
    const client = await connect('ada');
    await client.callTool({ name: 'search', arguments: { query: 'north weir', limit: 5 } });
    await client.callTool({
      name: 'read_component',
      arguments: { component: '00000000-0000-4000-8000-000000000001' },
    });
    await client.close();
    const events = (await toolEvents()).slice(before);
    expect(events).toEqual([
      expect.objectContaining({
        actor_kind: 'token',
        actor: h.ids.ada,
        subject_kind: 'tenant',
        outcome: 'done',
        detail: {
          tool: 'search',
          arguments: {
            query: {
              length: 10,
              sha256: createHash('sha256').update('north weir').digest('hex'),
            },
            limit: 5,
          },
          outcome: 'ok',
        },
      }),
      expect.objectContaining({
        actor_kind: 'token',
        actor: h.ids.ada,
        subject_kind: 'component',
        subject: '00000000-0000-4000-8000-000000000001',
        outcome: 'refused',
        detail: {
          tool: 'read_component',
          arguments: { component: '00000000-0000-4000-8000-000000000001' },
          outcome: 'refused',
          code: 'not_found',
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('north weir');
  });

  it('API-021 refuses a change to a token that may only read, as the route it wraps does', async () => {
    const client = await connect('ada');
    const refused = await client.callTool({
      name: 'comment',
      arguments: { component, text: 'Is the weir still there?' },
    });
    expect(refused.isError).toBe(true);
    expect(JSON.parse((refused.content as { text: string }[])[0]!.text)).toMatchObject({
      code: 'forbidden',
    });
    await client.close();
  });

  it('comments on a component, and replies to the thread, as the caller', async () => {
    const client = await connect('adaWrites');
    const started = await client.callTool({
      name: 'comment',
      arguments: { component, text: 'Is the weir still there?' },
    });
    expect(started.isError, JSON.stringify(started.content)).toBeFalsy();
    const thread = (started.structuredContent as { thread: { id: string } }).thread.id;
    const replied = await client.callTool({
      name: 'comment',
      arguments: { thread, text: 'Yes, rebuilt in spring.' },
    });
    expect(replied.isError, JSON.stringify(replied.content)).toBeFalsy();
    const read = await h.call('ada', 'GET', `/v1/threads/${thread}`);
    expect(read.json<{ comments: unknown[] }>().comments).toHaveLength(2);
    const both = await client.callTool({
      name: 'comment',
      arguments: { component, thread, text: 'Both at once' },
    });
    expect(both.isError).toBe(true);
    await client.close();
  });

  it('suggests an edit for the author to review, changing nothing, and refuses one the caller may not make', async () => {
    const before = (await h.call('ada', 'GET', `/v1/components/${component}`)).json<{
      version: { id: string };
    }>().version.id;
    const client = await connect('adaWrites');
    const suggested = await client.callTool({
      name: 'suggest_edit',
      arguments: {
        component,
        version: before,
        edits: [{ replace: 'p1', markdown: 'The north weir floods each spring and autumn.' }],
      },
    });
    expect(suggested.isError, JSON.stringify(suggested.content)).toBeFalsy();
    const after = (await h.call('ada', 'GET', `/v1/components/${component}`)).json<{
      version: { id: string };
    }>().version.id;
    expect(after).toBe(before);
    const missing = await client.callTool({
      name: 'suggest_edit',
      arguments: { component, version: before, edits: [{ delete: 'nowhere' }] },
    });
    expect(missing.isError).toBe(true);
    expect(JSON.parse((missing.content as { text: string }[])[0]!.text)).toMatchObject({
      code: 'edits_invalid',
    });
    await client.close();
    // Alice reads General and holds no suggest there: her token's scope gives her none.
    const hers = await connect('alice');
    const refused = await hers.callTool({
      name: 'suggest_edit',
      arguments: { component, version: before, edits: [{ delete: 'p1' }] },
    });
    expect(refused.isError).toBe(true);
    await hers.close();
  });

  it('drafts a new component from Markdown in a space the caller may create in, and nowhere else', async () => {
    const client = await connect('adaWrites');
    const drafted = await client.callTool({
      name: 'draft_component',
      arguments: {
        space: h.general,
        title: 'Spring floods',
        markdown: 'The weir floods.\n\nEach spring.',
      },
    });
    expect(drafted.isError, JSON.stringify(drafted.content)).toBeFalsy();
    const made = (drafted.structuredContent as { component: { id: string } }).component.id;
    const read = await client.callTool({ name: 'read_component', arguments: { component: made } });
    expect((read.structuredContent as { blocks: string }).blocks).toMatch(
      /^\[#\S+\] paragraph\nThe weir floods\.\n\n\[#\S+\] paragraph\nEach spring\.$/,
    );
    await client.close();
    const hers = await connect('alice');
    const refused = await hers.callTool({
      name: 'draft_component',
      arguments: { space: h.general, title: 'Hers', markdown: 'Not hers to make.' },
    });
    expect(refused.isError).toBe(true);
    await hers.close();
  });

  it('IAM-036 acts through MCP as a service identity, with its grants and never another', async () => {
    const made = (
      await h.call('ada', 'POST', '/v1/service-identities', { name: 'Weir agent' })
    ).json<{ id: string }>().id;
    secrets.robot = (
      await h.call('ada', 'POST', `/v1/service-identities/${made}/tokens`, {
        name: 'Agent',
        scopes: ['comment'],
        expiresAt: inAMonth(),
      })
    ).json<{ secret: string }>().secret;
    const client = await connect('robot');
    const unread = await client.callTool({ name: 'read_component', arguments: { component } });
    expect(unread.isError).toBe(true);
    await h.allow(made, h.roles.Reader!, { kind: 'space', id: h.general });
    const read = await client.callTool({ name: 'read_component', arguments: { component } });
    expect(read.isError, JSON.stringify(read.content)).toBeFalsy();
    // Reading, and a comment scope, give it no permission to comment its grants do not hold.
    const comment = await client.callTool({
      name: 'comment',
      arguments: { component, text: 'From the agent' },
    });
    expect(comment.isError).toBe(true);
    await client.close();
    const used = (await toolEvents()).filter((each) => each.actor === made);
    expect(used.map((each) => each.detail.outcome)).toEqual(['refused', 'ok', 'refused']);
  });

  it('refuses Markdown a save could not store, as the route does', async () => {
    const client = await connect('adaWrites');
    const drafted = await client.callTool({
      name: 'draft_component',
      arguments: { space: h.general, title: 'Broken', markdown: 'a\ud800b' },
    });
    expect(drafted.isError).toBe(true);
    expect(JSON.parse((drafted.content as { text: string }[])[0]!.text)).toMatchObject({
      code: 'content_invalid',
    });
    await client.close();
  });

  it("comments on a document's node, as the caller", async () => {
    const document = await h.documentReferencing([component]);
    const client = await connect('adaWrites');
    const started = await client.callTool({
      name: 'comment',
      arguments: { document: document.id, node: document.nodes[0]!, text: 'Check this section.' },
    });
    expect(started.isError, JSON.stringify(started.content)).toBeFalsy();
    await client.close();
  });

  it('API-023 audits a call naming no tool, or arguments it refuses, as refused', async () => {
    const before = (await toolEvents()).length;
    const bearer = { authorization: `Bearer ${secrets.ada!}` };
    await post(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'publish' } },
      bearer,
    );
    await post(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'search', arguments: {} } },
      bearer,
    );
    expect((await toolEvents()).slice(before).map((each) => each.detail)).toEqual([
      { tool: 'unknown', arguments: {}, outcome: 'refused', code: 'unknown_tool' },
      { tool: 'search', arguments: {}, outcome: 'refused', code: 'invalid_arguments' },
    ]);
  });

  it('answers a body that is not JSON, or too large, in its own status', async () => {
    const bearer = { authorization: `Bearer ${secrets.ada!}` };
    const xml = await h.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: HOST, 'content-type': 'application/xml', ...bearer },
      payload: '<ping/>',
    });
    expect(xml.statusCode).toBe(415);
    expect(xml.json()).toMatchObject({ error: { code: -32600 } });
    const large = await post(
      { jsonrpc: '2.0', id: 7, method: 'ping', params: { padding: 'x'.repeat(2_000_000) } },
      bearer,
    );
    expect(large.statusCode).toBe(413);
  });

  it('takes a bearer token alone, refusing a cookie, a page of another origin and a version it does not hold', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const cookie = await post(ping, { cookie: h.cookies.ada! });
    expect(cookie.statusCode).toBe(401);
    expect(cookie.headers['www-authenticate']).toBe('Bearer');
    const bearer = { authorization: `Bearer ${secrets.ada!}` };
    expect((await post(ping, bearer)).json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect((await post(ping, { ...bearer, origin: 'https://elsewhere.example' })).statusCode).toBe(
      403,
    );
    expect((await post(ping, { ...bearer, origin: `http://${HOST}` })).statusCode).toBe(200);
    expect((await post(ping, { ...bearer, 'mcp-protocol-version': '2024-11-05' })).statusCode).toBe(
      400,
    );
    expect((await post([ping], bearer)).json()).toMatchObject({ error: { code: -32600 } });
    expect(
      (await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, bearer)).statusCode,
    ).toBe(202);
    expect(
      (await post({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, bearer)).json(),
    ).toMatchObject({ error: { code: -32601 } });
    const parse = await h.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: HOST, 'content-type': 'application/json', ...bearer },
      payload: '{not json',
    });
    expect(parse.json()).toMatchObject({ error: { code: -32700 } });
    expect(
      (await h.app.inject({ method: 'GET', url: '/mcp', headers: { host: HOST, ...bearer } }))
        .statusCode,
    ).toBe(405);
    const unknown = await post(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'publish' } },
      bearer,
    );
    expect(unknown.json()).toMatchObject({ error: { code: -32602 } });
    const invalid = await post(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search', arguments: {} } },
      bearer,
    );
    expect(invalid.json()).toMatchObject({ result: { isError: true } });
  });
});
