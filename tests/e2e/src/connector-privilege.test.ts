import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

import { e2eTargets } from './targets.js';

/**
 * What a connector's child can do inside the connector's own container (the D1 fix, C1 and C2), asked
 * of the running stack. A probe is spawned inside the connector's container exactly as the supervisor
 * spawns a child - by the built `childSpawn` and `runChild` in `/app/dist/supervisor.js`, with the
 * production policy - while the real supervisor, holding both keys, is process 1 beside it. The probe
 * is told the keys on its standard input, never on a command line or in an environment, and reports
 * only where it found them.
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
  const status = fs.readFileSync('/proc/1/status', 'utf8');
  const result = {
    uid: process.getuid(),
    gid: process.getgid(),
    supervisorUid: Number(/^Uid:\s+(\d+)/m.exec(status)[1]),
    supervisorCaps: /^CapEff:\s+([0-9a-f]+)/m.exec(status)[1],
    supervisorNoNewPrivs: /^NoNewPrivs:\s+(\d)/m.exec(status)[1],
    ownCaps: /^CapEff:\s+([0-9a-f]+)/m.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1],
    environ: attempt(() => fs.readFileSync('/proc/1/environ')),
    mem: attempt(() => fs.closeSync(fs.openSync('/proc/1/mem', 'r'))),
    fd: attempt(() => fs.readdirSync('/proc/1/fd')),
    kill: attempt(() => process.kill(1, 0)),
    becomeRoot: attempt(() => process.setuid(0)),
    writes: {
      child: attempt(() => fs.appendFileSync('/app/dist/child.js', '')),
      chmod: attempt(() => fs.chmodSync('/app/dist/child.js', 0o777)),
      createInDist: attempt(() => fs.writeFileSync('/app/dist/probe-written.js', 'x')),
      createInApp: attempt(() => fs.writeFileSync('/app/probe-written', 'x')),
      modules: attempt(() => fs.writeFileSync('/app/node_modules/probe-written.js', 'x')),
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
  readonly supervisorUid: number;
  readonly supervisorCaps: string;
  readonly supervisorNoNewPrivs: string;
  readonly ownCaps: string;
  readonly environ: string;
  readonly mem: string;
  readonly fd: string;
  readonly kill: string;
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
    expect(probed.environ).toBe('EACCES');
    expect(probed.uid).not.toBe(0);
    expect(probed.uid).not.toBe(probed.supervisorUid);
    expect(probed.gid).not.toBe(0);
    expect(probed.mem).toBe('EACCES');
    expect(probed.fd).toBe('EACCES');
    expect(probed.kill).toBe('EPERM');
    expect(probed.becomeRoot).toBe('EPERM');
    expect(probed.becomeSupervisor).toBe('EPERM');
    // The child holds no capability; the supervisor exactly KILL, SETGID and SETUID (bits 5 to 7),
    // and may gain none by an exec.
    expect(BigInt(`0x${probed.ownCaps}`)).toBe(0n);
    expect(BigInt(`0x${probed.supervisorCaps}`)).toBe((1n << 5n) | (1n << 6n) | (1n << 7n));
    expect(probed.supervisorNoNewPrivs).toBe('1');
  });

  it("gives a child no way to change the connector's code", () => {
    for (const [what, result] of Object.entries(probed.writes)) {
      expect(['EACCES', 'EROFS', 'EPERM'], what).toContain(result);
    }
  });
});
