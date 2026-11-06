import { describe, expect, it } from 'vitest';

import { parseComponentGroup } from '../reuse/group.js';
import { referencesIn } from '../reuse/references.js';
import { applyOutlineOperation } from './operations.js';
import { groupPlacements, placeGroup, removeGroup, takeGroupVersion } from './groups.js';
import {
  OUTLINE_SCHEMA_VERSION,
  canonicaliseOutline,
  parseOutlineDocument,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const GROUP = uuid(900);
const V1 = uuid(901);
const V2 = uuid(902);
const [A, B, C, D] = [uuid(1), uuid(2), uuid(3), uuid(4)];
const pin = (component: string) => uuid(Number(component.slice(0, 8)) + 100);

function identifiers() {
  let next = 0;
  return () => {
    next += 1;
    return `${String(next).padStart(4, '0')}${'a'.repeat(22)}`.replace(
      /\d/g,
      (d) => 'abcdefghij'[Number(d)]!,
    );
  };
}

const SECTION = 'section'.padEnd(26, 'a').replace(/[^a-z2-7]/g, 'a');
const OTHER = 'zzzz'.padEnd(26, 'z');

const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const outline: OutlineDocument = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'An SOP',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    {
      ...base,
      type: 'section',
      id: SECTION,
      title: [{ type: 'text', value: 'References', marks: [] }],
      children: [
        {
          ...base,
          type: 'reference',
          id: OTHER,
          component: D,
          mode: { kind: 'latest' },
          children: [],
        },
      ],
    },
  ],
});

const version1 = {
  id: GROUP,
  version: V1,
  members: [A, B, C].map((component) => ({ component, version: pin(component) })),
};

function placed(): OutlineDocument {
  const applied = placeGroup(
    outline,
    { parent: SECTION, position: 1, group: version1 },
    identifiers(),
  );
  if (!applied.applied) throw new Error(applied.reason);
  return applied.outline;
}

const sectionChildren = (doc: OutlineDocument) => doc.nodes[0]!.children;

describe('a component group', () => {
  it('REU-060 holds components once each, at least one, each pinned to a version', () => {
    const good = { schemaVersion: 1, title: 'Boilerplate', members: version1.members };
    expect(parseComponentGroup(good).members).toHaveLength(3);
    expect(() => parseComponentGroup({ ...good, members: [] })).toThrow();
    expect(() =>
      parseComponentGroup({ ...good, members: [version1.members[0], version1.members[0]] }),
    ).toThrow();
    expect(() => parseComponentGroup({ ...good, members: [{ component: A }] })).toThrow();
    expect(() => parseComponentGroup({ ...good, title: '  ' })).toThrow();
  });
});

describe('placing a group', () => {
  it('REU-061 places one reference per member, pinned as the group pins, together and in order', () => {
    const doc = placed();
    const children = sectionChildren(doc);
    expect(children.map((each) => (each.type === 'reference' ? each.component : null))).toEqual([
      D,
      A,
      B,
      C,
    ]);
    const members = children.slice(1) as Extract<OutlineNode, { type: 'reference' }>[];
    const placement = members[0]!.group!.placement;
    for (const member of members) {
      expect(member.mode).toEqual({ kind: 'pinned', version: pin(member.component) });
      expect(member.group).toEqual({ id: GROUP, version: V1, placement });
    }
    expect(groupPlacements(doc)).toEqual([
      {
        placement,
        group: GROUP,
        version: V1,
        parent: SECTION,
        nodes: members.map((each) => each.id),
      },
    ]);
  });

  it('digests the marker, so a placed run is a change', () => {
    const doc = placed();
    const unmarked = parseOutlineDocument({
      ...doc,
      nodes: [
        {
          ...doc.nodes[0]!,
          children: sectionChildren(doc).map((each) => {
            if (each.type !== 'reference') return each;
            const { group: dropped, ...rest } = each;
            void dropped;
            return rest;
          }),
        },
      ],
    });
    expect(canonicaliseOutline(unmarked)).not.toBe(canonicaliseOutline(doc));
  });

  it('refuses a position inside another run, and a reference as the parent', () => {
    const doc = placed();
    expect(
      placeGroup(doc, { parent: SECTION, position: 2, group: version1 }, identifiers()).applied,
    ).toBe(false);
    expect(
      placeGroup(doc, { parent: OTHER, position: 0, group: version1 }, identifiers()).applied,
    ).toBe(false);
  });
});

