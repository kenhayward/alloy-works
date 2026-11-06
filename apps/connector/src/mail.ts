import { rootCertificates } from 'node:tls';

import {
  childMailRequestSchema,
  MAIL_DEADLINE_MS,
  type ChildMailRequest,
  type MailAnswer,
  type MailFailureCode,
} from '@alloy-works/domain';
import nodemailer from 'nodemailer';

import { guardedAddress, normaliseHost, type Lookup } from './guard.js';

/**
 * A mail, in the child (the EM plan, EM-I and EM-J): every value checked again for a line break before
 * the library sees it, the relay's host guarded and resolved once, the socket dialled at the address
 * checked, TLS required - from the start, or by STARTTLS before AUTH - and verified by the host's
 * name. Answers sent, or a code and the SMTP code alone: the relay's words can quote an address.
 */
export async function answerMail(
  input: ChildMailRequest,
  options: { readonly lookup?: Lookup; readonly deadlineMs?: number } = {},
): Promise<MailAnswer> {
  const started = Date.now();
  const latencyMs = () => Math.max(0, Date.now() - started);
  const failed = (code: MailFailureCode, smtpCode?: number): MailAnswer => ({
    type: 'failed',
    code,
    ...(smtpCode === undefined ? {} : { smtpCode }),
    latencyMs: latencyMs(),
  });
  const parsed = childMailRequestSchema.safeParse(input);
  if (!parsed.success) return failed('connector_error');
  const { relay, message } = parsed.data;
  const guarded = await guardedAddress(relay.host, {
    deny: parsed.data.deny,
    ...(options.lookup ? { lookup: options.lookup } : {}),
  });
  if (guarded === 'refused') return failed('host_refused');
  const byName = normaliseHost(relay.host).kind === 'name';
  const deadlineMs = options.deadlineMs ?? MAIL_DEADLINE_MS;
  const domain = relay.fromAddress.slice(relay.fromAddress.lastIndexOf('@') + 1);
  const transport = nodemailer.createTransport({
    // The address checked, never the name again: a rebinding answer is never asked for.
    host: guarded.address,
    port: relay.port,
    secure: relay.implicitTls,
    requireTLS: !relay.implicitTls,
    tls: {
      ...(byName ? { servername: relay.host } : {}),
      ...(parsed.data.ca === undefined ? {} : { ca: [...rootCertificates, parsed.data.ca] }),
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    },
    ...(relay.username === null
      ? {}
      : { auth: { user: relay.username, pass: relay.password ?? '' } }),
    // The sender's domain greets, never this host's name.
    name: domain,
    connectionTimeout: parsed.data.connectTimeoutMs,
    greetingTimeout: deadlineMs,
    socketTimeout: deadlineMs,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
  });
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), deadlineMs);
  });
  try {
    const sent = await Promise.race([
      transport.sendMail({
        from: { name: message.fromName, address: relay.fromAddress },
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId: `<${message.id}@${domain}>`,
        headers: { 'X-Alloy-Event-Id': message.id, 'Auto-Submitted': 'auto-generated' },
      }),
      late,
    ]);
    if (sent === 'late') return failed('timeout');
    if (sent.accepted.length !== 1) return failed('recipient_refused');
    return { type: 'sent', latencyMs: latencyMs() };
  } catch (error) {
    const { code, smtpCode } = failureOf(error);
    return failed(code, smtpCode);
  } finally {
    clearTimeout(timer);
    transport.close();
  }
}

/** A library error as a code and its SMTP code, its message - which quotes the relay - dropped. */
function failureOf(error: unknown): { code: MailFailureCode; smtpCode?: number } {
  const { code, responseCode, command, response } = (error ?? {}) as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
    response?: unknown;
  };
  // A 5.7.x is the relay's policy - relay access denied, a sender not allowed - and never the
  // recipient's: its code read, its words dropped (the final review).
  const policy = typeof response === 'string' && /\b5\.7\.\d{1,3}\b/.test(response);
  const smtpCode =
    typeof responseCode === 'number' &&
    Number.isInteger(responseCode) &&
    responseCode >= 200 &&
    responseCode <= 599
      ? responseCode
      : undefined;
  const coded = (each: MailFailureCode) => ({
    code: each,
    ...(smtpCode === undefined ? {} : { smtpCode }),
  });
  switch (code) {
    case 'EAUTH':
    case 'ENOAUTH':
      return coded('auth_failed');
    case 'ETLS':
      return coded('tls_failed');
    case 'ETIMEDOUT':
      return coded('timeout');
    case 'EENVELOPE':
      return coded(
        smtpCode !== undefined && smtpCode >= 500 && command === 'RCPT TO' && !policy
          ? 'recipient_refused'
          : 'relay_refused',
      );
    case 'EMESSAGE':
    case 'EPROTOCOL':
      return coded('relay_refused');
    default:
      return tlsError(error) ? coded('tls_failed') : coded('connection_failed');
  }
}

/** Whether a socket's error was TLS refusing the relay's certificate or its handshake. */
function tlsError(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let each: unknown = error; each && !seen.has(each);) {
    seen.add(each);
    // The library keeps the socket's own code as `originalCode`.
    const { code, originalCode, cause } = each as {
      code?: unknown;
      originalCode?: unknown;
      cause?: unknown;
    };
    for (const one of [code, originalCode]) {
      if (
        typeof one === 'string' &&
        (one.startsWith('ERR_TLS_') ||
          one.startsWith('ERR_SSL_') ||
          /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(one))
      ) {
        return true;
      }
    }
    each = cause;
  }
  return false;
}
