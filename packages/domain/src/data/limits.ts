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
