import { z } from 'zod';

import { isBaseUrl } from '../data/connection.js';

/**
 * A tenant's model endpoint (generation.md, "Endpoints"; the G1 plan, G1-A): which protocol it
 * speaks, where, which model, how much it accepts, what it costs, and whether it sits outside the
 * tenant's data boundary, which the administrator states and nothing infers (GEN-031).
 */

/** The two protocols (GN-B): Anthropic's Messages API, and OpenAI's chat completions. */
export const MODEL_PROTOCOLS = ['anthropic', 'openai'] as const;
export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number];

/** What a route is for (GN-B, GEN-028); a test is a run's purpose and routes nothing. */
export const ROUTED_PURPOSES = ['drafting', 'chat', 'summarising', 'embedding'] as const;
export type RoutedPurpose = (typeof ROUTED_PURPOSES)[number];
export const RUN_PURPOSES = [...ROUTED_PURPOSES, 'test'] as const;
export type RunPurpose = (typeof RUN_PURPOSES)[number];

export const BOUNDARIES = ['inside', 'outside'] as const;
export type Boundary = (typeof BOUNDARIES)[number];

/** The least and most context window an endpoint may declare, in tokens. */
export const CONTEXT_WINDOW = { least: 1024, most: 10_000_000 } as const;

/** The most a price per million tokens may be, in the currency's units, to six places. */
export const PRICE_MOST = 1_000_000;

/** A model's identifier, as its provider spells it: printable ASCII, no space, 1 to 200 characters. */
const MODEL = /^[\x21-\x7e]{1,200}$/;

const price = z.number().min(0).max(PRICE_MOST).refine(hasSixPlacesAtMost, {
  message: 'A price is to six decimal places at most',
});

function hasSixPlacesAtMost(value: number): boolean {
  return Math.abs(Math.round(value * 1e6) - value * 1e6) < 1e-6;
}

export const modelEndpointSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  protocol: z.enum(MODEL_PROTOCOLS),
  baseUrl: z.string().refine(isBaseUrl, {
    message:
      'A base URL is http or https, a lower-case host or a canonical address, an optional port and a path: no user, query, fragment or trailing slash',
  }),
  model: z
    .string()
    .regex(MODEL, { message: "A model is its provider's identifier, with no space" }),
  contextWindow: z.number().int().min(CONTEXT_WINDOW.least).max(CONTEXT_WINDOW.most),
  priceIn: price,
  priceOut: price,
  currency: z.string().regex(/^[A-Z]{3}$/, { message: 'A currency is its ISO 4217 code' }),
  boundary: z.enum(BOUNDARIES),
});
export type ModelEndpoint = z.infer<typeof modelEndpointSchema>;

/** What an endpoint's key is sealed to beside the tenant (G1-B): the endpoint and where it signs in. */
export function modelCredentialContext(
  endpointId: string,
  endpoint: Pick<ModelEndpoint, 'protocol' | 'baseUrl'>,
): string {
  return JSON.stringify([endpointId, endpoint.protocol, originOf(endpoint.baseUrl)]);
}

/** A base URL's scheme, host and port: a key follows the host it was given for, not a path. */
function originOf(baseUrl: string): string {
  const match = /^(https?:\/\/[^/]+)/.exec(baseUrl);
  return match ? match[1]! : baseUrl;
}

/** A price in millionths of the currency's unit, so cost is integer arithmetic. */
const micros = (price: number): bigint => BigInt(Math.round(price * 1e6));

/**
 * A run's cost in millionths of the currency's unit (GEN-033): each price is per million tokens, so
 * tokens times the price in millionths, over a million, rounded half up.
 */
export function costMicros(
  tokens: { readonly in: number; readonly out: number },
  prices: Pick<ModelEndpoint, 'priceIn' | 'priceOut'>,
): bigint {
  const total =
    BigInt(tokens.in) * micros(prices.priceIn) + BigInt(tokens.out) * micros(prices.priceOut);
  return (total + 500_000n) / 1_000_000n;
}
