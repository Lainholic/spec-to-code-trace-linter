import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVerdicts } from '../src/verdicts.mjs';
import { loadIssueContext, analyzeLinkedPullRequest } from '../src/linked-analysis.mjs';
import { validateIssueTransition } from '../src/workflow-validator.mjs';
import { formatWorkflowGateBadge } from '../src/frontend/view-model.mjs';
import { buildCacheKey, buildIssueGateKey, saveCachedSnapshot, saveIssueGateSummary } from '../src/cache-store.mjs';
import { verifyIssueSpecForRovo } from '../src/rovo-action.mjs';

test('ID normalization: handles numeric and padded string IDs across verdict validation', () => {
  const requirements = ['Enforce TLS 1.3', 'Audit mutations'];
  const line1 = { path: 'src/net.ts', line: 10, text: 'const tls = true;' };
  const line2 = { path: 'src/audit.ts', line: 20, text: 'audit.log();' };
  const candidates = [
    { id: 1, status: 'EVIDENCE_FOUND', reasoning: 'Verified TLS', citation: line1 },
    { id: ' 2 ', status: 'EVIDENCE_FOUND', reasoning: 'Verified Audit', citation: line2 }
  ];
  const changedLines = [line1, line2];

  const verdicts = validateVerdicts(requirements, candidates, changedLines);
  assert.equal(verdicts.length, 2);
  assert.equal(verdicts[0].status, 'EVIDENCE_FOUND');
  assert.equal(verdicts[0].id, '1');
  assert.equal(verdicts[1].status, 'EVIDENCE_FOUND');
  assert.equal(verdicts[1].id, '2');
});

test('Confluence 404 & error cache lock: suppresses cached snapshot when page is deleted or inaccessible', async () => {
  const storeMap = new Map();
  const mockStore = {
    get: async k => storeMap.get(k) || null,
    set: async (k, v) => { storeMap.set(k, v); return true; },
    delete: async k => storeMap.delete(k)
  };

  const cacheKey = buildCacheKey({
    accountId: 'usr-1',
    issueKey: 'PLAT-100',
    pageId: '123',
    pullRequestUrl: 'https://bitbucket.org/team/repo/pull-requests/1'
  });
  await saveCachedSnapshot(mockStore, cacheKey, {
    cachedAt: new Date().toISOString(),
    pageId: '123',
    pageVersion: 1,
    summary: { total: 1, inScopeTotal: 1, evidenceFound: 1, potentialMissing: 0, insufficientContext: 0, outOfScope: 0, coverageRatio: 1.0 },
    verdicts: [{ id: '1', requirementText: 'Req 1', status: 'EVIDENCE_FOUND' }]
  });

  // 1. loadIssueContext with 404 error
  const ctx = await loadIssueContext(
    { accountId: 'usr-1', siteUrl: 'https://test.atlassian.net', issueKey: 'PLAT-100', pageId: '123', pullRequestUrl: 'https://bitbucket.org/team/repo/pull-requests/1' },
    {
      loadLinks: async () => ({
        pages: [{ pageId: '123', title: 'Spec', site: 'https://test.atlassian.net' }],
        pullRequests: [{ workspace: 'team', repository: 'repo', pullRequestId: '1', url: 'https://bitbucket.org/team/repo/pull-requests/1' }]
      }),
      loadPage: async () => { throw new Error('Confluence page not found or not accessible.'); },
      store: mockStore
    }
  );
  assert.equal(ctx.cachedAnalysis, null);
  assert.match(ctx.pageError, /not found/i);

  // 2. analyzeLinkedPullRequest fails closed on 404 rather than returning stale cached snapshot
  await assert.rejects(
    () => analyzeLinkedPullRequest(
      { accountId: 'usr-1', siteUrl: 'https://test.atlassian.net', issueKey: 'PLAT-100', pageId: '123', pullRequestUrl: 'https://bitbucket.org/team/repo/pull-requests/1', forceRefresh: false },
      {
        loadLinks: async () => ({
          pages: [{ pageId: '123', title: 'Spec', site: 'https://test.atlassian.net' }],
          pullRequests: [{ workspace: 'team', repository: 'repo', pullRequestId: '1', url: 'https://bitbucket.org/team/repo/pull-requests/1' }]
        }),
        loadPage: async () => { throw new Error('Confluence page not found or not accessible.'); },
        store: mockStore
      }
    ),
    /not found|not accessible/i
  );

  // 3. verifyIssueSpecForRovo fails closed on 404 with NOT_FOUND code
  const rovoResult = await verifyIssueSpecForRovo(
    { issueKey: 'PLAT-100' },
    { accountId: 'usr-1' },
    {
      getRuntimeAccountId: () => 'usr-1',
      hasBitbucketAuth: async () => false,
      loadLinks: async () => ({
        pages: [{ pageId: '123', title: 'Spec', site: 'https://test.atlassian.net' }],
        pullRequests: [{ workspace: 'team', repository: 'repo', pullRequestId: '1', url: 'https://bitbucket.org/team/repo/pull-requests/1' }]
      }),
      loadPage: async () => { throw new Error('Confluence page not found or not accessible.'); },
      store: mockStore
    }
  );
  assert.equal(rovoResult.ok, false);
  assert.equal(rovoResult.code, 'NOT_FOUND');
});

