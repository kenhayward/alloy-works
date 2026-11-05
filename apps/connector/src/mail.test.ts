import { randomUUID } from 'node:crypto';

import {
  mailAnswerSchema,
  mailCredentialContext,
  type ChildMailRequest,
  type MailRequest,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConnectorConfig, takeConnectorConfig } from './config.js';
import { answerMail } from './mail.js';
import { createConnectorServer } from './server.js';
import { childSpawn, createSupervisor, type PlatformRelay, type Supervisor } from './supervisor.js';
import { SEALING_KEY, TENANT, suiteChild, suiteDeny, suiteIsolation } from './testing/source.js';
import { MAIL_CA, startFakeRelay, type FakeRelay, type RelayOptions } from './testing/smtp.js';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

let relay: FakeRelay | undefined;
afterEach(async () => {
  await relay?.close();
  relay = undefined;
});

async function relayOf(options: RelayOptions = {}): Promise<FakeRelay> {
  relay = await startFakeRelay(options);
  return relay;
}

/** A mail to the fake at a port, by the name its certificate holds, resolved to loopback. */
function mailTo(
  port: number,
  over: Partial<ChildMailRequest['relay']> = {},
  message: Partial<ChildMailRequest['message']> = {},
): ChildMailRequest {
  return {
    kind: 'mail',
    relay: {
      host: 'mailpit',
      port,
      implicitTls: false,
      username: 'ada',
      password: 'relay-dev-password',
      fromAddress: 'news@example.test',
      ...over,
    },
    message: {
      id: '0b8f5f2a-6d0e-4c1b-9b8e-3f2c1d0a9e01',
      fromName: 'Acme',
      to: 'grace@example.test',
      subject: 'Something happened',
      text: 'Something happened.\nOpen it here.',
      ...message,
    },
    deny: [...suiteDeny],
    connectTimeoutMs: 2000,
    ca: MAIL_CA,
  };
}

const loopback = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

