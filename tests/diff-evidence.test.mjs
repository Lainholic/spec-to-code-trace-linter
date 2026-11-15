import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateDiffForPrompt,
  budgetDiffByRelevance,
  changedLines,
  enrichCitationContext,
  filterAndIndexDiff,
  isNoisePath,
  languageFromPath,
  removedLines,
  resolveVerifiedCitation,
  verifyCitation
} from '../src/diff-evidence.mjs';

test('tracks added lines through context, deletions, tab timestamps, and separate hunks', () => {
  const diff = 'diff --git a/a.js b/a.js\n--- a/a.js\t2026-11-12 00:00:00\n+++ b/a.js\t2026-11-12 00:00:01\n@@ -2,3 +2,4 @@\n context\n-old\n+new\n+next\n end\n@@ -20 +21 @@\n-old\n+last\n';
  assert.deepEqual(changedLines(diff), [
    { path: 'a.js', line: 3, text: 'new' },
    { path: 'a.js', line: 4, text: 'next' },
    { path: 'a.js', line: 21, text: 'last' }
  ]);
});

test('decodes git-quoted paths with spaces and UTF-8 octal sequences while ignoring deleted files', () => {
  const diff = [
    'diff --git a/gone.js b/gone.js',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-removed',
    'diff --git "a/src/my file \\303\\251.ts" "b/src/my file \\303\\251.ts"',
    '--- "a/src/my file \\303\\251.ts"',
    '+++ "b/src/my file \\303\\251.ts"',
    '@@ -0,0 +1 @@',
    '+export const ok = true;',
    ''
  ].join('\n');
  assert.deepEqual(changedLines(diff), [
    { path: 'src/my file é.ts', line: 1, text: 'export const ok = true;' }
  ]);
});

test('filters lockfiles, snapshots, and build bundles while preserving real source hunks', () => {
  const lockPatch = [
    'diff --git a/package-lock.json b/package-lock.json',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '@@ -1,1 +1,2 @@',
    ' {',
    '+  "lockfileVersion": 3'
  ].join('\n');
  const distPatch = [
    'diff --git a/dist/app.min.js b/dist/app.min.js',
    '--- a/dist/app.min.js',
    '+++ b/dist/app.min.js',
    '@@ -0,0 +1 @@',
    '+!function(){}()'
  ].join('\n');
  const srcPatch = [
    'diff --git a/src/service.ts b/src/service.ts',
    '--- a/src/service.ts',
    '+++ b/src/service.ts',
    '@@ -10,0 +11,1 @@',
    '+verifySignature(payload);'
  ].join('\n');

  const result = filterAndIndexDiff([lockPatch, distPatch, srcPatch].join('\n'));
  assert.deepEqual(result.excludedFiles, ['package-lock.json', 'dist/app.min.js']);
  assert.deepEqual(result.lines, [{ path: 'src/service.ts', line: 11, text: 'verifySignature(payload);' }]);
  assert.ok(!result.filteredDiff.includes('lockfileVersion'));
  assert.equal(isNoisePath('pnpm-lock.yaml'), true);
  assert.equal(isNoisePath('src/__snapshots__/ui.test.js.snap'), true);
  assert.equal(isNoisePath('src/service.ts'), false);
});

test('requires an exact non-empty citation of an added line and maps CodeBlock languages', () => {
  const lines = [{ path: 'a.js', line: 3, text: 'sendEmail()' }];
  assert.equal(verifyCitation(lines, { path: 'a.js', line: 3, text: 'sendEmail()' }), true);
  assert.equal(verifyCitation(lines, { path: 'a.js', line: 4, text: 'sendEmail()' }), false);
  assert.equal(verifyCitation(lines, { path: 'a.js', line: 3, text: 'sendEmail' }), false);
  assert.equal(verifyCitation(lines, { path: 'a.js', line: 3, text: '' }), false);
  assert.equal(languageFromPath('src/index.tsx'), 'tsx');
  assert.equal(languageFromPath('scripts/deploy.py'), 'python');
  assert.equal(languageFromPath('Dockerfile'), 'dockerfile');
  assert.equal(languageFromPath('UNKNOWN'), 'text');
});

test('treats added content beginning with plus signs as content, not a file header', () => {
  const diff = 'diff --git a/a b/a\n+++ b/a\n@@ -0,0 +1 @@\n+++ heading\n';
  assert.deepEqual(changedLines(diff), [{ path: 'a', line: 1, text: '++ heading' }]);
});

