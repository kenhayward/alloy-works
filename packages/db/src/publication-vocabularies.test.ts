import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  DEFINITION_SCHEMA_VERSION,
  defaultNumberingScheme,
  resolveVariable,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBaseline, readBaseline, requestBaselinePublication } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition, recordDefinitionVersion, type StoredDefinition } from './definitions.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  publicationInputs,
  readPublicationRequest,
  recordPublication,
  requestPublication,
  type PublicationInputs,
} from './publishing.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

/**
 * **The vocabulary versions a publish prints labels from** (the VO plan, VO-D, VO-H): each vocabulary a
 * document's value draws on, at its latest version, recorded on the request and its publication and
 * pinned by a baseline; the job prints a held id by its label in the publication's language; and every
 * deprecated or retired value held is reported, never refused.
 */

const ISSUER = 'https://idp.example';

describe('the vocabulary versions a publish reads (VO-H)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const settled = async (answer: Promise<{ answer: string }>) => {
    const done = (await answer) as { answer: string; definition?: StoredDefinition };
    if (done.answer !== 'created' && done.answer !== 'recorded') {
      throw new Error(JSON.stringify(done));
    }
    return done.definition!;
  };

  /** A study's phases in French, the draft labelled in English too as `draft`. */
  const phasesOf = (key: string, draft: string) => ({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    name: `Phases by ${key}`,
    key,
    base: 'fr',
    order: 'declared',
    values: [
      {
        id: 'draft',
        labels: [
          { language: 'fr', text: 'Brouillon' },
          { language: 'en-GB', text: draft },
        ],
        descriptions: [],
        state: 'active',
      },
      {
        id: 'early',
        labels: [{ language: 'fr', text: 'Précoce' }],
        descriptions: [],
        state: 'deprecated',
        replacedBy: 'draft',
      },
      {
        id: 'pilot',
        labels: [
          { language: 'fr', text: 'Pilote' },
          { language: 'en-GB', text: 'Pilot' },
        ],
        descriptions: [],
        state: 'retired',
      },
    ],
  });

  /** A vocabulary keyed `key`, a field drawing on it and a variable printing that field. */
  const drawn = async (key: string) => {
    const vocabulary = await settled(
      tenant((trx) =>
        createDefinition(trx, {
          kind: 'vocabulary',
          definition: phasesOf(key, 'Draft'),
          author: ada,
        }),
      ),
    );
    const field = await settled(
      tenant((trx) =>
        createDefinition(trx, {
          kind: 'field',
          author: ada,
          definition: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            name: `Phase by ${key}`,
            dataType: 'text',
            multiplicity: 'one',
            validation: { vocabulary: vocabulary.id },
          },
        }),
      ),
    );
    await settled(
      tenant((trx) =>
        createDefinition(trx, {
          kind: 'variable',
          author: ada,
          definition: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            name: `Phase printed by ${key}`,
            key,
            type: { base: 'text' },
            sources: { field: field.id },
          },
        }),
      ),
    );
    return { vocabulary, field: field.id, key };
  };

  /** A component in General holding these values. */
  const holding = (values: Record<string, unknown>) =>
    tenant(async (trx) => {
      const first = await createComponent(trx, {
        spaceId: general,
        title: 'Dosing',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (first.answer !== 'created') throw new Error(first.answer);
      const substance = substanceOf(first.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: first.version.artifactId,
        openedFrom: first.version.id,
        author: ada,
        substance: { ...substance, values },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  /** A document in General holding these values, placing each component, and its nodes. */
  const documentOf = (values: Record<string, unknown>, ...components: StoredVersion[]) =>
    tenant(async (trx) => {
      const created = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (created.answer !== 'created') throw new Error(created.answer);
      const nodes = components.map(() => blockIdentifierFrom(randomBytes(16)));
      const outline: OutlineDocument = {
        ...(created.version.content as OutlineDocument),
        nodes: components.map((component, n) => ({
          type: 'reference' as const,
          id: nodes[n]!,
          component: component.artifactId,
          mode: { kind: 'latest' as const },
          numbered: true,
          matter: 'body' as const,
          pageBreak: 'none' as const,
          values: {},
          children: [],
        })),
      };
      const recorded = await recordVersion(trx, {
        artifactId: created.version.artifactId,
        openedFrom: created.version.id,
        author: ada,
        substance: { kind: 'document', content: outline, values },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return { document: recorded.version, nodes };
    });

  const published = (document: StoredVersion) =>
    tenant(async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: document.artifactId,
        version: document.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(JSON.stringify(asked));
      return {
        request: asked.request.id,
        inputs: (await publicationInputs(trx, asked.request.id))!,
        warnings: (await readPublicationRequest(trx, asked.request.id))!.warnings,
      };
    });

  /** What the variable keyed `key` prints from the inputs. */
  const printed = (inputs: PublicationInputs, key: string) =>
    resolveVariable(inputs.variables.definitions.get(key)!, inputs.variables.context)?.value;

  const recordedOn = (request: string) =>
    tenant((trx) =>
      trx
        .selectFrom('publication_request_asset')
        .select(['asset_id', 'version_id'])
        .where('request_id', '=', request)
        .where('asset_kind', '=', 'vocabulary')
        .execute(),
    );

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
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it("prints a held value by its label in the document's language, recording the vocabulary version on the request and its publication", async () => {
    const { vocabulary, field, key } = await drawn('stage');
    const { document } = await documentOf({ [field]: 'draft' });
    const { request, inputs, warnings } = await published(document);
    // Its English label, though the vocabulary's base is French; the document's value is the id.
    expect(printed(inputs, key)).toBe('Draft');
    expect(warnings).toEqual([]);
    expect(await recordedOn(request)).toEqual([
      { asset_id: vocabulary.id, version_id: vocabulary.version.id },
    ]);
    const recorded = await tenant(async (trx) => {
      const id = await recordPublication(trx, {
        requestId: request,
        pipelineVersion: '28',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 24,
            key: `${production.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
      });
      return trx
        .selectFrom('publication_asset')
        .select(['version_id', 'asset_id'])
        .where('publication_id', '=', id!)
        .where('asset_kind', '=', 'vocabulary')
        .execute();
    });
    expect(recorded).toEqual([{ version_id: vocabulary.version.id, asset_id: vocabulary.id }]);
  });

  it('LIB-004 pins the vocabulary version a baseline printed labels from, so a later relabel changes the next publish and never a republish of the baseline', async () => {
    const { vocabulary, field, key } = await drawn('step');
    const { document } = await documentOf({ [field]: 'draft' });
    const baseline = await tenant(async (trx) => {
      const answer = await makeBaseline(trx, {
        documentId: document.artifactId,
        version: document.id,
        name: 'Issued',
        maker: ada,
      });
      if (answer.answer !== 'made') throw new Error(JSON.stringify(answer));
      return answer.baseline;
    });
    expect(
      (await tenant((trx) => readBaseline(trx, baseline, ada)))?.pins.vocabularies?.map(
        (each) => each.version,
      ),
    ).toEqual([vocabulary.version.id]);
    await settled(
      tenant((trx) =>
        recordDefinitionVersion(trx, {
          id: vocabulary.id,
          openedFrom: vocabulary.version.id,
          definition: phasesOf('step', 'Rough draft'),
          author: ada,
        }),
      ),
    );
    expect(printed((await published(document)).inputs, key)).toBe('Rough draft');
    const again = await tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(JSON.stringify(asked));
      return {
        request: asked.request.id,
        inputs: (await publicationInputs(trx, asked.request.id))!,
      };
    });
    expect(printed(again.inputs, key)).toBe('Draft');
    expect(await recordedOn(again.request)).toEqual([
      { asset_id: vocabulary.id, version_id: vocabulary.version.id },
    ]);
  });

  it('LIB-023 publishes a document holding deprecated and retired values, listing each where it is held and refusing none', async () => {
    const { field } = await drawn('period');
    const component = await holding({ [field]: 'pilot' });
    const { document, nodes } = await documentOf({ [field]: 'early' }, component);
    const { warnings } = await published(document);
    expect(warnings).toEqual([
      {
        code: 'vocabulary_value',
        node: null,
        field,
        value: 'early',
        label: 'Précoce',
        state: 'deprecated',
        replacedBy: 'draft',
      },
      {
        code: 'vocabulary_value',
        node: nodes[0],
        field,
        value: 'pilot',
        label: 'Pilot',
        state: 'retired',
      },
    ]);
  });
});
