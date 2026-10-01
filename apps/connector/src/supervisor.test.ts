import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CHILD_USER_BASE,
  childSpawn,
  createSupervisor,
  IsolationRefused,
  productionChild,
  productionIsolation,
  runChild,
  verifyChildIsolation,
  type ChildOutcome,
  type ChildSpec,
  type SpawnChild,
} from './supervisor.js';
import {
  column,
  describeSqlRequest,
  draft,
  PASSWORDS,
  requestFor,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

/** Every spelling of a key's bytes a child's input could carry. */
const spellings = (key: Buffer) => [
  key.toString('base64'),
  key.toString('base64url'),
  key.toString('hex'),
  key.toString('latin1'),
];

describe('the supervisor', () => {
  it("DAT-056 runs each request in a fresh process handed one opened credential, never the sealing key, and nothing of the supervisor's environment", async () => {
    const spec = childSpawn(suiteChild, suiteIsolation);
    expect(spec.file).toBe(process.execPath);
    expect(spec.env).toEqual({});
    expect(spec.args).toContain('--max-old-space-size=256');
    expect(spec.args.at(-1)).toBe(suiteChild.path);
    for (const arg of spec.args) {
      expect(arg).not.toContain(PASSWORDS.reader);
      for (const spelling of spellings(SEALING_KEY)) expect(arg).not.toContain(spelling);
    }
    // The production child: the built entry beside this module, nothing else on its command line,
    // run as a user of its own that is neither root nor the supervisor.
    const production = childSpawn();
    expect(production.env).toEqual({});
    expect(production.args).toEqual(['--max-old-space-size=256', production.args.at(-1)]);
    expect(production.args.at(-1)).toMatch(/child\.js$/);
    expect(production.uid).toBe(CHILD_USER_BASE);
    expect(production.gid).toBe(CHILD_USER_BASE);
    expect(CHILD_USER_BASE).toBeGreaterThan(1000);
    // The suite's children switch no user: Windows has none to switch to.
    expect(spec.uid).toBeUndefined();
    expect(spec.gid).toBeUndefined();

    const seen: { spec: ChildSpec; input: string; outcome: ChildOutcome }[] = [];
    const spawn: SpawnChild = async (given, input, deadlineMs) => {
      const outcome = await runChild(given, input, deadlineMs);
      seen.push({ spec: given, input, outcome });
      return outcome;
    };
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 8,
      spec,
      spawn,
    });
    const request = requestFor(settings(), PASSWORDS.reader);
    expect(await supervisor.run('test', request)).toEqual({ outcome: 'ok', findings: [] });
    expect(await supervisor.run('test', { ...request, requestId: crypto.randomUUID() })).toEqual({
      outcome: 'ok',
      findings: [],
    });

    expect(seen).toHaveLength(2);
    const [first, second] = seen;
    expect(first!.outcome.pid).toBeGreaterThan(0);
    expect(second!.outcome.pid).toBeGreaterThan(0);
    expect(first!.outcome.pid).not.toBe(second!.outcome.pid);
    expect(first!.outcome.pid).not.toBe(process.pid);
    for (const { spec: given, input } of seen) {
      expect(given.env).toEqual({});
      // The one opened credential, and never the key that opened it.
      expect(JSON.parse(input)).toMatchObject({ kind: 'test', secret: PASSWORDS.reader });
      for (const spelling of spellings(SEALING_KEY)) expect(input).not.toContain(spelling);
    }
  });

  it('kills a child past its deadline and answers timeout', async () => {
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 8,
      spec: { file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} },
    });
    const started = Date.now();
    expect(await supervisor.run('test', requestFor(settings(), PASSWORDS.reader, 1000))).toEqual({
      outcome: 'failed',
      failure: { code: 'timeout', attribution: 'connector' },
    });
    // Killed a second after the deadline, not sooner and not much later.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(Date.now() - started).toBeLessThan(6000);
    expect(supervisor.active()).toBe(0);
  });

  it('answers connector_error for a child that ends without an answer, or with one that does not parse', async () => {
    for (const script of [
      'process.exit(3)',
      'process.stdin.resume(); process.stdin.on("end", () => process.exit(0))',
      'process.stdout.write("not json\\n"); process.exit(0)',
      'process.stdout.write(JSON.stringify({ outcome: "ok", findings: ["everything"] }) + "\\n")',
    ]) {
      const supervisor = createSupervisor({
        sealingKey: SEALING_KEY,
        deny: suiteDeny,
        maxChildren: 8,
        spec: { file: process.execPath, args: ['-e', script], env: {} },
      });
      expect(
        await supervisor.run('test', requestFor(settings(), PASSWORDS.reader)),
        script,
      ).toEqual({
        outcome: 'failed',
        failure: { code: 'connector_error', attribution: 'connector' },
      });
      expect(
        await supervisor.run('describe', requestFor(settings(), PASSWORDS.reader)),
        script,
      ).toEqual({
        failure: { code: 'connector_error', attribution: 'connector' },
      });
    }
  });

  it('refuses a request past its cap of children as busy, without starting one', async () => {
    let started = 0;
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 2,
      spec: { file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} },
      spawn: (spec, input, deadlineMs) => {
        started += 1;
        return runChild(spec, input, deadlineMs);
      },
    });
    const running = [1, 2].map(() => supervisor.run('test', requestFor(settings(), 'x', 1000)));
    expect(await supervisor.run('test', requestFor(settings(), 'x', 1000))).toBe('busy');
    expect(started).toBe(2);
    await Promise.all(running);
    expect(supervisor.active()).toBe(0);
  });

  it('runs at most four definitions at once, of its eight children, leaving room for tests and describes', async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 8,
      spec: { file: process.execPath, args: [], env: {} },
      // A child that answers once released: each holds its slot until then.
      spawn: async (_spec, input) => {
        started.push((JSON.parse(input) as { kind: string }).kind);
        await held;
        return { kind: 'ended', pid: 2 };
      },
    });
    const run = () =>
      supervisor.run(
        'run',
        runRequest(settings(), 'x', draft('select 1 as id', [column('id', { base: 'integer' })])),
      );
    const running = [run(), run(), run(), run()];
    // A fifth run is busy: four children at a result's ceiling are what the container's memory holds.
    const fifth = run();
    running.push(fifth);
    expect(
      await Promise.race([fifth, new Promise((resolve) => setTimeout(resolve, 200, 'started'))]),
    ).toBe('busy');
    // A test, a describe and a SQL describe are not runs, and still have their slots.
    const others = [
      supervisor.run('test', requestFor(settings(), 'x')),
      supervisor.run('describe', requestFor(settings(), 'x')),
      supervisor.run('describeSql', describeSqlRequest(settings(), 'x', 'select 1 as id')),
    ];
    await new Promise((resolve) => setTimeout(resolve, 10));
    const kinds = [...started].sort();
    const active = supervisor.active();
    release();
    expect(kinds).toEqual(['describe', 'describeSql', 'run', 'run', 'run', 'run', 'test']);
    expect(active).toBe(7);
    await Promise.all([...running, ...others]);
    // And once a run has ended, another may start.
    expect(await run()).toMatchObject({ outcome: 'failed' });
  });

  it('answers connection_failed, no sooner than the failure floor, for a credential that does not open', async () => {
    const supervisor = createSupervisor({
      sealingKey: Buffer.alloc(32, 9),
      deny: suiteDeny,
      maxChildren: 8,
      spec: childSpawn(suiteChild, suiteIsolation),
      failureFloorMs: 1500,
    });
    const started = Date.now();
    expect(await supervisor.run('test', requestFor(settings(), PASSWORDS.reader))).toEqual({
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1450);
  });

  it('opens a credential only for the connection and the target it was sealed for, answering connection_failed without a child for any other', async () => {
    let spawned = 0;
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 8,
      spec: childSpawn(suiteChild, suiteIsolation),
      spawn: async () => {
        spawned += 1;
        return { kind: 'answer', answer: { outcome: 'ok', findings: [] }, pid: 2 };
      },
      failureFloorMs: 0,
    });
    const sealedFor = requestFor(settings(), PASSWORDS.reader);
    expect(await supervisor.run('test', sealedFor)).toEqual({ outcome: 'ok', findings: [] });
    expect(spawned).toBe(1);
    // The same sealed value, with the connection pointed at a server of somebody else's.
    const moved = { ...sealedFor, settings: settings({ host: 'elsewhere.example' }) };
    expect(await supervisor.run('test', moved)).toEqual({
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
    expect(spawned).toBe(1);
    // The same sealed value copied to another connection with the same target: it opens for the
    // connection it was sealed for alone.
    const copied = { ...sealedFor, connection: { id: randomUUID(), version: randomUUID() } };
    expect(await supervisor.run('test', copied)).toEqual({
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
    expect(spawned).toBe(1);
  });

  it("runs each child at once as a user of its own slot, and sweeps a slot's user before it is used again", async () => {
    const started: ChildSpec[] = [];
    const release: (() => void)[] = [];
    const swept: number[] = [];
    const spawn: SpawnChild = (spec) => {
      started.push(spec);
      return new Promise((resolve) =>
        release.push(() =>
          resolve({ kind: 'answer', answer: { outcome: 'ok', findings: [] }, pid: 2 }),
        ),
      );
    };
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 3,
      spawn,
      sweep: async (uid) => {
        swept.push(uid);
      },
    });
    const ask = () =>
      supervisor.run('test', {
        ...requestFor(settings(), PASSWORDS.reader),
        requestId: randomUUID(),
      });
    const running = [ask(), ask(), ask()];
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started.map((spec) => [spec.uid, spec.gid])).toEqual([
      [CHILD_USER_BASE, CHILD_USER_BASE],
      [CHILD_USER_BASE + 1, CHILD_USER_BASE + 1],
      [CHILD_USER_BASE + 2, CHILD_USER_BASE + 2],
    ]);
    for (const spec of started) expect(spec.args.at(-1)).toBe(productionChild.path);
    expect(swept).toEqual([]);

    release[1]!();
    await running[1];
    // The slot's user is swept of anything its child left running, and only then used again.
    expect(swept).toEqual([CHILD_USER_BASE + 1]);
    // Handed out again once its sweep has ended, which is after the answer.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fourth = ask();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started[3]!.uid).toBe(CHILD_USER_BASE + 1);
    for (const each of [0, 2, 3]) release[each]!();
    await Promise.all([...running, fourth]);
    expect([...swept].sort()).toEqual(
      [CHILD_USER_BASE, CHILD_USER_BASE + 1, CHILD_USER_BASE + 1, CHILD_USER_BASE + 2].sort(),
    );
    expect(supervisor.active()).toBe(0);
  });

  it("answers without waiting for a slot's sweep, and holds the slot until the sweep has ended", async () => {
    let endSweep: () => void = () => {};
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 1,
      spawn: async () => ({ kind: 'answer', answer: { outcome: 'ok', findings: [] }, pid: 2 }),
      // A sweep that reads a crowded /proc takes as long as it takes.
      sweep: () =>
        new Promise<void>((resolve) => {
          endSweep = resolve;
        }),
    });
    const ask = () => supervisor.run('test', requestFor(settings(), PASSWORDS.reader));
    const answer = await Promise.race([
      ask(),
      new Promise((resolve) => setTimeout(() => resolve('waited on the sweep'), 1000)),
    ]);
    expect(answer).toEqual({ outcome: 'ok', findings: [] });
    // The slot's user may still be running something, so the slot is not handed out yet.
    expect(await ask()).toBe('busy');
    endSweep();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await ask()).toEqual({ outcome: 'ok', findings: [] });
    endSweep();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(supervisor.active()).toBe(0);
  });

  it("refuses to start unless a child spawned as the supervisor spawns them runs as its own user and cannot read the supervisor's environment", async () => {
    const answering =
      (answer: unknown): SpawnChild =>
      async () => ({ kind: 'answer', answer, pid: 2 });
    const probed: ChildSpec[] = [];
    const isolated: SpawnChild = async (spec) => {
      probed.push(spec);
      return {
        kind: 'answer',
        answer: { uid: spec.uid, gid: spec.gid, environ: 'EACCES' },
        pid: 2,
      };
    };
    await expect(verifyChildIsolation({ spawn: isolated })).resolves.toBeUndefined();
    expect(probed[0]!.uid).toBe(CHILD_USER_BASE);
    expect(probed[0]!.env).toEqual({});

    for (const answer of [
      // Not switched: the supervisor's own user.
      { uid: 0, gid: 0, environ: 'done' },
      // Switched, and still able to read the supervisor's environment.
      { uid: CHILD_USER_BASE, gid: CHILD_USER_BASE, environ: 'done' },
      // Switched user and not group.
      { uid: CHILD_USER_BASE, gid: 0, environ: 'EACCES' },
      'nothing like an answer',
    ]) {
      await expect(verifyChildIsolation({ spawn: answering(answer) })).rejects.toBeInstanceOf(
        IsolationRefused,
      );
    }
    // A child that could not be started as its user at all.
    await expect(
      verifyChildIsolation({ spawn: async () => ({ kind: 'ended', pid: -1 }) }),
    ).rejects.toBeInstanceOf(IsolationRefused);
    // And production's is never the suite's.
    expect(productionIsolation.kind).toBe('user');
  });
});