describe('the outline holds a run together', () => {
  const doc = placed();
  const members = sectionChildren(doc).slice(1);

  it('REU-061 refuses a run that is not contiguous siblings', () => {
    const split = {
      ...doc.nodes[0]!,
      children: [members[0]!, sectionChildren(doc)[0]!, ...members.slice(1)],
    };
    expect(() => parseOutlineDocument({ ...doc, nodes: [split] })).toThrow(/together/);
  });

  it('refuses a placement id used by a run elsewhere', () => {
    const elsewhere = {
      ...doc.nodes[0]!,
      children: sectionChildren(doc).slice(0, 3),
    };
    const second = {
      ...base,
      type: 'section' as const,
      id: 'q'.repeat(26),
      title: [{ type: 'text' as const, value: 'More', marks: [] }],
      children: [members[2]!],
    };
    expect(() => parseOutlineDocument({ ...doc, nodes: [elsewhere, second] })).toThrow();
  });

  it('refuses a member that is not pinned', () => {
    const unpinned = {
      ...doc.nodes[0]!,
      children: sectionChildren(doc).map((each, n) =>
        n === 1 && each.type === 'reference' ? { ...each, mode: { kind: 'latest' } } : each,
      ),
    };
    expect(() => parseOutlineDocument({ ...doc, nodes: [unpinned] })).toThrow();
  });
});

describe("a placed group's members", () => {
  const doc = placed();
  const [first, second] = sectionChildren(doc)
    .slice(1)
    .map((each) => each.id) as [string, string];

  it('REU-061 refuse moving or removing one member alone, or changing its mode', () => {
    const allocate = identifiers();
    for (const operation of [
      { operation: 'move', node: first, parent: SECTION, position: 0 },
      { operation: 'remove', node: second },
      { operation: 'set', node: second, mode: { kind: 'latest' } },
    ] as const) {
      expect(applyOutlineOperation(doc, operation, allocate)).toMatchObject({ applied: false });
    }
  });

  it('REU-061 refuse a node inserted inside the run, or under a member', () => {
    const node = { type: 'reference', component: D, mode: { kind: 'latest' } } as const;
    expect(
      applyOutlineOperation(
        doc,
        { operation: 'insert', parent: SECTION, position: 2, node },
        identifiers(),
      ),
    ).toMatchObject({ applied: false });
    expect(
      applyOutlineOperation(
        doc,
        { operation: 'insert', parent: first, position: 0, node },
        identifiers(),
      ),
    ).toMatchObject({ applied: false });
    expect(
      applyOutlineOperation(
        doc,
        { operation: 'move', node: OTHER, parent: SECTION, position: 2 },
        identifiers(),
      ),
    ).toMatchObject({ applied: false });
  });

  it('REU-061 take local overrides and other switches', () => {
    const applied = applyOutlineOperation(
      doc,
      {
        operation: 'set',
        node: second,
        overrides: [
          {
            block: 'b'.repeat(26),
            against: pin(B),
            text: [{ type: 'text', value: 'Ours', marks: [] }],
          },
        ],
        pageBreak: 'page',
      },
      identifiers(),
    );
    expect(applied.applied).toBe(true);
  });

  it('move and go with their section as one', () => {
    const allocate = identifiers();
    const wrapped = applyOutlineOperation(
      doc,
      {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'section', title: [{ type: 'text', value: 'Front', marks: [] }] },
      },
      allocate,
    );
    if (!wrapped.applied) throw new Error(wrapped.reason);
    const moved = applyOutlineOperation(
      wrapped.outline,
      { operation: 'move', node: SECTION, parent: wrapped.outline.nodes[0]!.id, position: 0 },
      allocate,
    );
    expect(moved.applied).toBe(true);
    expect(
      applyOutlineOperation(doc, { operation: 'remove', node: SECTION }, allocate).applied,
    ).toBe(true);
  });

  it('are removed as one, Remove group', () => {
    const placement = groupPlacements(doc)[0]!.placement;
    const removed = removeGroup(doc, placement);
    if (!removed.applied) throw new Error(removed.reason);
    expect(sectionChildren(removed.outline).map((each) => each.id)).toEqual([OTHER]);
    expect(removeGroup(doc, 'n'.repeat(26)).applied).toBe(false);
  });
});

