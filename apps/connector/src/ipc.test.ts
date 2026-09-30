import { describe, expect, it } from 'vitest';

import { IPC_LIMITS, ipcRefusal, verifyIpcClosed, type IpcLimit } from './ipc.js';
import { IsolationRefused } from './supervisor.js';

/** Every limit as compose's `sysctls` leave it, as the kernel spells each file. */
const closed: Readonly<Record<IpcLimit, string>> = {
  'kernel.shmmni': '0\n',
  'kernel.shmall': '0\n',
  'kernel.shmmax': '0\n',
  'kernel.msgmni': '0\n',
  'kernel.msgmnb': '0\n',
  'kernel.msgmax': '0\n',
  'kernel.sem': '0\t0\t0\t0\n',
  'fs.mqueue.queues_max': '0\n',
};

/** Docker's defaults for a container's own IPC namespace without `sysctls`, as a kernel reads them. */
const dockerDefaults: Readonly<Record<IpcLimit, string>> = {
  'kernel.shmmni': '4096\n',
  'kernel.shmall': '18446744073692774399\n',
  'kernel.shmmax': '18446744073692774399\n',
  'kernel.msgmni': '32000\n',
  'kernel.msgmnb': '16384\n',
  'kernel.msgmax': '8192\n',
  'kernel.sem': '32000\t1024000000\t500\t32000\n',
  'fs.mqueue.queues_max': '256\n',
};

describe("the connector's IPC limits", () => {
  it('reads the eight limits compose sets, each from its file under /proc/sys', () => {
    expect(Object.keys(IPC_LIMITS).sort()).toEqual(Object.keys(closed).sort());
    expect(IPC_LIMITS['kernel.sem']).toBe('/proc/sys/kernel/sem');
    expect(IPC_LIMITS['fs.mqueue.queues_max']).toBe('/proc/sys/fs/mqueue/queues_max');
  });

  it('starts when every limit is zero, as compose sets them', () => {
    expect(ipcRefusal(closed)).toBeUndefined();
  });

  it('refuses to start without the limits, naming every one that is not zero', () => {
    const refusal = ipcRefusal(dockerDefaults);
    expect(refusal).toBeDefined();
    for (const limit of Object.keys(dockerDefaults)) expect(refusal).toContain(limit);
    expect(refusal).toContain('deploy/compose.yaml');
  });

  it('names only the limits that are not zero', () => {
    const refusal = ipcRefusal({ ...closed, 'kernel.msgmni': '32000\n' });
    expect(refusal).toContain('kernel.msgmni');
    for (const limit of Object.keys(closed).filter((name) => name !== 'kernel.msgmni')) {
      expect(refusal).not.toContain(limit);
    }
  });

  it('refuses a semaphore limit with any of its four fields above zero', () => {
    for (const sem of ['1\t0\t0\t0', '0\t0\t0\t1', '0 32000 0 0']) {
      expect(ipcRefusal({ ...closed, 'kernel.sem': sem })).toContain('kernel.sem');
    }
  });

  it('refuses a limit it could not read, or could not read as zero', () => {
    for (const value of [undefined, '', 'zero', '0 0', '-1']) {
      expect(ipcRefusal({ ...closed, 'fs.mqueue.queues_max': value })).toContain(
        'fs.mqueue.queues_max',
      );
    }
    expect(ipcRefusal({ ...closed, 'kernel.sem': '0 0 0' })).toContain('kernel.sem');
  });

  it('reads each file as given and refuses to start with what it read, and the suite runs without it by a parameter', async () => {
    const read = (values: Readonly<Record<string, string>>) => async (path: string) => {
      const name = Object.entries(IPC_LIMITS).find(([, file]) => file === path)?.[0];
      const value = name === undefined ? undefined : values[name];
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return value;
    };
    await expect(verifyIpcClosed({ read: read(closed) })).resolves.toBeUndefined();
    await expect(verifyIpcClosed({ read: read(dockerDefaults) })).rejects.toBeInstanceOf(
      IsolationRefused,
    );
    await expect(verifyIpcClosed({ read: read({}) })).rejects.toThrow(/kernel\.shmmni/);
  });
});
