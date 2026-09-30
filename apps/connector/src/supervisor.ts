import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  dataFailure,
  describeAnswerSchema,
  testAnswerSchema,
  type ChildRequest,
  type DataFailureCode,
  type DescribeAnswer,
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

/** How a child is started: always this Node, with an empty environment. */
export interface ChildSpec {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The built child, beside this module. */
export const productionChild: ChildEntry = {
  path: fileURLToPath(new URL('./child.js', import.meta.url)),
  execArgv: [],
};

/**
 * The command a child is started with. Nothing of a request is in it - the request and its credential
 * go on standard input - and its environment is empty, so no `PG*` variable, no home directory and no
 * key reaches it.
 */
export function childSpawn(entry: ChildEntry = productionChild): ChildSpec {
  return {
    file: process.execPath,
    args: [...entry.execArgv, '--max-old-space-size=256', entry.path],
    env: {},
  };
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
) => Promise<ChildOutcome>;

/** The most a child may answer: a describe of 2,000 relations fits many times over. */
const MAX_ANSWER_BYTES = 32 * 1024 * 1024;
/** How long past its deadline a child is let run before it is killed. */
const GRACE_MS = 1000;

/**
 * Starts a child, writes it one line, reads one line, and kills it a second after the deadline. Its
 * standard error is read, counted and dropped, unless a caller - a test - asks to see it.
 */
export const runChild: SpawnChild = (spec, input, deadlineMs, stderr) =>
  new Promise((resolve) => {
    const child = spawn(spec.file, [...spec.args], {
      env: { ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const pid = child.pid ?? -1;
    let killed = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, deadlineMs + GRACE_MS);
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

export type RequestKind = 'test' | 'describe';
export type AnswerOf<K extends RequestKind> = K extends 'test' ? TestAnswer : DescribeAnswer;

/** The connect timeout, and the least time a failure to reach or authenticate takes (D1-L). */
export const CONNECT_TIMEOUT_MS = 5000;

export interface Supervisor {
  /** The request's answer, or `busy` when the cap of children is running. */
  run<K extends RequestKind>(kind: K, request: TestRequest): Promise<AnswerOf<K> | 'busy'>;
  /** How many children are running. */
  active(): number;
}

function failed<K extends RequestKind>(kind: K, code: DataFailureCode): AnswerOf<K> {
  const failure = dataFailure(code);
  return (kind === 'test' ? { outcome: 'failed', failure } : { failure }) as AnswerOf<K>;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function createSupervisor(options: {
  readonly sealingKey: Buffer;
  /** The ranges the child's guard refuses: production's, or the suite's, never configuration's alone. */
  readonly deny: readonly string[];
  readonly maxChildren: number;
  readonly spec?: ChildSpec;
  readonly spawn?: SpawnChild;
  readonly connectTimeoutMs?: number;
  readonly failureFloorMs?: number;
  /** Told how many bytes each child wrote to its standard error, which is otherwise dropped. */
  readonly onStderrBytes?: (bytes: number) => void;
}): Supervisor {
  const spec = options.spec ?? childSpawn();
  const spawnChild = options.spawn ?? runChild;
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const failureFloorMs = options.failureFloorMs ?? CONNECT_TIMEOUT_MS;
  let active = 0;

  async function work<K extends RequestKind>(kind: K, request: TestRequest): Promise<AnswerOf<K>> {
    const started = Date.now();
    let secret: string;
    try {
      secret = openSecret(options.sealingKey, 'source-credential', request.tenant, request.sealed);
    } catch {
      // A credential that does not open fails to authenticate, as a wrong one does, and takes as long.
      await pause(started + failureFloorMs - Date.now());
      return failed(kind, 'connection_failed');
    }
    const input: ChildRequest = {
      kind,
      request,
      secret,
      deny: [...options.deny],
      connectTimeoutMs,
      failureFloorMs,
    };
    let stderrBytes = 0;
    const outcome = await spawnChild(spec, JSON.stringify(input), request.deadlineMs, (chunk) => {
      stderrBytes += chunk.length;
    });
    options.onStderrBytes?.(stderrBytes);
    if (outcome.kind !== 'answer') {
      return failed(kind, outcome.kind === 'timeout' ? 'timeout' : 'connector_error');
    }
    const parsed = (kind === 'test' ? testAnswerSchema : describeAnswerSchema).safeParse(
      outcome.answer,
    );
    return parsed.success ? (parsed.data as AnswerOf<K>) : failed(kind, 'connector_error');
  }

  return {
    run<K extends RequestKind>(kind: K, request: TestRequest): Promise<AnswerOf<K> | 'busy'> {
      if (active >= options.maxChildren) return Promise.resolve('busy');
      active += 1;
      return work(kind, request).finally(() => {
        active -= 1;
      });
    },
    active: () => active,
  };
}
