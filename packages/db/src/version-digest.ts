import { createHash } from 'node:crypto';
import {
  canonicaliseVersion,
  canonicaliseVersionContent,
  type VersionSubstance,
} from '@alloy-works/domain';

export interface VersionDigests {
  /** SHA-256 over the canonical content alone. Keys derived data; never decides whether a version changed. */
  readonly contentHash: string;
  /** SHA-256 over the whole version's canonical serialisation. Decides whether a version changed (ADR-0024). */
  readonly versionDigest: string;
}

/** SHA-256 over the UTF-8 bytes of `text`, as 64 lowercase hexadecimal digits. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Both digests of a version. Hashing lives here rather than in `packages/domain`, which serialises
 * and stays platform-free: `node:crypto` is not, and `crypto.subtle` would make the domain async for
 * nothing (docs/architecture.md, the content model).
 */
export function versionDigests(substance: VersionSubstance): VersionDigests {
  return {
    contentHash: sha256Hex(canonicaliseVersionContent(substance)),
    versionDigest: sha256Hex(canonicaliseVersion(substance)),
  };
}
