import { describe, expect, it } from 'vitest';
import { TENANT_EFFECT_CAPABILITIES, TENANT_STATE_EFFECTS, TENANT_STATES } from './states.js';

describe('what each state of a tenant stops (the TL plan, TL-C)', () => {
  it('ADM-045 declares each capability the requirement names, for suspension and closure', () => {
    expect([...TENANT_EFFECT_CAPABILITIES].sort()).toEqual(
      [
        'backgroundWork',
        'inFlightPublications',
        'modelEndpoints',
        'notificationDelivery',
        'realtimeConnections',
        'searchIndexes',
        'sharedPublicationLinks',
        'signInAndApi',
        'webhookDelivery',
      ].sort(),
    );
    for (const capability of TENANT_EFFECT_CAPABILITIES) {
      expect(TENANT_STATE_EFFECTS.suspended[capability], capability).toBeDefined();
      expect(TENANT_STATE_EFFECTS.closing[capability], capability).toBeDefined();
    }
  });

  it('ADM-028 lets nobody in while suspended, and keeps what it holds back', () => {
    expect(TENANT_STATE_EFFECTS.suspended.signInAndApi).toBe('stops');
    expect(TENANT_STATE_EFFECTS.suspended.webhookDelivery).toBe('stops, kept and resumed');
    expect(TENANT_STATE_EFFECTS.suspended.inFlightPublications).toBe('finishes within its lease');
  });

  it('names every state the platform schema allows, in the order a tenant moves through them', () => {
    expect(TENANT_STATES).toEqual([
      'active',
      'suspended',
      'closing',
      'retained',
      'deleting',
      'deleted',
    ]);
  });
});
