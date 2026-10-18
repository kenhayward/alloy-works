import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  CONNECTOR_ANSWER_MAX_BYTES,
  MODEL_ANSWER_MAX_BYTES,
  credentialContext,
  modelCredentialContext,
  modelEventSchema,
  type ChildModelRequest,
  type GenerationFailure,
  type ModelEvent,
  type ModelRequest,
  dataFailure,
  describeAnswerSchema,
  describeSqlAnswerSchema,
  runAnswerSchema,
  testAnswerSchema,
  type ChildRequest,
  type DataFailureCode,
  type DescribeAnswer,
  type DescribeSqlAnswer,
  type DescribeRequest,
  type DescribeSqlRequest,
  type RunAnswer,
  type RunRequest,
  type TestAnswer,
  type TestRequest,
} from '@alloy-works/domain';
import { openSecret } from '@alloy-works/sealing';

/**
 * The supervisor (data.md, "A fresh process per request"; D1-H): it holds the sealing key, opens the
 * one credential a request carries, and runs the request in a fresh Node process handed that
 * credential on its standard input. The child never holds the key, sees nothing of this process's
 * environment, and is killed a second after the request's deadline.
 */

/** Where the child's code is, and anything Node must be told to run it. */
export interface ChildEntry {
  readonly path: string;
  readonly execArgv: readonly string[];
}

/**
 * How a child is started: always this Node, with an empty environment, and - in production - as a
 * user and group of its own, `uid` and `gid`.
 */
export interface ChildSpec {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly uid?: number;
  readonly gid?: number;
}

/** The built child, beside this module. */
export const productionChild: ChildEntry = {
  path: fileURLToPath(new URL('./child.js', import.meta.url)),
  execArgv: [],
};

/**
 * The first of the users a child runs as: slot `n` of the supervisor's cap runs as user and group
 * `CHILD_USER_BASE + n`, which no file in the image belongs to and no other process runs as.
 */
export const CHILD_USER_BASE = 20000;

/**
 * Who a child runs as (the D1 fix, C1). Production's is `user`: each child a user and group of its own
 * slot, so the kernel refuses it the supervisor's `/proc` entries - its environment, which still holds
 * both keys whatever `process.env` says, its memory and its descriptors - and the other children's.
 * `none` is the suite's alone, on Windows and a developer's machine: a parameter, never configuration,
 * as the suite's deny list is (D1-K), and the production entry refuses to start without its switch.
 */
export type ChildIsolation =
  { readonly kind: 'user'; readonly base: number } | { readonly kind: 'none' };

export const productionIsolation: ChildIsolation = Object.freeze({
  kind: 'user',
  base: CHILD_USER_BASE,
});

/**
 * The command a child is started with. Nothing of a request is in it - the request and its credential
 * go on standard input - and its environment is empty, so no `PG*` variable, no home directory and no
 * key reaches it. In production it runs as its slot's own user and group.
 */
export function childSpawn(
  entry: ChildEntry = productionChild,
  isolation: ChildIsolation = productionIsolation,
  slot = 0,
): ChildSpec {
  const spec = {
    file: process.execPath,
    args: [...entry.execArgv, '--max-old-space-size=256', entry.path],
    env: {},
  };
  if (isolation.kind === 'none') return spec;
  return { ...spec, uid: isolation.base + slot, gid: isolation.base + slot };
}

/** How a child ended: with one line of answer, killed at its deadline, or without an answer. */
export type ChildOutcome =
  | { readonly kind: 'answer'; readonly answer: unknown; readonly pid: number }
  | { readonly kind: 'timeout' | 'ended'; readonly pid: number };

export type SpawnChild = (
  spec: ChildSpec,
  input: string,
  deadlineMs: number,
  stderr?: (chunk: Buffer) => void,
  /** Aborted where nobody waits for the answer any more: the child is killed at once (IAM-082). */
  signal?: AbortSignal,
) => Promise<ChildOutcome>;

/** The most a child may answer; a describe stops listing at half of it (`DESCRIBE_BUDGET_BYTES`). */
const MAX_ANSWER_BYTES = CONNECTOR_ANSWER_MAX_BYTES;
/** How long past its deadline a child is let run before it is killed. */
const GRACE_MS = 1000;