describe('a mail sent by the connector’s child (the EM plan, EM-I and EM-J)', () => {
  it('sends over STARTTLS, verified by name, AUTH only once TLS is up, with its stable ids', async () => {
    const fake = await relayOf();
    const answer = await answerMail(mailTo(fake.port), { lookup: loopback });
    expect(answer).toMatchObject({ type: 'sent' });
    expect(mailAnswerSchema.safeParse(answer).success).toBe(true);
    expect(fake.taken).toHaveLength(1);
    const [message] = fake.taken;
    expect(message!.tlsBeforeAuth).toBe(true);
    expect(message!.to).toEqual(['<grace@example.test>']);
    expect(message!.from).toBe('<news@example.test>');
    expect(message!.data).toMatch(/^Message-ID: <0b8f5f2a-6d0e-4c1b-9b8e-3f2c1d0a9e01@example\.test>/m);
    expect(message!.data).toMatch(/^X-Alloy-Event-Id: 0b8f5f2a-6d0e-4c1b-9b8e-3f2c1d0a9e01/im);
    expect(message!.data).toMatch(/^Auto-Submitted: auto-generated/m);
    expect(message!.data).toMatch(/^From: Acme <news@example\.test>/m);
  });

  it('sends over TLS from the start where the port is 465’s way', async () => {
    const fake = await relayOf({ tls: 'implicit' });
    const answer = await answerMail(mailTo(fake.port, { implicitTls: true }), {
      lookup: loopback,
    });
    expect(answer).toMatchObject({ type: 'sent' });
    expect(fake.taken).toHaveLength(1);
  });

  it('sends with no AUTH where the relay asks no username', async () => {
    const fake = await relayOf();
    const answer = await answerMail(mailTo(fake.port, { username: null, password: null }), {
      lookup: loopback,
    });
    expect(answer).toMatchObject({ type: 'sent' });
    expect(fake.authTried()).toBe(false);
  });

  it('refuses a relay without TLS, and a certificate for another name, before AUTH', async () => {
    const plain = await relayOf({ tls: 'none' });
    expect(await answerMail(mailTo(plain.port), { lookup: loopback })).toMatchObject({
      type: 'failed',
      code: 'tls_failed',
    });
    expect(plain.authTried()).toBe(false);
    expect(plain.taken).toHaveLength(0);
    await plain.close();

    const other = await relayOf({ certificate: 'other' });
    expect(await answerMail(mailTo(other.port), { lookup: loopback })).toMatchObject({
      type: 'failed',
      code: 'tls_failed',
    });
    expect(other.authTried()).toBe(false);
  });

  it('refuses a line break in any value before the library sees it', async () => {
    const fake = await relayOf();
    for (const line of [CR, LF]) {
      const broken = [
        mailTo(fake.port, {}, { to: `grace@example.test${line}RCPT TO:<eve@example.test>` }),
        mailTo(fake.port, {}, { subject: `one${line}Bcc: eve@example.test` }),
        mailTo(fake.port, {}, { fromName: `Acme${line}Bcc: eve@example.test` }),
        mailTo(fake.port, { username: `ada${line}x` }),
        mailTo(fake.port, { fromAddress: `news@example.test${line}` }),
      ];
      for (const each of broken) {
        expect(await answerMail(each, { lookup: loopback })).toMatchObject({
          type: 'failed',
          code: 'connector_error',
        });
      }
    }
    expect(fake.connections()).toBe(0);
  });

  it('gives up a recipient the relay refuses for good, with its code and none of its words', async () => {
    const fake = await relayOf({ rcpt: '550 5.1.1 grace@example.test: no such user here' });
    const answer = await answerMail(mailTo(fake.port), { lookup: loopback });
    expect(answer).toEqual({
      type: 'failed',
      code: 'recipient_refused',
      smtpCode: 550,
      latencyMs: expect.any(Number) as number,
    });
    expect(JSON.stringify(answer)).not.toContain('grace');
  });

  it('keeps no words of an SMTP reply, whatever it refuses', async () => {
    const auth = await relayOf({ auth: '535 5.7.8 ada@example.test: bad credentials' });
    const refused = await answerMail(mailTo(auth.port), { lookup: loopback });
    expect(refused).toMatchObject({ type: 'failed', code: 'auth_failed', smtpCode: 535 });
    expect(JSON.stringify(refused)).not.toMatch(/ada|credentials/);
    await auth.close();

    const busy = await relayOf({ rcpt: '451 4.7.1 grace@example.test: try later' });
    const later = await answerMail(mailTo(busy.port), { lookup: loopback });
    expect(later).toMatchObject({ type: 'failed', code: 'relay_refused', smtpCode: 451 });
    expect(JSON.stringify(later)).not.toMatch(/grace|later/);
    await busy.close();

    const data = await relayOf({ data: '554 5.6.0 message from news@example.test refused' });
    const message = await answerMail(mailTo(data.port), { lookup: loopback });
    expect(message).toMatchObject({ type: 'failed', code: 'relay_refused', smtpCode: 554 });
    expect(JSON.stringify(message)).not.toMatch(/news|refused /);
  });

  it('refuses a relay that resolves to an address the guard denies, and dials only the address checked', async () => {
    const fake = await relayOf();
    // Every answer must pass: one denied address refuses the name whole.
    const denied = () =>
      Promise.resolve([
        { address: '127.0.0.1', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ]);
    expect(await answerMail(mailTo(fake.port), { lookup: denied })).toMatchObject({
      type: 'failed',
      code: 'host_refused',
    });
    expect(fake.connections()).toBe(0);
    // A resolver that would answer another address the second time is asked once: the socket is
    // pinned to the first answer, which was checked (a rebinding answer is never asked for).
    let asked = 0;
    const rebinding = () => {
      asked += 1;
      return Promise.resolve([
        asked === 1 ? { address: '127.0.0.1', family: 4 } : { address: '169.254.169.254', family: 4 },
      ]);
    };
    expect(await answerMail(mailTo(fake.port), { lookup: rebinding })).toMatchObject({
      type: 'sent',
    });
    expect(asked).toBe(1);
  });

  it('times out a relay that never greets, within its deadline', async () => {
    const fake = await relayOf({ silent: true });
    const started = Date.now();
    const answer = await answerMail(mailTo(fake.port), { lookup: loopback, deadlineMs: 1500 });
    expect(answer).toMatchObject({ type: 'failed', code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

const OWN = { host: '127.0.0.1', port: 587, username: 'ada' } as const;

function supervisorFor(
  fake: FakeRelay,
  platform: Partial<PlatformRelay> | undefined = undefined,
): Supervisor {
  return createSupervisor({
    sealingKey: SEALING_KEY,
    deny: suiteDeny,
    maxChildren: 8,
    spec: childSpawn(suiteChild, suiteIsolation),
    ca: MAIL_CA,
    mailPort: () => fake.port,
    ...(platform === undefined
      ? {}
      : {
          platformRelay: {
            host: '127.0.0.1',
            port: 587,
            username: 'operator',
            password: 'operator-dev-password',
            fromAddress: 'alloy@operator.test',
            hourly: 100,
            ...platform,
          },
        }),
  });
}

function request(relay: MailRequest['relay'], tenant = TENANT): MailRequest {
  return {
    requestId: randomUUID(),
    tenant,
    id: randomUUID(),
    relay,
    fromName: 'Acme',
    to: 'grace@example.test',
    subject: 'Something happened',
    text: 'Something happened.',
  };
}

const sealedFor = (host: string, port: number, username: string, tenant = TENANT) =>
  sealSecret(
    SEALING_KEY,
    'mail-credential',
    tenant,
    'relay-dev-password',
    mailCredentialContext(host, port, username),
  );

describe('a mail through the supervisor (the EM plan, EM-I and EM-S)', () => {
  it('the connector refuses any from address but the operator’s on the operator’s relay, and past the tenant’s quota', async () => {
    const fake = await relayOf();
    const supervisor = supervisorFor(fake, { hourly: 2 });
    const send = (tenant: string) => supervisor.mail(request({ kind: 'platform' }, tenant));
    expect(await send(TENANT)).toMatchObject({ type: 'sent' });
    expect(fake.taken[0]!.from).toBe('<alloy@operator.test>');
    expect(fake.taken[0]!.data).toMatch(/^From: Acme <alloy@operator\.test>/m);
    expect(fake.taken[0]!.auth).toBeDefined();
    expect(await send(TENANT)).toMatchObject({ type: 'sent' });
    expect(await send(TENANT)).toMatchObject({ type: 'failed', code: 'quota_reached' });
    // Another tenant's hour is its own.
    expect(await send('globex')).toMatchObject({ type: 'sent' });
    expect(fake.taken).toHaveLength(3);
  });

  it('answers relay_not_configured where the operator offers no relay', async () => {
    const fake = await relayOf();
    expect(await supervisorFor(fake).mail(request({ kind: 'platform' }))).toMatchObject({
      type: 'failed',
      code: 'relay_not_configured',
    });
    expect(fake.connections()).toBe(0);
  });

  it('opens a relay’s password at sending only for the tenant, host, port and username it was sealed to', async () => {
    const fake = await relayOf();
    const supervisor = supervisorFor(fake);
    const own = (over: Partial<Extract<MailRequest['relay'], { kind: 'own' }>>) =>
      request({
        kind: 'own',
        ...OWN,
        sealed: sealedFor(OWN.host, OWN.port, OWN.username),
        fromAddress: 'news@example.test',
        ...over,
      });
    expect(await supervisor.mail(own({}))).toMatchObject({ type: 'sent' });
    expect(fake.taken[0]!.auth).toBeDefined();
    for (const moved of [
      own({ host: '127.0.0.2' }),
      own({ port: 465 }),
      own({ username: 'grace' }),
      own({ sealed: null }),
      { ...own({}), tenant: 'globex' },
    ]) {
      expect(await supervisor.mail(moved)).toMatchObject({
        type: 'failed',
        code: 'secret_refused',
      });
    }
    expect(fake.connections()).toBe(1);
  });

  it('sends by a relay of its own that asks no username, holding no password', async () => {
    const fake = await relayOf();
    const answer = await supervisorFor(fake).mail(
      request({
        kind: 'own',
        host: '127.0.0.1',
        port: 587,
        username: null,
        sealed: null,
        fromAddress: 'news@example.test',
      }),
    );
    expect(answer).toMatchObject({ type: 'sent' });
    expect(fake.authTried()).toBe(false);
  });
});

describe("the connector's mail key and the operator's relay (EM-I, EM-B)", () => {
  const SERVICE_KEY = Buffer.alloc(32, 1).toString('base64');
  const DELIVER_KEY = Buffer.alloc(32, 5).toString('base64');
  const MAIL_KEY = Buffer.alloc(32, 6).toString('base64');
  const base = {
    CONNECTOR_KEY: SERVICE_KEY,
    CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
    CONNECTOR_DELIVER_KEY: DELIVER_KEY,
    CONNECTOR_MAIL_KEY: MAIL_KEY,
    CONNECTOR_DENY: 'none',
    LOG_LEVEL: 'silent',
  };
  const RELAY = {
    ALLOY_SMTP_HOST: 'mailpit',
    ALLOY_SMTP_PORT: '587',
    ALLOY_SMTP_USERNAME: 'operator',
    ALLOY_SMTP_PASSWORD: 'operator-dev-password',
    ALLOY_SMTP_FROM: 'alloy@operator.test',
  };
  const refusal = (env: Record<string, string | undefined>) => {
    try {
      loadConnectorConfig(env);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('Expected a refusal');
  };

  it('opens mail alone to the mail key, and mail to no other key the worker holds', async () => {
    const fake = await relayOf();
    const server = createConnectorServer({
      config: loadConnectorConfig(base),
      supervisor: supervisorFor(fake),
      log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const post = (path: string, body: unknown, key: string) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      const mail = request({
        kind: 'own',
        host: '127.0.0.1',
        port: 587,
        username: null,
        sealed: null,
        fromAddress: 'news@example.test',
      });
      const sent = await post('/v1/mail', mail, MAIL_KEY);
      expect(sent.status).toBe(200);
      expect(await sent.json()).toMatchObject({ type: 'sent' });
      expect((await post('/v1/mail', mail, DELIVER_KEY)).status).toBe(401);
      for (const path of ['/v1/deliver', '/v1/seal', '/v1/mail/seal', '/v1/run', '/v1/embed']) {
        expect((await post(path, { tenant: TENANT }, MAIL_KEY)).status, path).toBe(401);
      }
      // A line break reaches no child: the request is refused whole.
      expect(
        (await post('/v1/mail', { ...mail, to: `grace@example.test${CR}${LF}` }, MAIL_KEY)).status,
      ).toBe(400);
      expect(fake.taken).toHaveLength(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reads the operator’s relay, none by default, and deletes its password and the mail key once read', () => {
    expect(loadConnectorConfig(base).platformRelay).toBeUndefined();
    expect(loadConnectorConfig({ ...base, ...RELAY }).platformRelay).toEqual({
      host: 'mailpit',
      port: 587,
      username: 'operator',
      password: 'operator-dev-password',
      fromAddress: 'alloy@operator.test',
      hourly: 200,
    });
    expect(
      loadConnectorConfig({
        ...base,
        ...RELAY,
        ALLOY_SMTP_USERNAME: undefined,
        ALLOY_SMTP_PASSWORD: undefined,
        ALLOY_SMTP_PORT: '465',
        ALLOY_SMTP_HOURLY: '50',
      }).platformRelay,
    ).toMatchObject({ port: 465, username: null, password: null, hourly: 50 });
    const env: Record<string, string | undefined> = { ...base, ...RELAY };
    takeConnectorConfig(env);
    expect(env).not.toHaveProperty('ALLOY_SMTP_PASSWORD');
    expect(env).not.toHaveProperty('CONNECTOR_MAIL_KEY');
  });

  it('refuses an operator’s relay half named, on another port, or a mail key that is one of the others, never saying the value', () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ ...base, ...RELAY, ALLOY_SMTP_FROM: undefined }, 'ALLOY_SMTP_FROM'],
      [{ ...base, ...RELAY, ALLOY_SMTP_FROM: 'not an address' }, 'ALLOY_SMTP_FROM'],
      [{ ...base, ...RELAY, ALLOY_SMTP_PORT: '25' }, 'ALLOY_SMTP_PORT'],
      [{ ...base, ...RELAY, ALLOY_SMTP_HOST: 'smtp://mailpit' }, 'ALLOY_SMTP_HOST'],
      [{ ...base, ...RELAY, ALLOY_SMTP_PASSWORD: undefined }, 'ALLOY_SMTP_PASSWORD'],
      [{ ...base, ...RELAY, ALLOY_SMTP_USERNAME: `operator${LF}x` }, 'ALLOY_SMTP_USERNAME'],
      [{ ...base, ...RELAY, ALLOY_SMTP_HOURLY: '0' }, 'ALLOY_SMTP_HOURLY'],
      [{ ...base, ALLOY_SMTP_FROM: 'alloy@operator.test' }, 'ALLOY_SMTP_HOST'],
      [{ ...base, CONNECTOR_MAIL_KEY: DELIVER_KEY }, 'CONNECTOR_MAIL_KEY'],
      [{ ...base, CONNECTOR_MAIL_KEY: SERVICE_KEY }, 'CONNECTOR_MAIL_KEY'],
    ];
    for (const [env, variable] of cases) {
      const message = refusal(env);
      expect(message, variable).toContain(variable);
      expect(message, variable).not.toContain('operator-dev-password');
    }
  });
});
