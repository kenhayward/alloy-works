import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import {
  readStanding,
  standingIn,
  TransitionButtons,
  type Standing,
} from '../lifecycle/Workflow.js';
import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import { StateLozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import styles from './groups.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A member as the group's view gives it, or as added here: no version yet means its latest. */
interface Member {
  readonly component: { readonly id: string; readonly title: string } | null;
  readonly version: { readonly id: string; readonly number: string } | null;
  readonly newest: { readonly id: string; readonly number: string } | null;
}

interface GroupView {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly number: string };
  readonly members: readonly Member[];
  readonly mayEdit: boolean;
}

const isView = (data: unknown): data is GroupView =>
  typeof data === 'object' && data !== null && 'members' in data && 'version' in data;

/**
 * A component group's page (REU-060; the CG plan, CG-K): its members in order, each at the version the
 * group pins with a newer one offered, and, to an editor, add, remove, reorder and "use version N",
 * saved together as the group's next version. No overrides, conditions or threads here: those are
 * each document's.
 */
export function ComponentGroupPage({ client, id }: { client: Client; id: string }) {
  const [view, setView] = useState<GroupView | null | 'failed'>(null);
  const [standing, setStanding] = useState<Standing | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [changed, setChanged] = useState(false);
  const [offered, setOffered] = useState<readonly { id: string; title: string }[]>([]);
  const [adding, setAdding] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useCallback((data: GroupView) => {
    setView(data);
    setStanding(standingIn(data));
    setTitle(data.title);
    setMembers(data.members);
    setChanged(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await client.GET('/v1/component-groups/{id}', {
        params: { path: { id } },
      });
      if (isView(data)) shown(data);
      else setView('failed');
    } catch {
      setView('failed');
    }
  }, [client, id, shown]);

  useEffect(() => {
    void load();
  }, [load]);

  // The components that may be added: readable ones not already members (CG-C). Read once.
  const mayEdit = view !== null && view !== 'failed' && view.mayEdit;
  useEffect(() => {
    if (!mayEdit) return;
    let current = true;
    client
      .GET('/v1/components', { params: { query: { sort: 'title', order: 'asc' } } })
      .then(({ data }) => {
        if (current && data)
          setOffered(data.items.map((each) => ({ id: each.id, title: each.title })));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, mayEdit]);

  if (view === null) return null;
  if (view === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('groups.the-group-could-not-be-loaded')}</p>
        <button type="button" onClick={() => void load()}>
          {words('editor.try-again')}
        </button>
      </Notice>
    );
  }

  const held = new Set(members.flatMap((each) => (each.component ? [each.component.id] : [])));
  const addable = offered.filter((each) => !held.has(each.id));
  const chosen = addable.some((each) => each.id === adding) ? adding : (addable[0]?.id ?? '');
  const change = (next: readonly Member[]) => {
    setMembers(next);
    setChanged(true);
    setNotice(null);
  };
  const moveBy = (index: number, by: -1 | 1) => {
    const next = [...members];
    const [taken] = next.splice(index, 1);
    next.splice(index + by, 0, taken!);
    change(next);
  };

  const save = async () => {
    if (busy) return;
    if (title.trim() === '') {
      setNotice(words('groups.a-group-needs-a-title'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/component-groups/{id}/versions', {
        params: { path: { id } },
        body: {
          openedFrom: view.version.id,
          title: title.trim(),
          members: members.flatMap((each) =>
            each.component === null
              ? []
              : [
                  {
                    component: each.component.id,
                    ...(each.version === null ? {} : { version: each.version.id }),
                  },
                ],
          ),
        },
      });
      if (isView(data)) {
        shown(data);
        setNotice(words('groups.saved-as-version', { number: data.version.number }));
      } else if (error?.code === 'version_stale') {
        await load();
        setNotice(words('groups.the-group-changed-since-you'));
      } else {
        setNotice(
          typeof error?.message === 'string'
            ? error.message
            : words('groups.the-group-could-not-be-saved'),
        );
      }
    } catch {
      setNotice(words('groups.the-group-could-not-be-saved'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles['page']} aria-labelledby="group-heading">
      <div className={styles['head']}>
        <span className={styles['tile']}>
          <Icon name="Component group" size={18} />
        </span>
        <div>
          <p className={styles['kicker']}>{words('groups.component-group')}</p>
          <h1 id="group-heading" data-content>
            {view.title}
          </h1>
        </div>
      </div>
      <div className={styles['chips']}>
        {standing && <StateLozenge size="small" state={standing.state} />}
        <Chip>{words('groups.version-of', { number: view.version.number })}</Chip>
        <Chip>
          <span data-content>{view.space.name}</span>
        </Chip>
      </div>
      {standing && (
        <TransitionButtons
          client={client}
          kind="componentGroup"
          id={view.id}
          title={view.title}
          standing={standing}
          versionId={view.version.id}
          onMoved={(now, said) => {
            setStanding(now);
            setNotice(said);
          }}
          onNotice={setNotice}
          onStale={() => {
            void readStanding(client, 'componentGroup', view.id).then((now) => {
              if (now) setStanding(now);
            });
          }}
        />
      )}
      {view.mayEdit && (
        <label className={styles['titleField']}>
          {words('groups.title')}
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setChanged(true);
            }}
          />
        </label>
      )}
      <h2 id="group-members">{words('groups.members')}</h2>
      <ol className={styles['members']} aria-labelledby="group-members">
        {members.map((each, index) => {
          const name = each.component?.title ?? words('groups.a-component-you-may-not-read');
          return (
            <li key={each.component?.id ?? `unread-${index}`} className={styles['member']}>
              <Icon name="Part component" size={16} />
              {each.component === null ? (
                <span className={styles['name']}>{name}</span>
              ) : (
                <a
                  className={styles['name']}
                  href={`#/components/${each.component.id}`}
                  data-content
                >
                  {name}
                </a>
              )}
              <Chip>
                {each.version === null
                  ? words('groups.latest-when-saved')
                  : words('groups.version-of', { number: each.version.number })}
              </Chip>
              {view.mayEdit && each.newest !== null && (
                <button
                  type="button"
                  onClick={() =>
                    change(
                      members.map((one, at) =>
                        at === index ? { ...one, version: one.newest, newest: null } : one,
                      ),
                    )
                  }
                >
                  {words('groups.use-version-of', { number: each.newest.number, title: name })}
                </button>
              )}
              {view.mayEdit && (
                <span className={styles['acts']}>
                  <IconButton
                    label={words('groups.move-up', { title: name })}
                    disabled={index === 0}
                    onClick={() => moveBy(index, -1)}
                  >
                    <Icon name="Chevron up" size={14} />
                  </IconButton>
                  <IconButton
                    label={words('groups.move-down', { title: name })}
                    disabled={index === members.length - 1}
                    onClick={() => moveBy(index, 1)}
                  >
                    <Icon name="Chevron down" size={14} />
                  </IconButton>
                  <IconButton
                    label={words('groups.remove', { title: name })}
                    disabled={members.length === 1}
                    onClick={() => change(members.filter((_, at) => at !== index))}
                  >
                    <Icon name="Close" size={12} />
                  </IconButton>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {view.mayEdit && addable.length > 0 && (
        <form
          className={styles['adding']}
          onSubmit={(event) => {
            event.preventDefault();
            const component = addable.find((each) => each.id === chosen);
            if (component) change([...members, { component, version: null, newest: null }]);
          }}
        >
          <label>
            {words('groups.add-a-component')}
            <select value={chosen} onChange={(event) => setAdding(event.target.value)}>
              {addable.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">{words('groups.add')}</button>
        </form>
      )}
      {view.mayEdit && (
        <div className={styles['save']}>
          {changed && <p>{words('groups.changes-not-yet-saved')}</p>}
          <button
            type="button"
            className="primary"
            aria-disabled={!changed || undefined}
            disabled={busy}
            onClick={() => changed && void save()}
          >
            {words('groups.save-as-a-new-version')}
          </button>
        </div>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
