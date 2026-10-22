import { SEED_TERM_WORKFLOW, type ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { searchWords } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  archiveTerm,
  createTerm,
  importTerms,
  listTerms,
  readTerm,
  recordTermVersion,
  termUses,
  termsForExport,
  type StoredTerm,
  type TermInput,
} from './terms.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { decideGate } from './workflow-gates.js';
import { moveArtifact } from './workflow.js';

const ISSUER = 'https://idp.example';

/** A term in English alone, with these labels and nothing related. */
const english = (preferred: string, more: Partial<TermInput> = {}): TermInput => ({
  base: 'en',
  labels: [{ language: 'en', preferred, alternatives: [] }],
  definition: [],
  broader: [],
  narrower: [],
  related: [],
  ...more,
});

describe('a term', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const made = (term: TermInput, spaceId = general) =>
    tenant(async (trx) => {
      const answer = await createTerm(trx, { author: ada, spaceId, term });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.term;
    });

  const refusal = (work: (trx: TenantTransaction) => Promise<unknown>) =>
    tenant(work).then((answer) => answer as { answer: string; problems?: { path: string }[] });

  /** The next version of a term, from its latest. */
  const revised = (stored: StoredTerm, term: TermInput) =>
    tenant((trx) =>
      recordTermVersion(trx, { author: ada, id: stored.id, openedFrom: stored.version.id, term }),
    );

  /** A component in this space whose words `value` are marked as the term. */
  const using = (term: string, title: string, value: string, spaceId = general) =>
    tenant(async (trx): Promise<StoredVersion> => {
      const first = await createComponent(trx, {
        spaceId,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (first.answer !== 'created') throw new Error(first.answer);
      const substance = substanceOf(first.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content: ContentDocument = {
        ...substance.content,
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [
              { type: 'text', value: 'Seen: ', marks: [] },
              { type: 'text', value, marks: [{ type: 'definedTerm', id: 'm1', term }] },
            ],
          },
        ] as ContentDocument['content'],
      };
      const next = await recordVersion(trx, {
        artifactId: first.version.artifactId,
        openedFrom: first.version.id,
        author: ada,
        substance: { ...substance, content },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await tenant(async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada authors in both; Grace authors and approves in General and reads Quality.
      const administrator = await findRole(trx, 'Administrator');
      const reader = await findRole(trx, 'Reader');
      const author = await findRole(trx, 'Author');
      for (const [role, principal, space] of [
        [administrator!.id, ada, general],
        [administrator!.id, ada, quality],
        [author!.id, ada, general],
        [author!.id, ada, quality],
        [administrator!.id, grace, general],
        [author!.id, grace, general],
        [reader!.id, grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: role,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LIB-013 LIB-014 is made at 0.1 holding its labels per language, abbreviation and definition, in draft', async () => {
    const term = await made({
      base: 'en',
      labels: [
        {
          language: 'en',
          preferred: 'Fat-tailed dunnart',
          alternatives: ['Dunnart'],
          abbreviation: 'FTD',
        },
        { language: 'fr', preferred: 'Dunnart à queue grasse', alternatives: [] },
      ],
      definition: [{ language: 'en', text: 'A small carnivorous marsupial.' }],
      broader: [],
      narrower: [],
      related: [],
    });
    expect(term.version).toMatchObject({ revision: 0, version: 1 });
    const read = await tenant((trx) => readTerm(trx, term.id));
    expect(read?.term.labels.map((each) => [each.language, each.preferred])).toEqual([
      ['en', 'Fat-tailed dunnart'],
      ['fr', 'Dunnart à queue grasse'],
    ]);
    expect(read?.term.labels[0]?.abbreviation).toBe('FTD');
    expect(read?.space).toEqual({ id: general, name: 'General' });
    expect(read?.standing).toEqual({ key: 'draft', name: 'Draft', approved: false });
    expect(read?.deprecated).toBe(false);
    // A base language with no label is refused, writing nothing.
    const answer = await refusal((trx) =>
      createTerm(trx, { author: ada, spaceId: general, term: { ...english('Quoll'), base: 'de' } }),
    );
    expect(answer).toMatchObject({ answer: 'term.refused', problems: [{ path: 'base' }] });
  });

  it('LIB-025 states broader, narrower and related terms of its own space, and infers none', async () => {
    const marsupial = await made(english('Marsupial'));
    const quoll = await made(english('Quoll', { broader: [marsupial.id] }));
    // Stated on the quoll, the marsupial says nothing of it: nothing is inferred (LIB-027).
    expect((await tenant((trx) => readTerm(trx, marsupial.id)))?.term.narrower).toEqual([]);
    expect((await tenant((trx) => readTerm(trx, quoll.id)))?.term.broader).toEqual([marsupial.id]);
    // A term of another space, anything but a term, and itself are refused by where they are named.
    const elsewhere = await made(english('Platypus'), quality);
    const component = await using(marsupial.id, 'A note', 'marsupial');
    expect(
      await refusal((trx) =>
        createTerm(trx, {
          author: ada,
          spaceId: general,
          term: english('Bilby', { related: [elsewhere.id, component.artifactId] }),
        }),
      ),
    ).toMatchObject({
      answer: 'term.refused',
      problems: [{ path: 'related.0' }, { path: 'related.1' }],
    });
    expect(
      await revised(quoll, english('Quoll', { broader: [marsupial.id], related: [quoll.id] })),
    ).toMatchObject({ answer: 'term.refused', problems: [{ path: 'related.0' }] });
  });

  it('names a replacement of its own space, never closing a cycle, the chain at most five long', async () => {
    const chain: StoredTerm[] = [];
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      const next = chain.at(-1);
      chain.push(await made(english(name, next === undefined ? {} : { replacedBy: next.id })));
    }
    // Six names Five, which names Four, down to One: a chain of five from Six.
    expect(chain[5]?.term.replacedBy).toBe(chain[4]?.id);
    expect(
      await refusal((trx) =>
        createTerm(trx, {
          author: ada,
          spaceId: general,
          term: english('Seven', { replacedBy: chain[5]!.id }),
        }),
      ),
    ).toMatchObject({ answer: 'term.refused', problems: [{ path: 'replacedBy' }] });
    // One replaced by Three closes a cycle through Two.
    expect(await revised(chain[0]!, english('One', { replacedBy: chain[2]!.id }))).toMatchObject({
      answer: 'term.refused',
      problems: [{ path: 'replacedBy' }],
    });
  });

  it('LIB-049 takes its standing from its workflow: approved at a gate, then deprecated', async () => {
    // 0153 seeds the domain's declaration.
    const seeded = await tenant((trx) =>
      trx
        .selectFrom('workflow_definition')
        .select('body')
        .where('kind', '=', 'term')
        .where('version_no', '=', 1)
        .executeTakeFirstOrThrow(),
    );
    expect(seeded.body).toEqual(SEED_TERM_WORKFLOW);
    const term = await made(english('Antechinus'));
    const may = () => true;
    // Ada made it, so Grace approves it.
    const approved = await tenant((trx) =>
      decideGate(trx, {
        artifactId: term.id,
        kind: 'term',
        transition: 'approve',
        version: term.version.id,
        decision: 'approved',
        by: grace,
        may,
      }),
    );
    expect(approved.answer).toBe('passed');
    expect((await tenant((trx) => readTerm(trx, term.id)))?.standing?.key).toBe('approved');
    const moved = await tenant((trx) =>
      moveArtifact(trx, {
        artifactId: term.id,
        kind: 'term',
        transition: 'deprecate',
        from: 'approved',
        reason: 'Use the dunnart',
        by: grace,
        may,
      }),
    );
    expect(moved.answer).toBe('moved');
    const read = await tenant((trx) => readTerm(trx, term.id));
    expect(read?.standing).toEqual({ key: 'deprecated', name: 'Deprecated', approved: false });
    expect(read?.deprecated).toBe(true);
    // And the listing says so.
    const listed = await tenant((trx) => listTerms(trx, ada, general));
    expect(listed?.items.find((each) => each.id === term.id)?.standing?.key).toBe('deprecated');
  });

  it('lists where it is used and is kept from archiving while a component uses it', async () => {
    const term = await made(english('Kowari'));
    const user = await using(term.id, 'The kowari section', 'kowari');
    expect(await tenant((trx) => termUses(trx, ada, term.id))).toEqual({
      named: [{ id: user.artifactId, title: 'The kowari section' }],
      unreadable: false,
    });
    expect(await tenant((trx) => archiveTerm(trx, term.id, ada, 'archived'))).toBe('used');
    // One nothing uses is archived, and leaves the listing.
    const free = await made(english('Mulgara'));
    expect(await tenant((trx) => archiveTerm(trx, free.id, ada, 'archived'))).toBe('changed');
    const labels = await tenant((trx) => listTerms(trx, ada, general)).then((listed) =>
      listed?.items.map((each) => each.label),
    );
    expect(labels).toContain('Kowari');
    expect(labels).not.toContain('Mulgara');
  });

  it('SCH-056 SCH-015 LIB-026 finds a term by its labels, and content by a term or a narrower one', async () => {
    const definition = [{ language: 'en', text: 'Carnivorous marsupial family' }];
    const carnivore = await made(english('Dasyurid', { definition }));
    const ningaui = await made(
      english('Ningaui', {
        labels: [
          { language: 'en', preferred: 'Ningaui', alternatives: ['Wongai'], abbreviation: 'NGU' },
        ],
        broader: [carnivore.id],
      }),
    );
    await revised(carnivore, english('Dasyurid', { definition, narrower: [ningaui.id] }));
    const user = await using(ningaui.id, 'Field notes', 'the little one');
    const found = (words: string) =>
      tenant((trx) => searchWords(trx, ada, words)).then((answer) =>
        answer?.outcome === 'results' ? answer.items.map((each) => each.artifactId) : [],
      );
    // The term by its labels, abbreviation and definition.
    expect(await found('Wongai')).toContain(ningaui.id);
    expect(await found('carnivorous')).toContain(carnivore.id);
    // The component, whose words are none of these, by the term's alternative label, its
    // abbreviation, and its broader term's label.
    expect(await found('Wongai')).toContain(user.artifactId);
    expect(await found('NGU')).toContain(user.artifactId);
    expect(await found('Dasyurid')).toContain(user.artifactId);
  });

  it('never matches, merges into or relates to a term its author may not read or edit', async () => {
    // Ada's wombat in General, withheld from Grace by a grant on it.
    const hidden = await made(english('Wombat'));
    await tenant(async (trx) => {
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: grace },
        level: { kind: 'artifact', id: hidden.id },
        effect: 'deny',
        grantedBy: ada,
      });
    });
    const concept = (preferred: string) => ({
      key: `urn:x:${preferred}`,
      term: english(preferred),
      broader: [],
      narrower: [],
      related: [],
    });
    const imported = await tenant((trx) =>
      importTerms(trx, { author: grace, spaceId: general, concepts: [concept('Wombat')] }),
    );
    expect(imported?.[0]?.outcome).toBe('created');
    expect(imported?.[0]?.term?.id).not.toBe(hidden.id);
    expect((await tenant((trx) => readTerm(trx, hidden.id)))?.version.version).toBe(1);
    // A relation to it is refused as one to no term at all.
    expect(
      await refusal((trx) =>
        createTerm(trx, {
          author: grace,
          spaceId: general,
          term: english('Hairy-nosed wombat', { broader: [hidden.id] }),
        }),
      ),
    ).toMatchObject({
      answer: 'term.refused',
      problems: [{ path: 'broader.0', message: 'This names no term of the space' }],
    });
    // Grace reads Quality but may not edit there: a match is refused, unnamed.
    await made(english('Dibbler'), quality);
    const unedited = await tenant((trx) =>
      importTerms(trx, { author: grace, spaceId: quality, concepts: [concept('Dibbler')] }),
    );
    expect(unedited).toEqual([
      {
        key: 'urn:x:Dibbler',
        outcome: 'refused',
        message: 'A term of the space has this label, and you may not edit it',
      },
    ]);
  });

  it('LIB-028 LIB-029 imports terms, merging a match by its base preferred label and relating by file identity', async () => {
    const existing = await made(english('Phascogale'), quality);
    const answer = await tenant((trx) =>
      importTerms(trx, {
        author: ada,
        spaceId: quality,
        concepts: [
          {
            key: 'urn:x:phascogale',
            term: {
              ...english('Phascogale'),
              labels: [
                { language: 'en', preferred: 'Phascogale', alternatives: ['Wambenger'] },
                { language: 'fr', preferred: 'Phascogale à queue en pinceau', alternatives: [] },
              ],
            },
            broader: ['urn:x:dasyurid'],
            narrower: [],
            related: [],
          },
          {
            key: 'urn:x:dasyurid',
            term: english('Dasyurid family'),
            broader: [],
            narrower: ['urn:x:phascogale'],
            related: [],
          },
        ],
      }),
    );
    expect(answer?.map((each) => [each.key, each.outcome])).toEqual([
      ['urn:x:phascogale', 'merged'],
      ['urn:x:dasyurid', 'created'],
    ]);
    expect(answer?.[0]).toMatchObject({
      merged: ['labels.en.alternatives', 'labels.fr', 'broader'],
    });
    const merged = await tenant((trx) => readTerm(trx, existing.id));
    expect(merged?.term.labels.map((each) => each.language)).toEqual(['en', 'fr']);
    expect(merged?.term.broader).toEqual([answer?.[1]?.term?.id]);
    // Exported as it is held, archived ones among them.
    const exported = await tenant((trx) => termsForExport(trx, ada, quality));
    expect(exported?.map((each) => each.term.labels[0]?.preferred)).toEqual([
      'Dasyurid family',
      'Dibbler',
      'Phascogale',
      'Platypus',
    ]);
  });
});