describe('taking a group version', () => {
  it('REU-062 keeps kept members and their overrides, adds new ones, drops removed ones and repins', () => {
    const doc = placed();
    const placement = groupPlacements(doc)[0]!.placement;
    const [, nodeA, nodeB] = sectionChildren(doc).map((each) => each.id);
    const override = {
      block: 'b'.repeat(26),
      against: pin(B),
      text: [{ type: 'text' as const, value: 'Ours', marks: [] }],
    };
    const overridden = applyOutlineOperation(
      doc,
      { operation: 'set', node: nodeB!, overrides: [override] },
      identifiers(),
    );
    if (!overridden.applied) throw new Error(overridden.reason);
    const withC = applyOutlineOperation(
      overridden.outline,
      {
        operation: 'set',
        node: sectionChildren(doc)[3]!.id,
        overrides: [{ ...override, against: pin(C) }],
      },
      identifiers(),
    );
    if (!withC.applied) throw new Error(withC.reason);
    const NEWER = uuid(555);
    const version2 = {
      id: GROUP,
      version: V2,
      members: [
        { component: B, version: NEWER },
        { component: D, version: pin(D) },
        { component: A, version: pin(A) },
      ],
    };
    const taken = takeGroupVersion(withC.outline, placement, version2, () => 'x'.repeat(26));
    if (!taken.applied) throw new Error(taken.reason);
    expect(taken.change).toEqual({ added: [D], removed: [C], kept: 2, overridesDropped: 1 });
    const children = sectionChildren(taken.outline);
    expect(children.map((each) => each.id)).toEqual([OTHER, nodeB, 'x'.repeat(26), nodeA]);
    const b = children[1] as Extract<OutlineNode, { type: 'reference' }>;
    expect(b.mode).toEqual({ kind: 'pinned', version: NEWER });
    expect(b.overrides).toEqual([override]);
    expect(b.group).toEqual({ id: GROUP, version: V2, placement });
  });

  it('refuses another group, and an unknown placement', () => {
    const doc = placed();
    const placement = groupPlacements(doc)[0]!.placement;
    const allocate = identifiers();
    expect(takeGroupVersion(doc, placement, { ...version1, id: uuid(77) }, allocate).applied).toBe(
      false,
    );
    expect(takeGroupVersion(doc, 'n'.repeat(26), version1, allocate).applied).toBe(false);
  });
});

describe('the reference index of groups', () => {
  it('REU-063 indexes a document to each group it places and a group to each member', () => {
    const doc = placed();
    const placement = groupPlacements(doc)[0]!.placement;
    const fromDocument = referencesIn('document', doc);
    expect(
      fromDocument.filter(
        (each) => 'artifact' in each.target && each.target.kind === 'componentGroup',
      ),
    ).toEqual([
      {
        node: placement,
        target: { artifact: GROUP, kind: 'componentGroup' },
        mode: 'pinned',
        version: V1,
      },
    ]);
    expect(
      referencesIn('componentGroup', { schemaVersion: 1, title: 'G', members: version1.members }),
    ).toEqual(
      version1.members.map((each) => ({
        node: null,
        target: { artifact: each.component, kind: 'component' },
        mode: 'pinned',
        version: each.version,
      })),
    );
  });
});