/**
 * Starts a child, writes it one line, reads one line, and kills it a second after the deadline, or at
 * once where `signal` aborts: its caller has gone, so its answer reaches nobody, and its connection to
 * the source closes with it (the D7 plan, D7-I). Its standard error is read, counted and dropped,
 * unless a caller - a test - asks to see it.
 */
export const runChild: SpawnChild = (spec, input, deadlineMs, stderr, signal) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(spec.file, [...spec.args], {
        env: { ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...(spec.uid === undefined ? {} : { uid: spec.uid }),
        ...(spec.gid === undefined ? {} : { gid: spec.gid }),
      });
    } catch {
      // Refused before it started - a user this process may not become - which is no answer.
      resolve({ kind: 'ended', pid: -1 });
      return;
    }
    const pid = child.pid ?? -1;
    let killed = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, deadlineMs + GRACE_MS);
    const abandoned = () => child.kill('SIGKILL');
    if (signal?.aborted) abandoned();
    else signal?.addEventListener('abort', abandoned, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_ANSWER_BYTES) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr?.(chunk));
    // A child that exits before reading its input closes the pipe under the write: that is an ending
    // without an answer, not the supervisor's failure.
    child.stdin.on('error', () => {});
    child.on('error', () => {});
    child.on('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abandoned);
      if (killed) {
        resolve({ kind: 'timeout', pid });
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const line = text.split('\n')[0] ?? '';
      if (bytes > MAX_ANSWER_BYTES || line === '') {
        resolve({ kind: 'ended', pid });
        return;
      }
      try {
        resolve({ kind: 'answer', answer: JSON.parse(line) as unknown, pid });
      } catch {
        resolve({ kind: 'ended', pid });
      }
    });
    child.stdin.end(`${input}\n`);
  });

/** How a streamed child ended: done writing, killed at its deadline, past its cap, or abandoned. */
export type StreamOutcome = { readonly kind: 'ended' | 'timeout' | 'capped'; readonly pid: number };

export type StreamChild = (
  spec: ChildSpec,
  input: string,
  deadlineMs: number,
  /** Each whole line as the child writes it; `false` ends the child, nothing more being wanted. */
  onLine: (line: string) => boolean,
  stderr?: (chunk: Buffer) => void,
  signal?: AbortSignal,
) => Promise<StreamOutcome>;

/**
 * Starts a child, writes it one line, and hands on each line it writes as it writes it (the G1 plan,
 * G1-C): killed a second after the deadline, past `MODEL_ANSWER_MAX_BYTES`, where `onLine` says
 * nothing more is wanted, or at once where `signal` aborts.
 */
export const streamChild: StreamChild = (spec, input, deadlineMs, onLine, stderr, signal) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(spec.file, [...spec.args], {
        env: { ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...(spec.uid === undefined ? {} : { uid: spec.uid }),
        ...(spec.gid === undefined ? {} : { gid: spec.gid }),
      });
    } catch {
      resolve({ kind: 'ended', pid: -1 });
      return;
    }
    const pid = child.pid ?? -1;
    let ending: StreamOutcome['kind'] = 'ended';
    let bytes = 0;
    let partial = '';
    let wanted = true;
    const decoder = new TextDecoder('utf-8');
    const timer = setTimeout(() => {
      ending = 'timeout';
      child.kill('SIGKILL');
    }, deadlineMs + GRACE_MS);
    const abandoned = () => child.kill('SIGKILL');
    if (signal?.aborted) abandoned();
    else signal?.addEventListener('abort', abandoned, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (!wanted) return;
      bytes += chunk.length;
      if (bytes > MODEL_ANSWER_MAX_BYTES) {
        ending = 'capped';
        wanted = false;
        child.kill('SIGKILL');
        return;
      }
      partial += decoder.decode(chunk, { stream: true });
      let newline = partial.indexOf('\n');
      while (newline !== -1 && wanted) {
        const line = partial.slice(0, newline);
        partial = partial.slice(newline + 1);
        if (line !== '' && !onLine(line)) {
          wanted = false;
          child.kill('SIGKILL');
        }
        newline = partial.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => stderr?.(chunk));
    child.stdin.on('error', () => {});
    child.on('error', () => {});
    child.on('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abandoned);
      resolve({ kind: ending, pid });
    });
    child.stdin.end(`${input}\n`);
  });

export type RequestKind = 'test' | 'describe' | 'run' | 'describeSql';

