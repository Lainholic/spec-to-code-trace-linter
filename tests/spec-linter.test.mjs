import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectHeuristicAmbiguity,
  lintConfluenceSpec,
  lintSpecification,
  summarizeSpecLint,
  validateSpecLint
} from '../src/spec-linter.mjs';

function createMemoryStore() {
  const map = new Map();
  return {
    get: async k => map.get(k),
    set: async (k, v) => { map.set(k, v); }
  };
}

test('detects subjective phrasing vs measurable bounds and runtime SLAs deterministically', () => {
  const vague = detectHeuristicAmbiguity('The export endpoint should handle errors gracefully and respond quickly.');
  assert.equal(vague.hasMeasurableBound, false);
  assert.ok(vague.vagueTerms.includes('gracefully/properly'));
  assert.ok(vague.vagueTerms.includes('fast/quickly'));

  const concrete = detectHeuristicAmbiguity('Reject invalid payloads quickly with HTTP 422 within 200ms.');
  assert.equal(concrete.hasMeasurableBound, true);

  const runtime = detectHeuristicAmbiguity('Maintain p99 latency under 150ms across 5,000 concurrent users during load test.');
  assert.equal(runtime.isRuntimeOrInfra, true);
});

test('validates spec lint candidates with 1:1 cardinality and deterministic fallbacks', () => {
  const requirements = [
    'Sign outbound webhook payloads using HMAC-SHA256 in the X-Signature-256 header.',
    'Handle webhook retry failures gracefully as needed.',
    'Sustain 99.9% uptime SLA across multi-region Kubernetes cluster.'
  ];

  // Candidate 1 valid TESTABLE; Candidate 2 missing suggestedRewrite; Candidate 3 missing entirely!
  const validated = validateSpecLint(requirements, [
    { id: '1', status: 'TESTABLE', issue: 'Concrete cryptographic algorithm and header name specified.' },
    { id: '2', status: 'AMBIGUOUS', issue: 'No retry count, backoff schedule, or dead-letter behavior defined.', suggestedRewrite: '' }
  ]);

  assert.equal(validated.length, 3);
  assert.equal(validated[0].status, 'TESTABLE');
  assert.equal(validated[0].suggestedRewrite, null);

  assert.equal(validated[1].status, 'AMBIGUOUS');
  assert.ok(validated[1].suggestedRewrite.length > 10);
  assert.ok(validated[1].signals.length > 0);

  assert.equal(validated[2].status, 'UNVERIFIABLE_IN_DIFF');
  assert.match(validated[2].suggestedRewrite, /CI|benchmark/i);

  const summary = summarizeSpecLint(validated);
  assert.deepEqual(summary, {
    total: 3,
    testable: 1,
    ambiguous: 1,
    unverifiableInDiff: 1,
    readinessScore: 0.3333
  });
});

test('lintConfluenceSpec caches per user and pageVersion, invalidating automatically when pageVersion increments', async () => {
  const store = createMemoryStore();
  let llmCalls = 0;
  let currentVersion = 2;

  const deps = {
    loadPage: async id => ({
      pageId: id,
      title: 'Webhook Spec',
      pageVersion: currentVersion,
      webUrl: 'https://one-atlas-hebl.atlassian.net/wiki/pages/viewpage.action?pageId=2293824',
      requirements: [
        'Return HTTP 202 Accepted with a UUID deliveryId in JSON.',
        'Process retries seamlessly.'
      ]
    }),
    chat: async () => {
      llmCalls++;
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            content: '```json\n' + JSON.stringify({
              items: [
                { id: '1', status: 'TESTABLE', issue: 'Clear status code and response schema.', suggestedRewrite: null },
                { id: '2', status: 'AMBIGUOUS', issue: 'Retry count and backoff interval are unspecified.', suggestedRewrite: 'Retry failed deliveries up to 3 times with exponential backoff (1s, 5s, 25s).' }
              ]
            }) + '\n```'
          }
        }],
        usage: { total_tokens: 180 }
      };
    },
    store,
    now: () => '2026-11-12T05:00:00.000Z'
  };

  const first = await lintConfluenceSpec({ accountId: 'user-a', pageId: '2293824' }, deps);
  assert.equal(first.fromCache, false);
  assert.equal(first.summary.readinessScore, 0.5);
  assert.equal(llmCalls, 1);

  // Second call for same user + same pageVersion hits KVS cache with 0 LLM calls
  const cachedHit = await lintConfluenceSpec({ accountId: 'user-a', pageId: '2293824' }, deps);
  assert.equal(cachedHit.fromCache, true);
  assert.equal(llmCalls, 1);

  // Different user does NOT share user-a's cached spec lint
  const otherUser = await lintConfluenceSpec({ accountId: 'user-b', pageId: '2293824' }, deps);
  assert.equal(otherUser.fromCache, false);
  assert.equal(llmCalls, 2);

  // Editing the Confluence page (v2 -> v3) automatically invalidates cache for user-a
  currentVersion = 3;
  const afterEdit = await lintConfluenceSpec({ accountId: 'user-a', pageId: '2293824' }, deps);
  assert.equal(afterEdit.fromCache, false);
  assert.equal(afterEdit.pageVersion, 3);
  assert.equal(llmCalls, 3);
});