test('enriches verified citations with surrounding new-file hunk context and 1-based highlight line', () => {
  const diff = [
    'diff --git a/src/webhook.ts b/src/webhook.ts',
    '--- a/src/webhook.ts',
    '+++ b/src/webhook.ts',
    '@@ -40,4 +40,5 @@',
    ' export function verifyWebhook(rawBody: string, headerSig: string, secret: string) {',
    '-  return Boolean(headerSig);',
    '+  const expected = computeHmacSha256(rawBody, secret);',
    '+  if (!timingSafeEqualHex(expected, headerSig)) throw new UnauthorizedError();',
    '   return true;',
    ' }'
  ].join('\n');

  const enriched = enrichCitationContext(diff, {
    path: 'src/webhook.ts',
    line: 42,
    text: '  if (!timingSafeEqualHex(expected, headerSig)) throw new UnauthorizedError();'
  });

  assert.equal(enriched.startLine, 40);
  assert.equal(enriched.endLine, 44);
  assert.equal(enriched.highlightLine, 3);
  assert.deepEqual(enriched.snippet.split('\n'), [
    'export function verifyWebhook(rawBody: string, headerSig: string, secret: string) {',
    '  const expected = computeHmacSha256(rawBody, secret);',
    '  if (!timingSafeEqualHex(expected, headerSig)) throw new UnauthorizedError();',
    '  return true;',
    '}'
  ]);
});

test('budgets >100 KB source diffs by retaining relevant production hunks with intact line provenance and disclosing omitted fixture files', () => {
  const fixtureLines = Array.from({ length: 1500 }, (_, i) => `+  "fixtureRow_${i}": "${'x'.repeat(65)}",`);
  const giantFixtureSection = [
    'diff --git a/tests/fixtures/seeded-events.json b/tests/fixtures/seeded-events.json',
    '--- a/tests/fixtures/seeded-events.json',
    '+++ b/tests/fixtures/seeded-events.json',
    `@@ -0,0 +1,${fixtureLines.length} @@`,
    ...fixtureLines
  ].join('\n');

  const prodSection = [
    'diff --git a/src/auth/verifyHmac.ts b/src/auth/verifyHmac.ts',
    '--- a/src/auth/verifyHmac.ts',
    '+++ b/src/auth/verifyHmac.ts',
    '@@ -18,2 +18,4 @@',
    ' export function verifyHmacSignature(payload: string, header: string, secret: string) {',
    '+  const digest = createHmacSha256(payload, secret);',
    '+  if (!timingSafeEqual(digest, header)) return false;',
    '   return true;'
  ].join('\n');

  const combined = `${giantFixtureSection}\n${prodSection}`;
  assert.ok(combined.length > 110000);

  const budgeted = budgetDiffByRelevance(combined, ['Verify HMAC signature using timingSafeEqual'], 100000);
  assert.equal(budgeted.wasBudgeted, true);
  assert.ok(budgeted.budgetedDiff.length <= 100000);
  assert.deepEqual(budgeted.omittedFiles, ['tests/fixtures/seeded-events.json']);
  assert.equal(
    verifyCitation(budgeted.lines, {
      path: 'src/auth/verifyHmac.ts',
      line: 20,
      text: '  if (!timingSafeEqual(digest, header)) return false;'
    }),
    true
  );
});

