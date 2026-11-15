import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirements, extractRequirementsWithMeta } from '../src/adf-requirements.mjs';

const text = value => ({ type: 'text', text: value });
const paragraph = value => ({ type: 'paragraph', content: [text(value)] });
const heading = (value, level = 2) => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const item = value => ({ type: 'listItem', content: [paragraph(value)] });
const list = (...items) => ({ type: 'bulletList', content: items });
const headerCell = value => ({ type: 'tableHeader', content: [paragraph(value)] });
const dataCell = value => ({ type: 'tableCell', content: [paragraph(value)] });
const row = (...cells) => ({ type: 'tableRow', content: cells });
const table = (...rows) => ({ type: 'table', content: rows });
const panel = (panelType, ...content) => ({ type: 'panel', attrs: { panelType }, content });
const doc = (...content) => ({ type: 'doc', content });

test('extracts explicit criteria and stops at a peer or higher heading', () => {
  const result = extractRequirements(doc(
    list(item('Not a criterion')),
    heading('Acceptance Criteria:'),
    list(item('Send email'), item('Record audit')),
    heading('Notes'),
    list(item('Not a criterion'))
  ));
  assert.deepEqual(result, ['Send email', 'Record audit']);
});

test('handles nested lists, subheadings, English requirement headings, and task items', () => {
  const nested = item('Audit Logging:');
  nested.content.push(list(item('Capture actor ID'), item('Capture UTC timestamp')));
  const tasks = { type: 'taskList', content: [{ type: 'taskItem', content: [text('Verify retention policy')], attrs: { state: 'TODO' } }] };
  assert.deepEqual(
    extractRequirements(doc(heading('Functional Requirements'), list(nested), heading('Details', 3), tasks, heading('Appendix', 1), list(item('Ignored')))),
    ['Audit Logging: Capture actor ID', 'Audit Logging: Capture UTC timestamp', 'Verify retention policy']
  );
});

test('extracts structured rows from ADF tables and skips status-only columns and empty rows', () => {
  const reqTable = table(
    row(headerCell('ID'), headerCell('Requirement'), headerCell('Notes'), headerCell('Status')),
    row(dataCell('REQ-01'), dataCell('Reject expired JWT tokens'), dataCell('HTTP 401'), dataCell('In Progress')),
    row(dataCell(''), dataCell('   '), dataCell(''), dataCell('')),
    row(dataCell('REQ-02'), dataCell('Rotate refresh token on use'), dataCell(''), dataCell('Done'))
  );
  assert.deepEqual(
    extractRequirements(doc(heading('Requirements'), reqTable)),
    [
      '[REQ-01] Reject expired JWT tokens — Notes: HTTP 401',
      '[REQ-02] Rotate refresh token on use'
    ]
  );
});

test('extracts callout panels with lists or standalone requirement statements and deduplicates items', () => {
  const result = extractRequirements(doc(
    heading('Technical Requirements'),
    panel('info', list(item('Enforce TLS 1.3'), item('Enforce   TLS 1.3'))),
    panel('warning', paragraph('All admin mutations must write an immutable audit event.'))
  ));
  assert.deepEqual(result, [
    'Enforce TLS 1.3',
    'All admin mutations must write an immutable audit event.'
  ]);
});

test('does not infer requirements without a recognized English section', () => {
  assert.deepEqual(extractRequirements(doc(heading('Overview'), list(item('Example')))), []);
  assert.throws(() => extractRequirements({ type: 'paragraph' }), TypeError);
});

test('extracts only the list or table immediately following an explicit introduction paragraph', () => {
  const result = extractRequirements(doc(
    paragraph('Here are the functional requirements for this ticket:'),
    table(row(dataCell('AC-1'), dataCell('Validate webhook signature'))),
    paragraph('Other notes:'),
    list(item('Not a criterion')),
    paragraph('Acceptance criteria will be discussed later.'),
    list(item('Also not a criterion'))
  ));
  assert.deepEqual(result, ['[AC-1] Validate webhook signature']);
});

