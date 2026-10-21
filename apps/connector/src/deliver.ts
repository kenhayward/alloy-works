import { createHmac } from 'node:crypto';

import {
  DELIVERY_DEADLINE_MS,
  DELIVERY_REPLY_MOST,
  secretKey,
  signatureHeader,
  signedContent,
  type ChildDeliverRequest,
  type DeliverAnswer,
} from '@alloy-works/domain';

import { baseUrlParts, deliver, type ExchangePolicy } from './https.js';

/**
 * A webhook delivery, in the child (the WB plan, WB-F and WB-G): the body signed as Standard Webhooks
 * specifies with each secret it was given, posted once to the subscription's URL, and the receiver's
 * status and the start of its reply answered. Never the receiver's headers or the network's words.
 */
export async function answerDeliver(
  input: ChildDeliverRequest,
  options: { readonly lookup?: ExchangePolicy['lookup']; readonly now?: () => number } = {},
): Promise<DeliverAnswer> {
  const started = Date.now();
  const latency = () => Math.max(0, Date.now() - started);
  const { request } = input;
  const timestamp = Math.floor((options.now ?? Date.now)() / 1000);
  const content = signedContent(request.id, timestamp, request.body);
  const signatures = input.secrets.map((secret) =>
    createHmac('sha256', Buffer.from(secretKey(secret), 'base64'))
      .update(content, 'utf8')
      .digest('base64'),
  );
  const url = new URL(request.url);
  const parts = baseUrlParts(`${url.protocol}//${url.host}`);
  const delivered = await deliver(
    {
      host: parts.host,
      port: parts.port,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      secure: true,
      headers: [
        ['user-agent', 'Alloy-Works-Webhooks/1'],
        ['webhook-id', request.id],
        ['webhook-timestamp', String(timestamp)],
        ['webhook-signature', signatureHeader(signatures)],
      ],
      body: request.body,
    },
    {
      deny: input.deny,
      ...(options.lookup ? { lookup: options.lookup } : {}),
      ...(input.ca === undefined ? {} : { ca: input.ca }),
      deadline: started + DELIVERY_DEADLINE_MS,
      connectTimeoutMs: input.connectTimeoutMs,
      replyBytes: DELIVERY_REPLY_MOST,
    },
  );
  if (!delivered.ok) return { type: 'failed', code: delivered.code, latencyMs: latency() };
  if (delivered.status < 100 || delivered.status > 599) {
    return { type: 'failed', code: 'connection_failed', latencyMs: latency() };
  }
  return {
    type: 'answered',
    status: delivered.status,
    latencyMs: latency(),
    // Control characters, NUL among them, which a text column refuses, never kept (the final review).
    reply: keptText(delivered.reply).slice(0, DELIVERY_REPLY_MOST),
  };
}

/** A reply's text with its control characters, NUL among them, dropped: tab and line ends kept. */
function keptText(text: string): string {
  return Array.from(text)
    .filter((each) => {
      const code = each.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('');
}