test('indexes removed lines and deleted source files while still excluding deleted lockfiles', () => {
  const deletionDiff = [
    'diff --git a/yarn.lock b/yarn.lock',
    'deleted file mode 100644',
    '--- a/yarn.lock',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-# yarn lockfile v1',
    '-integrity sha512-abc',
    'diff --git a/src/auth/legacyMd5.ts b/src/auth/legacyMd5.ts',
    'deleted file mode 100644',
    '--- a/src/auth/legacyMd5.ts',
    '+++ /dev/null',
    '@@ -10,3 +0,0 @@',
    '-export function verifyLegacyMd5(token: string) {',
    '-  return md5(token);',
    '-}',
    'diff --git a/src/routes/debug.ts b/src/routes/debug.ts',
    '--- a/src/routes/debug.ts',
    '+++ b/src/routes/debug.ts',
    '@@ -14,3 +14,2 @@',
    ' export function registerRoutes(app) {',
    '-  app.get("/v1/debug/dump-env", dumpEnvHandler);',
    '   app.get("/healthz", healthHandler);'
  ].join('\n');

  const indexed = filterAndIndexDiff(deletionDiff);
  assert.deepEqual(indexed.excludedFiles, ['yarn.lock']);
  assert.equal(indexed.lines.length, 0);
  assert.equal(removedLines(indexed.filteredDiff).length, 4);
  assert.equal(
    verifyCitation(indexed.allChangedLines, {
      path: 'src/routes/debug.ts',
      line: 15,
      text: '  app.get("/v1/debug/dump-env", dumpEnvHandler);'
    }),
    true
  );
  assert.equal(
    verifyCitation(indexed.allChangedLines, {
      path: 'src/auth/legacyMd5.ts',
      line: 11,
      text: '  return md5(token);'
    }),
    true
  );

  const enrichedRemoved = enrichCitationContext(indexed.filteredDiff, {
    path: 'src/routes/debug.ts',
    line: 15,
    text: '  app.get("/v1/debug/dump-env", dumpEnvHandler);'
  });
  assert.equal(enrichedRemoved.changeType, 'deleted');
  assert.equal(enrichedRemoved.highlightLine, 2);
  assert.equal(enrichedRemoved.startLine, 14);
  assert.equal(enrichedRemoved.endLine, 16);
});

test('annotates mixed deletion/addition hunks with exact line tags and canonicalizes trimmed or tagged citations', () => {
  const mixedDiff = [
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

  const annotated = annotateDiffForPrompt(mixedDiff);
  assert.ok(annotated.includes('-[L1] export function allowInsecureMd5Auth(token) {'));
  assert.ok(annotated.includes('+[L1] export function verifyWebhookSignature(payload, sig, secret) {'));
  assert.ok(annotated.includes('+[L5]   if (rpm > 100) return { status: 429 };'));

  const indexed = filterAndIndexDiff(mixedDiff);
  assert.deepEqual(
    resolveVerifiedCitation(indexed.allChangedLines, {
      path: 'webhookAuth.js',
      line: 5,
      text: 'if (rpm > 100) return { status: 429 };'
    }),
    {
      path: 'webhookAuth.js',
      line: 5,
      text: '  if (rpm > 100) return { status: 429 };'
    }
  );
  assert.deepEqual(
    resolveVerifiedCitation(indexed.allChangedLines, {
      path: 'a/webhookAuth.js',
      line: 1,
      text: '-[L1] export function allowInsecureMd5Auth(token) {'
    }),
    {
      path: 'webhookAuth.js',
      line: 1,
      text: 'export function allowInsecureMd5Auth(token) {',
      changeType: 'deleted'
    }
  );
  assert.equal(
    resolveVerifiedCitation(indexed.allChangedLines, {
      path: 'webhookAuth.js',
      line: 8,
      text: 'if (rpm > 100) return { status: 429 };'
    }),
    null
  );
});

test('handles binary diff files, rename headers, CRLF line endings, and git submodule changes gracefully', () => {
  const binaryAndRenameDiff = [
    'diff --git a/logo.png b/logo.png\r\n',
    'index 1234567..89abcdef 100644\r\n',
    'Binary files a/logo.png and b/logo.png differ\r\n',
    'diff --git a/submodule b/submodule\r\n',
    'index 0000000..1111111 160000\r\n',
    '--- a/submodule\r\n',
    '+++ b/submodule\r\n',
    '@@ -1 +1 @@\r\n',
    '-Subproject commit 0000000\r\n',
    '+Subproject commit 1111111\r\n',
    'diff --git a/old_helper.js b/new_helper.js\r\n',
    'similarity index 95%\r\n',
    'rename from old_helper.js\r\n',
    'rename to new_helper.js\r\n',
    '@@ -1,2 +1,3 @@\r\n',
    ' function helper() {\r\n',
    '+  recordMetric("probe");\r\n',
    ' }\r\n'
  ].join('');

  const result = filterAndIndexDiff(binaryAndRenameDiff);
  assert.equal(result.excludedFiles.length, 0);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].path, 'new_helper.js');
  assert.equal(result.lines[0].line, 2);
  assert.equal(result.lines[0].text, '  recordMetric("probe");');
});

