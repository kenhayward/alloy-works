import { describe, expect, it } from 'vitest';
import { fetchRetrying } from './fetch-retrying.js';

const answering = (...answers: (number | Error)[]) => {
  const calls: string[] = [];
  const fetcher = (url: string) => {
    calls.push(url);
    const answer = answers.shift()!;
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(new Response(null, { status: answer }));
  };
  return { calls, fetcher };
};
const noWait = () => Promise.resolve();

describe('fetching a pinned tool', () => {
  it('tries again when the host answers 504, or does not answer', async () => {
    const { calls, fetcher } = answering(504, new Error('reset'), 200);
    const response = await fetchRetrying('https://tools.test/t', { fetcher, wait: noWait });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('does not try again when the host says the file is not there', async () => {
    const { calls, fetcher } = answering(404, 200);
    const response = await fetchRetrying('https://tools.test/t', { fetcher, wait: noWait });
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('gives the last answer once its attempts run out', async () => {
    const { calls, fetcher } = answering(504, 503, 502, 500, 200);
    const response = await fetchRetrying('https://tools.test/t', { fetcher, wait: noWait });
    expect(response.status).toBe(500);
    expect(calls).toHaveLength(4);
  });

  it('throws the last failure once its attempts run out', async () => {
    const { fetcher } = answering(
      new Error('one'),
      new Error('two'),
      new Error('three'),
      new Error('four'),
    );
    await expect(fetchRetrying('https://tools.test/t', { fetcher, wait: noWait })).rejects.toThrow(
      'four',
    );
  });
});
