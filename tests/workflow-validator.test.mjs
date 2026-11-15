import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueGateKey, saveIssueGateSummary } from '../src/cache-store.mjs';
import { saveProjectSettings } from '../src/project-settings.mjs';
import { validateIssueTransition } from '../src/workflow-validator.mjs';

function createMemoryStore() {
  const map = new Map();
  return {
    raw: map,
    get: async k => map.get(k),
    set: async (k, v) => { map.set(k, v); }
  };
}

test('blocks Jira workflow transition when verification has not been run or flags Potential Missing criteria, and passes when clean', async () => {
  const store = createMemoryStore();

  const unverified = await validateIssueTransition({ issue: { key: 'PLAT-33510' } }, { store });
  assert.equal(unverified.result, false);
  assert.match(unverified.errorMessage, /Verify Requirements/);

  const gateKey = buildIssueGateKey({ issueKey: 'PLAT-33510' });
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33510',
    verifiedAt: '2026-11-12T04:15:00.000Z',
    pageId: '2293824',
    pageVersion: 4,
    pullRequestUrl: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1',
    headCommit: 'ea49e103cae8',
    summary: {
      total: 12,
      inScopeTotal: 12,
      evidenceFound: 10,
      potentialMissing: 2,
      insufficientContext: 0,
      outOfScope: 0,
      coverageRatio: 0.8333
    }
  });

  // Verify privacy-safe zero-content storage invariant
  const storedRaw = JSON.stringify(store.raw.get(gateKey));
  assert.ok(!storedRaw.includes('requirementText'));
  assert.ok(!storedRaw.includes('snippet'));

  const blockedMissing = await validateIssueTransition({ issue: { key: 'PLAT-33510' } }, { store });
  assert.equal(blockedMissing.result, false);
  assert.match(blockedMissing.errorMessage, /2 requirement\(s\) are still flagged as Potential Missing/);

  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33510',
    verifiedAt: '2026-11-12T04:20:00.000Z',
    pageId: '2293824',
    pageVersion: 4,
    pullRequestUrl: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1',
    headCommit: 'fb92c1100999',
    summary: {
      total: 12,
      inScopeTotal: 12,
      evidenceFound: 11,
      potentialMissing: 0,
      insufficientContext: 1,
      outOfScope: 0,
      coverageRatio: 0.9167
    }
  });

  const allowed = await validateIssueTransition({ issue: { key: 'PLAT-33510' } }, { store });
  assert.deepEqual(allowed, { result: true });

  // Live drift guard #1: Confluence spec bumped from v4 -> v5 after PASS gate was recorded
  const blockedStaleSpec = await validateIssueTransition(
    { issue: { key: 'PLAT-33510' } },
    {
      store,
      loadLinks: async () => ({
        pages: [{ pageId: '2293824', site: 'https://one-atlas-hebl.atlassian.net', title: 'Audit compliance' }],
        pullRequests: [{ url: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1' }]
      }),
      loadPage: async () => ({ pageId: '2293824', pageVersion: 5 })
    }
  );
  assert.equal(blockedStaleSpec.result, false);
  assert.match(blockedStaleSpec.errorMessage, /updated from v4 to v5/);

  // Live drift guard #2: Verified PR was unlinked or swapped on the Jira issue
  const blockedSwappedPr = await validateIssueTransition(
    { issue: { key: 'PLAT-33510' } },
    {
      store,
      loadLinks: async () => ({
        pages: [{ pageId: '2293824', site: 'https://one-atlas-hebl.atlassian.net', title: 'Audit compliance' }],
        pullRequests: [{ url: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/99' }]
      }),
      loadPage: async () => ({ pageId: '2293824', pageVersion: 4 })
    }
  );
  assert.equal(blockedSwappedPr.result, false);
  assert.match(blockedSwappedPr.errorMessage, /no longer linked/);

  // Live guard passes when links and Confluence pageVersion match the verified gate record
  const allowedLive = await validateIssueTransition(
    { issue: { key: 'PLAT-33510' } },
    {
      store,
      loadLinks: async () => ({
        pages: [{ pageId: '2293824', site: 'https://one-atlas-hebl.atlassian.net', title: 'Audit compliance' }],
        pullRequests: [{ url: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1' }]
      }),
      loadPage: async () => ({ pageId: '2293824', pageVersion: 4 })
    }
  );
  assert.deepEqual(allowedLive, { result: true });
});

test('validateIssueTransition fails closed on batch timeouts, zero verified evidence, and live API errors', async () => {
  const store = createMemoryStore();
  const gateKey = buildIssueGateKey({ issueKey: 'PLAT-33520' });
  const baseLinks = {
    pages: [{ pageId: '5111809', site: 'https://one-atlas-hebl.atlassian.net', title: 'E2E Spec' }],
    pullRequests: [{ url: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/2' }]
  };

  // 1. Partial batch timeout must block transition even when potentialMissing === 0
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33520',
    verifiedAt: '2026-11-14T02:00:00.000Z',
    pageId: '5111809',
    pageVersion: 2,
    pullRequestUrl: baseLinks.pullRequests[0].url,
    summary: {
      total: 8,
      inScopeTotal: 8,
      evidenceFound: 4,
      potentialMissing: 0,
      insufficientContext: 4,
      outOfScope: 0,
      coverageRatio: 0.5,
      incompleteBatchCount: 1
    }
  });
  const blockedIncomplete = await validateIssueTransition({ issue: { key: 'PLAT-33520' } }, { store });
  assert.equal(blockedIncomplete.result, false);
  assert.match(blockedIncomplete.errorMessage, /timed out or failed/);

  // 2. Zero verified in-scope evidence must block transition even when potentialMissing === 0
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33520',
    verifiedAt: '2026-11-14T02:05:00.000Z',
    pageId: '5111809',
    pageVersion: 2,
    pullRequestUrl: baseLinks.pullRequests[0].url,
    summary: {
      total: 4,
      inScopeTotal: 4,
      evidenceFound: 0,
      potentialMissing: 0,
      insufficientContext: 4,
      outOfScope: 0,
      coverageRatio: 0,
      incompleteBatchCount: 0
    }
  });
  const blockedZeroEvidence = await validateIssueTransition({ issue: { key: 'PLAT-33520' } }, { store });
  assert.equal(blockedZeroEvidence.result, false);
  assert.match(blockedZeroEvidence.errorMessage, /0\/4 in-scope criteria/);

  // 3. Valid PASS gate still fails closed if live Jira links or Confluence page fetch fails or violates siteOrigin
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33520',
    verifiedAt: '2026-11-14T02:10:00.000Z',
    pageId: '5111809',
    pageVersion: 2,
    pullRequestUrl: baseLinks.pullRequests[0].url,
    summary: {
      total: 3,
      inScopeTotal: 3,
      evidenceFound: 3,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 0,
      coverageRatio: 1,
      incompleteBatchCount: 0
    }
  });

  const linksErr = await validateIssueTransition({ issue: { key: 'PLAT-33520' } }, {
    store,
    loadLinks: async () => { throw new Error('Jira 503'); }
  });
  assert.equal(linksErr.result, false);
  assert.match(linksErr.errorMessage, /link integrity/i);

  const pageErr = await validateIssueTransition({ issue: { key: 'PLAT-33520' } }, {
    store,
    loadLinks: async () => baseLinks,
    loadPage: async () => { throw new Error('Confluence 404 deleted'); }
  });
  assert.equal(pageErr.result, false);
  assert.match(pageErr.errorMessage, /could not load linked Confluence/i);

  const crossSiteBlocked = await validateIssueTransition({ issue: { key: 'PLAT-33520' } }, {
    store,
    siteOrigin: 'https://other-tenant.atlassian.net',
    loadLinks: async () => baseLinks,
    loadPage: async () => ({ pageId: '5111809', pageVersion: 2 })
  });
  assert.equal(crossSiteBlocked.result, false);
  assert.match(crossSiteBlocked.errorMessage, /not linked/i);
});

