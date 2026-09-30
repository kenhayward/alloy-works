import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

const require = createRequire(import.meta.url);
const documentBytes = readFileSync(require.resolve('@alloy-works/api-contract/openapi.json'));
const scalarBytes = readFileSync(
  join(dirname(require.resolve('@scalar/api-reference')), 'browser', 'standalone.js'),
);
const scalarPath = `/docs/v1/scalar-${createHash('sha256').update(scalarBytes).digest('hex').slice(0, 16)}.js`;
const documentEtag = `"${createHash('sha256').update(documentBytes).digest('hex')}"`;

function secure(reply: FastifyReply): void {
  void reply.header('Referrer-Policy', 'no-referrer');
  void reply.header('X-Content-Type-Options', 'nosniff');
  void reply.header('X-Frame-Options', 'DENY');
}

const clientScript = String.raw`
  const origin = window.location.origin;
  const status = document.querySelector('#status');
  const operation = document.querySelector('#operation');
  const fields = document.querySelector('#fields');
  const body = document.querySelector('#body');
  const file = document.querySelector('#file');
  const answer = document.querySelector('#answer');
  const token = document.querySelector('#token');
  const execute = document.querySelector('#execute');
  const spec = await fetch('/openapi/v1.json', { credentials: 'omit' }).then(r => r.json());
  Scalar.createApiReference('#reference', {
    content: spec,
    hideTestRequestButton: true,
    hideClientButton: true,
    withDefaultFonts: false,
    persistAuth: false,
    telemetry: false,
    agent: { disabled: true },
  });
  const routes = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, details] of Object.entries(methods)) {
      if (details['x-alloy-token-enabled'] !== true) continue;
      routes.push({ path, method: method.toUpperCase(), details });
    }
  }
  for (const [index, route] of routes.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = route.method + ' ' + route.path + ' - ' + route.details.summary;
    operation.append(option);
  }
  function selectRoute() {
    fields.replaceChildren();
    const route = routes[Number(operation.value)];
    if (!route) return;
    for (const parameter of route.details.parameters || []) {
      const label = document.createElement('label');
      label.textContent = parameter.name + (parameter.required ? ' (required)' : '') + ' ';
      const input = document.createElement('input');
      input.dataset.name = parameter.name;
      input.dataset.location = parameter.in;
      label.append(input);
      fields.append(label);
    }
    body.hidden = !route.details.requestBody?.content?.['application/json'];
    file.hidden = !route.details.requestBody?.content?.['application/octet-stream'];
    status.textContent = route.method === 'GET' ? 'Read-only request' : 'This request can change ' + origin;
  }
  operation.addEventListener('change', selectRoute);
  selectRoute();
  execute.addEventListener('click', async () => {
    const route = routes[Number(operation.value)];
    if (!route) return;
    const secret = token.value.trim();
    if (!/^awt_[A-Za-z0-9_-]{43}$/.test(secret)) {
      answer.textContent = 'Enter a personal API token before executing.';
      return;
    }
    let path = route.path;
    const query = new URLSearchParams();
    const extraHeaders = {};
    for (const input of fields.querySelectorAll('input')) {
      const value = input.value.trim();
      if (!value && input.parentElement.textContent.includes('(required)')) {
        answer.textContent = 'Fill every required parameter.';
        return;
      }
      if (input.dataset.location === 'path') path = path.replace('{' + input.dataset.name + '}', encodeURIComponent(value));
      else if (input.dataset.location === 'query' && value) query.set(input.dataset.name, value);
      else if (input.dataset.location === 'header' && value && ['X-Request-Id', 'Idempotency-Key'].includes(input.dataset.name)) extraHeaders[input.dataset.name] = value;
    }
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) {
      answer.textContent = 'The reference refuses a request outside this environment.';
      return;
    }
    url.search = query.toString();
    if (route.method !== 'GET' && !window.confirm('Send ' + route.method + ' to ' + origin + '? This may change this environment.')) return;
    let payload;
    let contentType;
    if (route.details.requestBody?.content?.['application/json']) {
      try { payload = JSON.stringify(JSON.parse(body.value)); }
      catch { answer.textContent = 'Enter a valid JSON request body.'; return; }
      contentType = 'application/json';
    } else if (route.details.requestBody?.content?.['application/octet-stream']) {
      payload = file.files?.[0];
      if (!payload) { answer.textContent = 'Choose a file to upload.'; return; }
      contentType = 'application/octet-stream';
    }
    answer.textContent = 'Sending...';
    try {
      const response = await fetch(url, {
        method: route.method,
        credentials: 'omit',
        redirect: 'manual',
        headers: { Authorization: 'Bearer ' + secret, ...extraHeaders, ...(contentType ? { 'Content-Type': contentType } : {}) },
        ...(payload ? { body: payload } : {}),
      });
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const first = await reader?.read();
        answer.textContent = response.status + ' ' + response.statusText + '\n' + new TextDecoder().decode(first?.value);
        await reader?.cancel();
        return;
      }
      if (response.headers.get('content-type')?.startsWith('image/') || response.headers.get('content-type')?.includes('application/pdf')) {
        const bytes = await response.arrayBuffer();
        answer.textContent = response.status + ' ' + response.statusText + '\n' + bytes.byteLength + ' bytes (' + response.headers.get('content-type') + ')';
        return;
      }
      const content = await response.text();
      let shown = content;
      try { shown = JSON.stringify(JSON.parse(content), null, 2); } catch { /* Not JSON. */ }
      answer.textContent = response.status + ' ' + response.statusText + '\n' + shown;
    } catch {
      answer.textContent = 'The request could not be completed.';
    }
  });
`;

