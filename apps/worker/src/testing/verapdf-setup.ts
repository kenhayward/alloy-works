import type { TestProject } from 'vitest/node';
import { serveWarmVeraPdf, startWarmVeraPdf } from './verapdf-server.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where `checkPdfUa1` reaches the run's one warm veraPDF (verapdf-server.ts). */
    verapdf: string;
  }
}

/**
 * The worker suite's global setup: one veraPDF for the whole run, reached over HTTP because each test
 * file runs in its own process. The JVM starts on the first check, so a run that never checks a PDF
 * pays nothing for it.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const checker = startWarmVeraPdf();
  const front = await serveWarmVeraPdf(checker);
  project.provide('verapdf', front.url);
  return async () => {
    await front.close();
    await checker.close();
  };
}
