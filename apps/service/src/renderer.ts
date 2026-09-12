import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { apiNotFound } from './http.js';

/**
 * The renderer, served beside the API by the service that answers it. One origin, so the session
 * cookie belongs to the same address the renderer calls, which is what lets the desktop window load
 * the service rather than a file from disk (ADR-0022).
 */
export function serveRenderer(app: FastifyInstance, root: string): void {
  void app.register(fastifyStatic, { root, wildcard: false });
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