test('validateIssueTransition rejects malformed metrics, all-out-of-scope, low coverage, and PR commit drift', async () => {
  const store = createMemoryStore();
  const gateKey = buildIssueGateKey({ issueKey: 'PLAT-33530' });

  // 1. Malformed non-numeric or negative values
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33530',
    verifiedAt: '2026-11-14T03:00:00.000Z',
    pageId: '5111809',
    summary: {
      total: 5,
      inScopeTotal: NaN,
      evidenceFound: 5,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 0,
      incompleteBatchCount: 0
    }
  });
  const malformed = await validateIssueTransition({ issue: { key: 'PLAT-33530' } }, { store });
  assert.equal(malformed.result, false);
  assert.match(malformed.errorMessage, /invalid, non-numeric, or empty/);

  // 2. All items classified out-of-scope (inScopeTotal === 0)
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33530',
    verifiedAt: '2026-11-14T03:05:00.000Z',
    pageId: '5111809',
    summary: {
      total: 4,
      inScopeTotal: 0,
      evidenceFound: 0,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 4,
      incompleteBatchCount: 0
    }
  });
  const allOos = await validateIssueTransition({ issue: { key: 'PLAT-33530' } }, { store });
  assert.equal(allOos.result, false);
  assert.match(allOos.errorMessage, /0 in-scope functional requirements/);

  // 3. Low coverage ratio (e.g. 1/10 verified, 9 Needs Context)
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33530',
    verifiedAt: '2026-11-14T03:10:00.000Z',
    pageId: '5111809',
    summary: {
      total: 10,
      inScopeTotal: 10,
      evidenceFound: 1,
      potentialMissing: 0,
      insufficientContext: 9,
      outOfScope: 0,
      incompleteBatchCount: 0
    }
  });
  const lowCoverage = await validateIssueTransition({ issue: { key: 'PLAT-33530' } }, { store });
  assert.equal(lowCoverage.result, false);
  assert.match(lowCoverage.errorMessage, /below required threshold/);

  // 4. Live PR commit drift
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33530',
    verifiedAt: '2026-11-14T03:15:00.000Z',
    pageId: '5111809',
    pageVersion: 1,
    pullRequestUrl: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1',
    headCommit: 'abcdef123456',
    summary: {
      total: 5,
      inScopeTotal: 5,
      evidenceFound: 5,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 0,
      incompleteBatchCount: 0
    }
  });
  const driftedCommit = await validateIssueTransition(
    { issue: { key: 'PLAT-33530' } },
    {
      store,
      loadLinks: async () => ({
        pages: [{ pageId: '5111809', site: 'https://one-atlas-hebl.atlassian.net' }],
        pullRequests: [{ url: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1' }]
      }),
      loadPage: async () => ({ pageId: '5111809', pageVersion: 1 }),
      loadPrMeta: async () => ({ headCommit: '999999abcdef' })
    }
  );
  assert.equal(driftedCommit.result, false);
  assert.match(driftedCommit.errorMessage, /pull request commit drifted from #abcdef1 to #999999a/);

  // 5. Inconsistent arithmetic invariants (total != inScope + outOfScope, etc.)
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33530',
    verifiedAt: '2026-11-14T03:20:00.000Z',
    pageId: '5111809',
    summary: {
      total: 1,
      inScopeTotal: 1,
      evidenceFound: 99,
      potentialMissing: 0,
      insufficientContext: 10,
      outOfScope: 0,
      incompleteBatchCount: 0
    }
  });
  const inconsistentCounts = await validateIssueTransition({ issue: { key: 'PLAT-33530' } }, { store });
  assert.equal(inconsistentCounts.result, false);
  assert.match(inconsistentCounts.errorMessage, /inconsistent criteria metrics/);

  // 6. Issue key mismatch (record belongs to another issue)
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-OTHER',
    verifiedAt: '2026-11-14T03:25:00.000Z',
    pageId: '5111809',
    summary: {
      total: 5,
      inScopeTotal: 5,
      evidenceFound: 5,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 0,
      incompleteBatchCount: 0
    }
  });
  const issueMismatch = await validateIssueTransition({ issue: { key: 'PLAT-33530' } }, { store });
  assert.equal(issueMismatch.result, false);
  assert.match(issueMismatch.errorMessage, /belongs to PLAT-OTHER/);

  // 7. Human-in-the-Loop Tech Lead approval gate
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33530',
    verifiedAt: '2026-11-14T03:30:00.000Z',
    pageId: '5111809',
    summary: {
      total: 5,
      inScopeTotal: 5,
      evidenceFound: 5,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 0,
      incompleteBatchCount: 0
    }
  });

  // Without lead sign-off when policy requires it -> BLOCKED
  const awaitingLead = await validateIssueTransition(
    { issue: { key: 'PLAT-33530' } },
    { store, requireLeadApproval: true }
  );
  assert.equal(awaitingLead.result, false);
  assert.match(awaitingLead.errorMessage, /requires Tech Lead sign-off/);

  // With verified lead sign-off -> ALLOWED
  await saveIssueGateSummary(store, gateKey, {
    issueKey: 'PLAT-33530',
    verifiedAt: '2026-11-14T03:35:00.000Z',
    pageId: '5111809',
    summary: {
      total: 5,
      inScopeTotal: 5,
      evidenceFound: 5,
      potentialMissing: 0,
      insufficientContext: 0,
      outOfScope: 0,
      incompleteBatchCount: 0
    },
    leadApproval: {
      approved: true,
      approvedBy: 'Alice (Staff Engineer)',
      approvedAt: '2026-11-14T03:35:00.000Z'
    }
  });

  const leadApproved = await validateIssueTransition(
    { issue: { key: 'PLAT-33530' } },
    { store, requireLeadApproval: true }
  );
  assert.equal(leadApproved.result, true);
  assert.equal(leadApproved.leadApproved, true);
  assert.equal(leadApproved.approvedBy, 'Alice (Staff Engineer)');
});

