import { describe, expect, it } from 'vitest';
import { DecomposedDocumentSchema, SinkDescribeSchema } from '@kenhayward/bridge-contract';

describe('the bridge contract package', () => {
  it('reads the contract package the sink implements', () => {
    expect(DecomposedDocumentSchema.safeParse({}).success).toBe(false);
    expect(SinkDescribeSchema.safeParse({}).success).toBe(false);
  });
});