interface Kinds {
  readonly test: { readonly request: TestRequest; readonly answer: TestAnswer };
  readonly describe: { readonly request: DescribeRequest; readonly answer: DescribeAnswer };
  readonly run: { readonly request: RunRequest; readonly answer: RunAnswer };
  readonly describeSql: {
    readonly request: DescribeSqlRequest;
    readonly answer: DescribeSqlAnswer;
  };
}

export type RequestOf<K extends RequestKind> = Kinds[K]['request'];
export type AnswerOf<K extends RequestKind> = Kinds[K]['answer'];

/** What each kind's answer is parsed by, as it leaves the child. */
const answerSchemas = {
  test: testAnswerSchema,
  describe: describeAnswerSchema,
  run: runAnswerSchema,
  describeSql: describeSqlAnswerSchema,
} as const satisfies Record<RequestKind, unknown>;

/**
 * The most runs of a definition at once, whatever the cap of children (the D2 plan, D2-J, final review
 * 5): a run at a result's ceiling peaked at about 370 MiB in its child, and the supervisor holds about
 * 90 MiB more parsing its answer, so four of them fit the container's 3 GiB beside the supervisor,
 * where eight would not. A test and a describe hold far less, and keep the other slots.
 */
export const MAX_RUNS = 4;

/**
 * The most model calls at once (the G1 plan, G1-C): each may hold its child for minutes, so they
 * never take every slot from the connections' tests, describes and runs.
 */
export const MAX_MODELS = 4;

/** The connect timeout, and the least time a failure to reach or authenticate takes (D1-L). */
export const CONNECT_TIMEOUT_MS = 5000;

export interface Supervisor {
  /**
   * The request's answer, or `busy` when the cap of children is running. Where `signal` aborts, its
   * caller has gone: the child is killed at once, and what it answers is nobody's.
   */
  run<K extends RequestKind>(
    kind: K,
    request: RequestOf<K>,
    signal?: AbortSignal,
  ): Promise<AnswerOf<K> | 'busy'>;
  /**
   * A model call (the G1 plan, G1-C): `busy` at once where its cap or the children's is reached;
   * otherwise each event as the child writes it, the last `ended` or `failed`, and done once it is.
   */
  model(
    request: ModelRequest,
    onEvent: (event: ModelEvent) => void,
    signal?: AbortSignal,
  ): 'busy' | Promise<void>;
  /** How many children are running. */
  active(): number;
}

