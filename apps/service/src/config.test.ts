import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, loadConfig } from './config.js';

const url = 'postgres://aw_service:secret-pw@127.0.0.1:5432/alloy_dev';

describe('configuration', () => {
  it('reads the database address and fills in the rest', () => {
    expect(loadConfig({ DATABASE_URL: url })).toEqual({
      databaseUrl: url,
      port: 8080,
      host: '127.0.0.1',
      logLevel: 'info',
    });
  });

  it('reads the optional settings when given', () => {
    const config = loadConfig({
      DATABASE_URL: url,
      PORT: '9000',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'warn',
    });
    expect(config).toMatchObject({ port: 9000, host: '0.0.0.0', logLevel: 'warn' });
  });

  it('refuses to start without a database, naming what is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('names every problem at once, and never repeats a value it was given', () => {
    let message = '';
    try {
      loadConfig({ DATABASE_URL: 'mysql://root:secret-pw@db/x', PORT: 'eighty' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/PORT/);
    expect(message).not.toContain('secret-pw');
    expect(message).not.toContain('eighty');
  });

  it('describes itself for a log without the password', () => {
    const described = JSON.stringify(describeConfig(loadConfig({ DATABASE_URL: url })));
    expect(described).not.toContain('secret-pw');
    expect(described).toContain('aw_service:***@127.0.0.1:5432/alloy_dev');
  });
});
