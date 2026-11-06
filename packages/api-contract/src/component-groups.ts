import { GROUP_MEMBERS_MOST, groupTitleSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { DocumentView, OutlineRefusal } from './documents.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid, SPACE_ARCHIVED } from './schemas.js';
import {
  GateView,
  TransitionView,
  WorkflowRevisionView,
  WorkflowStandingView,
  WorkflowStatesView,
} from './workflows.js';

/** A component group, by the id its artifact carries (the CG plan, CG-A). */
export const ComponentGroupParams = z.object({ id: LowercaseUuid });
export type ComponentGroupParams = z.infer<typeof ComponentGroupParams>;

const member = z.strictObject({
  component: LowercaseUuid.describe('The component, never a group (CG-C)'),
  version: LowercaseUuid.optional().describe(
    "The version of it the group pins; absent, the component's latest at the time",
  ),
});

const members = z
  .array(member)
  .min(1)
  .max(GROUP_MEMBERS_MOST)
  .refine(
    (each) => new Set(each.map((one) => one.component)).size === each.length,
    'A component is a member of a group once',
  )
  .describe(`Its members in order, 1 to ${GROUP_MEMBERS_MOST}, each component once`);

export const CreateComponentGroupBody = z.strictObject({ title: groupTitleSchema, members });
export type CreateComponentGroupBody = z.infer<typeof CreateComponentGroupBody>;

export const ComponentGroupVersionBody = z.strictObject({
  openedFrom: LowercaseUuid.describe('The version the group was read at, which must be the latest'),
  title: groupTitleSchema,
  members,
});
export type ComponentGroupVersionBody = z.infer<typeof ComponentGroupVersionBody>;

export const ComponentGroupListQuery = z.object({
  ...pageQuery,
  space: LowercaseUuid.optional().describe(
    'Only the groups in this space; every space when absent',
  ),
});
export type ComponentGroupListQuery = z.infer<typeof ComponentGroupListQuery>;

const state = z
  .object({ key: z.string(), name: z.string(), approved: z.boolean() })
  .describe('Its workflow state now: the component workflow’s (CG-A)');

export const ComponentGroupList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      space: z.object({ id: z.string(), name: z.string() }),
      version: z
        .object({ id: z.string(), number: z.string() })
        .describe('Its latest version, as `revision.version`'),
      members: z.number().int().describe('How many members its latest version holds'),
      changedAt: z.string().describe('When its latest version was made'),
      state,
    }),
  ),
  next: nextCursor,
});
export type ComponentGroupList = z.infer<typeof ComponentGroupList>;

export const ComponentGroupView = z.object({
  id: z.string(),
  title: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  members: z
    .array(
      z.object({
        component: z
          .object({ id: z.string(), title: z.string() })
          .nullable()
          .describe('By its latest title; null where the caller may not read it'),
        version: z
          .object({ id: z.string(), number: z.string() })
          .nullable()
          .describe('The version the group pins (CG-B); null where the caller may not read it'),
        newest: z
          .object({ id: z.string(), number: z.string() })
          .nullable()
          .describe("The component's latest version, where newer than the one pinned; null else"),
      }),
    )
    .describe('In order'),
  mayEdit: z
    .boolean()
    .describe(
      'Whether the caller may cut its next version: edit on it, and every member theirs to read',
    ),
  archived: z.boolean(),
  state: WorkflowStandingView,
  states: WorkflowStatesView,
  transitions: z
    .array(TransitionView)
    .describe('The workflow transitions the caller may take from its state now, in order'),
  gates: z.array(GateView).describe('Each gate from its state, decided by its approvers'),
  revision: WorkflowRevisionView,
});
export type ComponentGroupView = z.infer<typeof ComponentGroupView>;

export const ComponentGroupRefusal = ErrorBody.extend({
  index: z
    .number()
    .int()
    .optional()
    .describe('group_member_invalid: the first member refused, by its place in the list'),
  current: ComponentGroupView.optional().describe(
    'version_precondition: the group as it now stands',
  ),
});

