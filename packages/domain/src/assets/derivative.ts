/**
 * **An image's derivatives** (AST-008 to AST-010, AST-048; the AL plan, AL-H): a thumbnail for a
 * library and a preview for an editor, each WebP and turned upright, its long side at most this, never
 * enlarged. Made from the original, which is never replaced by one.
 */
export const ASSET_DERIVATIVES = {
  thumbnail: { longSide: 256 },
  preview: { longSide: 1024 },
} as const;

export type DerivativeKind = keyof typeof ASSET_DERIVATIVES;

export const DERIVATIVE_KINDS = Object.keys(ASSET_DERIVATIVES) as readonly DerivativeKind[];
