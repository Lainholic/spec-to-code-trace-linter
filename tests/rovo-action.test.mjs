import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheKey, buildIssueSelectionKey, saveCachedSnapshot, saveLastIssueSelection } from '../src/cache-store.mjs';
import { lintSpecForRovo, suggestFixForRovo, verifyIssueSpecForRovo } from '../src/rovo-action.mjs';

const pr = { workspace: 'team', repository: 'repo', pullRequestId: '1', url: 'https://bitbucket.org/team/repo/pull-requests/1' };
const diff = 'diff --git a/src/audit.ts b/src/audit.ts\n--- a/src/audit.ts\n+++ b/src/audit.ts\n@@ -0,0 +1 @@\n+recordAudit();\n';

function createMemoryStore() {
  const data = new Map();
  return {
    get: async k => data.get(k),
    set: async (k, v) => { data.set(k, v); }
  };
}

test('auto-selects linked Confluence spec and Bitbucket PR for Rovo and returns grounded verdicts', async () => {
  const res = await verifyIssueSpecForRovo(
    { issueKey: 'plat-33510' },
    { accountId: 'acct-1', siteUrl: 'https://one-atlas-hebl.atlassian.net' },
    {
      loadLinks: async key => {
        assert.equal(key, 'PLAT-33510');
        return {
          pages: [{ pageId: '2293824', site: 'https://one-atlas-hebl.atlassian.net', title: 'Audit compliance' }],
          pullRequests: [pr]
        };
      },
      loadPage: async id => ({
        pageId: id,
        title: 'Audit compliance',
        pageVersion: 5,
        requirements: ['Record audit event']
      }),
      hasBitbucketAuth: async () => true,
      connect: async () => async () => new Response(diff),
      chat: async () => ({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              verdicts: [{ id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Audit call added.', citation: { path: 'src/audit.ts', line: 1, text: 'recordAudit();' } }]
            })
          }
        }]
      }),
      store: null
    }
  );
  assert.equal(res.ok, true, `Result failed with: ${JSON.stringify(res)}`);
  assert.equal(res.issueKey, 'PLAT-33510');
  assert.equal(res.pageId, '2293824');
  assert.equal(res.summary.evidenceFound, 1);
  assert.equal(res.verdicts[0].citation.path, 'src/audit.ts');
});

test('serves verified per-user KVS snapshot via runtime aaid when Rovo lacks direct Bitbucket OAuth, and propagates NeedsAuthenticationError when uncached', async () => {
  const store = createMemoryStore();
  const selKey = buildIssueSelectionKey({ accountId: 'aaid-user-1', issueKey: 'PLAT-33510' });
  await saveLastIssueSelection(store, selKey, { pageId: '2293824', pullRequestUrl: pr.url });
  const cacheKey = buildCacheKey({ accountId: 'aaid-user-1', issueKey: 'PLAT-33510', pageId: '2293824', pullRequestUrl: pr.url });
  await saveCachedSnapshot(store, cacheKey, {
    cachedAt: '2026-11-12T04:00:00.000Z',
    issueKey: 'PLAT-33510',
    pageId: '2293824',
    pageTitle: 'Audit compliance',
    pageVersion: 1,
    pullRequestUrl: pr.url,
    diffHash: 'h1',
    excludedFiles: [],
    summary: { total: 12, evidenceFound: 1, potentialMissing: 8, insufficientContext: 2, outOfScope: 1, inScopeTotal: 11, coverageRatio: 0.0909 },
    verdicts: [{ id: '1', requirementText: 'Audit log', status: 'EVIDENCE_FOUND', reasoning: 'Verified' }]
  });

  const cachedRes = await verifyIssueSpecForRovo(
    { issueKey: 'PLAT-33510' },
    {}, // Rovo raw context without top-level accountId
    {
      getRuntimeAccountId: () => 'aaid-user-1',
      loadLinks: async () => ({ pages: [], pullRequests: [pr] }),
      loadPage: async () => ({ pageId: '2293824', title: 'Audit compliance', pageVersion: 2, requirements: ['Audit log'] }),
      hasBitbucketAuth: async () => false,
      store
    }
  );
  assert.equal(cachedRes.ok, true);
  assert.equal(cachedRes.fromCache, true);
  assert.equal(cachedRes.summary.evidenceFound, 1);
  assert.equal(cachedRes.staleness?.isStale, true);
  assert.equal(cachedRes.staleness?.specOutdated, true);
  assert.equal(cachedRes.staleness?.cachedPageVersion, 1);
  assert.equal(cachedRes.staleness?.livePageVersion, 2);

  // When no cached snapshot exists, NeedsAuthenticationError must propagate so Rovo renders its native Connect OAuth card!
  const authErr = Object.assign(new Error('Authentication Required'), { name: 'NeedsAuthenticationError', isExpectedError: true, serviceKey: 'bitbucket-oauth' });
  await assert.rejects(
    verifyIssueSpecForRovo(
      { issueKey: 'PLAT-33510' },
      {},
      {
        getRuntimeAccountId: () => 'aaid-user-2',
        loadLinks: async () => ({ pages: [{ pageId: '2293824', site: 'https://x.atlassian.net', title: 'Spec' }], pullRequests: [pr] }),
        loadPage: async () => ({ pageId: '2293824', title: 'Spec', requirements: ['Req'] }),
        hasBitbucketAuth: async () => false,
        connect: async () => { throw authErr; },
        store
      }
    ),
    err => err.name === 'NeedsAuthenticationError'
  );
});

