import {
  NON_REQUIREMENT_ID,
  NonRequirement,
  QUESTION_ID,
  Question,
  REQUIREMENT_ID,
  Requirement,
  validate,
} from '../model.js';
import { boldIdentifier, tableCells } from './table.js';

export interface AreaDocument {
  readonly area: string;
  readonly requirements: Requirement[];
  readonly nonRequirements: NonRequirement[];
  readonly questions: Question[];
}

/**
 * An area document's text to the three numbered sequences it holds. Takes text rather than a path
 * so that every test of it is a template literal.
 *
 * A row is only a row when its first cell is a bolded identifier. That excludes the header, the
 * separator, and the tables elsewhere in these documents that bold a concept rather than an
 * identifier - the ownership map in the index being the one that matters.
 */
export function parseAreaDocument(document: string, text: string): AreaDocument {
  const area = document.slice(0, 3);
  const requirements: Requirement[] = [];
  const nonRequirements: NonRequirement[] = [];
  const questions: Question[] = [];

  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const cells = tableCells(line);
    if (cells === undefined) continue;
    const first = cells[0];
    if (first === undefined) continue;
    const id = boldIdentifier(first);
    if (id === undefined) continue;

    const at = index + 1;
    const where = `${document}:${at}`;

    if (REQUIREMENT_ID.test(id) && cells.length === 4) {
      requirements.push(
        validate(
          Requirement,
          {
            id,
            area: id.slice(0, 3),
            statement: cells[1],
            tranche: cells[2],
            status: cells[3],
            document,
            line: at,
          },
          where,
        ),
      );
    } else if (NON_REQUIREMENT_ID.test(id) && cells.length === 2) {
      nonRequirements.push(
        validate(NonRequirement, { id, statement: cells[1], document, line: at }, where),
      );
    } else if (QUESTION_ID.test(id) && cells.length === 3) {
      questions.push(
        validate(
          Question,
          { id, question: cells[1], settledBy: cells[2], document, line: at },
          where,
        ),
      );
    } else {
      throw new Error(
        `${where}: ${id} is a bolded identifier in a row of ${cells.length} cells. A requirement row has 4, a non-requirement 2, an open question 3.`,
      );
    }
  }

  return { area, requirements, nonRequirements, questions };
}
