import type { FastifyTypeProvider } from 'fastify';
import type { z } from 'zod';

/** Types a handler's request and reply from the zod schemas it declares. */
export interface ZodTypeProvider extends FastifyTypeProvider {
  readonly validator: this['schema'] extends z.ZodType ? z.output<this['schema']> : unknown;
  readonly serializer: this['schema'] extends z.ZodType ? z.input<this['schema']> : unknown;
}
