import { z } from 'zod';

import { artifactIdentifierSchema as artifactIdentifier } from '../content/model/identifier.js';
import { hasText } from '../content/model/text.js';
import { storableText } from '../stored/storable.js';

/**
 * A component group version (the CG plan, CG-A to CG-C; REU-060): a title and an ordered list of
 * components, each pinned to one of its versions. One level: a member is a component, never a group,
 * and a component is a member once. That a member is a component and its version one of its own is
 * the writer's to check, with a transaction in hand.
 */
export const COMPONENT_GROUP_SCHEMA_VERSION = 1;

/** The most members a group holds: as many as one placement makes (`PLACE_MAX`). */
export const GROUP_MEMBERS_MOST = 200;

export const groupMemberSchema = z.strictObject({
  component: artifactIdentifier,
  version: artifactIdentifier,
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupTitleSchema = z
  .string()
  .max(500)
  .refine(hasText, 'A group needs a title')
  .refine(storableText, 'A title holds a character that cannot be stored');

export const groupMembersSchema = z
  .array(groupMemberSchema)
  .min(1, 'A group holds at least one component')
  .max(GROUP_MEMBERS_MOST)
  .refine(
    (members) => new Set(members.map((each) => each.component)).size === members.length,
    'A component is a member of a group once',
  );

export const componentGroupSchema = z.strictObject({
  schemaVersion: z.literal(COMPONENT_GROUP_SCHEMA_VERSION),
  title: groupTitleSchema,
  members: groupMembersSchema,
});
export type ComponentGroup = z.infer<typeof componentGroupSchema>;

export function parseComponentGroup(value: unknown): ComponentGroup {
  return componentGroupSchema.parse(value);
}
