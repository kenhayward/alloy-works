import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * veraPDF 1.30.2, pinned by digest: the checker PUB-090 and PUB-091 name. It runs in its own container,
 * with no network, so neither a developer nor CI needs a Java runtime. About eleven seconds a run is the
 * JVM starting, whatever the PDF (finding 1).
 */
export const VERAPDF_IMAGE =
  'verapdf/cli@sha256:d5ee329657cf9bc4b2400392dd54c7d0a0ce9980ff6fa2da5590eebeec007cdb';

export interface VeraPdfVerdict {
  readonly compliant: boolean;
  readonly profile: string;
  readonly failedRules: number;
  /** Each failed rule as `clause-test`, for a failure to name. */
  readonly failures: readonly string[];
}

interface Report {
  report: {
    jobs: {
      validationResult: {
        compliant: boolean;
        profileName: string;
        details: { failedRules: number; ruleSummaries: { clause: string; testNumber: number }[] };
      }[];
    }[];
  };
}

/**
 * veraPDF's exit when the PDF is not compliant. Exit 0 (compliant) and exit 1 (not) each print the full
 * report; anything else (4 is "no such file") is a check that did not happen, and throws.
 */
const NOT_COMPLIANT = 1;

/** A PDF checked against veraPDF's PDF/UA-1 validation profile. */
export async function checkPdfUa1(pdf: Buffer): Promise<VeraPdfVerdict> {
  const directory = await mkdtemp(join(tmpdir(), 'aw-verapdf-'));
  try {
    // The image runs as its own user (uid 100, `verapdf`), not the host's. On Linux a bind mount keeps
    // the host's permissions, and mkdtemp's 0700 would leave veraPDF reporting the file missing (exit
    // 4); Docker Desktop's file sharing hides that on Windows and macOS. Readable by all, and nothing
    // in it is secret: the directory is removed as soon as the check is done.
    await chmod(directory, 0o755);
    await writeFile(join(directory, 'checked.pdf'), pdf, { mode: 0o644 });
    const stdout = await veraPdf([
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${directory}:/checked:ro`,
      VERAPDF_IMAGE,
      '--flavour',
      'ua1',
      '--format',
      'json',
      '/checked/checked.pdf',
    ]);
    const [result] = (JSON.parse(stdout) as Report).report.jobs[0]!.validationResult;
    return {
      compliant: result!.compliant,
      profile: result!.profileName,
      failedRules: result!.details.failedRules,
      failures: result!.details.ruleSummaries.map((rule) => `${rule.clause}-${rule.testNumber}`),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** veraPDF's report, whether the PDF passed (exit 0) or failed (exit 1). */
async function veraPdf(args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await run('docker', args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    return stdout;
  } catch (error) {
    const { code, stdout } = error as { code?: unknown; stdout?: unknown };
    if (code === NOT_COMPLIANT && typeof stdout === 'string' && stdout !== '') return stdout;
    throw error;
  }
}
