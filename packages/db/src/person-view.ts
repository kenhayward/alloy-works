/**
 * **A person as every view says them** (IAM-045; the R13 plan, R13-A): their identifier and name, and
 * `external`, true alone, where they are from outside the tenant - absent for everybody else, so a view
 * of somebody inside reads as it always has.
 */
export interface PersonView {
  readonly id: string;
  readonly name: string | null;
  readonly external?: true;
}

export const personView = (id: string, name: string | null, kind: string | null): PersonView =>
  kind === 'external' ? { id, name, external: true } : { id, name };
