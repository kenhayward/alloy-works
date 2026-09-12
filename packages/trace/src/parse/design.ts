import { DesignClaim, type Design, REQUIREMENT_ID, validate } from '../model.js';
import { boldIdentifier, tableCells } from './table.js';

const HEADING = '## Requirements owned';

/**
 * A design document's text to the requirements it claims.
 *
 * Only the `## Requirements owned` section counts. A design document mentions plenty of identifiers
 * in its prose, and mentioning one is not claiming it - which is the distinction the whole reverse
 * index rests on.
 */
export function parseDesignDocument(document: string, text: string): Design {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === HEADING);
  if (start === -1) return { document, owns: [] };

  const owns: DesignClaim[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('## ')) break;

    const cells = tableCells(line);
    if (cells === undefined || cells.length !== 2) continue;
    const first = cells[0];
    if (first === undefined) continue;
    const id = boldIdentifier(first);
    if (id === undefined || !REQUIREMENT_ID.test(id)) continue;

    owns.push(validate(DesignClaim, { id, howItIsMet: cells[1] }, `${document}:${index + 1}`));
  }

  return { document, owns };
}