test('returns structured diagnostic codes when issueKey or links are missing', async () => {
  const badKey = await verifyIssueSpecForRovo({ issueKey: 'invalid' }, {}, {});
  assert.equal(badKey.ok, false);
  assert.equal(badKey.code, 'MISSING_ISSUE_KEY');

  const noSpec = await verifyIssueSpecForRovo({ issueKey: 'PLAT-1' }, {}, {
    loadLinks: async () => ({ pages: [], pullRequests: [pr] })
  });
  assert.equal(noSpec.code, 'NO_LINKED_SPEC');

  const noPr = await verifyIssueSpecForRovo({ issueKey: 'PLAT-1' }, {}, {
    loadLinks: async () => ({ pages: [{ pageId: '10', site: 'https://x.atlassian.net', title: 'Spec' }], pullRequests: [] })
  });
  assert.equal(noPr.code, 'NO_LINKED_PR');
});

test('lintSpecForRovo audits Confluence spec via direct pageId or Jira issueKey linked/saved page', async () => {
  const store = createMemoryStore();
  const selKey = buildIssueSelectionKey({ accountId: 'acct-lint', issueKey: 'PLAT-33510' });
  await saveLastIssueSelection(store, selKey, { pageId: '2293824', pullRequestUrl: pr.url });

  const res = await lintSpecForRovo(
    { issueKey: 'plat-33510' },
    { accountId: 'acct-lint', siteUrl: 'https://one-atlas-hebl.atlassian.net' },
    {
      loadLinks: async () => ({ pages: [], pullRequests: [pr] }),
      loadPage: async id => ({
        pageId: id,
        title: 'Audit compliance',
        pageVersion: 4,
        webUrl: 'https://one-atlas-hebl.atlassian.net/wiki/pages/viewpage.action?pageId=2293824',
        requirements: ['Log every export quickly.']
      }),
      chat: async () => ({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              items: [{
                id: '1',
                status: 'AMBIGUOUS',
                issue: '"quickly" has no latency bound or schema.',
                suggestedRewrite: 'Write an immutable audit entry containing actorId and ISO-8601 timestamp synchronously before returning HTTP 200.'
              }]
            })
          }
        }]
      }),
      store
    }
  );

  assert.equal(res.ok, true, `Result failed with: ${JSON.stringify(res)}`);
  assert.equal(res.issueKey, 'PLAT-33510');
  assert.equal(res.pageId, '2293824');
  assert.equal(res.summary.ambiguous, 1);
  assert.match(res.items[0].suggestedRewrite, /ISO-8601/);

  const missingTarget = await lintSpecForRovo({}, {}, {});
  assert.equal(missingTarget.ok, false);
  assert.equal(missingTarget.code, 'MISSING_SPEC_TARGET');
});

