import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact, unarchiveArtifact } from './archival.js';
import { makeBaseline } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { deleteArtifact, undeleteArtifact } from './deletion.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { reindexSearch } from './search.js';
import { indexMessage, THREAD_WORDS_MAX } from './search-threads.js';
import { searchWords, type SearchAnswer } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  beforeTheLogDatabase,
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { addComment, editComment, resolveThread, startThread } from './threads.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const words = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: words(value),
});
const said = (value: string) => [{ text: value }];

function resultsOf(answer: SearchAnswer | 'baseline_not_found' | undefined) {
  if (answer === undefined || answer === 'baseline_not_found' || answer.outcome !== 'results') {
    throw new Error(`Expected results, not ${JSON.stringify(answer)}`);
  }
  return answer;
}

describe('searching threads', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let hal: string;
  let general: string;
  let quality: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A component in `space` whose one paragraph says `text`. */
  const component = (space: string, title: string, text: string) =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return revise(trx, made.version, text);
    });

  const revise = async (trx: TenantTransaction, version: StoredVersion, text: string) => {
    const substance = substanceOf(version) as Extract<
      ReturnType<typeof substanceOf>,
      { kind: 'component' }
    >;
    const next = await recordVersion(trx, {
      artifactId: version.artifactId,
      openedFrom: version.id,
      author: ada,
      substance: {
        ...substance,
        content: {
          ...(substance.content as ContentDocument),
          content: [para('b1', text)],
        } as ContentDocument,
      },
    });
    if (next.answer !== 'recorded') throw new Error(next.answer);
    return next.version;
  };

  /** A document in General placing `component` under one section, its node answered. */
  const document = (title: string, component?: string) =>
    tenant(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const node = nodeId();
      const nodes: OutlineNode[] = [
        { type: 'section', id: node, title: words('Scope'), ...base, children: [] },
        ...(component === undefined
          ? []
          : [
              {
                type: 'reference' as const,
                id: nodeId(),
                component,
                mode: { kind: 'latest' as const },
                ...base,
                children: [],
              },
            ]),
      ];
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(made.version.content as OutlineDocument), nodes },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return { version: recorded.version, node };
    });

  const start = (on: StoredVersion, anchor: unknown, text: string, by = ada) =>
    tenant(async (trx) => {
      const answer = await startThread(trx, {
        on: on.artifactId,
        version: on.id,
        anchor,
        parts: said(text),
        author: by,
      });
      if (answer.answer !== 'done') throw new Error(answer.answer);
      return answer;
    });

  const reply = (thread: string, parts: unknown, by = ada) =>
    tenant(async (trx) => {
      const answer = await addComment(trx, { thread, parts, author: by });
      if (answer.answer !== 'done') throw new Error(answer.answer);
      return answer;
    });

  const search = (
    principal: string,
    query: string,
    scope?: 'latest' | 'all' | { readonly baseline: string },
  ) => tenant((trx) => searchWords(trx, principal, query, scope === undefined ? {} : { scope }));

  const threadsFound = async (principal: string, query: string) =>
    resultsOf(await search(principal, query)).items.filter((each) => each.kind === 'thread');

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
      // Hal reads General alone.
      hal = await person(trx, 'hal', 'Hal');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      for (const [principal, space, role] of [
        [ada, general, author],
        [ada, quality, author],
        [grace, general, author],
        [hal, general, reader],
      ] as const) {
        await grant(trx, {
          roleId: role!.id,
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

  it('SCH-071 finds a thread by a word in one message, naming it, and as a whole by two words in two messages', async () => {
    const on = await component(general, 'Valve service', 'Turn the spindle clockwise.');
    const started = await start(
      on,
      { kind: 'span', block: 'b1', quote: 'the spindle', before: 'Turn ' },
      'Is the torque wrong here?',
    );
    const answered = await reply(started.thread, said('Measured with the calibrated wrench.'));

    const found = await threadsFound(ada, 'calibrated');
    expect(found).toMatchObject([
      {
        kind: 'thread',
        artifactId: on.artifactId,
        node: null,
        title: 'Is the torque wrong here?',
        place: `message:${answered.comment}`,
        thread: { id: started.thread, on: 'component', resolved: false },
        version: null,
      },
    ]);
    expect(found[0]!.passage.some((piece) => piece.matched && piece.text === 'calibrated')).toBe(
      true,
    );
    // Two words, each in a message of its own: the thread as a whole.
    expect((await threadsFound(ada, 'torque wrench')).map((each) => each.thread?.id)).toEqual([
      started.thread,
    ]);
    // The span's quoted text is a place too.
    expect((await threadsFound(ada, 'spindle')).map((each) => each.place)).toEqual(['anchor']);
  });

  it('SCH-071 appends a message without reading the thread, its other messages untouched', async () => {
    const on = await component(general, 'Pump seal', 'Grease the seal.');
    const started = await start(on, { kind: 'component' }, 'Which grease is allowed?');
    const placed = () =>
      tenant(async (trx) =>
        (
          await trx
            .selectFrom('search_text as t')
            .innerJoin('search_entry as e', 'e.id', 't.entry_id')
            .select(['t.place', sql<string>`t.xmin::text`.as('written')])
            .where('e.thread_id', '=', started.thread)
            .orderBy('t.place')
            .execute()
        ).map((row) => `${row.place} ${row.written}`),
      );
    const before = await placed();

    // Every thread table held exclusively by another session: a statement reading any of them
    // would wait, and time out.
    const holder = new pg.Client({ connectionString: db.adminUrl });
    await holder.connect();
    const comment = randomUUID();
    try {
      await holder.query('begin');
      for (const table of [
        'thread',
        'thread_comment',
        'thread_comment_text',
        'thread_resolution',
      ]) {
        await holder.query(
          `lock table ${holder.escapeIdentifier(production.schema)}.${table} in access exclusive mode`,
        );
      }
      await tenant(async (trx) => {
        await sql`set local lock_timeout = '2s'`.execute(trx);
        await indexMessage(trx, {
          thread: started.thread,
          comment,
          parts: [{ text: 'Only the lithium grease.' }],
        });
      });
    } finally {
      await holder.query('rollback');
      await holder.end();
    }

    expect(
      (await threadsFound(ada, 'lithium')).map((each) => [each.thread?.id, each.place]),
    ).toEqual([[started.thread, `message:${comment}`]]);
    const after = await placed();
    // The first message's place is the row it was: not rewritten.
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toHaveLength(before.length + 1);
  });

  it('SCH-071 rebuilds an edited message, its old words gone, and the title with the first', async () => {
    const on = await component(general, 'Hopper', 'Empty the hopper.');
    const started = await start(on, { kind: 'component' }, 'Mention the gasket.');
    const second = await reply(started.thread, said('And the hinge.'));
    await tenant(async (trx) => {
      for (const [comment, text] of [
        [started.comment, 'Mention the washer.'],
        [second.comment, 'And the latch.'],
      ] as const) {
        const edited = await editComment(trx, {
          thread: started.thread,
          comment,
          parts: said(text),
          author: ada,
        });
        if (edited.answer !== 'done') throw new Error(edited.answer);
      }
    });
    expect(await threadsFound(ada, 'gasket')).toEqual([]);
    expect(await threadsFound(ada, 'hinge')).toEqual([]);
    expect(await threadsFound(ada, 'washer latch')).toMatchObject([
      { title: 'Mention the washer.', thread: { id: started.thread } },
    ]);
  });

  it('keeps the order messages were written in when one is edited', async () => {
    const on = await component(general, 'Mixer', 'Stir.');
    const started = await start(on, { kind: 'component' }, 'alpha');
    const ids = [started.comment];
    for (const word of ['bravo', 'charlie', 'delta', 'echo']) {
      ids.push((await reply(started.thread, said(word))).comment);
    }
    await tenant(async (trx) => {
      const edited = await editComment(trx, {
        thread: started.thread,
        comment: ids[2]!,
        parts: said('charlie2'),
        author: ada,
      });
      if (edited.answer !== 'done') throw new Error(edited.answer);
    });
    const body = await tenant((trx) =>
      trx
        .selectFrom('search_entry')
        .select('body')
        .where('thread_id', '=', started.thread)
        .executeTakeFirstOrThrow(),
    );
    expect(body.body).toBe('alpha bravo charlie2 delta echo');
  });

  it('SCH-071 indexes a long thread whole up to a bound, never failing a message for its length', async () => {
    const on = await component(general, 'Ledger', 'Count.');
    const started = await start(on, { kind: 'component' }, 'The opening okapi.');
    // Distinct words, so the thread's vector would pass the 1 MB a tsvector holds well before the end.
    const many = (n: number) =>
      Array.from({ length: 280 }, (_, i) => `wordy${n.toString(36)}x${i.toString(36)}qz`).join(' ');
    await tenant(async (trx) => {
      for (let n = 0; n < 260; n += 1) {
        await indexMessage(trx, {
          thread: started.thread,
          comment: randomUUID(),
          parts: said(many(n)),
        });
      }
    });
    const entry = await tenant((trx) =>
      trx
        .selectFrom('search_entry')
        .select(sql<number>`length(body)`.as('length'))
        .where('thread_id', '=', started.thread)
        .executeTakeFirstOrThrow(),
    );
    expect(entry.length).toBeLessThanOrEqual(THREAD_WORDS_MAX);
    expect((await threadsFound(ada, 'okapi')).map((each) => each.thread?.id)).toEqual([
      started.thread,
    ]);
    // And a reply after the bound is still taken.
    await reply(started.thread, said('One more.'));
  });

  it('indexes a mention as nothing, never a name', async () => {
    const on = await component(general, 'Filter', 'Swap the filter.');
    const started = await start(on, { kind: 'component' }, 'Ready to swap.');
    await reply(started.thread, [{ mention: grace }, { text: ' can you check the mesh?' }]);
    expect(await threadsFound(ada, 'grace')).toEqual([]);
    expect((await threadsFound(ada, 'mesh')).map((each) => each.thread?.id)).toEqual([
      started.thread,
    ]);
  });

  it('SCH-032 finds a thread only as a reader of what it is anchored to, its counts and facets too', async () => {
    // A component in Quality, placed in a document in General: Hal reads the document, not it.
    const hidden = await component(quality, 'Quality step', 'Inspect the weld.');
    const placing = await document('Assembly guide', hidden.artifactId);
    await start(hidden, { kind: 'component' }, 'The porpoise weld fails.');
    const onNode = await start(
      placing.version,
      { kind: 'node', node: placing.node },
      'The porpoise section is late.',
    );

    const halSees = resultsOf(await search(hal, 'porpoise'));
    expect(halSees.items.map((each) => [each.kind, each.artifactId, each.node])).toEqual([
      ['thread', placing.version.artifactId, placing.node],
    ]);
    expect(halSees.items[0]!.thread).toMatchObject({ id: onNode.thread, on: 'document' });
    expect(halSees.count).toBe(1);
    expect(halSees.facets.kinds).toEqual([
      { value: 'thread', label: 'thread', count: 1, capped: false },
    ]);
    expect(halSees.facets.owners).toEqual([{ value: ada, label: 'Ada', count: 1, capped: false }]);
    // Not vacuous: Ada reads both.
    expect(resultsOf(await search(ada, 'porpoise')).count).toBe(2);
  });

  it('finds a resolved thread, saying so, and one whose anchor no longer stands', async () => {
    const on = await component(general, 'Boiler', 'Bleed the radiator.');
    const started = await start(
      on,
      { kind: 'span', block: 'b1', quote: 'radiator', before: 'Bleed the ' },
      'Which narwhal key?',
    );
    await tenant((trx) => resolveThread(trx, { thread: started.thread, by: ada }));
    // Its quoted text gone from the component: orphaned (COL-017), and still found.
    await tenant(async (trx) => revise(trx, on, 'Drain the tank.'));
    expect(await threadsFound(ada, 'narwhal')).toMatchObject([
      { thread: { id: started.thread, resolved: true } },
    ]);
  });

  it('LIF-020 hides a thread while what it is on is archived, and while it is deleted', async () => {
    const on = await component(general, 'Crane', 'Check the hook.');
    const started = await start(on, { kind: 'component' }, 'The pelican latch sticks.');
    const ids = async () => (await threadsFound(ada, 'pelican')).map((each) => each.thread?.id);
    expect(await ids()).toEqual([started.thread]);

    await tenant((trx) => archiveArtifact(trx, on.artifactId, ada));
    expect(await ids()).toEqual([]);
    // A thread started on it while archived is hidden as it is.
    const later = await start(on, { kind: 'component' }, 'Another pelican note.');
    expect(await ids()).toEqual([]);
    await tenant((trx) => unarchiveArtifact(trx, on.artifactId, ada));
    expect((await ids()).sort()).toEqual([started.thread, later.thread].sort());

    await tenant((trx) => deleteArtifact(trx, on.artifactId, ada));
    expect(await ids()).toEqual([]);
    await tenant((trx) => undeleteArtifact(trx, on.artifactId, ada));
    expect((await ids()).sort()).toEqual([started.thread, later.thread].sort());
  });

  it("finds a thread under every version, once, never in a baseline, and keeps it through its artifact's next version", async () => {
    const on = await component(general, 'Lathe', 'Oil the bed.');
    const started = await start(on, { kind: 'component' }, 'The ocelot gauge drifts.');
    const placing = await document('Lathe manual', on.artifactId);
    const onNode = await start(
      placing.version,
      { kind: 'node', node: placing.node },
      'Ocelot section needs a figure.',
    );
    // Its artifact's next version moves the earlier rows, and leaves the thread's where it is.
    await tenant(async (trx) => revise(trx, on, 'Oil the bed and the ways.'));

    const all = resultsOf(await search(ada, 'ocelot', 'all'));
    expect(all.items.map((each) => each.thread?.id).sort()).toEqual(
      [started.thread, onNode.thread].sort(),
    );
    expect(all.count).toBe(2);
    expect(all.facets.kinds).toEqual([
      { value: 'thread', label: 'thread', count: 2, capped: false },
    ]);
    const earlier = await tenant((trx) =>
      trx
        .selectFrom('search_earlier')
        .select('kind')
        .where('artifact_id', '=', on.artifactId)
        .execute(),
    );
    expect(earlier.map((each) => each.kind)).not.toContain('thread');

    const pinned = await tenant(async (trx) => {
      const made = await makeBaseline(trx, {
        documentId: placing.version.artifactId,
        version: placing.version.id,
        name: 'Issued',
        maker: ada,
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      return made.baseline;
    });
    expect(resultsOf(await search(ada, 'ocelot', { baseline: pinned })).items).toEqual([]);
  });

  it('writes every thread again when the projection is rebuilt', async () => {
    const on = await component(general, 'Press', 'Set the stroke.');
    const started = await start(on, { kind: 'component' }, 'The stroke is short.');
    const answered = await reply(started.thread, said('Raise the bison stop.'));
    await tenant(async (trx) => {
      const edited = await editComment(trx, {
        thread: started.thread,
        comment: answered.comment,
        parts: said('Raise the yak stop.'),
        author: ada,
      });
      if (edited.answer !== 'done') throw new Error(edited.answer);
    });
    const before = await threadsFound(ada, 'yak');
    await tenant((trx) => reindexSearch(trx));
    expect(await threadsFound(ada, 'bison')).toEqual([]);
    expect(await threadsFound(ada, 'yak')).toEqual(before);
  });
});

describe('migration 0089, which makes threads searchable', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0088 and none after, where every environment stood before SV2.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0089-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 89;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('SCH-071 writes, in the run that applies it, the threads an environment already held', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const service = beforeTheLogDatabase(db.serviceUrl);
    try {
      // Written before 0089: the version indexed as it always was, the thread not at all.
      const ada = await service.withTenant(tenant, async (trx) => {
        const ada = (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: 'ada',
              email: null,
              display_name: 'Ada',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space.id },
          effect: 'allow',
          grantedBy: ada,
        });
        const made = await createComponent(trx, {
          spaceId: space.id,
          title: 'Kiln firing',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const started = await startThread(trx, {
          on: made.version.artifactId,
          version: made.version.id,
          anchor: { kind: 'component' },
          parts: said('The tapir cone slumped.'),
          author: ada,
        });
        if (started.answer !== 'done') throw new Error(started.answer);
        const replied = await addComment(trx, {
          thread: started.thread,
          parts: said('Fire it hotter.'),
          author: ada,
        });
        if (replied.answer !== 'done') throw new Error(replied.answer);
        return ada;
      });

      const report = await migrate(db.migratorUrl);
      expect(report.tenants[id]).toEqual([
        '0089_search_threads',
        '0090_search_at_scale',
        '0091_search_history',
        '0092_search_scoped',
        '0093_search_history_titles',
        '0094_search_history_fields',
        '0095_workflow',
        '0096_workflow_gates',
        '0097_workflow_publishing',
        '0098_workflow_query_definitions',
        '0099_workflow_dates',
        '0100_section_waivers',
        '0101_template_moves',
        '0102_reference_index',
        '0103_api_jobs',
        '0104_variable_definitions',
        '0105_provenance_without_bindings',
        '0106_conditions_and_profiles',
        '0107_cohorts',
        '0108_relationships',
        '0109_thread_internal',
        '0110_search_conditions',
        '0111_scoped_effectivity',
        '0112_divergent_lines',
        '0113_line_returned',
        '0114_publication_shares',
        '0115_query_limits',
        '0116_cohort_on_failure',
        '0117_dataset_source',
        '0118_tenant_export',
        '0119_range_preview',
        '0120_model_endpoints',
        '0121_assistant',
        '0122_prompts',
        '0123_workflow_prompts',
        '0124_prompt_libraries',
        '0125_prompt_trials',
        '0126_run_transcripts',
        '0127_conversations',
        '0128_guardrails',
        '0129_conversation_context',
        '0130_creation_proposals',
        '0131_personal_prompts',
        '0132_generation_limits',
        '0133_generation_budget',
        '0134_caching',
        '0135_embeddings',
        '0136_embedding_queue',
        '0137_embedding_confirmed',
        '0138_service_identities',
        '0139_webhooks',
        '0140_webhook_notification',
        '0141_extensions',
        '0142_webhook_delivery_ids',
        '0143_publication_generated',
        '0144_embedding_lag',
        '0145_bibliography_entries',
        '0146_citation_styles',
        '0147_publication_citations',
        '0148_default_layout_bibliography',
        '0149_reference_sources',
        '0150_entry_status',
        '0151_citation_proposals',
        '0152_reference_extensions',
        '0153_terms',
        '0154_publication_terms',
        '0155_imports',
        '0156_import_review',
        '0157_import_structure',
        '0158_import_again',
        '0159_translation',
        '0160_publish_in_language',
        '0161_default_layout_languages',
        '0162_untranslated_note',
        '0163_translation_jobs',
        '0164_translation_returns',
        '0165_machine_drafts',
        '0166_interface_language',
        '0167_default_theme_naskh',
        '0168_html_output',
        '0169_default_layout_index',
      ]);
      const answer = await service.withTenant(tenant, (trx) =>
        searchWords(trx, ada, 'tapir hotter'),
      );
      expect(resultsOf(answer).items).toMatchObject([
        { kind: 'thread', title: 'The tapir cone slumped.' },
      ]);
      // And the component, written before, is found as it was.
      expect(
        resultsOf(await service.withTenant(tenant, (trx) => searchWords(trx, ada, 'kiln'))).items,
      ).toMatchObject([{ kind: 'component' }]);
    } finally {
      await service.close();
    }
  });
});
