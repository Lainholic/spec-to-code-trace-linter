import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectSettingsKey,
  getProjectSettings,
  saveProjectSettings,
  DEFAULT_PROJECT_SETTINGS
} from '../src/project-settings.mjs';

function createMemoryStore() {
  const map = new Map();
  return {
    get: async k => map.get(k) || null,
    set: async (k, v) => { map.set(k, v); return true; }
  };
}

test('project settings: defaults gracefully when no settings saved', async () => {
  const store = createMemoryStore();
  const settings = await getProjectSettings(store, 'PLAT');
  assert.deepEqual(settings, DEFAULT_PROJECT_SETTINGS);
});

test('project settings: saves and retrieves custom policies with validation', async () => {
  const store = createMemoryStore();
  const saved = await saveProjectSettings(store, 'PLAT', {
    requireLeadApproval: true,
    minCoverageRatio: 0.9,
    strictResolution: true,
    allowedWorkspace: 'synapse-codegeist'
  }, { userAccountId: 'usr-admin-1' });

  assert.equal(saved, true);

  const loaded = await getProjectSettings(store, 'PLAT');
  assert.equal(loaded.requireLeadApproval, true);
  assert.equal(loaded.minCoverageRatio, 0.9);
  assert.equal(loaded.strictResolution, true);
  assert.equal(loaded.allowedWorkspace, 'synapse-codegeist');
  assert.equal(loaded.updatedBy, 'usr-admin-1');
  assert.ok(loaded.updatedAt);
});

test('project settings: clamps out-of-range coverage ratios to [0.5, 1.0]', async () => {
  const store = createMemoryStore();
  await saveProjectSettings(store, 'PROJ-LOW', { minCoverageRatio: 0.1 });
  const low = await getProjectSettings(store, 'PROJ-LOW');
  assert.equal(low.minCoverageRatio, 0.5);

  await saveProjectSettings(store, 'PROJ-HIGH', { minCoverageRatio: 1.5 });
  const high = await getProjectSettings(store, 'PROJ-HIGH');
  assert.equal(high.minCoverageRatio, 1.0);
});
