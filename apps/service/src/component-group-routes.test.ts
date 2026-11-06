import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findRole } from '@alloy-works/db';
import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

interface GroupView {
  id: string;
  version: { id: string; number: string };
  members: { component: { id: string; title: string } | null; version: { id: string } }[];
  state: { key: string };
}

interface DocumentView {
  id: string;
  version: { id: string };
  outline: { nodes: { id: string; component?: string; group?: Json }[] };
  groups: {
    placement: string;
    group: { id: string; title: string | null };
    version: { id: string };
    newer: { id: string } | null;
  }[];
}

/**
 * Component groups through the API (the CG plan): made, approved through the component workflow,
 * placed in a document, offered at a newer approved version and taken. Grace makes; Ada approves.
 */
describe('the component group routes', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    const approver = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Approver'));
    await h.allow(h.ids.ada!, approver!.id, { kind: 'space', id: h.general });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const approve = async (group: string) => {
    const submitted = await h.call('grace', 'POST', `/v1/component-groups/${group}/transitions`, {
      transition: 'submit',
      from: 'draft',
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const view = (await h.call('ada', 'GET', `/v1/component-groups/${group}`)).json<GroupView>();
    const approved = await h.call('ada', 'POST', `/v1/component-groups/${group}/approvals`, {
      transition: 'approve',
      version: view.version.id,
      decision: 'approved',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ state: { approved: true } });
  };

  it('REU-060 makes a group in a space, lists it and refuses a member it may not hold', async () => {
    const warning = await h.component(h.general, 'Warning');
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/component-groups`, {
      title: 'SOP references',
      members: [{ component: warning.id }],
    });
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<GroupView>();
    expect(view).toMatchObject({
      version: { number: '0.1' },
      members: [
        { component: { id: warning.id, title: 'Warning' }, version: { id: warning.version } },
      ],
      state: { key: 'draft' },
    });
    expect((await h.call('alice', 'GET', `/v1/component-groups/${view.id}`)).statusCode).toBe(200);
    expect((await h.call('ivy', 'GET', `/v1/component-groups/${view.id}`)).statusCode).toBe(404);
    const listed = await h.call('alice', 'GET', `/v1/component-groups?space=${h.general}`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: Json[] }>().items).toContainEqual(
      expect.objectContaining({ id: view.id, title: 'SOP references', members: 1 }),
    );
    // A group is never a member (CG-C), and a component is a member once.
    const nested = await h.call('grace', 'POST', `/v1/spaces/${h.general}/component-groups`, {
      title: 'Nested',
      members: [{ component: warning.id }, { component: view.id }],
    });
    expect(nested.statusCode).toBe(400);
    expect(nested.json()).toMatchObject({ code: 'group_member_invalid', index: 1 });
    const twice = await h.call('grace', 'POST', `/v1/spaces/${h.general}/component-groups`, {
      title: 'Twice',
      members: [{ component: warning.id }, { component: warning.id }],
    });
    expect(twice.statusCode).toBe(400);
    // A component's transition route does not reach a group.
    expect(
      (
        await h.call('grace', 'POST', `/v1/component-groups/${warning.id}/transitions`, {
          transition: 'submit',
          from: 'draft',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('REU-061 REU-062 places an approved group, offers its newer approved version, and takes it', async () => {
    const a = await h.component(h.general, 'Boilerplate');
    const b = await h.component(h.general, 'Narrative');
    const c = await h.component(h.general, 'New warning');
    const group = (
      await h.call('grace', 'POST', `/v1/spaces/${h.general}/component-groups`, {
        title: 'References',
        members: [{ component: a.id }, { component: b.id }],
      })
    ).json<GroupView>();
    const target = await h.documentReferencing([]);
    const place = (openedFrom: string) =>
      h.call('grace', 'POST', `/v1/documents/${target.id}/groups`, {
        openedFrom,
        group: group.id,
        parent: null,
        position: 0,
      });
    const unapproved = await place(target.version);
    expect(unapproved.statusCode).toBe(409);
    expect(unapproved.json()).toMatchObject({ code: 'group_unapproved' });

    await approve(group.id);
    const placed = await place(target.version);
    expect(placed.statusCode, placed.body).toBe(200);
    const doc = placed.json<DocumentView>();
    const run = doc.outline.nodes.filter((node) => node.group !== undefined);
    expect(run.map((node) => node.component)).toEqual([a.id, b.id]);
    expect(doc.groups).toEqual([
      {
        placement: (run[0]!.group as { placement: string }).placement,
        group: { id: group.id, title: 'References' },
        version: { id: group.version.id, number: '0.1' },
        newer: null,
      },
    ]);
    const placement = doc.groups[0]!.placement;

    // Moving one member alone is refused (CG-G).
    const moved = await h.call('grace', 'POST', `/v1/documents/${target.id}/outline`, {
      openedFrom: doc.version.id,
      operation: { operation: 'remove', node: run[1]!.id },
    });
    expect(moved.statusCode).toBe(400);
    expect(moved.json()).toMatchObject({ code: 'outline_invalid' });

    // A newer approved version is offered, never followed (CG-F).
    const second = await h.call('grace', 'POST', `/v1/component-groups/${group.id}/versions`, {
      openedFrom: group.version.id,
      title: 'References',
      members: [{ component: b.id }, { component: c.id }],
    });
    expect(second.statusCode, second.body).toBe(200);
    const stale = await h.call('grace', 'POST', `/v1/component-groups/${group.id}/versions`, {
      openedFrom: group.version.id,
      title: 'References',
      members: [{ component: c.id }],
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version_precondition' });
    await approve(group.id);
    const newer = second.json<GroupView>().version;
    const offered = (
      await h.call('grace', 'GET', `/v1/documents/${target.id}`)
    ).json<DocumentView>();
    expect(offered.version.id).toBe(doc.version.id);
    expect(offered.groups[0]!.newer).toMatchObject({ id: newer.id });

    const preview = await h.call(
      'grace',
      'POST',
      `/v1/documents/${target.id}/groups/${placement}/take/preview`,
      { version: newer.id },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toEqual({
      added: [{ id: c.id, title: 'New warning' }],
      removed: [{ id: a.id, title: 'Boilerplate' }],
      kept: 1,
      overridesDropped: 0,
    });
    const taken = await h.call(
      'grace',
      'POST',
      `/v1/documents/${target.id}/groups/${placement}/take`,
      {
        openedFrom: doc.version.id,
        version: newer.id,
      },
    );
    expect(taken.statusCode, taken.body).toBe(200);
    const after = taken.json<DocumentView>();
    expect(
      after.outline.nodes.filter((node) => node.group !== undefined).map((node) => node.component),
    ).toEqual([b.id, c.id]);
    expect(after.groups[0]).toMatchObject({ version: { id: newer.id }, newer: null });

    const removed = await h.call(
      'grace',
      'POST',
      `/v1/documents/${target.id}/groups/${placement}/remove`,
      { openedFrom: after.version.id },
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json<DocumentView>().groups).toEqual([]);
  });

  it('REU-063 names a group where its member is used, and refuses deleting the member', async () => {
    const held = await h.component(h.general, 'Held by a group');
    const group = (
      await h.call('grace', 'POST', `/v1/spaces/${h.general}/component-groups`, {
        title: 'Holding',
        members: [{ component: held.id }],
      })
    ).json<GroupView>();
    const uses = await h.call('grace', 'GET', `/v1/components/${held.id}/uses`);
    expect(uses.statusCode, uses.body).toBe(200);
    expect(uses.json()).toMatchObject({
      groups: { named: [{ id: group.id, title: 'Holding' }], unreadable: false },
    });
    const deletion = await h.call('ada', 'GET', `/v1/components/${held.id}/deletion`);
    expect(deletion.statusCode, deletion.body).toBe(200);
    expect(deletion.json()).toMatchObject({
      refusals: [{ code: 'grouped', named: [{ id: group.id, title: 'Holding' }] }],
    });
  });
});
