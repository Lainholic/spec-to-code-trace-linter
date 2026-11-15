import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLinkedPullRequest, loadIssueContext } from '../src/linked-analysis.mjs';

const pr = { workspace: 'team', repository: 'repo', pullRequestId: '42', url: 'https://bitbucket.org/team/repo/pull-requests/42' };
const diff1 = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -0,0 +1 @@\n+placeholder();\n';
const diff2 = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -0,0 +1 @@\n+sendEmail();\n';
const input = { accountId: 'user-1', issueKey: 'TEST-1', pageId: '12', pullRequestUrl: pr.url };

function createMemoryStore() {
  const data = new Map();
  return {
    get: async k => data.get(k),
    set: async (k, v) => { data.set(k, v); }
  };
}

test('connects linked issue, page, PR diff, caches per user, restores manually loaded page on reload, and computes delta on forceRefresh', async () => {
  const store = createMemoryStore();
  let llmCalls = 0;
  let activeDiff = diff1;

  const deps = {
    loadLinks: async key => {
      assert.equal(key, 'TEST-1');
      // Simulate PLAT-33510 where Bitbucket PR is linked and Confluence page was entered manually (pages: [])
      return { pages: [], pullRequests: [pr] };
    },
    loadPage: async id => {
      assert.equal(id, '12');
      return { pageId: '12', title: 'Spec', pageVersion: 1, requirements: ['Send email'] };
    },
    connect: async () => async path => {
      assert.match(path, /pullrequests\/42\/diff$/);
      return new Response(activeDiff);
    },
    chat: async () => {
      llmCalls++;
      const verdicts = llmCalls === 1
        ? [{ id: '1', status: 'POTENTIAL_MISSING', reasoning: 'No email call yet.' }]
        : [{ id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Added sendEmail call.', citation: { path: 'a.js', line: 1, text: 'sendEmail();' } }];
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdicts }) } }] };
    },
    store,
    now: () => `2026-11-12T03:00:0${llmCalls}.000Z`
  };

  const first = await analyzeLinkedPullRequest(input, deps);
  assert.equal(first.fromCache, false);
  assert.equal(first.verdicts[0].status, 'POTENTIAL_MISSING');
  assert.equal(llmCalls, 1);

  // On browser reload with zero remote Confluence links, user-1 immediately gets page 12 + cachedAnalysis hydrated!
  const reloadedUserContext = await loadIssueContext(
    { accountId: 'user-1', siteUrl: 'https://one.atlassian.net', issueKey: 'TEST-1' },
    deps
  );
  assert.equal(reloadedUserContext.selectedPageId, '12');
  assert.ok(reloadedUserContext.cachedAnalysis);
  assert.equal(reloadedUserContext.cachedAnalysis.verdicts[0].status, 'POTENTIAL_MISSING');

  // user-2 does NOT see user-1's selection or cache!
  const otherUserContext = await loadIssueContext(
    { accountId: 'user-2', siteUrl: 'https://one.atlassian.net', issueKey: 'TEST-1' },
    deps
  );
  assert.equal(otherUserContext.selectedPageId, null);
  assert.equal(otherUserContext.cachedAnalysis, null);

  activeDiff = diff2;
  const refreshed = await analyzeLinkedPullRequest({ ...input, forceRefresh: true }, deps);
  assert.equal(refreshed.fromCache, false);
  assert.equal(refreshed.verdicts[0].status, 'EVIDENCE_FOUND');
  assert.equal(refreshed.delta.resolvedCount, 1);
  assert.deepEqual(refreshed.delta.transitions['1'], {
    fromStatus: 'POTENTIAL_MISSING',
    toStatus: 'EVIDENCE_FOUND',
    direction: 'resolved'
  });
});

test('rejects unlinked PRs before connecting to Bitbucket or calling AI', async () => {
  let called = false;
  await assert.rejects(analyzeLinkedPullRequest(input, {
    loadLinks: async () => ({ pages: [], pullRequests: [] }),
    connect: async () => { called = true; },
    chat: async () => { called = true; }
  }), /not linked/);
  assert.equal(called, false);
});

test('persists Bitbucket PR headCommit and detects stale cached snapshots when spec version or PR commit drifts', async () => {
  const store = createMemoryStore();
  let livePageVersion = 2;
  let liveHeadCommit = 'abc1234567890';

  const deps = {
    loadLinks: async () => ({
      pages: [{ pageId: '12', site: 'https://one.atlassian.net', title: 'Spec' }],
      pullRequests: [pr]
    }),
    loadPage: async () => ({
      pageId: '12',
      title: 'Spec',
      pageVersion: livePageVersion,
      extractionMode: 'explicit',
      requirements: ['Send email']
    }),
    hasBitbucketAuth: async () => true,
    connect: async () => async () => new Response(diff2),
    connectJson: async () => async () => new Response(JSON.stringify({
      title: 'PR #42',
      state: 'OPEN',
      source: { branch: { name: 'feat/email' }, commit: { hash: liveHeadCommit } },
      destination: { branch: { name: 'main' } }
    })),
    chat: async () => ({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            verdicts: [{ id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Found.', citation: { path: 'a.js', line: 1, text: 'sendEmail();' } }]
          })
        }
      }]
    }),
    store,
    now: () => '2026-11-12T04:00:00.000Z'
  };

  const analyzed = await analyzeLinkedPullRequest(input, deps);
  assert.equal(analyzed.headCommit, 'abc1234567890');
  assert.equal(analyzed.prMeta.state, 'OPEN');

  const freshCtx = await loadIssueContext({ accountId: 'user-1', siteUrl: 'https://one.atlassian.net', issueKey: 'TEST-1' }, deps);
  assert.equal(freshCtx.staleness.isStale, false);

  livePageVersion = 3;
  liveHeadCommit = 'def9876543210';
  const driftedCtx = await loadIssueContext({ accountId: 'user-1', siteUrl: 'https://one.atlassian.net', issueKey: 'TEST-1' }, deps);
  assert.equal(driftedCtx.staleness.isStale, true);
  assert.equal(driftedCtx.staleness.specOutdated, true);
  assert.equal(driftedCtx.staleness.prOutdated, true);
  assert.equal(driftedCtx.staleness.cachedPageVersion, 2);
  assert.equal(driftedCtx.staleness.livePageVersion, 3);
  assert.equal(driftedCtx.staleness.cachedHeadCommit, 'abc1234567890');
  assert.equal(driftedCtx.staleness.liveHeadCommit, 'def9876543210');
});

