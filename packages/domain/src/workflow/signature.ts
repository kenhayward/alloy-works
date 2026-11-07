/**
 * **What an electronic signature signs** (LIF-083, LIF-087; the ES plan, ES-G and ES-Q; ADR-0104): the
 * parts recorded as signed, and the canonical text its digest is SHA-256 over. No internal id is in it,
 * so an import renumbering rows changes nothing. Hashed and keyed in `packages/sealing`, which holds
 * `node:crypto`.
 */

/** The signer as the provider named them (ES-O), and as they read when they signed. */
export interface Signer {
  readonly issuer: string;
  readonly subject: string;
  /** The provider's stable key where it has one (`oid` for Entra ID); null otherwise. */
  readonly providerKey: string | null;
  readonly name: string;
  readonly address: string;
}

export interface SignedParts {
  /** The digest of the baseline signed (VER-043): the electronic record. */
  readonly baselineDigest: string;
  readonly signer: Signer;
  /** The role signed under, by name. */
  readonly role: string;
  /** The document's title and the baseline's name, as signed. */
  readonly title: string;
  readonly baseline: string;
  readonly decision: 'approved' | 'rejected';
  /** The gate's meaning for the decision, verbatim (LIF-081). */
  readonly meaning: string;
  /** A disapproval's reason; null for an approval. */
  readonly reason: string | null;
  readonly signedAt: Date;
  /** The signer's offset from UTC, in minutes, when they signed (LIF-062). */
  readonly offset: number;
}

const FORMAT = 'alloy-works/electronic-signature/1';

/** A lone surrogate or a NUL: what Postgres text cannot hold as written, so it could never verify. */
const LONE_SURROGATE = /\p{Cs}/u;
const NUL = String.fromCharCode(0);

/** A text part, composed (NFC), so a part stored composed reads back to the same manifest. */
function text<T extends string | null>(part: T): T {
  if (part === null) return part;
  if (LONE_SURROGATE.test(part) || part.includes(NUL)) {
    throw new Error('A signed part is text the database can hold');
  }
  return part.normalize('NFC') as T;
}

/**
 * The canonical text of a signature's parts: one JSON array, in a fixed order, under its format's
 * name, each text composed (NFC), the time in UTC to the millisecond. JSON keeps each part apart, so
 * no text in one can be spelled to read as another.
 */
export function signatureManifest(parts: SignedParts): string {
  if (Number.isNaN(parts.signedAt.getTime())) throw new Error('A signature has a time');
  if (!Number.isInteger(parts.offset) || Math.abs(parts.offset) > 840) {
    throw new Error('An offset is whole minutes within fourteen hours of UTC');
  }
  return JSON.stringify([
    FORMAT,
    ...[
      parts.baselineDigest,
      parts.signer.issuer,
      parts.signer.subject,
      parts.signer.providerKey,
      parts.signer.name,
      parts.signer.address,
      parts.role,
      parts.title,
      parts.baseline,
      parts.decision,
      parts.meaning,
      parts.reason,
    ].map(text),
    parts.signedAt.toISOString(),
    parts.offset,
  ]);
}
