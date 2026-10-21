import { describe, expect, it } from 'vitest';
import { negotiate, parseMessage, versionOf } from './protocol.js';

describe('the MCP protocol as /mcp speaks it (the G8 plan, G8-A)', () => {
  it('agrees the client version where held, else the newest held', () => {
    expect(negotiate('2025-06-18')).toBe('2025-06-18');
    expect(negotiate('2025-11-25')).toBe('2025-11-25');
    expect(negotiate('2024-11-05')).toBe('2025-11-25');
    expect(negotiate(undefined)).toBe('2025-11-25');
  });

  it('reads a later request version from its header, answering one sent none as 2025-06-18', () => {
    expect(versionOf('2025-11-25')).toBe('2025-11-25');
    expect(versionOf(undefined)).toBe('2025-06-18');
    expect(versionOf('2025-03-26')).toBeUndefined();
  });

  it('tells a request, a notification and a response apart, and refuses a batch', () => {
    expect(parseMessage({ jsonrpc: '2.0', id: 1, method: 'ping' })).toEqual({
      kind: 'request',
      id: 1,
      method: 'ping',
      params: {},
    });
    expect(parseMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({
      kind: 'notification',
      method: 'notifications/initialized',
    });
    expect(parseMessage({ jsonrpc: '2.0', id: 'a', result: {} })).toEqual({ kind: 'response' });
    expect(parseMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).toMatchObject({
      kind: 'invalid',
    });
    expect(parseMessage({ id: 1, method: 'ping' })).toMatchObject({ kind: 'invalid' });
    expect(parseMessage({ jsonrpc: '2.0', id: {}, method: 'ping' })).toMatchObject({
      kind: 'invalid',
      id: null,
    });
    expect(parseMessage({ jsonrpc: '2.0', id: 2, method: 'ping', params: [] })).toMatchObject({
      kind: 'invalid',
      id: 2,
    });
  });
});
