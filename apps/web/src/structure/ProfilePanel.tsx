import type { createApiClient } from '@alloy-works/api-client';
import type { StoredProfile } from '@alloy-works/domain';
import { useEffect, useId, useState } from 'react';

import { declaredAxes, type OfferedAxis } from '../editor/ConditionDialog.js';
import styles from './ProfilePanel.module.css';

type Client = ReturnType<typeof createApiClient>;

/** What saving the profile came to, as the page answers it. */
export type ProfileSaved = 'saved' | 'refused' | 'unsent';

/** What the panel says of the acceptance REU-053 asks for. */
export const EXCLUDE_UNSET_SAID =
  'Leave out text that depends on an axis this profile does not set';

export interface ProfilePanelProps {
  readonly client: Client;
  /** The profile the document declares now, or none. */
  readonly profile: StoredProfile | undefined;
  readonly readOnly: boolean;
  readonly onSave: (profile: StoredProfile | null) => Promise<ProfileSaved>;
  /** Asks for a preview of the text as this profile, saved or not, would publish it (REU-025). */
  readonly onPreview: (profile: StoredProfile) => void;
  /**
   * Publishes under this profile, saved or not, in place of the document's (REU-027; the R12 plan).
   * Absent where the reader may not publish.
   */
  readonly onPublish?: (profile: StoredProfile) => void;
}

/** The profile as chosen: each axis with a value chosen, and the acceptance only where it is given. */
const profileOf = (
  values: Readonly<Record<string, readonly string[]>>,
  excludeUnset: boolean,
): StoredProfile => ({
  values: Object.fromEntries(
    Object.entries(values)
      .filter(([, chosen]) => chosen.length > 0)
      .map(([axis, chosen]) => [axis, [...chosen]]),
  ),
  ...(excludeUnset ? { excludeUnset: true as const } : {}),
});

/**
 * **The document's profile** (REU-022, REU-025, REU-053; the R6 plan, R6-H): the values it takes on
 * each declared axis, and whether text depending on an axis it does not set may be left out, saved
 * whole; and a preview of the text as any profile chosen here would publish it.
 */
export function ProfilePanel({
  client,
  profile,
  readOnly,
  onSave,
  onPreview,
  onPublish,
}: ProfilePanelProps) {
  const id = useId();
  const [axes, setAxes] = useState<readonly OfferedAxis[] | 'unread' | null>(null);
  const [values, setValues] = useState<Readonly<Record<string, readonly string[]>>>(
    profile?.values ?? {},
  );
  const [excludeUnset, setExcludeUnset] = useState(profile?.excludeUnset === true);

  useEffect(() => {
    let live = true;
    declaredAxes(client).then(
      (found) => live && setAxes(found),
      () => live && setAxes('unread'),
    );
    return () => {
      live = false;
    };
  }, [client]);

  // The document's own when it changes underneath: a save, or somebody else's version.
  useEffect(() => {
    setValues(profile?.values ?? {});
    setExcludeUnset(profile?.excludeUnset === true);
  }, [profile]);

  const read = axes !== null && axes !== 'unread' ? axes : null;
  // Nothing to choose in an environment with no axis, or none that could be read: the page says
  // nothing of profiles until there is one to declare.
  if (read === null || read.length === 0) return null;
  const chosen = profileOf(values, excludeUnset);
  const empty = Object.keys(chosen.values).length === 0 && !excludeUnset;

  return (
    <section className={styles['panel']} aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className={styles['heading']}>
        Profile
      </h3>
      <>
        {read.map((axis) => (
          <fieldset key={axis.key} className={styles['axis']} disabled={readOnly}>
            <legend>{axis.name}</legend>
            {axis.values.map((value) => (
              <label key={value.key} className={styles['value']}>
                <input
                  type="checkbox"
                  checked={values[axis.key]?.includes(value.key) ?? false}
                  onChange={(event) =>
                    setValues((now) => {
                      const held = now[axis.key] ?? [];
                      return {
                        ...now,
                        [axis.key]: event.target.checked
                          ? [...held, value.key]
                          : held.filter((each) => each !== value.key),
                      };
                    })
                  }
                />
                {value.label}
              </label>
            ))}
          </fieldset>
        ))}
        <label className={styles['value']}>
          <input
            type="checkbox"
            checked={excludeUnset}
            disabled={readOnly}
            onChange={(event) => setExcludeUnset(event.target.checked)}
          />
          {EXCLUDE_UNSET_SAID}
        </label>
        <div className={styles['actions']}>
          {!readOnly && (
            <button type="button" onClick={() => void onSave(empty ? null : chosen)}>
              Save profile
            </button>
          )}
          <button type="button" onClick={() => onPreview(chosen)}>
            Preview this profile
          </button>
          {onPublish && (
            <button type="button" onClick={() => onPublish(chosen)}>
              Publish under this profile
            </button>
          )}
        </div>
      </>
    </section>
  );
}
