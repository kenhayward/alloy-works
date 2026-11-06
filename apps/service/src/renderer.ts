import { existsSync, readdirSync } from 'node:fs';
import { posix, relative, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { apiNotFound } from './http.js';

/**
 * The renderer, served beside the API by the service that answers it. One origin, so the session
 * cookie belongs to the same address the renderer calls, which is what lets the desktop window load
 * the service rather than a file from disk (ADR-0022).
 */
export function serveRenderer(app: FastifyInstance, root: string, policy: string): void {
  void app.register(fastifyStatic, {
    root,
    wildcard: false,
    setHeaders: (reply) => {
      void reply.header('Content-Security-Policy', policy);
    },
  });
}

/**
 * What the renderer's page may load: its own scripts and nothing else, so an injected one does not
 * run. Styles may be inline, as ProseMirror and React set them on elements. The object store's origin
 * is let in where its signed links go (an image, a preview's frame, a download's frame, an upload),
 * and `blob:` where the renderer makes a file itself. Nothing may frame the page.
 */
export function rendererPolicy(storeOrigin: string | undefined): string {
  const store = storeOrigin === undefined ? '' : ` ${storeOrigin}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${store}`,
    "font-src 'self' data:",
    `connect-src 'self'${store}`,
    `frame-src 'self' blob:${store}`,
    `media-src 'self' blob:${store}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The routes `serveRenderer` adds, one per file, as Fastify names them. */
export function rendererRoutes(root: string): ReadonlySet<string> {
  if (!existsSync(root)) return new Set();
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  );
  const routes = files.map(
    (file) =>
      posix.sep + relative(root, `${file.parentPath}${sep}${file.name}`).split(sep).join(posix.sep),
  );
  // `index.html` also answers as its directory.
  return new Set([
    ...routes,
    ...routes
      .filter((route) => route.endsWith('/index.html'))
      .map((route) => route.slice(0, -'index.html'.length)),
  ]);
}

/**
 * What answers an address that matched neither a route nor a file. Anything under `/v1` is the
 * API's, and keeps the API's own "nothing here"; everything else is the renderer's page, because
 * the addresses a single-page interface owns exist only in the browser.
 */
export function rendererFallback(request: FastifyRequest, reply: FastifyReply): unknown {
  if (request.url.startsWith('/v1/')) return apiNotFound(request, reply);
  return reply.sendFile('index.html');
}