test('falls back to Tier-2 heuristic_prd mode for Business Rules, task checklists, and normative RFC-2119 rules while keeping non-spec pages empty', () => {
  const prdDoc = doc(
    heading('Background'),
    paragraph('Customers use webhooks to stream billing events to external ERPs.'),
    paragraph('Every incoming webhook delivery request MUST include an X-Signature-256 HMAC header.'),
    heading('Business Rules'),
    list(item('Idempotency keys expire after 24 hours')),
    heading('Rollout Notes'),
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { state: 'TODO' }, content: [text('Return HTTP 429 with Retry-After when tenant burst exceeds 200 req/s')] }
      ]
    }
  );

  const meta = extractRequirementsWithMeta(prdDoc);
  assert.equal(meta.extractionMode, 'heuristic_prd');
  assert.deepEqual(meta.requirements, [
    'Every incoming webhook delivery request MUST include an X-Signature-256 HMAC header.',
    'Idempotency keys expire after 24 hours',
    'Return HTTP 429 with Retry-After when tenant burst exceeds 200 req/s'
  ]);

  const nonSpec = extractRequirementsWithMeta(doc(heading('Meeting Notes'), paragraph('Acceptance criteria will be discussed next sprint.')));
  assert.equal(nonSpec.extractionMode, 'none');
  assert.deepEqual(nonSpec.requirements, []);
});

test('falls back to Tier-3 narrative_prd mode for plain narrative behavioral prose while ignoring background and questions', () => {
  const narrativeDoc = doc(
    heading('Background'),
    paragraph('When legacy billing ran weekly, support tickets increased.'),
    heading('Proposed Behavior'),
    paragraph(
      'When a customer cancels their subscription, the billing service revokes active API keys and sends a cancellation receipt email. ' +
      'Should we also post to Slack?'
    ),
    paragraph('The webhook handler rejects expired replay timestamps and logs the rejected request ID.')
  );

  const meta = extractRequirementsWithMeta(narrativeDoc);
  assert.equal(meta.extractionMode, 'narrative_prd');
  assert.deepEqual(meta.requirements, [
    'When a customer cancels their subscription, the billing service revokes active API keys and sends a cancellation receipt email.',
    'The webhook handler rejects expired replay timestamps and logs the rejected request ID.'
  ]);
});

test('extracts all narrative and HTTP/SLA clauses in order under Proposed Behavior without Tier-2 shadowing', () => {
  const mixedNarrativeDoc = doc(
    heading('Proposed Behavior'),
    paragraph('When an export request arrives, the webhook handler verifies the X-Signature-256 HMAC digest before processing.'),
    paragraph('The authentication module removes the deprecated allowInsecureMd5Auth function so legacy MD5 tokens cannot authenticate.'),
    paragraph('When a tenant exceeds 100 requests per minute, the rate limiter rejects the request with HTTP 429.'),
    paragraph('Sustain p99 latency under 150ms across 5,000 concurrent requests during regional load testing.')
  );

  const meta = extractRequirementsWithMeta(mixedNarrativeDoc);
  assert.equal(meta.extractionMode, 'narrative_prd');
  assert.deepEqual(meta.requirements, [
    'When an export request arrives, the webhook handler verifies the X-Signature-256 HMAC digest before processing.',
    'The authentication module removes the deprecated allowInsecureMd5Auth function so legacy MD5 tokens cannot authenticate.',
    'When a tenant exceeds 100 requests per minute, the rate limiter rejects the request with HTTP 429.',
    'Sustain p99 latency under 150ms across 5,000 concurrent requests during regional load testing.'
  ]);
});

test('extracts substantive paragraphs under explicit headings alongside bullet lists without omission', () => {
  const mixedExplicitDoc = doc(
    heading('Functional Requirements'),
    paragraph('The system must reject unauthenticated webhook requests.'),
    list(item('All incoming payloads must include a valid HMAC signature.'))
  );

  const meta = extractRequirementsWithMeta(mixedExplicitDoc);
  assert.equal(meta.extractionMode, 'explicit');
  assert.equal(meta.wasTruncated, false);
  assert.deepEqual(meta.requirements, [
    'The system must reject unauthenticated webhook requests.',
    'All incoming payloads must include a valid HMAC signature.'
  ]);
});

test('reports truncation flag when criteria hit MAX_HEURISTIC_ITEMS', () => {
  const content = [heading('Business Rules')];
  for (let i = 0; i < 35; i++) {
    content.push(paragraph(`Rule #${i + 1}: The system must reject invalid tokens for operation ${i + 1}.`));
  }
  const largeDoc = { type: 'doc', content };
  const meta = extractRequirementsWithMeta(largeDoc);
  assert.equal(meta.wasTruncated, true);
  assert.equal(meta.requirements.length, 30);
});