function failed<K extends RequestKind>(kind: K, code: DataFailureCode): AnswerOf<K> {
  const failure = dataFailure(code);
  return (
    kind === 'test' || kind === 'run' ? { outcome: 'failed', failure } : { failure }
  ) as AnswerOf<K>;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function createSupervisor(options: {
  readonly sealingKey: Buffer;
  /** The ranges the child's guard refuses: production's, or the suite's, never configuration's alone. */
  readonly deny: readonly string[];
  readonly maxChildren: number;
  /** The most of those children that may be runs at once: `MAX_RUNS` unless a test says. */
  readonly maxRuns?: number;
  /** The most of those children that may be model calls at once: `MAX_MODELS` unless a test says. */
  readonly maxModels?: number;
  /** How a child is started, fixed or by its slot: production's own users unless a test says. */
  readonly spec?: ChildSpec | ((slot: number) => ChildSpec);
  readonly spawn?: SpawnChild;
  readonly streamSpawn?: StreamChild;
  /** Ends whatever a child's user left running, before its slot is used again. */
  readonly sweep?: (uid: number) => Promise<void>;
  readonly connectTimeoutMs?: number;
  readonly failureFloorMs?: number;
  /** Told how many bytes each child wrote to its standard error, which is otherwise dropped. */
  readonly onStderrBytes?: (bytes: number) => void;
  /** A development or CI source's certificate authority, handed to each child (the D6 plan). */
  readonly ca?: string;
}): Supervisor {
  const given = options.spec;
  const specFor =
    given === undefined
      ? (slot: number) => childSpawn(productionChild, productionIsolation, slot)
      : typeof given === 'function'
        ? given
        : () => given;
  const spawnChild = options.spawn ?? runChild;
  const streamSpawn = options.streamSpawn ?? streamChild;
  const maxModels = options.maxModels ?? MAX_MODELS;
  let models = 0;
  const sweep = options.sweep ?? sweepUser;
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const failureFloorMs = options.failureFloorMs ?? CONNECT_TIMEOUT_MS;
  /** Which slots of the cap are free: a running child holds its slot, and so its user. */
  const free = Array.from({ length: options.maxChildren }, (_, slot) => slot);
  const maxRuns = options.maxRuns ?? MAX_RUNS;
  let active = 0;
  let runs = 0;

  async function work<K extends RequestKind>(
    kind: K,
    request: RequestOf<K>,
    slot: number,
    sweeping: (done: Promise<void>) => void,
    signal: AbortSignal | undefined,
  ): Promise<AnswerOf<K>> {
    const started = Date.now();
    let secret: string;
    try {
      // Opened only for the connection and the target it was sealed for: a version pointing the
      // connection anywhere else, or the row copied to another connection, opens nothing (DA-AF).
      secret = openSecret(
        options.sealingKey,
        'source-credential',
        request.tenant,
        request.sealed,
        credentialContext(request.connection.id, request.settings),
      );
    } catch {
      // A credential that does not open fails to authenticate, as a wrong one does, and takes as long.
      await pause(started + failureFloorMs - Date.now());
      return failed(kind, 'connection_failed');
    }
    const input = {
      kind,
      request,
      secret,
      deny: [...options.deny],
      connectTimeoutMs,
      failureFloorMs,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    } as ChildRequest;
    const spec = specFor(slot);
    let stderrBytes = 0;
    let outcome: ChildOutcome;
    try {
      outcome = await spawnChild(
        spec,
        JSON.stringify(input),
        request.deadlineMs,
        (chunk) => {
          stderrBytes += chunk.length;
        },
        signal,
      );
    } finally {
      // Nothing the child started outlives it into the next request its user serves. The sweep reads
      // every process in /proc, so it runs beside the answer rather than before it, and the slot -
      // and so its user - is handed out again only once it has ended.
      if (spec.uid !== undefined) sweeping(sweep(spec.uid).catch(() => {}));
    }
    options.onStderrBytes?.(stderrBytes);
    if (outcome.kind !== 'answer') {
      return failed(kind, outcome.kind === 'timeout' ? 'timeout' : 'connector_error');
    }
    const parsed = answerSchemas[kind].safeParse(outcome.answer);
    return parsed.success ? (parsed.data as AnswerOf<K>) : failed(kind, 'connector_error');
  }

  /** Holds a slot for `body`, sweeping its user before the slot is handed out again. */
  function holding(
    slot: number,
    body: (sweeping: (done: Promise<void>) => void) => Promise<void>,
  ): Promise<void> {
    let swept: Promise<void> = Promise.resolve();
    const done = body((sweep) => {
      swept = sweep;
    });
    void done
      .catch(() => {})
      .then(() => swept)
      .then(() => {
        free.push(slot);
        free.sort((a, b) => a - b);
      });
    return done;
  }

  async function modelWork(
    request: ModelRequest,
    slot: number,
    onEvent: (event: ModelEvent) => void,
    sweeping: (done: Promise<void>) => void,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    let last: ModelEvent | undefined;
    const emit = (event: ModelEvent) => {
      if (last !== undefined) return;
      if (event.type === 'ended' || event.type === 'failed') last = event;
      onEvent(event);
    };
    const fail = (failure: GenerationFailure) => emit({ type: 'failed', failure });
    let secret: string;
    try {
      // Opened only for the endpoint and the origin it was sealed for (the G1 plan, G1-B): the key of
      // an endpoint pointed elsewhere, or copied to another, opens nothing.
      secret = openSecret(
        options.sealingKey,
        'model-credential',
        request.tenant,
        request.sealed,
        modelCredentialContext(request.endpoint.id, request.endpoint),
      );
    } catch {
      fail({ code: 'model_unavailable', reason: 'key_refused' });
      return;
    }
    const input: ChildModelRequest = {
      kind: 'model',
      request,
      secret,
      deny: [...options.deny],
      connectTimeoutMs,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    };
    const spec = specFor(slot);
    let stderrBytes = 0;
    let outcome: StreamOutcome;
    try {
      outcome = await streamSpawn(
        spec,
        JSON.stringify(input),
        request.deadlineMs,
        (line) => {
          let event: ModelEvent | undefined;
          try {
            const parsed = modelEventSchema.safeParse(JSON.parse(line));
            if (parsed.success) event = parsed.data;
          } catch {
            // Not an event: the child is at fault, and ends.
          }
          if (event === undefined) {
            fail({ code: 'connector_error' });
            return false;
          }
          emit(event);
          return last === undefined;
        },
        (chunk) => {
          stderrBytes += chunk.length;
        },
        signal,
      );
    } finally {
      if (spec.uid !== undefined) sweeping(sweep(spec.uid).catch(() => {}));
    }
    options.onStderrBytes?.(stderrBytes);
    if (last === undefined) {
      fail(
        outcome.kind === 'timeout'
          ? { code: 'timeout' }
          : outcome.kind === 'capped'
            ? { code: 'model_unavailable', reason: 'failed' }
            : { code: 'connector_error' },
      );
    }
  }

  return {
    model(request, onEvent, signal) {
      if (models >= maxModels) return 'busy';
      const slot = free.shift();
      if (slot === undefined) return 'busy';
      active += 1;
      models += 1;
      return holding(slot, (sweeping) =>
        modelWork(request, slot, onEvent, sweeping, signal).finally(() => {
          active -= 1;
          models -= 1;
        }),
      );
    },
    run<K extends RequestKind>(
      kind: K,
      request: RequestOf<K>,
      signal?: AbortSignal,
    ): Promise<AnswerOf<K> | 'busy'> {
      if (kind === 'run' && runs >= maxRuns) return Promise.resolve('busy');
      const slot = free.shift();
      if (slot === undefined) return Promise.resolve('busy');
      active += 1;
      if (kind === 'run') runs += 1;
      let swept: Promise<void> = Promise.resolve();
      const answer = work(
        kind,
        request,
        slot,
        (done) => {
          swept = done;
        },
        signal,
      ).finally(() => {
        active -= 1;
        if (kind === 'run') runs -= 1;
      });
      void answer
        .catch(() => {})
        .then(() => swept)
        .then(() => {
          free.push(slot);
          free.sort((a, b) => a - b);
        });
      return answer;
    },
    active: () => active,
  };
}

/**
 * Ends, with SIGKILL, every process still running as a child's user: a child is killed at its
 * deadline, but anything it started - a compromised driver's, say - would otherwise live on as that
 * user and wait for the next request it serves. Linux's `/proc` alone; elsewhere no user is switched.
 */
export async function sweepUser(uid: number): Promise<void> {
  if (process.platform !== 'linux') return;
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  for (const pid of pids) {
    try {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const ids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(status);
      if (ids && ids.slice(1).some((id) => Number(id) === uid)) {
        process.kill(Number(pid), 'SIGKILL');
      }
    } catch {
      // Gone already: nothing to end.
    }
  }
}

/** The production entry cannot run its children apart from itself, so it does not start. */
export class IsolationRefused extends Error {}

/**
 * What the isolation probe runs, as a child would: which user and group it is, and whether the kernel
 * lets it read its parent's environment, which holds both keys whatever `process.env` says.
 */
const ISOLATION_PROBE = [
  "let environ = 'done';",
  "try { require('node:fs').readFileSync('/proc/' + process.ppid + '/environ'); }",
  "catch (error) { environ = error.code || 'error'; }",
  'process.stdout.write(JSON.stringify({ uid: process.getuid(), gid: process.getgid(), environ }));',
].join('\n');

/**
 * Refuses to start unless a child spawned exactly as the supervisor spawns them - this Node, an empty
 * environment, slot 0's user and group - runs as that user and group and is refused its parent's
 * environment by the kernel (the D1 fix, C1). The production entry runs it before it listens.
 */
export async function verifyChildIsolation(
  options: { readonly spawn?: SpawnChild } = {},
): Promise<void> {
  const spec = childSpawn(
    { path: 'isolation-probe', execArgv: ['-e', ISOLATION_PROBE] },
    productionIsolation,
  );
  const outcome = await (options.spawn ?? runChild)(spec, '', 10_000);
  const answer =
    outcome.kind === 'answer' && typeof outcome.answer === 'object' && outcome.answer !== null
      ? (outcome.answer as Record<string, unknown>)
      : undefined;
  if (
    answer === undefined ||
    answer.uid !== spec.uid ||
    answer.gid !== spec.gid ||
    answer.environ !== 'EACCES'
  ) {
    throw new IsolationRefused(
      'The connector cannot run its children as users of their own. Start it as root with only the ' +
        'SETUID, SETGID and KILL capabilities, as deploy/compose.yaml does.',
    );
  }
}
