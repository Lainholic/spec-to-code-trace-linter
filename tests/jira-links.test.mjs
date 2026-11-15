import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrlsFromAdf, loadIssueLinks } from '../src/jira-links.mjs';

test('finds linked Confluence page IDs including native Jira globalId tiny-links and retains original site', async () => {
  const links = [
    { object: { title: 'Spec', url: 'https://example.atlassian.net/wiki/spaces/PROJ/pages/123/Spec' } },
    { object: { title: 'Duplicate', url: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123' } },
    { globalId: 'appId=abc-123&pageId=2293824', object: { title: 'Audit compliance', url: 'https://example.atlassian.net/wiki/x/AYAi' } },
    { object: { url: 'https://other.atlassian.net/wiki/spaces/X/pages/123/Other' } },
    { object: { url: 'https://attacker.example/wiki/spaces/X/pages/456' } },
    { object: { url: 'https://example.atlassian.net.evil.test/wiki/spaces/X/pages/456' } },
    { object: { url: 'https://bitbucket.org/team/repo/pull-requests/42/diff' } },
    { object: { url: 'https://bitbucket.org/team/repo/pull-requests/42' } },
    { object: { url: 'https://bitbucket.org.evil.test/team/repo/pull-requests/1' } }
  ];
  const result = await loadIssueLinks('PROJ-1', async key => {
    assert.equal(key, 'PROJ-1');
    return { ok: true, json: async () => links };
  });
  assert.deepEqual(result.pages, [
    { pageId: '123', site: 'https://example.atlassian.net', title: 'Spec' },
    { pageId: '2293824', site: 'https://example.atlassian.net', title: 'Audit compliance' },
    { pageId: '123', site: 'https://other.atlassian.net', title: 'Confluence page' }
  ]);
  assert.deepEqual(result.pullRequests, [{ workspace: 'team', repository: 'repo', pullRequestId: '42', url: 'https://bitbucket.org/team/repo/pull-requests/42' }]);
});

test('rejects invalid context and reports Jira failures', async () => {
  await assert.rejects(loadIssueLinks('../1', () => { throw Error('must not call'); }), /context/);
  await assert.rejects(loadIssueLinks('ABC-1', async () => ({ ok: false, status: 403 })), /access/);
  await assert.rejects(loadIssueLinks('ABC-1', async () => ({ ok: true, json: async () => ({}) })), /invalid/);
});

test('extracts Confluence smart cards, link marks, and Bitbucket PR links from Jira issue description ADF and deduplicates with remotelink', async () => {
  const descriptionAdf = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'inlineCard', attrs: { url: 'https://example.atlassian.net/wiki/spaces/PROJ/pages/555/Payment+Retry+PRD' } },
          { type: 'text', text: ' and duplicate ' },
          { type: 'inlineCard', attrs: { url: 'https://example.atlassian.net/wiki/spaces/PROJ/pages/123/Spec' } }
        ]
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Security Review Page',
            marks: [{ type: 'link', attrs: { href: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=888' } }]
          },
          { type: 'text', text: ' plus PR https://bitbucket.org/team/repo/pull-requests/99.' }
        ]
      },
      {
        type: 'blockCard',
        attrs: { url: 'https://bitbucket.org/team/repo/pull-requests/42' }
      }
    ]
  };

  const urls = extractUrlsFromAdf(descriptionAdf);
  assert.equal(urls.length, 5);

  const remoteLinks = [
    { object: { title: 'Spec', url: 'https://example.atlassian.net/wiki/spaces/PROJ/pages/123/Spec' } },
    { object: { url: 'https://bitbucket.org/team/repo/pull-requests/42' } }
  ];

  const merged = await loadIssueLinks(
    'PROJ-9',
    async () => ({ ok: true, json: async () => remoteLinks }),
    async () => ({ ok: true, json: async () => ({ fields: { description: descriptionAdf } }) })
  );

  assert.deepEqual(merged.pages, [
    { pageId: '123', site: 'https://example.atlassian.net', title: 'Spec' },
    { pageId: '555', site: 'https://example.atlassian.net', title: 'Payment Retry PRD' },
    { pageId: '888', site: 'https://example.atlassian.net', title: 'Security Review Page' }
  ]);
  assert.deepEqual(merged.pullRequests, [
    { workspace: 'team', repository: 'repo', pullRequestId: '42', url: 'https://bitbucket.org/team/repo/pull-requests/42' },
    { workspace: 'team', repository: 'repo', pullRequestId: '99', url: 'https://bitbucket.org/team/repo/pull-requests/99' }
  ]);
});
