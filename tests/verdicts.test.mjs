import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeVerdicts, validateVerdicts } from '../src/verdicts.mjs';

test('accepts only evidence that exactly matches an added line', () => {
  const line = { path: 'src/mail.js', line: 7, text: 'sendEmail();' };
  const candidate = { id: '1', status: 'EVIDENCE_FOUND', reasoning: 'Call found', citation: line };
  assert.deepEqual(validateVerdicts(['Send email'], [candidate], [line]), [
    { ...candidate, requirementText: 'Send email' }
  ]);
  assert.equal(validateVerdicts(['Send email'], [{ ...candidate, citation: { ...line, line: 8 } }], [line])[0].status, 'POTENTIAL_MISSING');
});

test('retains verified delegation citations on INSUFFICIENT_CONTEXT and strips unverified optional citations', () => {
  const line = { path: 'src/handler.ts', line: 12, text: 'return delegateAuditPolicy(event);' };
  const verifiedDelegation = validateVerdicts(
    ['Enforce audit retention policy'],
    [{ id: '1', status: 'INSUFFICIENT_CONTEXT', reasoning: 'Delegated to delegateAuditPolicy outside diff.', citation: line }],
    [line]
  );
  assert.deepEqual(verifiedDelegation, [{
    id: '1',
    requirementText: 'Enforce audit retention policy',
    status: 'INSUFFICIENT_CONTEXT',
    reasoning: 'Delegated to delegateAuditPolicy outside diff.',
    citation: line
  }]);

  const unverifiedDelegation = validateVerdicts(
    ['Enforce audit retention policy'],
    [{ id: '1', status: 'INSUFFICIENT_CONTEXT', reasoning: 'Delegated elsewhere.', citation: { path: 'src/handler.ts', line: 99, text: 'fake()' } }],
    [line]
  );
  assert.deepEqual(unverifiedDelegation, [{
    id: '1',
    requirementText: 'Enforce audit retention policy',
    status: 'INSUFFICIENT_CONTEXT',
    reasoning: 'Delegated elsewhere.'
  }]);
});

test('retains every source requirement when results are missing, duplicated, or malformed', () => {
  const result = validateVerdicts(['One', 'Two', 'Three', 'Four'], [
    { id: '1', status: 'POTENTIAL_MISSING', reasoning: 'No evidence in diff', requirementText: 'altered' },
    { id: '2', status: 'OUT_OF_SCOPE', reasoning: 'Needs runtime' },
    { id: '2', status: 'EVIDENCE_FOUND', reasoning: 'Duplicate' },
    { id: '3', status: 'EVIDENCE_FOUND', reasoning: 'No citation' },
    { id: '5', status: 'OUT_OF_SCOPE', reasoning: 'Unknown' }
  ], []);
  assert.deepEqual(result.map(x => x.requirementText), ['One', 'Two', 'Three', 'Four']);
  assert.deepEqual(result.map(x => x.status), ['POTENTIAL_MISSING', 'INSUFFICIENT_CONTEXT', 'POTENTIAL_MISSING', 'INSUFFICIENT_CONTEXT']);
});

test('rejects invalid statuses and empty explanations and computes deterministic coverage summary', () => {
  const results = validateVerdicts(['A', 'B'], [
    { id: '1', status: 'PASS', reasoning: 'Done' },
    { id: '2', status: 'OUT_OF_SCOPE', reasoning: ' ' }
  ], []);
  assert.ok(results.every(x => x.status === 'INSUFFICIENT_CONTEXT'));

  const summary = summarizeVerdicts([
    { status: 'EVIDENCE_FOUND' },
    { status: 'EVIDENCE_FOUND' },
    { status: 'POTENTIAL_MISSING' },
    { status: 'INSUFFICIENT_CONTEXT' },
    { status: 'OUT_OF_SCOPE' }
  ]);
  assert.deepEqual(summary, {
    total: 5,
    evidenceFound: 2,
    potentialMissing: 1,
    insufficientContext: 1,
    outOfScope: 1,
    inScopeTotal: 4,
    coverageRatio: 0.5
  });

  assert.equal(summarizeVerdicts([{ status: 'OUT_OF_SCOPE' }]).coverageRatio, 0);
});

