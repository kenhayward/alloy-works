import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { e2eTargets } from './targets.js';

/**
 * What a connector's child can do inside the connector's own container (the D1 fix, C1 and C2), asked
 * of the running stack. A probe is spawned inside the connector's container exactly as the supervisor
 * spawns a child - by the built `childSpawn` and `runChild` in `/app/dist/supervisor.js`, with the
 * production policy - while the real supervisor, holding both keys, runs beside it under Docker's init,
 * which Docker hands the same environment. The probe is told the keys on its standard input, never on
 * a command line or in an environment, and reports only where it found them.
 */
const PROJECT = e2eTargets(process.env).composeProject;

const docker = (args: readonly string[], input?: string): string =>
  execFileSync('docker', [...args], {
    encoding: 'utf8',
    timeout: 300_000,
    ...(input === undefined ? {} : { input }),
  }).trim();

/** The one running connector container of this project. */
function connectorId(): string {
  const ids = docker([
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${PROJECT}`,
    '--filter',
    'label=com.docker.compose.service=connector',
  ])
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1) throw new Error(`${PROJECT} runs ${ids.length} connector containers`);
  return ids[0]!;
}

/**
 * The probe, run as a child: reads the needles from its standard input, then tries every route to
 * them - the supervisor's /proc entries, every other process's, and every readable file - and every
 * way to change the connector's code or its own identity. It answers where it found a needle, never
 * the needle.
 */
const PROBE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const needles = JSON.parse(input.split('\n')[0]).map((each) => Buffer.from(each));
  const holds = (bytes) => needles.some((needle) => bytes.includes(needle));
  const attempt = (work) => { try { work(); return 'done'; } catch (error) { return error.code || 'error'; } };
  // The supervisor by its command line, whatever its number: under an init it is not process 1.
  const supervisor = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name)).find((pid) => {
    try { return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0').includes('dist/main.js'); } catch { return false; }
  });
  const status = fs.readFileSync('/proc/' + supervisor + '/status', 'utf8');
  const result = {
    uid: process.getuid(),
    gid: process.getgid(),
    supervisorPid: Number(supervisor),
    supervisorUid: Number(/^Uid:\s+(\d+)/m.exec(status)[1]),
    supervisorCaps: /^CapEff:\s+([0-9a-f]+)/m.exec(status)[1],
    supervisorNoNewPrivs: /^NoNewPrivs:\s+(\d)/m.exec(status)[1],
    ownCaps: /^CapEff:\s+([0-9a-f]+)/m.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1],
    environ: attempt(() => fs.readFileSync('/proc/' + supervisor + '/environ')),
    // Process 1, the supervisor or the init that started it, which Docker hands the same environment.
    initEnviron: attempt(() => fs.readFileSync('/proc/1/environ')),
    mem: attempt(() => fs.closeSync(fs.openSync('/proc/' + supervisor + '/mem', 'r'))),
    fd: attempt(() => fs.readdirSync('/proc/' + supervisor + '/fd')),
    kill: attempt(() => process.kill(Number(supervisor), 0)),
    killInit: attempt(() => process.kill(1, 0)),
    becomeRoot: attempt(() => process.setuid(0)),
    writes: {
      child: attempt(() => fs.appendFileSync('/app/dist/child.js', '')),
      chmod: attempt(() => fs.chmodSync('/app/dist/child.js', 0o777)),
      createInDist: attempt(() => fs.writeFileSync('/app/dist/probe-written.js', 'x')),
      createInApp: attempt(() => fs.writeFileSync('/app/probe-written', 'x')),
      modules: attempt(() => fs.writeFileSync('/app/node_modules/probe-written.js', 'x')),
      // The file views of shared memory and message queues, where one child could leave something for
      // the next; the IPC namespace itself, which no file view closes, is asked further down.
      shm: attempt(() => fs.writeFileSync('/dev/shm/probe-written', 'x')),
      mqueue: attempt(() => fs.writeFileSync('/dev/mqueue/probe-written', 'x')),
      tmp: attempt(() => fs.writeFileSync('/tmp/probe-written', 'x')),
    },
    found: [],
  };
  result.becomeSupervisor = attempt(() => process.setuid(result.supervisorUid));
  for (const pid of fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    if (Number(pid) === process.pid) continue;
    for (const file of ['environ', 'cmdline']) {
      try { if (holds(fs.readFileSync('/proc/' + pid + '/' + file))) result.found.push('/proc/' + pid + '/' + file); } catch {}
    }
  }
  const walk = (directory, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const at = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(at, depth + 1);
      else if (entry.isFile()) {
        try { if (fs.statSync(at).size <= 8 * 1024 * 1024 && holds(fs.readFileSync(at))) result.found.push(at); } catch {}
      }
    }
  };
  for (const root of ['/app', '/etc', '/tmp', '/run', '/home', '/root', '/var', '/dev/shm', '/opt', '/srv', '/usr/local/etc', '/mnt']) walk(root, 0);
  process.stdout.write(JSON.stringify(result) + '\n');
});
`;

/**
 * Run inside the container as the supervisor's own image runs things: the built supervisor's spawn,
 * handed the probe as its entry. The needles arrive on this process's standard input and go on to the
 * probe's the same way.
 */
const LAUNCHER = String.raw`
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  const { childSpawn, runChild } = await import('file:///app/dist/supervisor.js');
  // Production's own users, at slot 63, which the running supervisor - eight children at most - never
  // hands out: it kills whatever runs as a slot's user when that slot's child ends, and would take a
  // probe at slot 0 for a child's leftover whenever a connection's test ran beside this one.
  const spec = childSpawn({ path: 'probe', execArgv: ['-e', process.argv[1]] }, undefined, 63);
  // The probe's standard error, which says why when it ends without an answer. It never holds a key:
  // the probe writes where it found one, never what.
  let stderr = '';
  const outcome = await runChild(spec, input.trim(), 60000, (chunk) => { stderr += chunk; });
  process.stdout.write(JSON.stringify({ ...outcome, stderr: stderr.slice(0, 2000) }));
});
`;

interface Probed {
  readonly uid: number;
  readonly gid: number;
  readonly supervisorPid: number;
  readonly supervisorUid: number;
  readonly supervisorCaps: string;
  readonly supervisorNoNewPrivs: string;
  readonly ownCaps: string;
  readonly environ: string;
  readonly initEnviron: string;
  readonly mem: string;
  readonly fd: string;
  readonly kill: string;
  readonly killInit: string;
  readonly becomeRoot: string;
  readonly becomeSupervisor: string;
  readonly writes: Readonly<Record<string, string>>;
  readonly found: readonly string[];
}

describe("the connector's children", () => {
  let probed: Probed;

  beforeAll(() => {
    const id = connectorId();
    const env = (
      JSON.parse(docker(['inspect', '--format', '{{json .Config.Env}}', id])) as string[]
    ).filter((each) => /^CONNECTOR_(SEALING_)?KEY=/.test(each));
    expect(env).toHaveLength(2);
    // Each key as the environment spells it, and its bytes as hex: never on a command line.
    const needles = env.flatMap((each) => {
      const value = each.slice(each.indexOf('=') + 1);
      return [value, Buffer.from(value, 'base64').toString('hex')];
    });
    const outcome = JSON.parse(
      docker(['exec', '-i', id, 'node', '-e', LAUNCHER, PROBE], JSON.stringify(needles)),
    ) as { kind: string; answer?: Probed; stderr: string };
    expect(outcome.kind, `the probe answered: ${outcome.stderr}`).toBe('answer');
    probed = outcome.answer!;
  }, 300_000);

  it("DAT-056 runs each child as a user of its own, which cannot read the supervisor's keys through /proc or any file", () => {
    expect(probed.found).toEqual([]);
    expect(probed.supervisorPid).toBeGreaterThan(0);
    expect(probed.environ).toBe('EACCES');
    expect(probed.initEnviron).toBe('EACCES');
    expect(probed.uid).not.toBe(0);
    expect(probed.uid).not.toBe(probed.supervisorUid);
    expect(probed.gid).not.toBe(0);
    expect(probed.mem).toBe('EACCES');
    expect(probed.fd).toBe('EACCES');
    expect(probed.kill).toBe('EPERM');
    expect(probed.killInit).toBe('EPERM');
    expect(probed.becomeRoot).toBe('EPERM');
    expect(probed.becomeSupervisor).toBe('EPERM');
    // The child holds no capability; the supervisor exactly KILL, SETGID and SETUID (bits 5 to 7),
    // and may gain none by an exec.
    expect(BigInt(`0x${probed.ownCaps}`)).toBe(0n);
    expect(BigInt(`0x${probed.supervisorCaps}`)).toBe((1n << 5n) | (1n << 6n) | (1n << 7n));
    expect(probed.supervisorNoNewPrivs).toBe('1');
  });

  it("gives a child no way to change the connector's code, or to leave anything for another child in /dev/shm, /dev/mqueue or a file", () => {
    for (const [what, result] of Object.entries(probed.writes)) {
      expect(['EACCES', 'EROFS', 'EPERM', 'ENOENT'], what).toContain(result);
    }
  });
});

/**
 * A child that leaves a process running, as a compromised driver might: it starts one, detached, and
 * answers. Run inside the container as the supervisor runs a child, at slot 62 - which the running
 * supervisor never hands out - then swept as the supervisor sweeps a slot's user. What is left running
 * as that user afterwards, in any state, is reported by number and state.
 */
const LEAVER = String.raw`
const { spawn } = require('node:child_process');
const left = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
left.unref();
process.stdout.write(JSON.stringify({ left: left.pid }) + '\n');
process.exit(0);
`;

const SWEEPER = String.raw`
const fs = require('node:fs');
const as = (uid) => fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name)).flatMap((pid) => {
  try {
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
    const ids = /^Uid:\s+(\d+)/m.exec(status);
    return ids && Number(ids[1]) === uid ? [{ pid: Number(pid), state: /^State:\s+(\S)/m.exec(status)[1] }] : [];
  } catch { return []; }
});
(async () => {
  const { childSpawn, runChild, sweepUser } = await import('file:///app/dist/supervisor.js');
  const spec = childSpawn({ path: 'leaver', execArgv: ['-e', process.argv[1]] }, undefined, 62);
  const outcome = await runChild(spec, '', 30000);
  const before = as(spec.uid);
  await sweepUser(spec.uid);
  let after = as(spec.uid);
  for (let waited = 0; after.length > 0 && waited < 3000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    after = as(spec.uid);
  }
  process.stdout.write(JSON.stringify({ outcome, before, after }));
})();
`;

describe("the connector's container", () => {
  it('ends what a child leaves running and reaps it, leaving no process of its user behind, not even a zombie', () => {
    const swept = JSON.parse(
      docker(['exec', '-i', connectorId(), 'node', '-e', SWEEPER, LEAVER], ''),
    ) as {
      outcome: { kind: string; answer?: { left: number } };
      before: { pid: number; state: string }[];
      after: { pid: number; state: string }[];
    };
    expect(swept.outcome.kind).toBe('answer');
    // The child's leftover was running as the slot's user before the sweep.
    expect(swept.before.map((each) => each.pid)).toContain(swept.outcome.answer!.left);
    expect(swept.after).toEqual([]);
  });

  it('holds the container to a bounded number of processes, so a child that forks cannot exhaust the host', () => {
    const max = docker(['exec', connectorId(), 'cat', '/sys/fs/cgroup/pids.max']);
    expect(max).toMatch(/^\d+$/);
    expect(Number(max)).toBeLessThanOrEqual(256);
  });

  it("holds the container to 3 GiB of memory, a backstop for what a run's byte count does not see", () => {
    // A value's bytes are counted at the child's socket and stopped past the limit (the D2 plan, Q2
    // and D2-J), but a Buffer lives outside the heap `--max-old-space-size` bounds: eight children at
    // the ceiling hold about 200 MiB each, and the container's limit is what stops anything past that.
    const max = docker(['exec', connectorId(), 'cat', '/sys/fs/cgroup/memory.max']);
    expect(max).toBe(String(3 * 1024 ** 3));
  });
});

/**
 * System V IPC - shared memory, message queues and semaphore sets - and POSIX message queues live in
 * the container's one IPC namespace, not in its filesystem, and outlive the process that made them:
 * the sweep ends a child's processes, never what it made there. So a child that could make one could
 * leave data for whichever child comes next, as another user, serving another connection. Asked of
 * Perl, which the image carries as Debian's essential `perl-base` and whose builtins make the calls
 * Node has no binding for; a POSIX queue by its raw system call, since `/dev/mqueue` is only a view of
 * the namespace's queues. Every refusal is reported by its errno's name, never a value read.
 */
const IPC_PERL = String.raw`
use strict;
require Config;
my ($mode, $key) = @ARGV;
$key = int($key);
my $needle = 'd1-ipc-needle';
my $arm = $Config::Config{archname} =~ /^aarch64/;
my ($MQ_OPEN, $MQ_UNLINK, $MQ_SEND, $MQ_RECEIVE) = $arm ? (180, 181, 182, 183) : (240, 241, 242, 243);
my $mq = 'd1probe' . $key;
my %r;
sub err { return 'errno:' . ($! + 0); }
if ($mode eq 'create') {
  my $own = 'd1probe-own-' . $$;
  my $shm = shmget(0, 4096, 01000 | 0600);
  if (defined $shm) { $r{shm} = 'created'; shmctl($shm, 0, 0); } else { $r{shm} = err(); }
  my $msg = msgget(0, 01000 | 0600);
  if (defined $msg) { $r{msg} = 'created'; msgctl($msg, 0, 0); } else { $r{msg} = err(); }
  my $sem = semget(0, 1, 01000 | 0600);
  if (defined $sem) { $r{sem} = 'created'; semctl($sem, 0, 0, 0); } else { $r{sem} = err(); }
  my $fd = syscall($MQ_OPEN, $own, 0100 | 02, 0600, 0);
  if ($fd >= 0) { $r{mq} = 'created'; syscall($MQ_UNLINK, $own); } else { $r{mq} = err(); }
} elsif ($mode eq 'leave') {
  my $shm = shmget($key, 4096, 01000 | 0666);
  $r{shm} = defined $shm ? (shmwrite($shm, $needle, 0, length $needle) ? 'written' : err()) : err();
  my $msg = msgget($key, 01000 | 0666);
  $r{msg} = defined $msg ? (msgsnd($msg, pack('l! a*', 1, $needle), 04000) ? 'written' : err()) : err();
  my $sem = semget($key, 1, 01000 | 0666);
  $r{sem} = defined $sem ? (semop($sem, pack('s!3', 0, 7, 0)) ? 'written' : err()) : err();
  my $fd = syscall($MQ_OPEN, $mq, 0100 | 02, 0666, 0);
  $r{mq} = $fd >= 0 ? (syscall($MQ_SEND, $fd, $needle, length($needle), 0, 0) == 0 ? 'written' : err()) : err();
} elsif ($mode eq 'read') {
  my $shm = shmget($key, 0, 0);
  if (defined $shm) { my $buf = ''; $r{shm} = shmread($shm, $buf, 0, length $needle) ? ($buf eq $needle ? 'read' : 'empty') : err(); } else { $r{shm} = err(); }
  my $msg = msgget($key, 0);
  if (defined $msg) { my $buf = ''; $r{msg} = msgrcv($msg, $buf, 4096, 0, 04000) ? (index($buf, $needle) >= 0 ? 'read' : 'empty') : err(); } else { $r{msg} = err(); }
  my $sem = semget($key, 0, 0);
  if (defined $sem) { my $value = semctl($sem, 0, 12, 0); $r{sem} = defined $value ? ($value == 7 ? 'read' : 'empty') : err(); } else { $r{sem} = err(); }
  my $fd = syscall($MQ_OPEN, $mq, 04000, 0, 0);
  if ($fd >= 0) { my $buf = "\0" x 65536; my $got = syscall($MQ_RECEIVE, $fd, $buf, 65536, 0, 0); $r{mq} = $got >= 0 ? (index($buf, $needle) >= 0 ? 'read' : 'empty') : err(); } else { $r{mq} = err(); }
} elsif ($mode eq 'clean') {
  my $shm = shmget($key, 0, 0); shmctl($shm, 0, 0) if defined $shm;
  my $msg = msgget($key, 0); msgctl($msg, 0, 0) if defined $msg;
  my $sem = semget($key, 0, 0); semctl($sem, 0, 0, 0) if defined $sem;
  syscall($MQ_UNLINK, $mq);
  $r{clean} = 'done';
}
print '{' . join(',', map { '"' . $_ . '":"' . $r{$_} . '"' } sort keys %r) . '}';
`;

/** The child: runs Perl as its own user with an empty environment, and names each errno it met. */
const IPC_CHILD = String.raw`
const { spawnSync } = require('node:child_process');
const names = Object.fromEntries(Object.entries(require('node:os').constants.errno).map(([name, value]) => [value, name]));
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const { mode, key, perl } = JSON.parse(input.split('\n')[0]);
  const run = spawnSync('/usr/bin/perl', ['-e', perl, mode, String(key)], { encoding: 'utf8', env: {}, timeout: 20000 });
  if (run.error || run.status !== 0) {
    process.stdout.write(JSON.stringify({ perl: run.error ? run.error.code : 'status ' + run.status, stderr: String(run.stderr).slice(0, 500) }) + '\n');
    return;
  }
  const answer = JSON.parse(run.stdout);
  for (const [what, result] of Object.entries(answer)) {
    const errno = /^errno:(\d+)$/.exec(result);
    if (errno) answer[what] = names[Number(errno[1])] || result;
  }
  // The limits that refuse it, which a child may not raise.
  try { require('node:fs').writeFileSync('/proc/sys/kernel/shmmni', '4096'); answer.raise = 'done'; }
  catch (error) { answer.raise = error.code || 'error'; }
  process.stdout.write(JSON.stringify({ uid: process.getuid(), ...answer }) + '\n');
});
`;

/**
 * Runs each step as a child the supervisor spawns - its `childSpawn` and `runChild`, at slots the
 * running supervisor never hands out - and sweeps the slot's user after each, as the supervisor does.
 */
const IPC_LAUNCHER = String.raw`
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  const { childSpawn, runChild, sweepUser } = await import('file:///app/dist/supervisor.js');
  const { key, perl, steps } = JSON.parse(input);
  const results = [];
  for (const step of steps) {
    const spec = childSpawn({ path: 'ipc', execArgv: ['-e', process.argv[1]] }, undefined, step.slot);
    let stderr = '';
    const outcome = await runChild(spec, JSON.stringify({ mode: step.mode, key, perl }), 30000, (chunk) => { stderr += chunk; });
    await sweepUser(spec.uid);
    results.push({ ...outcome, stderr: stderr.slice(0, 2000) });
  }
  process.stdout.write(JSON.stringify(results));
});
`;

type IpcAnswer = Readonly<Record<string, string | number>>;

describe("the connector's children and the container's IPC", () => {
  let created: IpcAnswer;
  let left: IpcAnswer;
  let read: IpcAnswer;

  beforeAll(() => {
    // A key of this run's own, so a run never meets what an earlier one left.
    const key = 0x0d1000 + Math.floor(Math.random() * 0xfff);
    const steps = [
      { slot: 63, mode: 'create' },
      { slot: 60, mode: 'leave' },
      { slot: 61, mode: 'read' },
      // Whatever the first left, removed as its own user, whatever the outcome.
      { slot: 60, mode: 'clean' },
    ];
    const results = JSON.parse(
      docker(
        ['exec', '-i', connectorId(), 'node', '-e', IPC_LAUNCHER, IPC_CHILD],
        JSON.stringify({ key, perl: IPC_PERL, steps }),
      ),
    ) as { kind: string; answer?: IpcAnswer; stderr: string }[];
    for (const [index, result] of results.entries()) {
      expect(result.kind, `step ${index} answered: ${result.stderr}`).toBe('answer');
      expect(
        result.answer!.perl,
        `step ${index}: ${JSON.stringify(result.answer)}`,
      ).toBeUndefined();
    }
    expect(results).toHaveLength(steps.length);
    created = results[0]!.answer!;
    left = results[1]!.answer!;
    read = results[2]!.answer!;
  }, 300_000);

  it('refuses a child a System V shared-memory segment, message queue and semaphore set, and a POSIX message queue', () => {
    expect(created.uid).toBe(20063);
    for (const what of ['shm', 'msg', 'sem', 'mq']) {
      expect(['ENOSPC', 'EINVAL', 'EPERM', 'EACCES', 'ENOSYS', 'EMFILE'], what).toContain(
        created[what],
      );
    }
    expect(['EROFS', 'EACCES', 'EPERM']).toContain(created.raise);
  });

  it('lets nothing one child leaves in IPC be read by the next, a different user, once the first is swept', () => {
    expect([left.uid, read.uid]).toEqual([20060, 20061]);
    for (const what of ['shm', 'msg', 'sem', 'mq']) {
      expect(left[what], what).not.toBe('written');
      expect(read[what], what).toBe('ENOENT');
    }
  });
});

/** The IPC limits compose sets to zero in the connector's own namespace, as `docker run` spells them. */
const IPC_SYSCTLS: Readonly<Record<string, string>> = {
  'kernel.shmmni': '0',
  'kernel.shmall': '0',
  'kernel.shmmax': '0',
  'kernel.msgmni': '0',
  'kernel.msgmnb': '0',
  'kernel.msgmax': '0',
  'kernel.sem': '0 0 0 0',
  'fs.mqueue.queues_max': '0',
};

/**
 * The running connector's own image, started once more as compose starts it - the three capabilities,
 * read-only, an IPC namespace of its own, under Docker's init - but on no network, with keys of its
 * own, and with only the `sysctls` given. How it ended, and what it wrote to standard error.
 */
function startWith(sysctls: Readonly<Record<string, string>>): {
  readonly status: number | null;
  readonly stderr: string;
} {
  const image = docker(['inspect', '--format', '{{.Image}}', connectorId()]);
  // Named, so one that starts after all - the refusal missing - is removed rather than left running.
  const name = `${PROJECT}-connector-start-${randomBytes(4).toString('hex')}`;
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      name,
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      ...['SETUID', 'SETGID', 'KILL'].flatMap((cap) => ['--cap-add', cap]),
      '--security-opt',
      'no-new-privileges:true',
      '--read-only',
      '--ipc',
      'none',
      '--tmpfs',
      '/dev/mqueue:ro,size=4k',
      '--init',
      '--pids-limit',
      '256',
      ...Object.entries(sysctls).flatMap(([name, value]) => ['--sysctl', `${name}=${value}`]),
      // Keys of this container's own, thrown away with it: it refuses before it could use either.
      ...['CONNECTOR_KEY', 'CONNECTOR_SEALING_KEY'].flatMap((name) => [
        '-e',
        `${name}=${randomBytes(32).toString('base64')}`,
      ]),
      '-e',
      'CONNECTOR_DENY=none',
      image,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  spawnSync('docker', ['rm', '--force', name], { encoding: 'utf8', timeout: 60_000 });
  return { status: run.status, stderr: run.stderr };
}

describe("the connector's start", () => {
  it('refuses to start unless every IPC limit is zero, naming each one that is not', () => {
    const bare = startWith({});
    expect(bare.status, bare.stderr).toBe(1);
    expect(bare.stderr).toContain('System V or POSIX IPC');
    for (const limit of Object.keys(IPC_SYSCTLS)) expect(bare.stderr).toContain(limit);

    // Every limit but one: it names that one alone, so it read each of the others as zero.
    const allButOne = Object.fromEntries(
      Object.entries(IPC_SYSCTLS).filter(([name]) => name !== 'fs.mqueue.queues_max'),
    );
    const one = startWith(allButOne);
    expect(one.status, one.stderr).toBe(1);
    expect(one.stderr).toContain('fs.mqueue.queues_max');
    for (const limit of Object.keys(allButOne)) expect(one.stderr).not.toContain(limit);
  }, 300_000);
});
