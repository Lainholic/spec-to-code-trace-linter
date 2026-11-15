import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeLlmWithRetry } from '../src/llm-resilience.mjs';

test('llm-resilience: passes through immediately on successful first call', async () => {
  let calls = 0;
  const mockChat = async payload => {
    calls++;
    return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] };
  };

  const res = await invokeLlmWithRetry(mockChat, { model: 'claude-sonnet-5' });
  assert.equal(calls, 1);
  assert.equal(res.choices[0].message.content, 'ok');
});

test('llm-resilience: retries on 429 Too Many Requests and succeeds on second attempt', async () => {
  let calls = 0;
  const sleeps = [];
  const mockChat = async () => {
    calls++;
    if (calls === 1) {
      const err = new Error('Rate limit exceeded: 429 Too Many Requests');
      err.status = 429;
      throw err;
    }
    return { choices: [{ finish_reason: 'stop', message: { content: 'recovered' } }] };
  };

  const res = await invokeLlmWithRetry(mockChat, {}, {
    sleep: async ms => { sleeps.push(ms); }
  });

  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 200);
  assert.equal(res.choices[0].message.content, 'recovered');
});

test('llm-resilience: throws immediately on non-transient 400 Bad Request error', async () => {
  let calls = 0;
  const mockChat = async () => {
    calls++;
    const err = new Error('Bad Request: invalid token');
    err.status = 400;
    throw err;
  };

  await assert.rejects(
    () => invokeLlmWithRetry(mockChat, {}),
    /Bad Request/
  );
  assert.equal(calls, 1);
});

test('llm-resilience: exhausts retries and throws original error after maxRetries', async () => {
  let calls = 0;
  const mockChat = async () => {
    calls++;
    const err = new Error('Quota exceeded 429');
    err.status = 429;
    throw err;
  };

  await assert.rejects(
    () => invokeLlmWithRetry(mockChat, {}, { maxRetries: 2, sleep: async () => {} }),
    /Quota exceeded 429/
  );
  assert.equal(calls, 3);
});
