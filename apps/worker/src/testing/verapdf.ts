import { inject } from 'vitest';
import { verdictOf, type Checker, type VeraPdfVerdict } from '../verapdf.js';

export { VERAPDF_IMAGE } from './verapdf-server.js';
export { verdictOf, type VeraPdfVerdict };

/**
 * A PDF checked against veraPDF's PDF/UA-1 validation profile, by the run's one warm veraPDF
 * (verapdf-setup.ts). A check that could not happen throws with veraPDF's own words; it never falls
 * back to something that did not check.
 */
export async function checkPdfUa1(pdf: Uint8Array): Promise<VeraPdfVerdict> {
  const response = await fetch(`${inject('verapdf')}/check`, {
    method: 'POST',
    body: new Uint8Array(pdf),
  });
  if (!response.ok) throw new Error(`veraPDF did not check the PDF: ${await response.text()}`);
  const { stdout, exit } = (await response.json()) as { stdout: string; exit: number };
  return verdictOf(stdout, exit);
}

/**
 * The `check_pdf` job's checker in a test: the run's one warm veraPDF, in its pinned image, in the
 * stead of the worker's own child process, which speaks the same protocol (src/verapdf.ts). Closing it
 * leaves the run's veraPDF to the run.
 */
export const suiteChecker: Checker = {
  check: checkPdfUa1,
  close: async () => {},
};
