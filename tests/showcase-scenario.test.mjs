import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirements } from '../src/adf-requirements.mjs';
import { analyzeChanges } from '../src/analysis.mjs';
import { computeDelta } from '../src/cache-store.mjs';
import { buildMarkdownReport } from '../src/frontend/view-model.mjs';
import { lintSpecification } from '../src/spec-linter.mjs';

const SHOWCASE_ADF = {
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Functional Requirements' }]
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ID' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Requirement' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Status' }] }] }
          ]
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'REQ-01' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reject export requests exceeding 10,000 records with HTTP 413.' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }] }
          ]
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'REQ-02' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sign outbound webhook payloads using HMAC-SHA256 in X-Signature-256 header.' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }] }
          ]
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'REQ-03' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Handle transient downstream webhook failures gracefully as needed.' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }] }
          ]
        }
      ]
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Acceptance Criteria' }]
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Audit Governance' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Persist an encrypted 3-year compliance audit record containing actorAccountId and ISO-8601 timestamp.' }] }]
                },
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Redact apiSecret and authorizationHeader fields before serializing audit payloads.' }] }]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      type: 'panel',
      attrs: { panelType: 'warning' },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Sustain p99 response latency below 150ms across 5,000 concurrent users during load test.' }]
        }
      ]
    }
  ]
};

const STAGE_1_DIFF = [
  'diff --git a/package-lock.json b/package-lock.json',
  '--- a/package-lock.json',
  '+++ b/package-lock.json',
  '@@ -1,2 +1,3 @@',
  ' {',
  '+  "lockfileVersion": 3,',
  '   "name": "webhook-export-service"',
  'diff --git a/src/export/webhook-exporter.ts b/src/export/webhook-exporter.ts',
  '--- a/src/export/webhook-exporter.ts',
  '+++ b/src/export/webhook-exporter.ts',
  '@@ -10,2 +10,16 @@',
  ' import { auditVault } from "../common/audit-vault";',
  ' ',
  '+export async function dispatchAuditExport(actorAccountId: string, records: Record<string, unknown>[], targetUrl: string) {',
  '+  if (records.length > 10000) {',
  '+    throw Object.assign(new Error("Payload Too Large"), { statusCode: 413 });',
  '+  }',
  '+  const sanitized = records.map(({ apiSecret, authorizationHeader, ...safe }) => safe);',
  '+  const body = JSON.stringify({ exportedAt: new Date().toISOString(), items: sanitized });',
  '+  await auditVault.archiveComplianceRecord({ actorAccountId, exportedAt: new Date().toISOString() });',
  '+  return fetch(targetUrl, {',
  '+    method: "POST",',
  '+    headers: { "Content-Type": "application/json" },',
  '+    body',
  '+  });',
  '+}',
  '+'
].join('\n');

const STAGE_2_DIFF = [
  'diff --git a/package-lock.json b/package-lock.json',
  '--- a/package-lock.json',
  '+++ b/package-lock.json',
  '@@ -1,2 +1,3 @@',
  ' {',
  '+  "lockfileVersion": 3,',
  '   "name": "webhook-export-service"',
  'diff --git a/src/export/webhook-exporter.ts b/src/export/webhook-exporter.ts',
  '--- a/src/export/webhook-exporter.ts',
  '+++ b/src/export/webhook-exporter.ts',
  '@@ -10,2 +10,18 @@',
  ' import { auditVault } from "../common/audit-vault";',
  '+import crypto from "node:crypto";',
  ' ',
  '+export async function dispatchAuditExport(actorAccountId: string, records: Record<string, unknown>[], targetUrl: string, secret: string) {',
  '+  if (records.length > 10000) {',
  '+    throw Object.assign(new Error("Payload Too Large"), { statusCode: 413 });',
  '+  }',
  '+  const sanitized = records.map(({ apiSecret, authorizationHeader, ...safe }) => safe);',
  '+  const body = JSON.stringify({ exportedAt: new Date().toISOString(), items: sanitized });',
  '+  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");',
  '+  await auditVault.archiveComplianceRecord({ actorAccountId, exportedAt: new Date().toISOString() });',
  '+  return fetch(targetUrl, {',
  '+    method: "POST",',
  '+    headers: { "Content-Type": "application/json", "X-Signature-256": `sha256=${sig}` },',
  '+    body',
  '+  });',
  '+}',
  '+'
].join('\n');

