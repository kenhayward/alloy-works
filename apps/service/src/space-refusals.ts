import { SpaceArchived, SpaceRefused, type SpaceRefusal } from '@alloy-works/db';
import type { AppError } from './errors.js';
import { refused } from './wire-codes.js';

/** What each refusal says, for a person administering spaces. */
const REFUSALS: Readonly<Record<SpaceRefusal, readonly [number, string]>> = {
  'space.name_invalid': [400, 'A space name is 1 to 200 characters, with no control characters.'],
  'space.name_taken': [409, 'There is already a space with that name, perhaps an archived one.'],
  'space.last': [409, 'This is the last space not archived, so it cannot be archived.'],
};

/**
 * A space's own refusal, or a creation in an archived space (the SP1 plan, SP-C), as the wire says it;
 * undefined for anything else. The error handler asks this of every failure, so each route that makes
 * an artifact answers `409 space_archived` without having to remember to.
 */
export function spaceRefusal(error: unknown): AppError | undefined {
  if (error instanceof SpaceArchived) {
    return refused(
      409,
      'space.archived',
      'This space is archived, so nothing new can be made in it. Restore it first.',
    );
  }
  if (error instanceof SpaceRefused) {
    const [status, message] = REFUSALS[error.refusal];
    return refused(status, error.refusal, message);
  }
  return undefined;
}