test('lintSpecification shards large requirement lists into parallel 6-item batches to stay well below Forge 25s timeout', async () => {
  const fourteenReqs = Array.from({ length: 14 }, (_, idx) => `Return HTTP 200 for check #${idx + 1}.`);
  const seenBatchSizes = [];

  const result = await lintSpecification(fourteenReqs, async req => {
    const payload = JSON.parse(req.messages[1].content);
    seenBatchSizes.push(payload.requirements.length);
    return {
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            items: payload.requirements.map(r => ({
              id: r.id,
              status: 'TESTABLE',
              issue: 'Clear HTTP 200 assertion.',
              suggestedRewrite: null
            }))
          })
        }
      }],
      usage: { total_tokens: 100 }
    };
  });

  assert.deepEqual(seenBatchSizes, [6, 6, 2]);
  assert.equal(result.items.length, 14);
  assert.equal(result.summary.testable, 14);
  assert.equal(result.usage.batches, 3);
  assert.equal(result.usage.total_tokens, 300);
});

test('lintSpecification rejects empty or oversized requirement arrays', async () => {
  await assert.rejects(() => lintSpecification([], async () => ({})), /between 1 and 30/);
});

test('lintSpecification isolates failed batches via Promise.allSettled, falls back deterministically, and avoids caching partial results', async () => {
  const store = createMemoryStore();
  const eightReqs = [
    'Return HTTP 202 on valid POST payload.',
    'Reject unsigned payloads with HTTP 401.',
    'Persist actorId as UUID string.',
    'Store ISO-8601 timestamp in audit row.',
    'Validate Content-Type application/json.',
    'Sign payloads with HMAC-SHA256.',
    'Handle unexpected errors gracefully.',
    'Maintain p99 latency under 100ms under load test.'
  ];
  let batchNum = 0;

  const res = await lintConfluenceSpec(
    { accountId: 'user-partial', pageId: '5111809' },
    {
      store,
      loadPage: async id => ({
        pageId: id,
        title: 'Spec Partial',
        pageVersion: 1,
        requirements: eightReqs
      }),
      chat: async req => {
        batchNum++;
        if (batchNum === 2) {
          throw new Error('TIMEOUT_LINT-BATCH-2_18000MS');
        }
        const payload = JSON.parse(req.messages[1].content);
        return {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                items: payload.requirements.map(r => ({
                  id: r.id,
                  status: 'TESTABLE',
                  issue: 'Concrete check.'
                }))
              })
            }
          }],
          usage: { total_tokens: 90 }
        };
      }
    }
  );

  assert.equal(res.items.length, 8);
  assert.equal(res.incompleteBatchCount, 1);
  assert.equal(res.items[0].status, 'TESTABLE');
  assert.equal(res.items[6].status, 'AMBIGUOUS');
  assert.equal(res.items[7].status, 'UNVERIFIABLE_IN_DIFF');
  // Partial/incomplete spec lint must NOT poison KVS cache
  const nextRun = await lintConfluenceSpec(
    { accountId: 'user-partial', pageId: '5111809' },
    {
      store,
      loadPage: async id => ({
        pageId: id,
        title: 'Spec Partial',
        pageVersion: 1,
        requirements: eightReqs
      }),
      chat: async req => {
        const payload = JSON.parse(req.messages[1].content);
        return {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                items: payload.requirements.map(r => ({ id: r.id, status: 'TESTABLE', issue: 'Concrete check.' }))
              })
            }
          }]
        };
      }
    }
  );
  assert.equal(nextRun.fromCache, false);
  assert.equal(nextRun.incompleteBatchCount, 0);
});
