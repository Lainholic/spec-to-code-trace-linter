import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRequirements } from '../src/confluence-page.mjs';

test('uses the requested page and extracts criteria, version, and safe webUrl from its ADF body', async () => {
  const adf = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance Criteria' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Send confirmation' }] }] }] }
  ] };
  const result = await loadRequirements(' 123 ', async id => {
    assert.equal(id, '123');
    return {
      ok: true,
      json: async () => ({
        title: 'Spec',
        version: { number: 4 },
        _links: { base: 'https://one-atlas-hebl.atlassian.net/wiki', webui: '/spaces/PLAT/pages/123/Spec' },
        body: { atlas_doc_format: { value: JSON.stringify(adf) } }
      })
    };
  });
  assert.deepEqual(result, {
    title: 'Spec',
    pageId: '123',
    pageVersion: 4,
    webUrl: 'https://one-atlas-hebl.atlassian.net/wiki/spaces/PLAT/pages/123/Spec',
    extractionMode: 'explicit',
    requirements: ['Send confirmation']
  });
});

test('defaults pageVersion and webUrl to null when optional metadata is absent or off-tenant', async () => {
  const adf = { type: 'doc', content: [] };
  const result = await loadRequirements('99', async () => ({
    ok: true,
    json: async () => ({
      title: 'Minimal',
      _links: { base: 'https://evil.example/wiki', webui: '/pages/99' },
      body: { atlas_doc_format: { value: JSON.stringify(adf) } }
    })
  }));
  assert.deepEqual(result, {
    title: 'Minimal',
    pageId: '99',
    pageVersion: null,
    webUrl: null,
    extractionMode: 'none',
    requirements: []
  });
});

test('returns heuristic_prd extractionMode when page uses unstructured PRD sections or normative statements', async () => {
  const adf = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Security Constraints' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reject unsigned webhook payloads with HTTP 401.' }] }] }] }
    ]
  };
  const result = await loadRequirements('777', async () => ({
    ok: true,
    json: async () => ({
      title: 'Webhook PRD',
      version: { number: 2 },
      body: { atlas_doc_format: { value: JSON.stringify(adf) } }
    })
  }));
  assert.equal(result.extractionMode, 'heuristic_prd');
  assert.deepEqual(result.requirements, ['Reject unsigned webhook payloads with HTTP 401.']);
});

test('rejects invalid IDs before making a request', async () => {
  await assert.rejects(loadRequirements('../12', () => { throw new Error('must not call'); }), /numeric/);
});

test('reports inaccessible pages and malformed page bodies', async () => {
  await assert.rejects(loadRequirements('1', async () => ({ ok: false, status: 403 })), /access/);
  await assert.rejects(loadRequirements('1', async () => ({ ok: true, json: async () => ({ body: { atlas_doc_format: { value: '{' } } }) })), /invalid/);
});
