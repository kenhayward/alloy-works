import { e2eTargets } from './targets.js';

/**
 * The suite's global setup: refuses the whole run, before any test file is collected and so before
 * any request, when a target is not set (`targets.ts`).
 */
export default function refuseUnsetTargets(): void {
  e2eTargets(process.env);
}
