import { arch, availableParallelism, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { TYPST_RELEASE } from '../typst-release.js';

/**
 * The machine a budget was measured on, recorded beside the result (CNT-186, REU-049): CI's reference
 * runner where `CI` is `true` (the R22 plan, R22-C), a developer's machine otherwise.
 */
export function machine() {
  return {
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    // The logical CPUs the machine has, whatever a container or runner lets this process use.
    cpus: cpus().length,
    // How many of them this process may run on at once: a container's or a runner's limit, where set.
    parallelism: availableParallelism(),
    memoryGiB: Number((totalmem() / 2 ** 30).toFixed(1)),
    node: process.version,
    typst: TYPST_RELEASE.version,
    ci: process.env['CI'] === 'true',
    // Always [0, 0, 0] on Windows, which is still a value.
    loadavg: loadavg().map((load) => Number(load.toFixed(2))),
  };
}
