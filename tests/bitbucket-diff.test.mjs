import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPullRequestDiff, loadPullRequestMetadata } from '../src/bitbucket-diff.mjs';

const pr = { workspace: 'team', repository: 'repo', pullRequestId: '42' };

test('fetches a selected PR through the provided authorized client', async () => {
  assert.equal(await loadPullRequestDiff(pr, async input => {
    assert.equal(input, '/2.0/repositories/team/repo/pullrequests/42/diff');
    return new Response('diff content');
  }), 'diff content');
});

test('follows only a safe redirect to the same repository diff including Bitbucket spec and query params', async () => {
  const paths = [];
  const realStyleLocation = 'https://api.bitbucket.org/2.0/repositories/team/repo/diff/team/repo:ea49e103cae8%0D280d938504e0?from_pullrequest_id=42&topic=true';
  const result = await loadPullRequestDiff(pr, async path => {
    paths.push(path);
    return paths.length === 1 ? new Response(null, { status: 302, headers: { location: realStyleLocation } }) : new Response('diff');
  });
  assert.equal(result, 'diff');
  assert.deepEqual(paths, [
    '/2.0/repositories/team/repo/pullrequests/42/diff',
    '/2.0/repositories/team/repo/diff/team/repo:ea49e103cae8%0D280d938504e0?from_pullrequest_id=42&topic=true'
  ]);
  await assert.rejects(loadPullRequestDiff(pr, async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/2.0/repositories/team/repo/diff/abc' } })), /unsafe/);
  await assert.rejects(loadPullRequestDiff(pr, async () => new Response(null, { status: 302, headers: { location: 'https://api.bitbucket.org/2.0/repositories/team/repo/diff/%2e%2e/%2e%2e/other' } })), /unsafe/);
});

test('allows raw PR diffs over 100 KB up to 500 KB for noise filtering while rejecting invalid or >500 KB responses', async () => {
  let called = false;
  await assert.rejects(loadPullRequestDiff({ ...pr, workspace: '../other' }, async () => { called = true; }), /Invalid/);
  await assert.rejects(loadPullRequestDiff({ ...pr, repository: '..' }, async () => { called = true; }), /Invalid/);
  assert.equal(called, false);
  await assert.rejects(loadPullRequestDiff(pr, async () => new Response('', { status: 403 })), /access was denied/);

  const mediumDiff = 'x'.repeat(150000);
  assert.equal(await loadPullRequestDiff(pr, async () => new Response(mediumDiff)), mediumDiff);
  await assert.rejects(loadPullRequestDiff(pr, async () => new Response('x'.repeat(500001))), /500 KB/);
});

test('loads Bitbucket pull request metadata including state, branches, and headCommit SHA', async () => {
  const meta = await loadPullRequestMetadata(pr, async path => {
    assert.equal(path, '/2.0/repositories/team/repo/pullrequests/42');
    return new Response(JSON.stringify({
      title: 'Implement HMAC webhook verification',
      state: 'OPEN',
      source: { branch: { name: 'feature/hmac-verify' }, commit: { hash: 'ea49e103cae8deadbeef' } },
      destination: { branch: { name: 'main' } },
      updated_on: '2026-11-12T04:10:00.000Z'
    }));
  });
  assert.deepEqual(meta, {
    title: 'Implement HMAC webhook verification',
    state: 'OPEN',
    sourceBranch: 'feature/hmac-verify',
    destinationBranch: 'main',
    headCommit: 'ea49e103cae8deadbeef',
    updatedOn: '2026-11-12T04:10:00.000Z'
  });
});
