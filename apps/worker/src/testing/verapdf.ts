import { inject } from 'vitest';

export { VERAPDF_IMAGE } from './verapdf-server.js';

export interface VeraPdfVerdict {
  readonly compliant: boolean;
  readonly profile: string;
  readonly failedRules: number;
  /** Each failed rule as `clause-test`, for a failure to name. */
  readonly failures: readonly string[];
}

interface Report {
  report?: {
    jobs?: {
      validationResult?: {
        compliant: boolean;
        profileName: string;
        details: { failedRules: number; ruleSummaries: { clause: string; testNumber: number }[] };
      }[];
    }[];
  };
}

/**
 * A PDF checked against veraPDF's PDF/UA-1 validation profile, by the run's one warm veraPDF
 * (verapdf-setup.ts). A check that could not happen throws with veraPDF's own words; it never falls
 * back to something that did not check.
 */
export async function checkPdfUa1(pdf: Buffer): Promise<VeraPdfVerdict> {
  const response = await fetch(`${inject('verapdf')}/check`, {
    method: 'POST',
    body: new Uint8Array(pdf),
  });
  if (!response.ok) throw new Error(`veraPDF did not check the PDF: ${await response.text()}`);
  const { stdout, exit } = (await response.json()) as { stdout: string; exit: number };
  return verdictOf(stdout, exit);
}

/**
 * The verdict in veraPDF's JSON report, printed with this exit code. A file veraPDF could not parse
 * leaves a job with no validation result, which is a check that did not happen, not a verdict.
 */
export function verdictOf(stdout: string, exit: number): VeraPdfVerdict {
  const result = (JSON.parse(stdout) as Report).report?.jobs?.[0]?.validationResult?.[0];
  if (result === undefined) {
    throw new Error(`veraPDF produced no validation result (exit ${exit})`);
  }
  return {
    compliant: result.compliant,
    profile: result.profileName,
    failedRules: result.details.failedRules,
    failures: result.details.ruleSummaries.map((rule) => `${rule.clause}-${rule.testNumber}`),
  };
}
