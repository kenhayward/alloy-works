import {
  MAIL_DEADLINE_MS,
  mailAnswerSchema,
  type MailAnswer,
  type MailRequest,
} from '@alloy-works/domain';

/**
 * The worker's way to send a mail (the EM plan, EM-I): `POST /v1/mail` with the mail-only key, which
 * opens nothing else. The request carries a tenant's sealed password, never an opened one, and names
 * nothing of the operator's relay; `busy` where the connector is full, which is no attempt.
 */
export type Mailer = (request: MailRequest) => Promise<MailAnswer | 'busy'>;

/** The most a mail's answer may be: a code and two numbers, as JSON. */
const ANSWER_MOST = 4 * 1024;

export function connectorMailer(options: {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof fetch;
}): Mailer {
  const base = options.url.replace(/\/+$/, '');
  const fetching = options.fetch ?? fetch;
  const failed: MailAnswer = { type: 'failed', code: 'connector_error', latencyMs: 0 };
  return async (request) => {
    let response: Response;
    try {
      response = await fetching(`${base}/v1/mail`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(MAIL_DEADLINE_MS + 5000),
      });
    } catch {
      return 'busy';
    }
    if (response.status === 503) return 'busy';
    if (!response.ok) return failed;
    let text: string;
    try {
      text = await response.text();
    } catch {
      return 'busy';
    }
    if (text.length > ANSWER_MOST) return failed;
    try {
      const parsed = mailAnswerSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // Not an answer.
    }
    return failed;
  };
}