test('validateIssueTransition enforces per-project governance settings (workspace policy & coverage threshold)', async () => {
  const store = createMemoryStore();
  const issueKey = 'PROJ-100';
  const gateKey = buildIssueGateKey({ issueKey });

  await saveProjectSettings(store, 'PROJ', {
    allowedWorkspace: 'corp-team',
    minCoverageRatio: 0.90,
    strictResolution: true
  });

  // Case A: PR from unauthorized workspace
  await saveIssueGateSummary(store, gateKey, {
    issueKey,
    pageId: '100',
    pullRequestUrl: 'https://bitbucket.org/attacker-team/repo/pull-requests/1',
    summary: { total: 10, inScopeTotal: 10, evidenceFound: 9, potentialMissing: 0, insufficientContext: 1, outOfScope: 0 }
  });

  const resWorkspace = await validateIssueTransition({ issue: { key: issueKey } }, { store });
  assert.equal(resWorkspace.result, false);
  assert.match(resWorkspace.errorMessage, /workspace policy/i);

  // Case B: Authorized workspace but 80% coverage < 90% required (with non-strict project)
  await saveProjectSettings(store, 'PROJ', {
    allowedWorkspace: 'corp-team',
    minCoverageRatio: 0.90,
    strictResolution: false
  });

  await saveIssueGateSummary(store, gateKey, {
    issueKey,
    pageId: '100',
    pullRequestUrl: 'https://bitbucket.org/corp-team/repo/pull-requests/1',
    summary: { total: 10, inScopeTotal: 10, evidenceFound: 8, potentialMissing: 0, insufficientContext: 2, outOfScope: 0 }
  });

  const resCoverage = await validateIssueTransition({ issue: { key: issueKey } }, { store });
  assert.equal(resCoverage.result, false);
  assert.match(resCoverage.errorMessage, /below required threshold/i);

  // Case C: Strict mode blocks transition when insufficientContext > 0 even if ratio is high
  await saveProjectSettings(store, 'PROJ', {
    allowedWorkspace: 'corp-team',
    minCoverageRatio: 0.80,
    strictResolution: true
  });
  await saveIssueGateSummary(store, gateKey, {
    issueKey,
    pageId: '100',
    pullRequestUrl: 'https://bitbucket.org/corp-team/repo/pull-requests/1',
    summary: { total: 10, inScopeTotal: 10, evidenceFound: 9, potentialMissing: 0, insufficientContext: 1, outOfScope: 0 }
  });

  const resStrict = await validateIssueTransition({ issue: { key: issueKey } }, { store });
  assert.equal(resStrict.result, false);
  assert.match(resStrict.errorMessage, /Strict gate requires all in-scope criteria/i);

  // Case D: Truncated Confluence specification (>30 items) fails closed
  await saveIssueGateSummary(store, gateKey, {
    issueKey,
    pageId: '100',
    pullRequestUrl: 'https://bitbucket.org/corp-team/repo/pull-requests/1',
    wasTruncated: true,
    summary: { total: 30, inScopeTotal: 30, evidenceFound: 30, potentialMissing: 0, insufficientContext: 0, outOfScope: 0 }
  });
  const resTruncated = await validateIssueTransition({ issue: { key: issueKey } }, { store });
  assert.equal(resTruncated.result, false);
  assert.match(resTruncated.errorMessage, /truncated/i);

  // Case E: Mandatory tech lead approval blocks when unapproved, passes when signed
  await saveProjectSettings(store, 'PROJ', {
    allowedWorkspace: 'corp-team',
    minCoverageRatio: 0.80,
    strictResolution: false,
    requireLeadApproval: true
  });
  await saveIssueGateSummary(store, gateKey, {
    issueKey,
    pageId: '100',
    pullRequestUrl: 'https://bitbucket.org/corp-team/repo/pull-requests/1',
    summary: { total: 10, inScopeTotal: 10, evidenceFound: 10, potentialMissing: 0, insufficientContext: 0, outOfScope: 0 }
  });
  const resUnapproved = await validateIssueTransition({ issue: { key: issueKey } }, { store });
  assert.equal(resUnapproved.result, false);
  assert.match(resUnapproved.errorMessage, /Tech Lead sign-off/i);

  // When signed by Tech Lead, transition succeeds
  await saveIssueGateSummary(store, gateKey, {
    issueKey,
    pageId: '100',
    pullRequestUrl: 'https://bitbucket.org/corp-team/repo/pull-requests/1',
    leadApproval: { approved: true, approvedBy: 'lead-user-123' },
    summary: { total: 10, inScopeTotal: 10, evidenceFound: 10, potentialMissing: 0, insufficientContext: 0, outOfScope: 0 }
  });
  const resApproved = await validateIssueTransition({ issue: { key: issueKey } }, { store });
  assert.equal(resApproved.result, true);
  assert.equal(resApproved.leadApproved, true);
  assert.equal(resApproved.approvedBy, 'lead-user-123');
});
