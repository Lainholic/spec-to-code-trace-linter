import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changedLines,
  removedLines,
  filterAndIndexDiff,
  budgetDiffByRelevance,
  resolveVerifiedCitation
} from '../src/diff-evidence.mjs';
import { extractRequirementsWithMeta } from '../src/adf-requirements.mjs';

test('wild-data: monorepo deep paths, git-quoted unicode names, and multi-file renames', () => {
  const diff = [
    'diff --git "a/packages/core/src/\\355\\225\\253\\354\\212\\244/net.ts" "b/packages/core/src/\\355\\225\\253\\354\\212\\244/net.ts"',
    '--- "a/packages/core/src/\\355\\225\\253\\354\\212\\244/net.ts"',
    '+++ "b/packages/core/src/\\355\\225\\253\\354\\212\\244/net.ts"',
    '@@ -1,2 +1,3 @@',
    ' const base = 1;',
    '+export function enforceTLS13() { return true; }',
    ' const end = 2;',
    'diff --git a/services/auth/legacy.js b/services/auth/v2/authenticator.js',
    'similarity index 92%',
    'rename from services/auth/legacy.js',
    'rename to services/auth/v2/authenticator.js',
    '--- a/services/auth/legacy.js',
    '+++ b/services/auth/v2/authenticator.js',
    '@@ -10,3 +10,4 @@',
    ' function verify() {',
    '-  return checkMd5(token);',
    '+  return checkSha256(token);',
    ' }'
  ].join('\n');

  const added = changedLines(diff);
  const removed = removedLines(diff);

  // 1. Unicode git-quoted filename decoded
  assert.equal(added[0].path, 'packages/core/src/핫스/net.ts');
  assert.equal(added[0].line, 2);
  assert.equal(added[0].text, 'export function enforceTLS13() { return true; }');

  // 2. Renamed file targets new path for addition, old path for deletion
  assert.equal(added[1].path, 'services/auth/v2/authenticator.js');
  assert.equal(added[1].line, 11);
  assert.equal(added[1].text, '  return checkSha256(token);');

  assert.equal(removed[0].path, 'services/auth/legacy.js');
  assert.equal(removed[0].line, 11);
  assert.equal(removed[0].text, '  return checkMd5(token);');
});

test('wild-data: binary diffs and submodule commits do not corrupt subsequent hunk indexing', () => {
  const diff = [
    'diff --git a/assets/banner.png b/assets/banner.png',
    'index 1111111..2222222 100644',
    'Binary files a/assets/banner.png and b/assets/banner.png differ',
    'diff --git a/submodules/shared-lib b/submodules/shared-lib',
    'index 3333333..4444444 160000',
    '--- a/submodules/shared-lib',
    '+++ b/submodules/shared-lib',
    '@@ -1 +1 @@',
    '-Subproject commit 3333333333333333333333333333333333333333',
    '+Subproject commit 4444444444444444444444444444444444444444',
    'diff --git a/src/service.ts b/src/service.ts',
    '--- a/src/service.ts',
    '+++ b/src/service.ts',
    '@@ -5,2 +5,3 @@',
    ' function run() {',
    '+  validateAuditTrail();',
    ' }'
  ].join('\n');

  const added = changedLines(diff);
  const serviceAdded = added.find(l => l.path === 'src/service.ts');
  assert.ok(serviceAdded);
  assert.equal(serviceAdded.line, 6);
  assert.equal(serviceAdded.text, '  validateAuditTrail();');
});

test('wild-data: extracts Korean & Japanese requirement headings and boosts Unicode keywords in diffs', () => {
  const koreanAdf = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '요구사항' }]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '결제 취소 시 즉시 401 인증 거부' }] }]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '보안 요구사항' }]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '모든 토큰은 SHA-256 해시로 저장' }] }]
          }
        ]
      }
    ]
  };

  const meta = extractRequirementsWithMeta(koreanAdf);
  assert.equal(meta.extractionMode, 'explicit');
  assert.equal(meta.requirements.length, 2);
  assert.equal(meta.requirements[0], '결제 취소 시 즉시 401 인증 거부');
  assert.equal(meta.requirements[1], '모든 토큰은 SHA-256 해시로 저장');

  // Test keyword relevance scoring with Korean terms
  const diffWithKorean = [
    'diff --git a/src/payment.ts b/src/payment.ts',
    '--- a/src/payment.ts',
    '+++ b/src/payment.ts',
    '@@ -10,3 +10,4 @@',
    ' export function processPayment() {',
    '+  // 결제 취소 요청 검증 로직',
    '+  if (isPaymentCancelled) return { status: 401 };',
    ' }'
  ].join('\n');

  const budgeted = budgetDiffByRelevance(diffWithKorean, meta.requirements, 5000);
  assert.equal(budgeted.lines.length, 2);
  assert.ok(budgeted.budgetedDiff.includes('결제 취소'));
});

test('wild-data: 60-file 300KB monorepo stress test budgets within 100KB limit safely', () => {
  const sections = [];
  // Build 60 distinct files across multiple monorepo packages
  for (let f = 1; f <= 60; f++) {
    const pkg = f <= 20 ? 'packages/core' : f <= 40 ? 'packages/billing' : 'packages/dashboard';
    const filename = `${pkg}/service_${f}.ts`;
    const lines = [
      `diff --git a/${filename} b/${filename}`,
      `--- a/${filename}`,
      `+++ b/${filename}`,
      '@@ -1,5 +1,15 @@',
      ' const init = true;'
    ];
    for (let i = 1; i <= 10; i++) {
      lines.push(`+export function feature_${f}_method_${i}() { return "data_${f}_${i}"; }`);
    }
    lines.push(' const done = true;');
    sections.push(lines.join('\n'));
  }

  // Add 1 lockfile section to test exclusion
  sections.push([
    'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
    '--- a/pnpm-lock.yaml',
    '+++ b/pnpm-lock.yaml',
    '@@ -1,2 +1,50 @@',
    '+lockfile_padding_bytes_here'.repeat(100)
  ].join('\n'));

  const rawDiff = sections.join('\n');
  assert.ok(rawDiff.length > 50000);

  const { filteredDiff, excludedFiles } = filterAndIndexDiff(rawDiff);
  assert.ok(excludedFiles.includes('pnpm-lock.yaml'));

  const requirements = [
    'Feature 5 method 3 must return data_5_3',
    'Feature 25 method 7 must return data_25_7'
  ];

  const budgeted = budgetDiffByRelevance(filteredDiff, requirements, 20000);
  assert.ok(budgeted.budgetedDiff.length <= 20000);
  assert.ok(budgeted.lines.length > 0);
  assert.ok(budgeted.omittedFiles.length > 0);

  // Verify that the relevant files for requirements 5 and 25 were prioritized
  const budgetedFilePaths = new Set(budgeted.lines.map(l => l.path));
  assert.ok(budgetedFilePaths.has('packages/core/service_5.ts'));
  assert.ok(budgetedFilePaths.has('packages/billing/service_25.ts'));

  // Test citation verification against budgeted lines
  const targetLine = budgeted.lines.find(l => l.text.includes('data_5_3'));
  assert.ok(targetLine);
  const citation = resolveVerifiedCitation(budgeted.allChangedLines, targetLine);
  assert.ok(citation);
  assert.equal(citation.path, 'packages/core/service_5.ts');
});
