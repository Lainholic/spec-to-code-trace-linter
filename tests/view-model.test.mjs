import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBitbucketFileUrl,
  buildDeltaBanner,
  buildLintTabItems,
  buildMarkdownReport,
  buildStalenessBanner,
  buildTabItems,
  formatCitationLocation,
  formatShortCommit,
  formatTimestamp,
  formatTransitionBadge,
  formatWorkflowGateBadge,
  getLintStatusMeta,
  getPrStateLozenge,
  getStatusMeta,
  inferCodeLanguage
} from '../src/frontend/view-model.mjs';

test('maps verdict statuses to semantic Lozenge appearances and filters tabs accurately', () => {
  assert.equal(getStatusMeta('EVIDENCE_FOUND').lozengeAppearance, 'success');
  assert.equal(getStatusMeta('POTENTIAL_MISSING').lozengeAppearance, 'removed');
  assert.equal(getStatusMeta('INSUFFICIENT_CONTEXT').lozengeAppearance, 'moved');
  assert.equal(getStatusMeta('OUT_OF_SCOPE').lozengeAppearance, 'default');

  const verdicts = [
    { id: '1', status: 'POTENTIAL_MISSING' },
    { id: '2', status: 'EVIDENCE_FOUND' },
    { id: '3', status: 'EVIDENCE_FOUND' },
    { id: '4', status: 'INSUFFICIENT_CONTEXT' }
  ];
  const tabs = buildTabItems(verdicts);
  assert.deepEqual(tabs.map(t => [t.key, t.count]), [
    ['ALL', 4],
    ['POTENTIAL_MISSING', 1],
    ['EVIDENCE_FOUND', 2],
    ['INSUFFICIENT_CONTEXT', 1],
    ['OUT_OF_SCOPE', 0]
  ]);
});

test('builds resolved, regressed, and unchanged delta banners and transition badges', () => {
  const resolvedBanner = buildDeltaBanner({ resolvedCount: 2, regressedCount: 0, changedCount: 2, pageVersionChanged: true });
  assert.equal(resolvedBanner.appearance, 'success');
  assert.match(resolvedBanner.title, /2 previously flagged/);
  assert.match(resolvedBanner.title, /Confluence spec version updated/);

  const regressedBanner = buildDeltaBanner({ resolvedCount: 1, regressedCount: 1, changedCount: 2, pageVersionChanged: false });
  assert.equal(regressedBanner.appearance, 'warning');

  const unchangedBanner = buildDeltaBanner({ resolvedCount: 0, regressedCount: 0, changedCount: 0, diffChanged: false, pageVersionChanged: false });
  assert.equal(unchangedBanner.appearance, 'information');

  assert.deepEqual(
    formatTransitionBadge({ fromStatus: 'POTENTIAL_MISSING', toStatus: 'EVIDENCE_FOUND', direction: 'resolved' }),
    { appearance: 'new', text: 'RESOLVED: MISSING RISK -> FOUND' }
  );
  assert.deepEqual(
    formatTransitionBadge({ fromStatus: 'EVIDENCE_FOUND', toStatus: 'POTENTIAL_MISSING', direction: 'regressed' }),
    { appearance: 'removed', text: 'REGRESSED: FOUND -> MISSING RISK' }
  );
});

test('infers CodeBlock languages and formats ISO timestamps cleanly', () => {
  assert.equal(inferCodeLanguage('src/auth/verify.ts'), 'typescript');
  assert.equal(inferCodeLanguage('Dockerfile'), 'dockerfile');
  assert.equal(inferCodeLanguage(''), 'text');
  assert.equal(formatTimestamp('2026-11-12T03:15:00.000Z'), '2026-11-12 03:15 UTC');
});

