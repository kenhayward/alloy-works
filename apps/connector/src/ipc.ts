import { readFile } from 'node:fs/promises';

import { IsolationRefused } from './supervisor.js';

/**
 * The IPC limits compose sets to zero in the connector's own IPC namespace (the D1 fix for System V
 * and POSIX IPC), each by its sysctl name and the file the kernel reads it from. System V shared
 * memory, message queues and semaphore sets, and POSIX message queues, live in the namespace and not
 * in any file, and outlive the child that made one - the sweep ends processes, not them - so with any
 * of these above zero one child could leave something there for the next, another user, to read.
 */
export const IPC_LIMITS = Object.freeze({
  'kernel.shmmni': '/proc/sys/kernel/shmmni',
  'kernel.shmall': '/proc/sys/kernel/shmall',
  'kernel.shmmax': '/proc/sys/kernel/shmmax',
  'kernel.msgmni': '/proc/sys/kernel/msgmni',
  'kernel.msgmnb': '/proc/sys/kernel/msgmnb',
  'kernel.msgmax': '/proc/sys/kernel/msgmax',
  'kernel.sem': '/proc/sys/kernel/sem',
  'fs.mqueue.queues_max': '/proc/sys/fs/mqueue/queues_max',
});

export type IpcLimit = keyof typeof IPC_LIMITS;

/** `kernel.sem` is four numbers - SEMMSL, SEMMNS, SEMOPM and SEMMNI - and each other limit one. */
const fieldsOf = (limit: IpcLimit) => (limit === 'kernel.sem' ? 4 : 1);

/**
 * The decision, with nothing read: each limit's file as it was read, or `undefined` where it could
 * not be, in; the refusal naming every limit that is not zero out, or nothing when every one is. A
 * limit that could not be read, or reads as anything but zeros, is not zero.
 */
export function ipcRefusal(
  values: Readonly<Partial<Record<IpcLimit, string | undefined>>>,
): string | undefined {
  const open: string[] = [];
  for (const limit of Object.keys(IPC_LIMITS) as IpcLimit[]) {
    const value = values[limit];
    if (value === undefined) {
      open.push(`${limit} could not be read`);
      continue;
    }
    const fields = value.trim().split(/\s+/);
    if (fields.length !== fieldsOf(limit) || fields.some((field) => field !== '0')) {
      open.push(`${limit} is ${JSON.stringify(value.trim().replace(/\s+/g, ' '))}`);
    }
  }
  if (open.length === 0) return undefined;
  return (
    `The connector will not start while System V or POSIX IPC can be used: ${open.join(', ')}. ` +
    "Set each to zero in the connector's own IPC namespace, as deploy/compose.yaml's sysctls do."
  );
}

/**
 * Refuses to start unless every IPC limit reads zero. The production entry runs it before it
 * listens; the suite never runs it, and passes `read` to decide from values of its own - a
 * parameter, never configuration, as `verifyChildIsolation`'s spawn is.
 */
export async function verifyIpcClosed(
  options: { readonly read?: (path: string) => Promise<string> } = {},
): Promise<void> {
  const read = options.read ?? ((path: string) => readFile(path, 'utf8'));
  const values: Partial<Record<IpcLimit, string>> = {};
  for (const [limit, path] of Object.entries(IPC_LIMITS) as [IpcLimit, string][]) {
    try {
      values[limit] = await read(path);
    } catch {
      // Unread: named as such, which refuses.
    }
  }
  const refusal = ipcRefusal(values);
  if (refusal !== undefined) throw new IsolationRefused(refusal);
}