test('Gate storage failure invalidates stale gate to prevent lingering PASS', async () => {
  const storeMap = new Map();
  let failGateSet = false;
  const mockStore = {
    get: async k => storeMap.get(k) || null,
    set: async (k, v) => {
      if (failGateSet && k.startsWith('trace:gate:v1:')) return false;
      storeMap.set(k, v);
      return true;
    },
    delete: async k => {
      storeMap.delete(k);
      return true;
    }
  };

  const gateKey = buildIssueGateKey({ issueKey: 'PLAT-200' });
  await saveIssueGateSummary(mockStore, gateKey, {
    issueKey: 'PLAT-200',
    summary: { total: 1, inScopeTotal: 1, evidenceFound: 1, potentialMissing: 0, insufficientContext: 0, outOfScope: 0, coverageRatio: 1.0 }
  });
  assert.equal(storeMap.has(gateKey), true);

  // Trigger new verification with failing gate write
  failGateSet = true;
  const testPr = { workspace: 'team', repository: 'repo', pullRequestId: '2', url: 'https://bitbucket.org/team/repo/pull-requests/2' };
  const res = await analyzeLinkedPullRequest(
    { accountId: 'usr-2', siteUrl: 'https://test.atlassian.net', issueKey: 'PLAT-200', pageId: '200', pullRequestUrl: testPr.url, forceRefresh: true },
    {
      loadLinks: async () => ({
        pages: [{ pageId: '200', title: 'Spec', site: 'https://test.atlassian.net' }],
        pullRequests: [testPr]
      }),
      loadPage: async () => ({ pageId: '200', pageVersion: 1, requirements: ['Req 1'] }),
      connect: async () => async () => new Response('diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -0,0 +1 @@\n+line\n'),
      connectJson: async () => async () => new Response(JSON.stringify({
        title: 'PR #2',
        state: 'OPEN',
        source: { branch: { name: 'feat' }, commit: { hash: 'abc1234' } },
        destination: { branch: { name: 'main' } }
      })),
      chat: async () => ({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              verdicts: [{ id: '1', status: 'POTENTIAL_MISSING', reasoning: 'Missing' }]
            })
          }
        }]
      }),
      store: mockStore
    }
  );

  assert.equal(res.issueGate, null);
  // Stale gate in storeMap was invalidated/deleted
  assert.equal(storeMap.has(gateKey), false);
});

test('Workflow validator fail-closed on missing live PR headCommit or Confluence pageVersion', async () => {
  const storeMap = new Map();
  const mockStore = {
    get: async k => storeMap.get(k) || null,
    set: async (k, v) => { storeMap.set(k, v); return true; }
  };

  const gateKey = buildIssueGateKey({ issueKey: 'PLAT-300' });
  await saveIssueGateSummary(mockStore, gateKey, {
    issueKey: 'PLAT-300',
    pageId: '300',
    pageVersion: 2,
    pullRequestUrl: 'https://bitbucket.org/team/repo/pull-requests/3',
    headCommit: 'aaa1111',
    summary: {
      total: 2,
      inScopeTotal: 2,
      evidenceFound: 2,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 0,
      coverageRatio: 1.0,
      incompleteBatchCount: 0
    }
  });

  // Case 1: loadPrMeta returns null or no headCommit
  const prResult = await validateIssueTransition(
    { issue: { key: 'PLAT-300' } },
    {
      store: mockStore,
      loadLinks: async () => ({
        pages: [{ pageId: '300', site: null }],
        pullRequests: [{ url: 'https://bitbucket.org/team/repo/pull-requests/3' }]
      }),
      loadPage: async () => ({ pageVersion: 2 }),
      loadPrMeta: async () => null // PR metadata unresolvable
    }
  );
  assert.equal(prResult.result, false);
  assert.match(prResult.errorMessage, /unable to resolve live Bitbucket pull request head commit/i);

  // Case 2: loadPage returns null or no pageVersion
  const pageResult = await validateIssueTransition(
    { issue: { key: 'PLAT-300' } },
    {
      store: mockStore,
      loadLinks: async () => ({
        pages: [{ pageId: '300', site: null }],
        pullRequests: [{ url: 'https://bitbucket.org/team/repo/pull-requests/3' }]
      }),
      loadPage: async () => ({ pageVersion: null }),
      loadPrMeta: async () => ({ headCommit: 'aaa1111' })
    }
  );
  assert.equal(pageResult.result, false);
  assert.match(pageResult.errorMessage, /unable to verify live Confluence page version/i);
});

test('Frontend badge metric invariant: blocks display on inconsistent summary numbers', () => {
  const badMetricsGate = {
    summary: {
      total: 5,
      inScopeTotal: 4,
      outOfScope: 2,
      evidenceFound: 4,
      potentialMissing: 0,
      insufficientContext: 0
    }
  };
  const badge = formatWorkflowGateBadge(badMetricsGate);
  assert.equal(badge.appearance, 'removed');
  assert.equal(badge.label, 'Workflow Gate: BLOCKED (Invalid Metrics)');
});
