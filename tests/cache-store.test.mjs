import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheKey, computeDelta, getCachedSnapshot, saveCachedSnapshot, getCachedSpecLint, saveCachedSpecLint } from '../src/cache-store.mjs';

test('isolates cache keys strictly by accountId, issueKey, pageId, and pullRequestUrl', () => {
  const base = { accountId: 'acct-1', issueKey: 'PLAT-1', pageId: '2293824', pullRequestUrl: 'https://bitbucket.org/ws/repo/pull-requests/1' };
  const k1 = buildCacheKey(base);
  const k2 = buildCacheKey({ ...base, accountId: 'acct-2' });
  assert.ok(k1.startsWith('trace:v1:'));
  assert.notEqual(k1, k2);
  assert.equal(buildCacheKey({ ...base, accountId: '' }), null);
  assert.equal(buildCacheKey({ ...base, issueKey: '' }), null);
});

test('computes resolved, regressed, and spec-version delta transitions accurately', () => {
  const prev = {
    cachedAt: '2026-11-12T01:00:00.000Z',
    pageVersion: 2,
    diffHash: 'hash-a',
    verdicts: [
      { id: '1', requirementText: 'Log actor ID', status: 'POTENTIAL_MISSING' },
      { id: '2', requirementText: 'Validate token', status: 'EVIDENCE_FOUND' },
      { id: '3', requirementText: 'Latency SLA', status: 'OUT_OF_SCOPE' }
    ]
  };
  const next = {
    pageVersion: 3,
    diffHash: 'hash-b',
    verdicts: [
      { id: '1', requirementText: 'Log actor ID', status: 'EVIDENCE_FOUND' },
      { id: '2', requirementText: 'Validate token', status: 'POTENTIAL_MISSING' },
      { id: '3', requirementText: 'Latency SLA', status: 'OUT_OF_SCOPE' }
    ]
  };
  const delta = computeDelta(prev, next);
  assert.equal(delta.resolvedCount, 1);
  assert.equal(delta.regressedCount, 1);
  assert.equal(delta.changedCount, 2);
  assert.equal(delta.pageVersionChanged, true);
  assert.equal(delta.diffChanged, true);
  assert.deepEqual(delta.transitions['1'], { fromStatus: 'POTENTIAL_MISSING', toStatus: 'EVIDENCE_FOUND', direction: 'resolved' });
  assert.deepEqual(delta.transitions['2'], { fromStatus: 'EVIDENCE_FOUND', toStatus: 'POTENTIAL_MISSING', direction: 'regressed' });
});

test('reads, writes, enforces size limits, and degrades gracefully on KVS errors', async () => {
  const map = new Map();
  const store = {
    get: async k => map.get(k),
    set: async (k, v) => { map.set(k, v); }
  };
  const key = buildCacheKey({ accountId: 'u1', issueKey: 'PLAT-1', pageId: '10', pullRequestUrl: 'https://bitbucket.org/w/r/pull-requests/1' });
  const saved = await saveCachedSnapshot(store, key, {
    cachedAt: '2026-11-12T02:00:00.000Z',
    issueKey: 'PLAT-1',
    pageId: '10',
    pageTitle: 'Audit Spec',
    pageVersion: 1,
    pullRequestUrl: 'https://bitbucket.org/w/r/pull-requests/1',
    diffHash: 'abc',
    excludedFiles: ['package-lock.json'],
    summary: { total: 1, evidenceFound: 1, potentialMissing: 0, insufficientContext: 0, outOfScope: 0, inScopeTotal: 1, coverageRatio: 1 },
    verdicts: [{ id: '1', requirementText: 'Req', status: 'EVIDENCE_FOUND', reasoning: 'Ok' }]
  });
  assert.equal(saved, true);
  const loaded = await getCachedSnapshot(store, key);
  assert.equal(loaded.pageTitle, 'Audit Spec');

  const oversized = await saveCachedSnapshot(store, key, {
    cachedAt: 'now',
    issueKey: 'PLAT-1',
    pageId: '10',
    pullRequestUrl: 'https://bitbucket.org/w/r/pull-requests/1',
    summary: {},
    verdicts: [{ id: '1', requirementText: 'x'.repeat(210000), status: 'OUT_OF_SCOPE', reasoning: 'big' }]
  });
  assert.equal(oversized, false);

  const brokenStore = {
    get: async () => { throw new Error('kvs down'); },
    set: async () => { throw new Error('kvs down'); }
  };
  assert.equal(await getCachedSnapshot(brokenStore, key), null);
  assert.equal(await saveCachedSnapshot(brokenStore, key, loaded), false);
});

test('compacts verbose citation snippets to fit within KVS snapshot limit', async () => {
  const map = new Map();
  const store = {
    get: async k => map.get(k),
    set: async (k, v) => { map.set(k, v); }
  };
  const key = buildCacheKey({
    accountId: 'user-1',
    issueKey: 'PLAT-1',
    pageId: '10',
    pullRequestUrl: 'https://bitbucket.org/w/r/pull-requests/1'
  });

  // Create a record with large snippets that exceed 200 KB in total
  const verdicts = [];
  for (let i = 0; i < 20; i++) {
    verdicts.push({
      id: String(i + 1),
      requirementText: `Requirement ${i + 1}`,
      status: 'EVIDENCE_FOUND',
      reasoning: 'Verified in diff',
      citation: {
        path: 'src/module.js',
        line: i + 1,
        text: 'verifiedCode();',
        snippet: 'x'.repeat(10500) // 20 * 10500 = 210 KB!
      }
    });
  }

  const saved = await saveCachedSnapshot(store, key, {
    cachedAt: 'now',
    issueKey: 'PLAT-1',
    pageId: '10',
    pullRequestUrl: 'https://bitbucket.org/w/r/pull-requests/1',
    summary: { total: 20 },
    verdicts
  });

  assert.equal(saved, true);
  const loaded = await getCachedSnapshot(store, key);
  assert.notEqual(loaded, null);
  assert.equal(loaded.verdicts.length, 20);
  // Snippets should be compacted away to fit KVS budget, while keeping path, line, text intact
  assert.equal(loaded.verdicts[0].citation.snippet, undefined);
  assert.equal(loaded.verdicts[0].citation.path, 'src/module.js');
  assert.equal(loaded.verdicts[0].citation.line, 1);
});

test('compacts verbose spec lint rationale to fit within KVS limit', async () => {
  const map = new Map();
  const store = {
    get: async k => map.get(k),
    set: async (k, v) => { map.set(k, v); }
  };
  const key = 'speclint:user-1:p10:v1';
  const items = [];
  for (let i = 0; i < 50; i++) {
    items.push({
      id: `crit-${i + 1}`,
      classification: 'AMBIGUOUS',
      issue: 'i'.repeat(3000),
      rationale: 'r'.repeat(3000)
    });
  }

  const saved = await saveCachedSpecLint(store, key, {
    cachedAt: 'now',
    pageId: '10',
    pageVersion: 1,
    summary: { total: 50 },
    items
  });

  assert.equal(saved, true);
  const loaded = await getCachedSpecLint(store, key);
  assert.notEqual(loaded, null);
  assert.equal(loaded.items.length, 50);
  assert.ok(loaded.items[0].issue.length <= 1500);
  assert.ok(loaded.items[0].rationale.length <= 1500);
});