test('builds Bitbucket file-anchor deep links, lint tabs, and strikethrough-free Markdown review reports', () => {
  assert.equal(
    buildBitbucketFileUrl('https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1', 'src/webhook/verify.ts'),
    'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1#chg-src/webhook/verify.ts'
  );
  assert.equal(buildBitbucketFileUrl('https://evil.example.com/pr/1', 'src/a.ts'), null);

  assert.equal(
    formatCitationLocation({ path: 'src/a.ts', line: 42, startLine: 40, endLine: 44 }),
    'src/a.ts:42 (L40-L44)'
  );
  assert.equal(
    formatCitationLocation({ path: 'src/legacy.ts', line: 12, startLine: 11, endLine: 13, changeType: 'deleted' }),
    'src/legacy.ts:12 (L11-L13) (removed)'
  );

  assert.equal(getLintStatusMeta('AMBIGUOUS').lozengeAppearance, 'removed');
  const lintTabs = buildLintTabItems([
    { id: '1', status: 'TESTABLE' },
    { id: '2', status: 'AMBIGUOUS' }
  ]);
  assert.deepEqual(lintTabs.map(t => [t.key, t.count]), [
    ['ALL', 2],
    ['AMBIGUOUS', 1],
    ['UNVERIFIABLE_IN_DIFF', 0],
    ['TESTABLE', 1]
  ]);

  const md = buildMarkdownReport({
    issueKey: 'PLAT-33510',
    pageTitle: 'Webhook Export Spec',
    pageVersion: 4,
    pullRequestUrl: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1',
    summary: {
      total: 4,
      evidenceFound: 1,
      potentialMissing: 1,
      insufficientContext: 1,
      outOfScope: 1,
      inScopeTotal: 3,
      coverageRatio: 0.3333
    },
    verdicts: [
      {
        id: '1',
        requirementText: 'Verify X-Signature-256 HMAC header',
        status: 'EVIDENCE_FOUND',
        reasoning: 'Verified HMAC comparison.',
        citation: { path: 'src/webhook.ts', line: 42, text: 'verifyHmac()' }
      },
      {
        id: '2',
        requirementText: `Emit retry event ${'~'.repeat(2)}legacy${'~'.repeat(2)} on HTTP 503`,
        status: 'POTENTIAL_MISSING',
        reasoning: 'No retry event emitter found in diff.'
      },
      {
        id: '3',
        requirementText: 'Archive encrypted audit log for 3 years',
        status: 'INSUFFICIENT_CONTEXT',
        reasoning: 'Delegated to auditVault.archiveExport.',
        citation: { path: 'src/export.ts', line: 19, text: 'await auditVault.archiveExport(entry);' }
      },
      {
        id: '4',
        requirementText: 'Sustain p99 < 150ms at 5,000 RPS',
        status: 'OUT_OF_SCOPE',
        reasoning: 'Runtime load SLA cannot be verified statically.'
      }
    ]
  });

  assert.match(md, /## Spec-to-Code Trace Review Report/);
  assert.match(md, /Action Required — Potential Missing Criteria/);
  assert.match(md, /`src\/webhook\.ts:42`/);
  assert.match(md, /`src\/export\.ts:19`/);
  assert.equal(md.includes('~'.repeat(2)), false);

  assert.equal(formatShortCommit('ea49e103cae8deadbeef'), '#ea49e10');
  assert.deepEqual(getPrStateLozenge('OPEN'), { appearance: 'inprogress', label: 'PR OPEN' });
  assert.deepEqual(getPrStateLozenge('MERGED'), { appearance: 'success', label: 'PR MERGED' });

  const staleBanner = buildStalenessBanner({
    isStale: true,
    specOutdated: true,
    prOutdated: true,
    cachedPageVersion: 2,
    livePageVersion: 3,
    cachedHeadCommit: 'abc1234567',
    liveHeadCommit: 'def9876543'
  });
  assert.equal(staleBanner.appearance, 'warning');
  assert.match(staleBanner.body, /v2 to v3/);
  assert.match(staleBanner.body, /#abc1234 to #def9876/);

  assert.deepEqual(formatWorkflowGateBadge(null), { appearance: 'moved', label: 'Workflow Gate: UNVERIFIED' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 3 } }), { appearance: 'removed', label: 'Workflow Gate: BLOCKED (3 Missing)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, incompleteBatchCount: 1, inScopeTotal: 4, evidenceFound: 2 } }), { appearance: 'removed', label: 'Workflow Gate: INCOMPLETE (Re-verify)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 4, evidenceFound: 0 } }), { appearance: 'removed', label: 'Workflow Gate: BLOCKED (0 Verified)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 3, evidenceFound: 3 } }, { isStale: true, specOutdated: true }), { appearance: 'moved', label: 'Workflow Gate: STALE (Spec Updated)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 3, evidenceFound: 3 } }, { isStale: true, prOutdated: true }), { appearance: 'moved', label: 'Workflow Gate: STALE (New Commit)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 0 } }), { appearance: 'removed', label: 'Workflow Gate: BLOCKED (0 In-Scope)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 10, evidenceFound: 5 } }), { appearance: 'removed', label: 'Workflow Gate: BLOCKED (Low Coverage 50%)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 5, evidenceFound: 5 } }), { appearance: 'success', label: 'Workflow Gate: PASS (Ready)' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 5, evidenceFound: 5 } }, null, { requireLeadApproval: true }), { appearance: 'inprogress', label: 'Workflow Gate: AWAITING SIGN-OFF' });
  assert.deepEqual(formatWorkflowGateBadge({ summary: { potentialMissing: 0, inScopeTotal: 5, evidenceFound: 5 }, leadApproval: { approved: true, approvedBy: 'Lead Alice' } }, null, { requireLeadApproval: true }), { appearance: 'success', label: 'Workflow Gate: PASS (Signed by Lead Alice)' });
});