test('rejects merge conflict markers and accepts string line numbers in resolveVerifiedCitation', () => {
  const lines = [
    { path: 'src/app.js', line: 10, text: '<<<<<<< HEAD' },
    { path: 'src/app.js', line: 11, text: 'const secure = true;' }
  ];

  // Conflict marker must be rejected
  const conflictCitation = { path: 'src/app.js', line: 10, text: '<<<<<<< HEAD' };
  assert.equal(resolveVerifiedCitation(lines, conflictCitation), null);

  // String line number must be parsed and accepted
  const stringLineCitation = { path: 'src/app.js', line: '11', text: 'const secure = true;' };
  const verified = resolveVerifiedCitation(lines, stringLineCitation);
  assert.notEqual(verified, null);
  assert.equal(verified.line, 11);
  assert.equal(verified.text, 'const secure = true;');
});

test('rejects pure comment lines from being cited as functional implementation evidence', () => {
  const lines = [
    { path: 'src/auth.js', line: 1, text: '// sample auth comment' },
    { path: 'src/auth.js', line: 2, text: '/* block comment */' },
    { path: 'src/auth.js', line: 3, text: '* nested javadoc line' },
    { path: 'src/auth.js', line: 4, text: '# python comment' },
    { path: 'src/auth.js', line: 5, text: '<!-- html comment -->' },
    { path: 'src/auth.js', line: 6, text: '-- sql comment' },
    { path: 'src/auth.js', line: 7, text: 'const token = createHmacToken();' }
  ];

  // Pure comment lines must return null
  assert.equal(resolveVerifiedCitation(lines, { path: 'src/auth.js', line: 1, text: '// sample auth comment' }), null);
  assert.equal(resolveVerifiedCitation(lines, { path: 'src/auth.js', line: 2, text: '/* block comment */' }), null);
  assert.equal(resolveVerifiedCitation(lines, { path: 'src/auth.js', line: 3, text: '* nested javadoc line' }), null);
  assert.equal(resolveVerifiedCitation(lines, { path: 'src/auth.js', line: 4, text: '# python comment' }), null);
  assert.equal(resolveVerifiedCitation(lines, { path: 'src/auth.js', line: 5, text: '<!-- html comment -->' }), null);
  assert.equal(resolveVerifiedCitation(lines, { path: 'src/auth.js', line: 6, text: '-- sql comment' }), null);

  // Functional implementation line must be accepted
  const verified = resolveVerifiedCitation(lines, { path: 'src/auth.js', line: 7, text: 'const token = createHmacToken();' });
  assert.notEqual(verified, null);
  assert.equal(verified.line, 7);
  assert.equal(verified.text, 'const token = createHmacToken();');
});

test('excludes lines inside conflict regions even when markers appear in context lines or span hunks', () => {
  const diffWithContextConflict = [
    'diff --git a/src/app.js b/src/app.js',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,4 +1,5 @@',
    ' <<<<<<< HEAD',
    '+  allowAllUsers();',
    ' =======',
    '   denyAllUsers();',
    ' >>>>>>> branch-a'
  ].join('\n');

  const lines = changedLines(diffWithContextConflict);
  // allowAllUsers() is inside the conflict region and must be excluded!
  assert.equal(lines.some(l => l.text.includes('allowAllUsers')), false);
});

test('assigns deleted lines to oldPath during file renames', () => {
  const renameDiff = [
    'diff --git a/old-name.js b/new-name.js',
    'similarity index 90%',
    'rename from old-name.js',
    'rename to new-name.js',
    '@@ -1,3 +1,2 @@',
    '-const legacyAuth = true;',
    ' const keepMe = 1;'
  ].join('\n');

  const removed = removedLines(renameDiff);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].path, 'old-name.js');
  assert.equal(removed[0].text, 'const legacyAuth = true;');
});

test('slices oversized single hunk exceeding budget instead of dropping it entirely', () => {
  // Construct a single hunk of 10,000 chars
  const lines = ['diff --git a/huge.js b/huge.js', '--- a/huge.js', '+++ b/huge.js', '@@ -1,500 +1,500 @@'];
  for (let i = 1; i <= 300; i++) {
    lines.push(`+  const item_${i} = ${i}; // padding data for huge file`);
  }
  const hugeDiff = lines.join('\n');

  // Set tight budget of 2,000 chars (smaller than the 10,000 char hunk)
  const budgeted = budgetDiffByRelevance(hugeDiff, { maxChars: 2000, keywords: ['item_10'] });
  assert.equal(budgeted.wasBudgeted, true);
  assert.ok(budgeted.lines.length > 0);
  assert.ok(budgeted.omittedFiles.includes('huge.js'));
  assert.ok(budgeted.budgetedDiff.length <= 2500);
});
