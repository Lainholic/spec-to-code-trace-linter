import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChanges } from '../src/analysis.mjs';

const diff = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -0,0 +1 @@\n+sendEmail();\n';
const response = verdicts => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdicts }) } }] });

test('analyzes requirements, computes summary & diffHash, and rejects invented citations', async () => {
  const result = await analyzeChanges(['Send email', 'Log action'], diff, async () => response([
    { id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Call present', citation: { path: 'a.js', line: 1, text: 'sendEmail();' } },
    { id: '2', status: 'EVIDENCE_FOUND', reasoning: 'Claim', citation: { path: 'a.js', line: 2, text: 'log();' } }
  ]));
  assert.deepEqual(result.verdicts.map(v => v.status), ['EVIDENCE_FOUND', 'POTENTIAL_MISSING']);
  assert.equal(result.summary.evidenceFound, 1);
  assert.equal(result.summary.potentialMissing, 1);
  assert.equal(result.summary.insufficientContext, 0);
  assert.equal(result.summary.coverageRatio, 0.5);
  assert.equal(typeof result.diffHash, 'string');
  assert.equal(result.diffHash.length, 64);
});

test('strips oversized lockfiles >100 KB so real source code still analyzes cleanly', async () => {
  const giantLockfile = [
    'diff --git a/package-lock.json b/package-lock.json',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '@@ -0,0 +1 @@',
    '+' + 'x'.repeat(140000)
  ].join('\n');
  const mixedDiff = `${giantLockfile}\n${diff}`;
  let promptPayload = null;
  const result = await analyzeChanges(['Send email'], mixedDiff, async req => {
    promptPayload = JSON.parse(req.messages[1].content);
    return response([{ id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Found', citation: { path: 'a.js', line: 1, text: 'sendEmail();' } }]);
  });
  assert.deepEqual(result.excludedFiles, ['package-lock.json']);
  assert.ok(!promptPayload.diff.includes('package-lock.json'));
  assert.equal(result.verdicts[0].status, 'EVIDENCE_FOUND');
});

test('does not call AI for unsupported, all-noise, or oversized source inputs', async () => {
  let called = false;
  const chat = async () => { called = true; };
  const hugeSourceDiff = 'diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n@@ -0,0 +1 @@\n+' + 'a'.repeat(100005);
  const onlyLockDiff = 'diff --git a/yarn.lock b/yarn.lock\n--- a/yarn.lock\n+++ b/yarn.lock\n@@ -0,0 +1 @@\n+integrity sha512\n';

  await assert.rejects(analyzeChanges(['Requirement'], hugeSourceDiff, chat), /100 KB/);
  await assert.rejects(analyzeChanges(['Requirement'], onlyLockDiff, chat), /lockfile/);
  await assert.rejects(analyzeChanges(['Requirement'], 'not a diff', chat), /No supported/);
  assert.equal(called, false);
});

test('rejects incomplete and malformed AI responses', async () => {
  await assert.rejects(analyzeChanges(['Requirement'], diff, async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })), /incomplete/);
  await assert.rejects(analyzeChanges(['Requirement'], diff, async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'invalid' } }] })), /JSON/);
});

test('accepts documented Forge text blocks, markdown code fences, and surrounding prose', async () => {
  const fenced = '```json\n{"verdicts":[{"id":"1","status":"EVIDENCE_FOUND","reasoning":"Found call.","citation":{"path":"a.js","line":1,"text":"sendEmail();"}}]}\n```';
  const r1 = await analyzeChanges(['Send email'], diff, async () => ({ choices: [{ finish_reason: 'end_turn', message: { content: [{ type: 'text', text: fenced }] } }] }));
  assert.equal(r1.verdicts[0].status, 'EVIDENCE_FOUND');

  const prose = 'Here is the analysis:\n{"verdicts":[{"id":"1","status":"OUT_OF_SCOPE","reasoning":"Runtime check."}]}\nEnd of report.';
  const r2 = await analyzeChanges(['Latency SLA'], diff, async () => ({ choices: [{ finish_reason: 'stop', message: { content: prose } }] }));
  assert.equal(r2.verdicts[0].status, 'OUT_OF_SCOPE');
});

test('analyzes >110 KB multi-file source PRs via relevance hunk budgeting and discloses omitted files', async () => {
  const fixtureBody = Array.from({ length: 1500 }, (_, idx) => `+  const row_${idx} = "${'z'.repeat(65)}";`).join('\n');
  const multiFileLargeDiff = [
    'diff --git a/tests/fixtures/mockData.ts b/tests/fixtures/mockData.ts',
    '--- a/tests/fixtures/mockData.ts',
    '+++ b/tests/fixtures/mockData.ts',
    '@@ -0,0 +1,1500 @@',
    fixtureBody,
    'diff --git a/src/billing/reconcile.ts b/src/billing/reconcile.ts',
    '--- a/src/billing/reconcile.ts',
    '+++ b/src/billing/reconcile.ts',
    '@@ -9,1 +9,3 @@',
    ' export async function reconcileInvoices() {',
    '+  const delta = computeInvoiceDiscrepancy();',
    '+  return persistAuditRecord(delta);'
  ].join('\n');

  let receivedUserPayload = null;
  const result = await analyzeChanges(
    ['Compute invoice discrepancy and persist audit record'],
    multiFileLargeDiff,
    async req => {
      receivedUserPayload = JSON.parse(req.messages[1].content);
      return response([
        {
          id: '1',
          status: 'EVIDENCE_FOUND',
          reasoning: 'Computes discrepancy and persists audit record.',
          citation: { path: 'src/billing/reconcile.ts', line: 10, text: '  const delta = computeInvoiceDiscrepancy();' }
        }
      ]);
    }
  );

  assert.equal(result.wasBudgeted, true);
  assert.deepEqual(result.omittedFiles, ['tests/fixtures/mockData.ts']);
  assert.deepEqual(receivedUserPayload.omittedFiles, ['tests/fixtures/mockData.ts']);
  assert.equal(result.verdicts[0].status, 'EVIDENCE_FOUND');
  assert.equal(result.verdicts[0].citation.line, 10);
});