test('suggestFixForRovo generates diff-grounded LLM remediation, repo-aware fallback, cross-site page filtering, and manual diff fixes', async () => {
  const store = createMemoryStore();
  const cacheKey = buildCacheKey({
    accountId: 'acct-fix',
    issueKey: 'PLAT-33510',
    pageId: '2293824',
    pullRequestUrl: pr.url
  });
  const tsDiff = [
    'diff --git a/src/webhook/hmac.ts b/src/webhook/hmac.ts',
    '--- a/src/webhook/hmac.ts',
    '+++ b/src/webhook/hmac.ts',
    '@@ -1,2 +1,4 @@',
    ' export function parseWebhook(raw: string) {',
    '+  return JSON.parse(raw);',
    ' }',
    'diff --git a/src/routes/inbound.ts b/src/routes/inbound.ts',
    '--- a/src/routes/inbound.ts',
    '+++ b/src/routes/inbound.ts',
    '@@ -1,2 +1,3 @@',
    '+export function handleInbound() { return 200; }'
  ].join('\n');

  await saveCachedSnapshot(store, cacheKey, {
    issueKey: 'PLAT-33510',
    pageId: '2293824',
    pullRequestUrl: pr.url,
    changedFiles: ['src/webhook/hmac.ts', 'src/routes/inbound.ts'],
    summary: { total: 2, evidenceFound: 1, potentialMissing: 1, inScopeTotal: 2, coverageRatio: 0.5 },
    verdicts: [
      {
        id: '1',
        status: 'EVIDENCE_FOUND',
        requirementText: 'Parse JSON webhook body safely',
        reasoning: 'Found in diff.',
        citation: { path: 'src/webhook/hmac.ts', line: 2, text: '  return JSON.parse(raw);' }
      },
      {
        id: '2',
        status: 'POTENTIAL_MISSING',
        requirementText: 'Verify HMAC SHA-256 webhook signature header on inbound requests',
        reasoning: 'No signature verification found.'
      }
    ]
  });

  // 1. Live diff-grounded @forge/llm remediation
  let receivedLlmPayload = null;
  const llmRes = await suggestFixForRovo(
    { issueKey: 'PLAT-33510', requirementId: '2' },
    { accountId: 'acct-fix', siteUrl: 'https://one-atlas-hebl.atlassian.net' },
    {
      store,
      loadLinks: async () => ({
        pages: [
          { pageId: '9999999', site: 'https://evil-tenant.atlassian.net', title: 'Other Tenant' },
          { pageId: '2293824', site: 'https://one-atlas-hebl.atlassian.net', title: 'Webhook Spec' }
        ],
        pullRequests: [pr]
      }),
      loadPage: async () => ({ requirements: [] }),
      hasBitbucketAuth: async () => true,
      connect: async () => async () => new Response(tsDiff),
      chat: async req => {
        receivedLlmPayload = JSON.parse(req.messages[1].content);
        return {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                targetFile: 'src/webhook/hmac.ts',
                testFile: 'tests/webhook/hmac.test.ts',
                rationale: 'Add constant-time HMAC SHA-256 signature verification into src/webhook/hmac.ts.',
                implementationScaffold: 'import crypto from "node:crypto";\nexport function verifyWebhookSignature(rawBody: string, headerSig: string, secret: string): boolean {\n  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");\n  return headerSig.length === expected.length && crypto.timingSafeEqual(Buffer.from(headerSig), Buffer.from(expected));\n}',
                unitTestScaffold: 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { verifyWebhookSignature } from "../../src/webhook/hmac";\n\ntest("rejects mismatched HMAC signature", async () => {\n  assert.equal(verifyWebhookSignature("{}", "bad", "sec"), false);\n});'
              })
            }
          }]
        };
      }
    }
  );

  assert.equal(llmRes.ok, true, `Result failed with: ${JSON.stringify(llmRes)}`);
  assert.equal(llmRes.issueKey, 'PLAT-33510');
  assert.equal(llmRes.requirementId, '2');
  assert.equal(llmRes.currentStatus, 'POTENTIAL_MISSING');
  assert.ok(receivedLlmPayload.diffExcerpt.includes('src/webhook/hmac.ts'));
  assert.ok(receivedLlmPayload.repoFiles.includes('src/webhook/hmac.ts'));
  assert.equal(llmRes.remediation.source, 'llm');
  assert.equal(llmRes.remediation.targetFile, 'src/webhook/hmac.ts');
  assert.equal(llmRes.remediation.testFile, 'tests/webhook/hmac.test.ts');
  assert.doesNotMatch(llmRes.remediation.implementationScaffold, /Not implemented/);
  assert.match(llmRes.remediation.nextStepGuide, /Re-verify/);

  // 2. Repo-aware fallback when LLM errors/times out: infers .ts target & uses awaited assertion (no pass-on-throw bug)
  const fallbackRes = await suggestFixForRovo(
    { issueKey: 'PLAT-33510', requirementId: '2' },
    { accountId: 'acct-fix', siteUrl: 'https://one-atlas-hebl.atlassian.net' },
    {
      store,
      loadLinks: async () => ({
        pages: [{ pageId: '2293824', site: 'https://one-atlas-hebl.atlassian.net' }],
        pullRequests: [pr]
      }),
      loadPage: async () => ({ requirements: [] }),
      chat: async () => { throw new Error('TIMEOUT_SUGGEST-FIX_15000MS'); }
    }
  );
  assert.equal(fallbackRes.ok, true);
  assert.equal(fallbackRes.remediation.source, 'fallback');
  assert.equal(fallbackRes.remediation.targetFile, 'src/webhook/hmac.ts');
  assert.equal(fallbackRes.remediation.testFile, 'tests/webhook/hmac.test.ts');
  assert.match(fallbackRes.remediation.unitTestScaffold, /await assert\.rejects\(/);
  assert.doesNotMatch(fallbackRes.remediation.implementationScaffold, /Not implemented/);

  // 3. Cross-site filter prevents reading foreign tenant Confluence pageId when context.siteUrl is present
  const crossSiteDenied = await suggestFixForRovo(
    { issueKey: 'PLAT-99999' },
    { accountId: 'acct-other', siteUrl: 'https://one-atlas-hebl.atlassian.net' },
    {
      store,
      loadLinks: async () => ({
        pages: [{ pageId: '777777', site: 'https://foreign.atlassian.net' }],
        pullRequests: []
      }),
      loadPage: async () => {
        throw new Error('Should not load cross-site Confluence page');
      }
    }
  );
  assert.equal(crossSiteDenied.ok, false);
  assert.equal(crossSiteDenied.code, 'REQUIREMENT_NOT_FOUND');

  // 4. Return ALREADY_IMPLEMENTED if requirement already has verified evidence
  const implementedRes = await suggestFixForRovo(
    { issueKey: 'PLAT-33510', requirementId: '1' },
    { accountId: 'acct-fix' },
    {
      store,
      loadLinks: async () => ({ pages: [{ pageId: '2293824' }], pullRequests: [pr] }),
      loadPage: async () => ({ requirements: [] })
    }
  );
  assert.equal(implementedRes.ok, true);
  assert.equal(implementedRes.currentStatus, 'EVIDENCE_FOUND');
  assert.equal(implementedRes.remediation.alreadyImplemented, true);

  // 5. Re-throws auth error properly
  const authErr = new Error('OAuth required');
  authErr.name = 'NeedsAuthenticationError';
  await assert.rejects(
    async () => suggestFixForRovo(
      { issueKey: 'PLAT-33510' },
      { accountId: 'acct-fix' },
      {
        store: null,
        loadLinks: async () => { throw authErr; }
      }
    ),
    err => err.name === 'NeedsAuthenticationError'
  );

  // 6. Manual diff payload works from Jira Issue Panel even without remote PR links
  const manualRes = await suggestFixForRovo(
    {
      issueKey: 'PLAT-33510',
      pageId: '2293824',
      requirementId: '3',
      requirementText: 'Enforce 60 req/min rate limit per tenant with HTTP 429',
      currentStatus: 'POTENTIAL_MISSING',
      diff: tsDiff
    },
    { accountId: 'acct-manual' },
    { store }
  );
  assert.equal(manualRes.ok, true);
  assert.equal(manualRes.requirementId, '3');
  assert.ok(manualRes.repoFiles.includes('src/webhook/hmac.ts'));

  // 7. Auto-targeting first missing requirement when requirementId is omitted
  const autoRes = await suggestFixForRovo(
    { issueKey: 'PLAT-33510' },
    { accountId: 'acct-fix' },
    {
      store,
      loadLinks: async () => ({ pages: [{ pageId: '2293824' }], pullRequests: [pr] }),
      loadPage: async () => ({ requirements: [] })
    }
  );
  assert.equal(autoRes.ok, true);
  assert.equal(autoRes.requirementId, '2');

  // 8. Rejects invalid issue key
  const invalidKey = await suggestFixForRovo({ issueKey: 'INVALID' }, {}, {});
  assert.equal(invalidKey.ok, false);
  assert.equal(invalidKey.code, 'MISSING_ISSUE_KEY');

  // 9. Fail-closed access denial protection (401/403)
  const accessDeniedRes = await suggestFixForRovo(
    { issueKey: 'PLAT-33510', pageId: '2293824' },
    { accountId: 'acct-fix' },
    {
      store,
      loadLinks: async () => ({ pages: [{ pageId: '2293824' }], pullRequests: [pr] }),
      loadPage: async () => {
        const err = new Error('403 Forbidden: User does not have access to this Confluence space.');
        throw err;
      }
    }
  );
  assert.equal(accessDeniedRes.ok, false);
  assert.equal(accessDeniedRes.code, 'ACCESS_DENIED');
});
