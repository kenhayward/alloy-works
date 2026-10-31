/**
 * One condition axis, Phase, drawing on the Phases vocabulary, a value of each state (the VO plan,
 * VO-E): the listing, the axis and the vocabulary as the service answers them, for a test's fetch.
 */
export const PHASE = '00000000-0000-4000-8000-0000000000a2';
export const PHASES = '00000000-0000-4000-8000-0000000000d1';

const version = { id: '00000000-0000-4000-8000-0000000000f1', number: '0.1' };
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const label = (text: string) => [{ language: 'en-GB', text }];

/** The answer to `pathname`, or undefined where it is none of the three. */
export function phaseAxisAnswer(pathname: string): Response | undefined {
  if (pathname === '/v1/definitions') {
    return json({
      items: [{ id: PHASE, kind: 'conditionAxis', name: 'Phase', key: 'phase', version }],
      next: null,
    });
  }
  if (pathname === `/v1/definitions/${PHASE}`) {
    return json({
      id: PHASE,
      kind: 'conditionAxis',
      version,
      definition: { name: 'Phase', key: 'phase', vocabulary: PHASES },
    });
  }
  if (pathname === `/v1/vocabularies/${PHASES}`) {
    return json({
      version,
      vocabulary: {
        schemaVersion: 1,
        id: PHASES,
        name: 'Phases',
        key: 'phase',
        base: 'en-GB',
        order: 'declared',
        values: [
          { id: 'one', labels: label('Phase I'), descriptions: [], state: 'active' },
          {
            id: 'early',
            labels: label('Early'),
            descriptions: [],
            state: 'deprecated',
            replacedBy: 'one',
          },
          { id: 'pilot', labels: label('Pilot'), descriptions: [], state: 'retired' },
        ],
      },
    });
  }
  return undefined;
}