test('executes full multi-stage Codegeist showcase pipeline end-to-end', async () => {
  // 1. Multi-format ADF requirement extraction (Table + Nested Bullet List + Panel = 6 criteria, Status column skipped)
  const requirements = extractRequirements(SHOWCASE_ADF);
  assert.equal(requirements.length, 6);
  assert.equal(requirements[0], '[REQ-01] Reject export requests exceeding 10,000 records with HTTP 413.');
  assert.equal(requirements[3], 'Audit Governance: Persist an encrypted 3-year compliance audit record containing actorAccountId and ISO-8601 timestamp.');
  assert.match(requirements[5], /p99 response latency below 150ms/);

  // 2. Pre-code Spec Readiness Linter catches REQ-03 ambiguity & Warning Panel runtime SLA
  const specLint = await lintSpecification(requirements, async () => ({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          items: [
            { id: '1', status: 'TESTABLE', issue: 'Clear 10,000 record threshold and HTTP 413 status.', suggestedRewrite: null },
            { id: '2', status: 'TESTABLE', issue: 'Specifies HMAC-SHA256 and exact header name.', suggestedRewrite: null },
            {
              id: '3',
              status: 'AMBIGUOUS',
              issue: '"gracefully as needed" leaves retry count and status codes undefined.',
              suggestedRewrite: 'Retry HTTP 502, 503, and 504 webhook responses up to 3 times with exponential backoff (1s, 5s, 25s).'
            },
            { id: '4', status: 'TESTABLE', issue: 'Concrete fields and retention policy.', suggestedRewrite: null },
            { id: '5', status: 'TESTABLE', issue: 'Exact sensitive field names listed.', suggestedRewrite: null },
            {
              id: '6',
              status: 'UNVERIFIABLE_IN_DIFF',
              issue: 'p99 load test latency cannot be proven from a static code diff.',
              suggestedRewrite: 'Gate release on a CI k6 benchmark proving p99 < 150ms at 5,000 RPS.'
            }
          ]
        })
      }
    }]
  }));
  assert.equal(specLint.summary.testable, 4);
  assert.equal(specLint.summary.ambiguous, 1);
  assert.equal(specLint.summary.unverifiableInDiff, 1);

  // 3. Stage 1 PR Verification (excludes package-lock.json, verifies multi-line snippets & delegation citation)
  const stage1 = await analyzeChanges(requirements, STAGE_1_DIFF, async () => ({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          verdicts: [
            {
              id: '1',
              status: 'EVIDENCE_FOUND',
              reasoning: 'Throws HTTP 413 when records.length > 10000.',
              citation: {
                path: 'src/export/webhook-exporter.ts',
                line: 14,
                text: '    throw Object.assign(new Error("Payload Too Large"), { statusCode: 413 });'
              }
            },
            {
              id: '2',
              status: 'POTENTIAL_MISSING',
              reasoning: 'Outbound fetch sends Content-Type without computing or attaching X-Signature-256.'
            },
            {
              id: '3',
              status: 'POTENTIAL_MISSING',
              reasoning: 'No retry or transient error handling around fetch.'
            },
            {
              id: '4',
              status: 'INSUFFICIENT_CONTEXT',
              reasoning: 'Delegates compliance archiving to auditVault; 3-year encryption lives outside this diff.',
              citation: {
                path: 'src/export/webhook-exporter.ts',
                line: 18,
                text: '  await auditVault.archiveComplianceRecord({ actorAccountId, exportedAt: new Date().toISOString() });'
              }
            },
            {
              id: '5',
              status: 'EVIDENCE_FOUND',
              reasoning: 'Destructures and strips apiSecret and authorizationHeader before JSON serialization.',
              citation: {
                path: 'src/export/webhook-exporter.ts',
                line: 16,
                text: '  const sanitized = records.map(({ apiSecret, authorizationHeader, ...safe }) => safe);'
              }
            },
            {
              id: '6',
              status: 'OUT_OF_SCOPE',
              reasoning: 'Runtime p99 latency under 5,000 concurrent users requires load testing.'
            }
          ]
        })
      }
    }]
  }));

  assert.deepEqual(stage1.excludedFiles, ['package-lock.json']);
  assert.equal(stage1.summary.evidenceFound, 2);
  assert.equal(stage1.summary.potentialMissing, 2);
  assert.equal(stage1.summary.insufficientContext, 1);
  assert.equal(stage1.summary.outOfScope, 1);
  assert.equal(stage1.summary.inScopeTotal, 5);
  assert.equal(stage1.verdicts[0].citation.highlightLine, 3);
  assert.ok(stage1.verdicts[0].citation.snippet.includes('if (records.length > 10000)'));
  assert.equal(stage1.verdicts[3].citation.line, 18); // Delegation citation preserved!

  // 4. Stage 2 PR Re-verification after HMAC fix -> Delta Transition POTENTIAL_MISSING -> EVIDENCE_FOUND!
  const stage2 = await analyzeChanges(requirements, STAGE_2_DIFF, async () => ({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          verdicts: [
            {
              id: '1',
              status: 'EVIDENCE_FOUND',
              reasoning: 'Throws HTTP 413 when records.length > 10000.',
              citation: {
                path: 'src/export/webhook-exporter.ts',
                line: 15,
                text: '    throw Object.assign(new Error("Payload Too Large"), { statusCode: 413 });'
              }
            },
            {
              id: '2',
              status: 'EVIDENCE_FOUND',
              reasoning: 'Computes HMAC-SHA256 digest and sets X-Signature-256 header.',
              citation: {
                path: 'src/export/webhook-exporter.ts',
                line: 23,
                text: '    headers: { "Content-Type": "application/json", "X-Signature-256": `sha256=${sig}` },'
              }
            },
            {
              id: '3',
              status: 'POTENTIAL_MISSING',
              reasoning: 'No retry logic around fetch.'
            },
            {
              id: '4',
              status: 'INSUFFICIENT_CONTEXT',
              reasoning: 'Delegates compliance archiving to auditVault.',
              citation: {
                path: 'src/export/webhook-exporter.ts',
                line: 20,
                text: '  await auditVault.archiveComplianceRecord({ actorAccountId, exportedAt: new Date().toISOString() });'
              }
            },
            {
              id: '5',
              status: 'EVIDENCE_FOUND',
              reasoning: 'Strips apiSecret and authorizationHeader before JSON serialization.',
              citation: {
                path: 'src/export/webhook-exporter.ts',
                line: 17,
                text: '  const sanitized = records.map(({ apiSecret, authorizationHeader, ...safe }) => safe);'
              }
            },
            {
              id: '6',
              status: 'OUT_OF_SCOPE',
              reasoning: 'Runtime p99 load SLA.'
            }
          ]
        })
      }
    }]
  }));

  const delta = computeDelta(
    { verdicts: stage1.verdicts, pageVersion: 1, diffHash: stage1.diffHash, cachedAt: '2026-11-12T04:00:00.000Z' },
    { verdicts: stage2.verdicts, pageVersion: 1, diffHash: stage2.diffHash }
  );

  assert.equal(delta.diffChanged, true);
  assert.equal(delta.resolvedCount, 1);
  assert.equal(delta.regressedCount, 0);
  assert.deepEqual(delta.transitions['2'], {
    fromStatus: 'POTENTIAL_MISSING',
    toStatus: 'EVIDENCE_FOUND',
    direction: 'resolved'
  });

  const report = buildMarkdownReport({
    issueKey: 'PLAT-33510',
    pageTitle: 'Webhook Delivery & Audit Export v1.0',
    pageVersion: 1,
    pullRequestUrl: 'https://bitbucket.org/synapse-codegeist/trace-integration-test/pull-requests/1',
    summary: stage2.summary,
    verdicts: stage2.verdicts
  });
  assert.match(report, /Verified Coverage\*\*: 3 \/ 5 in-scope criteria \(60%\)/);
  assert.equal(report.includes('~'.repeat(2)), false);
});
