/** Millionths of a currency's unit, written to six places. */
export function microsText(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const part = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${part}`;
}
