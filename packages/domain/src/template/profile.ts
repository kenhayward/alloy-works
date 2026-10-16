import type { StoredProfile } from '../reuse/conditions.js';

import type { TemplateDefinition } from './definition.js';

/**
 * The profile a document made from a template starts with (TPL-051; the R10 plan, R10-E): the
 * template's default values, each axis a parameter feeds taking that parameter's value over its
 * default, and whether exclusion by an unset axis is accepted. Always a profile, never none (REU-022):
 * a template declaring nothing gives one with no values.
 */
export function templateProfile(
  definition: TemplateDefinition,
  parameters: Readonly<Record<string, unknown>>,
): StoredProfile {
  const values: Record<string, string[]> = {};
  for (const [axis, keys] of Object.entries(definition.profile?.values ?? {}))
    values[axis] = [...keys];
  for (const parameter of definition.parameters ?? []) {
    const axis = parameter.feeds.axis;
    const given = parameters[parameter.name];
    if (axis === undefined || given === undefined) continue;
    const keys = (Array.isArray(given) ? given : [given]).filter(
      (each): each is string => typeof each === 'string',
    );
    if (keys.length > 0) values[axis] = [...new Set(keys)];
  }
  return {
    values,
    ...(definition.profile?.excludeUnset === true ? { excludeUnset: true as const } : {}),
  };
}

/** Each axis the template requires that the profile does not set: what leaves it incomplete (TPL-051). */
export function requiredUnset(definition: TemplateDefinition, profile: StoredProfile): string[] {
  return (definition.profile?.required ?? []).filter(
    (axis) => (profile.values[axis] ?? []).length === 0,
  );
}