test('shards 12 requirements into 3 parallel 4-item batches and isolates batch IDs cleanly within Forge 25s budget', async () => {
  const twelveReqs = Array.from({ length: 12 }, (_, idx) => `Requirement #${idx + 1}: validate business rule ${idx + 1}`);
  const batchSizes = [];
  const res = await analyzeChanges(twelveReqs, diff, async req => {
    const payload = JSON.parse(req.messages[1].content);
    batchSizes.push(payload.requirements.length);
    return response(
      payload.requirements.map(item =>
        item.id === '1'
          ? { id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Found sendEmail call.', citation: { path: 'a.js', line: 1, text: 'sendEmail();' } }
          : { id: item.id, status: 'POTENTIAL_MISSING', reasoning: 'No matching logic in diff.' }
      )
    );
  });

  assert.deepEqual(batchSizes, [4, 4, 4]);
  assert.equal(res.summary.total, 12);
  assert.equal(res.summary.inScopeTotal, 12);
  assert.equal(res.summary.evidenceFound, 1);
  assert.equal(res.summary.potentialMissing, 11);
});

test('analyzes deletion-only PRs and verifies removed-line citations without false errors', async () => {
  const deletionOnlyDiff = [
    'diff --git a/src/auth/md5Fallback.js b/src/auth/md5Fallback.js',
    'deleted file mode 100644',
    '--- a/src/auth/md5Fallback.js',
    '+++ /dev/null',
    '@@ -5,3 +0,0 @@',
    '-export function allowInsecureMd5Auth() {',
    '-  return true;',
    '-}'
  ].join('\n');

  const res = await analyzeChanges(
    ['Remove insecure MD5 authentication fallback'],
    deletionOnlyDiff,
    async () => response([
      {
        id: '1',
        status: 'EVIDENCE_FOUND',
        reasoning: 'Deleted allowInsecureMd5Auth implementation.',
        citation: { path: 'src/auth/md5Fallback.js', line: 5, text: 'export function allowInsecureMd5Auth() {' }
      }
    ])
  );

  assert.equal(res.verdicts[0].status, 'EVIDENCE_FOUND');
  assert.equal(res.verdicts[0].citation.changeType, 'deleted');
  assert.equal(res.verdicts[0].citation.line, 5);
});

test('recovers gracefully from partial batch failures, preserving successful batches while marking failed batches as INSUFFICIENT_CONTEXT', async () => {
  const sixReqs = ['Req 1', 'Req 2', 'Req 3', 'Req 4', 'Req 5', 'Req 6'];
  let callCount = 0;

  const res = await analyzeChanges(sixReqs, diff, async req => {
    callCount++;
    if (callCount === 2) {
      throw new Error('Upstream LLM 504 Gateway Timeout');
    }
    const payload = JSON.parse(req.messages[1].content);
    return response(
      payload.requirements.map(item => ({
        id: item.id,
        status: 'EVIDENCE_FOUND',
        reasoning: 'Found in batch 1.',
        citation: { path: 'a.js', line: 1, text: 'sendEmail();' }
      }))
    );
  });

  assert.equal(res.summary.total, 6);
  assert.equal(res.verdicts[0].status, 'EVIDENCE_FOUND');
  assert.equal(res.verdicts[1].status, 'EVIDENCE_FOUND');
  assert.equal(res.verdicts[2].status, 'EVIDENCE_FOUND');
  assert.equal(res.verdicts[3].status, 'EVIDENCE_FOUND');
  // Batch 2 (Req 5, Req 6) gracefully downgraded to INSUFFICIENT_CONTEXT instead of blowing up the whole analysis
  assert.equal(res.verdicts[4].status, 'INSUFFICIENT_CONTEXT');
  assert.equal(res.verdicts[5].status, 'INSUFFICIENT_CONTEXT');
  assert.equal(res.summary.evidenceFound, 4);
  assert.equal(res.summary.insufficientContext, 2);
  assert.equal(res.incompleteBatchCount, 1);
  assert.equal(res.summary.incompleteBatchCount, 1);
  assert.equal(res.recoveredErrors.length, 1);
  assert.deepEqual(res.changedFiles, ['a.js']);
});

test('parses AI responses with trailing commas gracefully', async () => {
  const rawWithTrailingComma = `
  {
    "verdicts": [
      {
        "id": "1",
        "status": "EVIDENCE_FOUND",
        "reasoning": "Call present",
        "citation": { "path": "a.js", "line": 1, "text": "sendEmail();" },
      },
    ],
  }
  `;
  const res = await analyzeChanges(['Send email'], diff, async () => ({
    choices: [{ finish_reason: 'stop', message: { content: rawWithTrailingComma } }]
  }));
  assert.equal(res.verdicts[0].status, 'EVIDENCE_FOUND');
  assert.equal(res.verdicts[0].citation.text, 'sendEmail();');
});