const placementId = z.string().regex(/^[a-z2-7]{26}$/, 'Expected a placement id');

export const GroupPlacementParams = z.object({ id: LowercaseUuid, placement: placementId });
export type GroupPlacementParams = z.infer<typeof GroupPlacementParams>;

export const PlaceComponentGroupBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the outline was read at, which must be the latest',
  ),
  group: LowercaseUuid,
  version: LowercaseUuid.optional().describe(
    "The group's version to place; absent, its latest approved version",
  ),
  parent: z
    .string()
    .min(1)
    .max(64)
    .nullable()
    .describe('The section it goes in, or null for the top of the document'),
  position: z.number().int().min(0).describe("Where among the parent's children"),
});
export type PlaceComponentGroupBody = z.infer<typeof PlaceComponentGroupBody>;

export const GroupTakePreviewBody = z.strictObject({
  version: LowercaseUuid.describe("The group's version that would be taken"),
});
export type GroupTakePreviewBody = z.infer<typeof GroupTakePreviewBody>;

export const TakeComponentGroupBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the outline was read at, which must be the latest',
  ),
  version: LowercaseUuid.describe("The group's version to take"),
});
export type TakeComponentGroupBody = z.infer<typeof TakeComponentGroupBody>;

export const RemoveComponentGroupBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the outline was read at, which must be the latest',
  ),
});
export type RemoveComponentGroupBody = z.infer<typeof RemoveComponentGroupBody>;

const said = z.array(z.object({ id: z.string(), title: z.string() }));

export const GroupTakePreviewView = z.object({
  added: said.describe('Members it adds, by latest title, empty where the caller may not read one'),
  removed: said.describe('Members it drops, by latest title'),
  kept: z.number().int().describe('How many members it keeps, each with its local rewording'),
  overridesDropped: z
    .number()
    .int()
    .describe('Local rewordings on the members it drops, which go with them'),
});
export type GroupTakePreviewView = z.infer<typeof GroupTakePreviewView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;
const groupNotFound = {
  description: 'No such component group in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const memberRefused = {
  description:
    'group_member_invalid: a member is no component the caller may read, a deleted one, or named at a version not its own; `index` says which',
  schema: ComponentGroupRefusal,
} as const;
const documentEdited = {
  401: unauthenticated,
  403: { description: 'The caller may read the document but may not edit it', schema: ErrorBody },
} as const;

/**
 * Component groups (the CG plan): made in a space on `create`, read on `read`, a version cut on `edit`;
 * placed, taken at another version and removed in a document on `edit` on the document. Their workflow
 * moves are the workflow routes', under the component workflow.
 */