test('protects issue workflow gate from poisoning when verifying against an unlinked manual Confluence page', async () => {
  const store = createMemoryStore();
  const deps = {
    loadLinks: async () => ({
      pages: [{ pageId: '12', site: 'https://one.atlassian.net', title: 'Official Linked Spec' }],
      pullRequests: [pr]
    }),
    loadPage: async id => (
      id === '12'
        ? { pageId: '12', title: 'Official Linked Spec', pageVersion: 2, requirements: ['Verify HMAC', 'Enforce TLS'] }
        : { pageId: '999', title: 'Personal Scratch Page', pageVersion: 1, requirements: ['Placeholder check'] }
    ),
    connect: async () => async () => new Response(diff2),
    chat: async req => {
      const payload = JSON.parse(req.messages[1].content);
      if (payload.requirements.length === 2) {
        return {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                verdicts: [
                  { id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Found.', citation: { path: 'a.js', line: 1, text: 'sendEmail();' } },
                  { id: '2', status: 'POTENTIAL_MISSING', reasoning: 'Missing TLS.' }
                ]
              })
            }
          }]
        };
      }
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              verdicts: [
                { id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Found.', citation: { path: 'a.js', line: 1, text: 'sendEmail();' } }
              ]
            })
          }
        }]
      };
    },
    store,
    now: () => '2026-11-12T08:00:00.000Z'
  };

  // Official linked page 12 records BLOCKED (1 Missing) in trace:gate:v1
  const officialRes = await analyzeLinkedPullRequest(input, deps);
  assert.equal(officialRes.gateSkippedUnlinkedPage, false);
  assert.equal(officialRes.issueGate.summary.potentialMissing, 1);

  // Unlinked manual page 999 returns 0 Missing for personal snapshot, but MUST NOT overwrite trace:gate:v1!
  const unlinkedRes = await analyzeLinkedPullRequest({ ...input, pageId: '999', forceRefresh: true }, deps);
  assert.equal(unlinkedRes.gateSkippedUnlinkedPage, true);
  assert.equal(unlinkedRes.summary.potentialMissing, 0);
  assert.equal(unlinkedRes.issueGate.pageId, '12');
  assert.equal(unlinkedRes.issueGate.summary.potentialMissing, 1);

  // Cross-site page 12 when siteUrl is another tenant must also NOT update trace:gate:v1!
  const crossSiteRes = await analyzeLinkedPullRequest({
    ...input,
    siteUrl: 'https://other-tenant.atlassian.net',
    forceRefresh: true
  }, deps);
  assert.equal(crossSiteRes.gateSkippedUnlinkedPage, true);
  assert.equal(crossSiteRes.issueGate.summary.potentialMissing, 1);
});

test('suppresses cached analysis when Confluence spec access is denied (401/403)', async () => {
  const store = createMemoryStore();
  const page = { pageId: '12', site: 'https://one.atlassian.net', title: 'Restricted Spec' };
  const testPr = {
    workspace: 'team',
    repository: 'repo',
    pullRequestId: '42',
    url: 'https://bitbucket.org/team/repo/pull-requests/42'
  };
  const input = {
    accountId: 'user-revoked',
    siteUrl: 'https://one.atlassian.net',
    issueKey: 'SEC-100',
    pageId: '12',
    pullRequestUrl: testPr.url
  };

  const deps = {
    loadLinks: async () => ({ pages: [page], pullRequests: [testPr] }),
    loadPage: async () => ({
      pageId: '12',
      title: 'Restricted Spec',
      pageVersion: 1,
      extractionMode: 'explicit',
      requirements: ['Private API token']
    }),
    hasBitbucketAuth: async () => true,
    connect: async () => async () => new Response('diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -0,0 +1 @@\n+const token = 1;\n'),
    connectJson: async () => async () => new Response(JSON.stringify({
      title: 'PR #1',
      state: 'OPEN',
      source: { branch: { name: 'feat' }, commit: { hash: '123' } },
      destination: { branch: { name: 'main' } }
    })),
    chat: async () => ({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            verdicts: [{ id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Found token.', citation: { path: 'a.js', line: 1, text: 'const token = 1;' } }]
          })
        }
      }]
    }),
    store,
    now: () => '2026-11-14T00:00:00.000Z'
  };

  // Initially user had access and cached analysis was created
  const analyzed = await analyzeLinkedPullRequest(input, deps);
  assert.equal(analyzed.summary.evidenceFound, 1);

  // Now user's Confluence access is revoked (403 Forbidden)
  const forbiddenDeps = {
    ...deps,
    loadPage: async () => {
      const err = new Error('Confluence returned 403 Forbidden');
      err.status = 403;
      throw err;
    }
  };

  const context = await loadIssueContext(input, forbiddenDeps);
  // Cached analysis must NOT be disclosed when Confluence access is forbidden
  assert.equal(context.cachedAnalysis, null);
  assert.equal(context.accessDenied, true);
});
