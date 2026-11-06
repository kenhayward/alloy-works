import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';
import { e2eTargets } from './targets.js';

type Json = Record<string, unknown>;

const TARGETS = e2eTargets(process.env);

/** A mail as Mailpit lists it. */
interface Listed {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
}

/**
 * Mail over the whole system (the EM plan): the notification or the invitation queued by its
 * trigger, the worker's loop, the connector's `/v1/mail` and the operator's relay, which in
 * development is Mailpit, read back through its API. A notification's five minutes' hold is passed
 * by moving its row due in the stack's own database, the one step taken around the service.
 */
describe('mail over the whole system', () => {
  let ada = '';
  let held: Json | undefined;

  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };

  /** The first mail to `to` whose subject is `subject`, waited for, with its text. */
  const arrived = async (to: string, subject: string): Promise<{ subject: string; text: string }> => {
    const stop = Date.now() + 90_000;
    for (;;) {
      const listed = (await (
        await fetch(`${TARGETS.mail}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
      ).json()) as { messages: Listed[] };
      const found = listed.messages.find((each) => each.Subject === subject);
      if (found) {
        const read = (await (
          await fetch(`${TARGETS.mail}/api/v1/message/${found.ID}`)
        ).json()) as { Text: string };
        return { subject: found.Subject, text: read.Text.replace(/\r\n/g, '\n') };
      }
      if (Date.now() > stop) throw new Error(`no mail “${subject}” arrived for ${to}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  /** Every notification's mail due now, past its hold, in the stack's database. */
  const dueNow = () => {
    const ids = execFileSync(
      'docker',
      [
        'ps',
        '-q',
        '--filter',
        `label=com.docker.compose.project=${TARGETS.composeProject}`,
        '--filter',
        'label=com.docker.compose.service=postgres',
      ],
      { encoding: 'utf8' },
    )
      .split(/\s+/)
      .filter(Boolean);
    expect(ids).toHaveLength(1);
    execFileSync(
      'docker',
      [
        'exec',
        ids[0]!,
        'psql',
        '-U',
        'postgres',
        '-d',
        'alloy_dev',
        '-c',
        "update t_acmedev.email_delivery set next_at = now() where state = 'pending'",
      ],
      { encoding: 'utf8' },
    );
  };

  beforeAll(async () => {
    await untilReady();
    ada = await signIn('ada');
    held = ok(await call(ada, 'GET', '/v1/mail-channel'))['channel'] as Json;
    ok(
      await call(ada, 'PUT', '/v1/mail-channel', {
        enabled: true,
        relay: 'platform',
        fromName: null,
      }),
    );
  }, 180_000);

  afterAll(async () => {
    // Left as it was found: the stack's other suites have their own expectations of its mail.
    if (held === undefined || ada === '') return;
    const { enabled, relay, host, port, username, fromAddress, fromName } = held;
    await call(ada, 'PUT', '/v1/mail-channel', {
      enabled,
      relay,
      ...(relay === 'own' ? { host, port, username, fromAddress } : {}),
      fromName,
    });
  });

  it('COL-064 tells a person mentioned by email, with a link to their inbox and none of the comment', async () => {
    const grace = await signIn('grace');
    const graceId = ok(await call(grace, 'GET', '/v1/me'))['id'] as string;
    const spaces = ok(await call(ada, 'GET', '/v1/spaces'))['items'] as { id: string; name: string }[];
    const general = spaces.find((space) => space.name === 'General')!.id;
    const title = `Install the printer ${Date.now()}`;
    const made = ok(
      await call(ada, 'POST', `/v1/spaces/${general}/components`, {
        title,
        language: 'en-GB',
        direction: 'ltr',
      }),
    );
    ok(
      await call(ada, 'POST', `/v1/components/${made['id'] as string}/threads`, {
        version: (made['version'] as Json)['id'],
        anchor: { kind: 'component' },
        parts: [{ text: 'The tray jams, over to ' }, { mention: graceId }],
      }),
    );
    dueNow();
    const mail = await arrived('grace@example.com', 'Somebody mentioned you in a comment');
    expect(mail.text).toMatch(/\nhttps?:\/\/[^/\s]+\/#\/inbox\n/);
    expect(`${mail.subject}\n${mail.text}`).not.toMatch(/printer|tray|jams|Ada|General/i);
  });

  it('IAM-089 mails an invitation with a link that signs the invitee in', async () => {
    const invited = await call(ada, 'POST', '/v1/invitations', { email: 'ivy@example.com' });
    // A retry finds the invitation made: renewing it mails nothing more the same day (EM-S).
    expect([200, 409], JSON.stringify(invited.body)).toContain(invited.status);
    const mail = await arrived('ivy@example.com', 'You have been invited to Alloy Works');
    const link = /\n(https?:\/\/[^\s]+\/)\n/.exec(mail.text)?.[1];
    expect(link).toBeDefined();
    expect(link).not.toMatch(/[?#=]/);
    const page = await fetch(link!);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    await signIn('ivy');
    const invitations = ok(await call(ada, 'GET', '/v1/invitations'))['items'] as {
      email: string;
      acceptedAt: string | null;
    }[];
    expect(invitations.find((each) => each.email === 'ivy@example.com')?.acceptedAt).not.toBeNull();
  });
});
