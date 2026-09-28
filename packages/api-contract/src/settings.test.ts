import { describe, expect, it } from 'vitest';
import { routes } from './routes.js';
import { EditingSettings } from './settings.js';

describe("the environment's editing settings", () => {
  it('states the window to anybody signed in, and lets only an administrator of the environment change it', () => {
    expect(routes.getEditingSettings).toMatchObject({
      method: 'GET',
      path: '/v1/settings/editing',
      tenantScoped: true,
      access: { check: 'session' },
    });
    expect(routes.setEditingSettings).toMatchObject({
      method: 'PUT',
      path: '/v1/settings/editing',
      tenantScoped: true,
      access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    });
  });

  it('takes a whole number of days from 1 to 365, and nothing else', () => {
    for (const days of [1, 30, 365]) {
      expect(EditingSettings.safeParse({ iterationRetentionDays: days }).success).toBe(true);
    }
    for (const body of [
      { iterationRetentionDays: 0 },
      { iterationRetentionDays: 366 },
      { iterationRetentionDays: 1.5 },
      { iterationRetentionDays: '30' },
      {},
      { iterationRetentionDays: 30, lockMinutes: 15 },
    ]) {
      expect(EditingSettings.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
