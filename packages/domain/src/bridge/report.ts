/**
 * What a delivery maps with a loss or a judgement, and says so (API-073): the closed set the receipt's
 * `carried` list draws from. Each is something the model has no place for, or took a decision about,
 * that a person sending the document would want to know of.
 */
export const CARRY_CODES = [
  'cell_header_dropped',
  'presentation_dropped',
  'note_anchored_table',
  'note_flattened',
  'table_flattened',
  'xref_outside',
  'link_scheme',
  'equation_image_only',
  'alt_missing',
  'title_from_text',
  'property_unmapped',
  'property_unconverted',
  'image_unreferenced',
] as const;

export type CarryCode = (typeof CARRY_CODES)[number];

/** One thing carried: its code, the CT Studio element it concerns (none for the document), and a word more. */
export type CarryEntry = { code: CarryCode; element: string | null; detail?: string };

/** An entry that leaves out a detail it was not given, so equal entries compare equal. */
export function carry(code: CarryCode, element: string | null, detail?: string): CarryEntry {
  return detail === undefined ? { code, element } : { code, element, detail };
}
