/**
 * A run's limits (DAT-050; the D1 plan, D1-R): the defaults a definition starts from, and the product's
 * ceilings, which a definition may not exceed and a tenant only lowers. Enforced from D2.
 */
export const defaultLimits = Object.freeze({
  rows: 10_000,
  bytes: 5_242_880,
  seconds: 30,
} as const);

export const limitCeilings = Object.freeze({
  rows: 100_000,
  bytes: 26_214_400,
  seconds: 120,
} as const);

/** A run's limits: rows, bytes and seconds. */
export interface Limits {
  readonly rows: number;
  readonly bytes: number;
  readonly seconds: number;
}

/** A tenant's lowered limits (D2-N), each null or absent where it has not lowered that one. */
export type TenantLimits = { readonly [K in keyof Limits]?: number | null };

/** The limits a run takes (DAT-050): the least of each of the definition's and the tenant's. */
export function effectiveLimits(definition: Limits, tenant: TenantLimits): Limits {
  const least = (limit: keyof Limits) => {
    const lowered = tenant[limit];
    return lowered === undefined || lowered === null
      ? definition[limit]
      : Math.min(definition[limit], lowered);
  };
  return { rows: least('rows'), bytes: least('bytes'), seconds: least('seconds') };
}
