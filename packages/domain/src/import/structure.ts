/**
 * What a reader reads beside a file's flow (the IM plan, IM-G to IM-J; IMc): its references to what
 * is not in it, its comments, and the identities it carries. A Word author is data, never a member
 * until the tenant's policy says so, at acceptance (IMP-032).
 */

/** A tracked change a text run stands in, on the candidate's text node until a proposal is made. */
export interface ImportChangeMark {
  readonly kind: 'insert' | 'delete';
  readonly author: string;
  /** Word's own identifier for the change. */
  readonly id: string;
}

/**
 * A cross-reference whose bookmark is not in the file (IMP-033): its candidate's target names `key`
 * until the importer retargets it or makes it plain text (IMP-034).
 */
export interface ImportReference {
  readonly key: string;
  readonly bookmark: string;
  readonly field: 'REF' | 'NOTEREF' | 'PAGEREF';
  /** What the field showed in the file: for review, never content. */
  readonly text: string;
}

/** A reply to a comment, as the file carries it. */
export interface ImportReply {
  readonly author: string;
  readonly initials: string | null;
  readonly date: string | null;
  readonly text: string;
}

/**
 * A comment as the file carries it: the block its range starts in, by the reader's identifier, the
 * text it covers there and what stands before it; `crossed` where its range ran past that block.
 */
export interface ImportComment extends ImportReply {
  readonly id: string;
  readonly block: string;
  readonly quote: string;
  readonly before: string;
  readonly crossed: boolean;
  readonly replies: readonly ImportReply[];
}

/** What a name in the file is the name of. */
export type ImportIdentityRole = 'changes' | 'comments' | 'creator' | 'lastModifiedBy';

/** An identity the file carries (IMP-009): a name, an email where the file gives one, and its roles. */
export interface ImportIdentity {
  readonly name: string;
  readonly email: string | null;
  readonly carries: readonly ImportIdentityRole[];
}

/** The tenant's identity policy (IM-I; IMP-010): map to members, keep as text, or discard. */
export const IMPORT_POLICIES = ['map', 'keep', 'discard'] as const;
export type ImportPolicy = (typeof IMPORT_POLICIES)[number];