test('reclassifies bogus OUT_OF_SCOPE excuses on functional code requirements to POTENTIAL_MISSING while keeping genuine runtime SLAs OUT_OF_SCOPE', () => {
  const results = validateVerdicts(
    [
      'Calculate daily conversion rate from checkout events',
      'Synchronize customer counts across databases',
      'Sustain p99 response latency below 150ms under load test'
    ],
    [
      { id: '1', status: 'OUT_OF_SCOPE', reasoning: 'This PR only touches sales.js, so conversion rate is out of scope.' },
      { id: '2', status: 'OUT_OF_SCOPE', reasoning: 'Not modified in the current pull request.' },
      { id: '3', status: 'OUT_OF_SCOPE', reasoning: 'Runtime load SLA cannot be verified from a static code diff.' }
    ],
    []
  );
  assert.deepEqual(results.map(r => r.status), [
    'POTENTIAL_MISSING',
    'POTENTIAL_MISSING',
    'OUT_OF_SCOPE'
  ]);
  const summary = summarizeVerdicts(results);
  assert.equal(summary.inScopeTotal, 2);
  assert.equal(summary.potentialMissing, 2);
  assert.equal(summary.outOfScope, 1);
});

test('accepts indentation-trimmed and deleted-line citations at exact line numbers and enriches clean diff context', () => {
  const diff = [
    'diff --git a/webhookAuth.js b/webhookAuth.js',
    '--- a/webhookAuth.js',
    '+++ b/webhookAuth.js',
    '@@ -1,3 +1,6 @@',
    '-export function allowInsecureMd5Auth(token) {',
    '-  return md5(token);',
    '-}',
    '+export function verifyWebhookSignature(payload, sig, secret) {',
    '+  return hmacSha256(payload, secret) === sig;',
    '+}',
    '+export function enforceRateLimit(rpm) {',
    '+  if (rpm > 100) return { status: 429 };',
    '+}'
  ].join('\n');
  const allChangedLines = [
    { path: 'webhookAuth.js', line: 1, text: 'export function allowInsecureMd5Auth(token) {', changeType: 'deleted' },
    { path: 'webhookAuth.js', line: 5, text: '  if (rpm > 100) return { status: 429 };' }
  ];

  const verdicts = validateVerdicts(
    [
      'Remove deprecated allowInsecureMd5Auth function',
      'Reject >100 rpm with HTTP 429'
    ],
    [
      {
        id: '1',
        status: 'EVIDENCE_FOUND',
        reasoning: 'Removed deprecated MD5 function.',
        citation: { path: 'webhookAuth.js', line: 1, text: 'export function allowInsecureMd5Auth(token) {' }
      },
      {
        id: '2',
        status: 'EVIDENCE_FOUND',
        reasoning: 'Returns HTTP 429 above 100 rpm.',
        citation: { path: 'webhookAuth.js', line: 5, text: 'if (rpm > 100) return { status: 429 };' }
      }
    ],
    allChangedLines,
    diff
  );

  assert.equal(verdicts[0].status, 'EVIDENCE_FOUND');
  assert.equal(verdicts[0].citation.changeType, 'deleted');
  assert.equal(verdicts[1].status, 'EVIDENCE_FOUND');
  assert.equal(verdicts[1].citation.text, '  if (rpm > 100) return { status: 429 };');
  assert.equal(verdicts[1].citation.highlightLine, 3);
});

test('prevents code-implementable monitoring and latency metric requirements from being falsely marked OUT_OF_SCOPE', () => {
  const results = validateVerdicts(
    [
      'Record latency metric on each request',
      'Emit p99 histogram to statsd'
    ],
    [
      { id: '1', status: 'OUT_OF_SCOPE', reasoning: 'Mentions latency so out of scope.' },
      { id: '2', status: 'OUT_OF_SCOPE', reasoning: 'Histogram is out of scope.' }
    ],
    []
  );
  assert.deepEqual(results.map(r => r.status), ['POTENTIAL_MISSING', 'POTENTIAL_MISSING']);
});

test('prevents security and auth code requirements from being falsely marked OUT_OF_SCOPE even if reasoning claims runtime SLA', () => {
  const results = validateVerdicts(
    [
      'Reject unauthenticated requests with HTTP 401 Unauthorized',
      'Validate HMAC-SHA256 signature in X-Signature-256 header'
    ],
    [
      { id: '1', status: 'OUT_OF_SCOPE', reasoning: 'Runtime check cannot be verified statically.' },
      { id: '2', status: 'OUT_OF_SCOPE', reasoning: 'Security SLA cannot be proven from diff.' }
    ],
    []
  );
  assert.deepEqual(results.map(r => r.status), ['POTENTIAL_MISSING', 'POTENTIAL_MISSING']);
});