function page(nonce: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alloy Works API reference</title><style>
body{margin:0;font-family:system-ui,sans-serif}#explorer{padding:1rem 2rem;border-bottom:1px solid #ccd3d8;background:#f5f8fa}
#explorer label{display:inline-block;margin:.5rem 1rem .5rem 0}#explorer input,#explorer select,#explorer textarea{font:inherit;padding:.4rem}
#operation{max-width:100%;width:40rem}#token{width:23rem}#body{display:block;width:min(48rem,90%);height:7rem}
#body[hidden]{display:none}
#file[hidden]{display:none}
#answer{white-space:pre-wrap;overflow:auto}#fields label{display:block}
</style></head><body>
<section id="explorer"><h1>Alloy Works API reference</h1><p>Environment: <strong id="environment"></strong>. Token requests omit your browser session; your token is not saved and disappears on reload.</p>
<label>Personal API token <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="awt_..."></label>
<label>Operation <select id="operation"></select></label><div id="fields"></div>
<textarea id="body" aria-label="JSON request body" placeholder="JSON request body" hidden></textarea>
<input id="file" type="file" aria-label="File to upload" hidden>
<p id="status"></p><button id="execute" type="button">Execute with token</button><pre id="answer" role="status"></pre>
<p>Session-only operations are documented below but cannot be executed here. Mutating requests require confirmation.</p></section>
<div id="reference"></div><script src="${scalarPath}"></script>
<script type="module" nonce="${nonce}">document.querySelector('#environment').textContent=window.location.origin;${clientScript}</script>
</body></html>`;
}

export function registerDocs(
  app: FastifyInstance,
  resolve: (hostname: string) => Promise<unknown>,
): void {
  const knownHost = async (request: FastifyRequest) => {
    if (!(await resolve(request.hostname))) {
      throw new AppError(404, 'tenant_not_found', 'No environment is served at this address.');
    }
  };
  app.get('/openapi/v1.json', { onRequest: knownHost }, (request, reply) => {
    secure(reply);
    void reply.header('Cache-Control', 'no-cache');
    void reply.header('ETag', documentEtag);
    if (request.headers['if-none-match'] === documentEtag) return reply.status(304).send();
    return reply.type('application/vnd.oai.openapi+json;version=3.1').send(documentBytes);
  });
  app.get('/docs', { onRequest: knownHost }, (_request, reply) => {
    secure(reply);
    void reply.header('Cache-Control', 'no-cache');
    return reply.redirect('/docs/v1/', 302);
  });
  app.get('/docs/v1/', { onRequest: knownHost }, (_request, reply) => {
    secure(reply);
    const nonce = randomBytes(16).toString('base64');
    void reply.header('Cache-Control', 'no-cache');
    void reply.header(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`,
    );
    return reply.type('text/html; charset=utf-8').send(page(nonce));
  });
  app.get(scalarPath, { onRequest: knownHost }, (_request, reply) => {
    secure(reply);
    void reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.type('application/javascript; charset=utf-8').send(scalarBytes);
  });
}
