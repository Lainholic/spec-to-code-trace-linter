import crypto from 'node:crypto';

const SCHEMA_VERSION = 1;

export function buildProjectSettingsKey(projectId) {
  const cleanId = String(projectId ?? '').trim();
  if (!cleanId) return null;
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([cleanId]))
    .digest('hex')
    .slice(0, 40);
  return `trace:proj:v1:${digest}`;
}

export const DEFAULT_PROJECT_SETTINGS = {
  requireLeadApproval: false,
  minCoverageRatio: 0.8,
  strictResolution: false,
  allowedWorkspace: '',
  updatedAt: null,
  updatedBy: null
};

export async function getProjectSettings(store, projectId) {
  if (!store || typeof store.get !== 'function' || !projectId) {
    return { ...DEFAULT_PROJECT_SETTINGS };
  }
  const key = buildProjectSettingsKey(projectId);
  if (!key) return { ...DEFAULT_PROJECT_SETTINGS };

  try {
    const record = await store.get(key);
    if (!record || typeof record !== 'object' || record.schemaVersion !== SCHEMA_VERSION) {
      return { ...DEFAULT_PROJECT_SETTINGS };
    }
    const ratio = typeof record.minCoverageRatio === 'number' && record.minCoverageRatio >= 0.5 && record.minCoverageRatio <= 1.0
      ? record.minCoverageRatio
      : DEFAULT_PROJECT_SETTINGS.minCoverageRatio;

    return {
      requireLeadApproval: Boolean(record.requireLeadApproval),
      minCoverageRatio: ratio,
      strictResolution: Boolean(record.strictResolution),
      allowedWorkspace: typeof record.allowedWorkspace === 'string' ? record.allowedWorkspace.trim() : '',
      updatedAt: record.updatedAt || null,
      updatedBy: record.updatedBy || null
    };
  } catch {
    return { ...DEFAULT_PROJECT_SETTINGS };
  }
}

export async function saveProjectSettings(store, projectId, input, { userAccountId = null } = {}) {
  if (!store || typeof store.set !== 'function' || !projectId) {
    return false;
  }
  const key = buildProjectSettingsKey(projectId);
  if (!key) return false;

  const ratio = typeof input?.minCoverageRatio === 'number'
    ? Math.min(1.0, Math.max(0.5, Number(input.minCoverageRatio.toFixed(2))))
    : DEFAULT_PROJECT_SETTINGS.minCoverageRatio;

  const record = {
    schemaVersion: SCHEMA_VERSION,
    projectId: String(projectId).trim(),
    requireLeadApproval: Boolean(input?.requireLeadApproval),
    minCoverageRatio: ratio,
    strictResolution: Boolean(input?.strictResolution),
    allowedWorkspace: typeof input?.allowedWorkspace === 'string' ? input.allowedWorkspace.trim().slice(0, 100) : '',
    updatedAt: new Date().toISOString(),
    updatedBy: userAccountId ? String(userAccountId).trim() : null
  };

  try {
    const setRes = await store.set(key, record);
    if (setRes === false) return false;
    return true;
  } catch {
    return false;
  }
}