export const componentGroupRoutes = {
  listComponentGroups: {
    operationId: 'listComponentGroups',
    method: 'GET',
    path: '/v1/component-groups',
    summary: 'The component groups the caller may read, by title, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: ComponentGroupListQuery,
    responses: {
      200: { description: 'A page of component groups', schema: ComponentGroupList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  createComponentGroup: {
    operationId: 'createComponentGroup',
    method: 'POST',
    path: '/v1/spaces/{space}/component-groups',
    summary: 'Make a component group in this space, at version 0.1, in draft',
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateComponentGroupBody,
    responses: {
      // 200, not 201: a permission-checked handler answers 200 (`createComponent`'s comment).
      200: { description: 'Made, at version 0.1', schema: ComponentGroupView },
      400: memberRefused,
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not create in it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: { description: SPACE_ARCHIVED, schema: ErrorBody },
    },
  },
  getComponentGroup: {
    operationId: 'getComponentGroup',
    method: 'GET',
    path: '/v1/component-groups/{id}',
    summary: 'A component group at its latest version: its members, pinned, and its standing',
    tenantScoped: true,
    access: read,
    params: ComponentGroupParams,
    responses: {
      200: { description: 'The component group', schema: ComponentGroupView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a group the caller may not read is not found',
        schema: ErrorBody,
      },
      404: groupNotFound,
    },
  },
  recordComponentGroupVersion: {
    operationId: 'recordComponentGroupVersion',
    method: 'POST',
    path: '/v1/component-groups/{id}/versions',
    summary:
      "Cut a component group's next version: its members added, removed, reordered or repinned",
    tenantScoped: true,
    access: edit,
    params: ComponentGroupParams,
    body: ComponentGroupVersionBody,
    responses: {
      200: {
        description:
          'The group at its latest version: the one cut, or the one before where nothing changed',
        schema: ComponentGroupView,
      },
      400: memberRefused,
      401: unauthenticated,
      403: { description: 'The caller may read the group but may not edit it', schema: ErrorBody },
      404: groupNotFound,
      409: {
        description:
          'version_precondition: the group has a newer version than the one named, answered with it. group_members_withheld: it holds a member the caller may not read, which a version they cut would lose',
        schema: ComponentGroupRefusal,
      },
    },
  },
  placeComponentGroup: {
    operationId: 'placeComponentGroup',
    method: 'POST',
    path: '/v1/documents/{id}/groups',
    summary:
      'Place a component group in a document: a reference per member, pinned as the group pins it',
    tenantScoped: true,
    access: edit,
    params: ComponentGroupParams,
    body: PlaceComponentGroupBody,
    responses: {
      200: { description: 'Placed: the document at its latest version', schema: DocumentView },
      400: {
        description:
          'outline_invalid: the placement does not apply there, or a member is not one the caller may reference; group_version_invalid: the version is not one of the group',
        schema: OutlineRefusal,
      },
      ...documentEdited,
      404: {
        description:
          'No such document the caller may edit, or no such component group the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          'version_precondition: the outline has changed since it was read; group_unapproved: no version is named and the group has no approved one',
        schema: OutlineRefusal,
      },
    },
  },
  previewComponentGroupTake: {
    operationId: 'previewComponentGroupTake',
    method: 'POST',
    path: '/v1/documents/{id}/groups/{placement}/take/preview',
    summary:
      "Say what taking another version of a placed group would change in the document's latest version",
    tenantScoped: true,
    access: read,
    params: GroupPlacementParams,
    body: GroupTakePreviewBody,
    responses: {
      200: { description: 'What it would change; nothing recorded', schema: GroupTakePreviewView },
      400: {
        description: 'group_version_invalid: the version is not one of the placed group',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such document the caller may read, no such placement in its latest version, or a group the caller may not read',
        schema: ErrorBody,
      },
    },
  },
  takeComponentGroup: {
    operationId: 'takeComponentGroup',
    method: 'POST',
    path: '/v1/documents/{id}/groups/{placement}/take',
    summary:
      'Take another version of a placed group: its run rewritten, local rewording kept, as the next version',
    tenantScoped: true,
    access: edit,
    params: GroupPlacementParams,
    body: TakeComponentGroupBody,
    responses: {
      200: { description: 'Taken: the document at its latest version', schema: DocumentView },
      400: {
        description:
          'outline_invalid: a member is not one the caller may reference; group_version_invalid: the version is not one of the placed group',
        schema: OutlineRefusal,
      },
      ...documentEdited,
      404: {
        description:
          'No such document the caller may edit, no such placement in the version opened, or a group the caller may not read',
        schema: ErrorBody,
      },
      409: {
        description: 'version_precondition: the outline has changed since it was read',
        schema: OutlineRefusal,
      },
    },
  },
  removeComponentGroup: {
    operationId: 'removeComponentGroup',
    method: 'POST',
    path: '/v1/documents/{id}/groups/{placement}/remove',
    summary: 'Remove a placed group from a document, its members as one',
    tenantScoped: true,
    access: edit,
    params: GroupPlacementParams,
    body: RemoveComponentGroupBody,
    responses: {
      200: { description: 'Removed: the document at its latest version', schema: DocumentView },
      ...documentEdited,
      404: {
        description:
          'No such document the caller may edit, or no such placement in the version opened',
        schema: ErrorBody,
      },
      409: {
        description: 'version_precondition: the outline has changed since it was read',
        schema: OutlineRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
