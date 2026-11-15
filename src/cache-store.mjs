import crypto from 'node:crypto';

const SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 200000;

function normalizeReqText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function buildCacheKey({ accountId, issueKey, pageId, pullRequestUrl } = {}) {
  const acct = typeof accountId === 'string' ? accountId.trim() : '';
  const issue = typeof issueKey === 'string' ? issueKey.trim() : '';
  const page = String(pageId ?? '').trim();
  const pr = typeof pullRequestUrl === 'string' ? pullRequestUrl.trim() : '';
  if (!acct || !issue || !page || !pr) return null;

  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([acct, issue, page, pr]))
    .digest('hex')
    .slice(0, 40);
  return `trace:v1:${digest}`;
}

export function buildIssueSelectionKey({ accountId, issueKey } = {}) {
  const acct = typeof accountId === 'string' ? accountId.trim() : '';
  const issue = typeof issueKey === 'string' ? issueKey.trim() : '';
  if (!acct || !issue) return null;

  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([acct, issue]))
    .digest('hex')
    .slice(0, 40);
  return `trace:sel:v1:${digest}`;
}

export function buildSpecLintCacheKey({ accountId, pageId, pageVersion } = {}) {
  const acct = typeof accountId === 'string' ? accountId.trim() : '';
  const page = String(pageId ?? '').trim();
  const ver = pageVersion === null || pageVersion === undefined ? 'unversioned' : String(pageVersion).trim();
  if (!acct || !page || !ver) return null;

  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([acct, page, ver]))
    .digest('hex')
    .slice(0, 40);
  return `trace:lint:v1:${digest}`;
}

export async function getCachedSpecLint(store, key) {
  if (!store || typeof store.get !== 'function' || typeof key !== 'string' || !key) return null;
  try {
    const record = await store.get(key);
    if (!record || typeof record !== 'object' || record.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(record.items) || !record.summary || typeof record.summary !== 'object') return null;
    return record;
  } catch {
    return null;
  }
}

export async function saveCachedSpecLint(store, key, lintResult) {
  if (!store || typeof store.set !== 'function' || typeof key !== 'string' || !key || !lintResult) return false;
  const record = {
    schemaVersion: SCHEMA_VERSION,
    cachedAt: lintResult.cachedAt,
    pageId: String(lintResult.pageId),
    pageTitle: lintResult.pageTitle ?? null,
    pageVersion: lintResult.pageVersion ?? null,
    extractionMode: lintResult.extractionMode ?? null,
    webUrl: lintResult.webUrl ?? null,
    summary: lintResult.summary,
    items: lintResult.items
  };
  try {
    let serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES && Array.isArray(record.items)) {
      record.items = record.items.map(item => ({
        ...item,
        issue: typeof item.issue === 'string' && item.issue.length > 80
          ? item.issue.slice(0, 77) + '...'
          : item.issue,
        rationale: typeof item.rationale === 'string' && item.rationale.length > 80
          ? item.rationale.slice(0, 77) + '...'
          : item.rationale,
        suggestedRewrite: typeof item.suggestedRewrite === 'string' && item.suggestedRewrite.length > 120
          ? item.suggestedRewrite.slice(0, 117) + '...'
          : item.suggestedRewrite
      }));
      serialized = JSON.stringify(record);
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) return false;
    const setRes = await store.set(key, record);
    if (setRes === false) return false;
    return true;
  } catch {
    return false;
  }
}

export async function getLastIssueSelection(store, key) {
  if (!store || typeof store.get !== 'function' || typeof key !== 'string' || !key) return null;
  try {
    const record = await store.get(key);
    if (!record || typeof record !== 'object' || record.schemaVersion !== SCHEMA_VERSION) return null;
    const pageId = /^\d{1,20}$/.test(String(record.pageId ?? '')) ? String(record.pageId) : null;
    const pullRequestUrl = typeof record.pullRequestUrl === 'string' && record.pullRequestUrl.trim()
      ? record.pullRequestUrl.trim()
      : null;
    if (!pageId && !pullRequestUrl) return null;
    return { pageId, pullRequestUrl };
  } catch {
    return null;
  }
}

export async function saveLastIssueSelection(store, key, { pageId, pullRequestUrl, updatedAt }) {
  if (!store || typeof store.set !== 'function' || typeof key !== 'string' || !key) return false;
  const cleanPageId = /^\d{1,20}$/.test(String(pageId ?? '')) ? String(pageId) : null;
  const cleanPrUrl = typeof pullRequestUrl === 'string' && pullRequestUrl.trim() ? pullRequestUrl.trim() : null;
  if (!cleanPageId && !cleanPrUrl) return false;
  try {
    const setRes = await store.set(key, {
      schemaVersion: SCHEMA_VERSION,
      pageId: cleanPageId,
      pullRequestUrl: cleanPrUrl,
      updatedAt: updatedAt || new Date().toISOString()
    });
    if (setRes === false) return false;
    return true;
  } catch {
    return false;
  }
}

export function computeDelta(previousSnapshot, nextResult) {
  if (!previousSnapshot || !Array.isArray(previousSnapshot.verdicts) || !nextResult || !Array.isArray(nextResult.verdicts)) {
    return null;
  }

  const prevBuckets = new Map();
  for (const prev of previousSnapshot.verdicts) {
    const key = normalizeReqText(prev?.requirementText);
    if (!key) continue;
    if (!prevBuckets.has(key)) prevBuckets.set(key, []);
    prevBuckets.get(key).push(prev);
  }

  const transitions = {};
  let resolvedCount = 0;
  let regressedCount = 0;
  let changedCount = 0;

  for (const next of nextResult.verdicts) {
    const key = normalizeReqText(next?.requirementText);
    const bucket = prevBuckets.get(key);
    const prev = bucket && bucket.length > 0 ? bucket.shift() : null;
    if (!prev || typeof prev.status !== 'string' || prev.status === next.status) continue;

    changedCount++;
    let direction = 'changed';
    if (next.status === 'EVIDENCE_FOUND') {
      direction = 'resolved';
      resolvedCount++;
    } else if (next.status === 'POTENTIAL_MISSING' || prev.status === 'EVIDENCE_FOUND') {
      direction = 'regressed';
      regressedCount++;
    }

    transitions[String(next.id)] = {
      fromStatus: prev.status,
      toStatus: next.status,
      direction
    };
  }

  const prevVer = previousSnapshot.pageVersion ?? null;
  const nextVer = nextResult.pageVersion ?? null;
  const pageVersionChanged = prevVer !== null && nextVer !== null && prevVer !== nextVer;
  const diffChanged = Boolean(
    previousSnapshot.diffHash &&
    nextResult.diffHash &&
    previousSnapshot.diffHash !== nextResult.diffHash
  );

  return {
    previousCachedAt: previousSnapshot.cachedAt ?? null,
    previousPageVersion: prevVer,
    pageVersionChanged,
    diffChanged,
    resolvedCount,
    regressedCount,
    changedCount,
    transitions
  };
}

export function computeStaleness(
  cachedSnapshot,
  { livePageVersion = null, liveHeadCommit = null, liveRequirementCount = null, liveExtractionMode = null } = {}
) {
  if (!cachedSnapshot || typeof cachedSnapshot !== 'object') return null;

  const cachedPageVersion = cachedSnapshot.pageVersion ?? null;
  const cachedHeadCommit = cachedSnapshot.headCommit ?? cachedSnapshot.prMeta?.headCommit ?? null;
  const cachedReqCount = Array.isArray(cachedSnapshot.verdicts) ? cachedSnapshot.verdicts.length : null;
  const extractorDrifted = Boolean(
    (cachedReqCount !== null && liveRequirementCount !== null && cachedReqCount !== liveRequirementCount) ||
    (cachedSnapshot.extractionMode && liveExtractionMode && cachedSnapshot.extractionMode !== liveExtractionMode)
  );

  const specOutdated = Boolean(
    (cachedPageVersion !== null &&
      livePageVersion !== null &&
      livePageVersion !== undefined &&
      cachedPageVersion !== livePageVersion) ||
    extractorDrifted
  );

  const prOutdated = Boolean(
    cachedHeadCommit &&
    liveHeadCommit &&
    cachedHeadCommit !== liveHeadCommit
  );

  return {
    isStale: Boolean(specOutdated || prOutdated),
    specOutdated,
    prOutdated,
    cachedPageVersion,
    livePageVersion: livePageVersion ?? null,
    cachedHeadCommit,
    liveHeadCommit: liveHeadCommit ?? null
  };
}

export async function getCachedSnapshot(store, key) {
  if (!store || typeof store.get !== 'function' || typeof key !== 'string' || !key) return null;
  try {
    const record = await store.get(key);
    if (!record || typeof record !== 'object' || record.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(record.verdicts) || !record.summary || typeof record.summary !== 'object') return null;
    return record;
  } catch {
    return null;
  }
}

export async function saveCachedSnapshot(store, key, snapshot) {
  if (!store || typeof store.set !== 'function' || typeof key !== 'string' || !key || !snapshot) return false;
  const record = {
    schemaVersion: SCHEMA_VERSION,
    cachedAt: snapshot.cachedAt,
    issueKey: snapshot.issueKey,
    pageId: String(snapshot.pageId),
    pageTitle: snapshot.pageTitle ?? null,
    pageVersion: snapshot.pageVersion ?? null,
    extractionMode: snapshot.extractionMode ?? null,
    pullRequestUrl: snapshot.pullRequestUrl,
    headCommit: snapshot.headCommit ?? snapshot.prMeta?.headCommit ?? null,
    prMeta: snapshot.prMeta ?? null,
    diffHash: snapshot.diffHash ?? null,
    changedFiles: Array.isArray(snapshot.changedFiles) ? snapshot.changedFiles.slice(0, 60) : [],
    incompleteBatchCount: Number(snapshot.incompleteBatchCount ?? snapshot.summary?.incompleteBatchCount ?? 0),
    excludedFiles: Array.isArray(snapshot.excludedFiles) ? snapshot.excludedFiles : [],
    wasBudgeted: Boolean(snapshot.wasBudgeted),
    omittedFiles: Array.isArray(snapshot.omittedFiles) ? snapshot.omittedFiles : [],
    summary: snapshot.summary,
    verdicts: snapshot.verdicts,
    delta: snapshot.delta ?? null
  };
  try {
    let serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
      // Stage 1: compact citation snippets (remove verbose multi-line snippets while keeping path, line, text)
      if (Array.isArray(record.verdicts)) {
        record.verdicts = record.verdicts.map(v => {
          if (v?.citation?.snippet) {
            const { snippet, ...restCitation } = v.citation;
            return { ...v, citation: restCitation };
          }
          return v;
        });
        serialized = JSON.stringify(record);
      }
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
      // Stage 2: truncate reasoning in verdicts to 100 characters and limit auxiliary file lists
      if (Array.isArray(record.verdicts)) {
        record.verdicts = record.verdicts.map(v => {
          if (typeof v?.reasoning === 'string' && v.reasoning.length > 100) {
            return { ...v, reasoning: v.reasoning.slice(0, 97) + '...' };
          }
          return v;
        });
        record.changedFiles = record.changedFiles.slice(0, 20);
        record.excludedFiles = record.excludedFiles.slice(0, 10);
        record.omittedFiles = record.omittedFiles.slice(0, 10);
        serialized = JSON.stringify(record);
      }
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) return false;
    const setRes = await store.set(key, record);
    if (setRes === false) return false;
    return true;
  } catch {
    return false;
  }
}

export function buildIssueGateKey({ issueKey } = {}) {
  const issue = typeof issueKey === 'string' ? issueKey.trim().toUpperCase() : '';
  if (!issue) return null;
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([issue]))
    .digest('hex')
    .slice(0, 40);
  return `trace:gate:v1:${digest}`;
}

export async function getIssueGateSummary(store, key) {
  if (!store || typeof store.get !== 'function' || typeof key !== 'string' || !key) return null;
  try {
    const record = await store.get(key);
    if (!record || typeof record !== 'object' || record.schemaVersion !== SCHEMA_VERSION) return null;
    if (!record.summary || typeof record.summary !== 'object') return null;
    return record;
  } catch {
    return null;
  }
}

// Stores gate counts, verification metadata, and optional Tech Lead approval governance.
export async function saveIssueGateSummary(store, key, gateInput) {
  if (!store || typeof store.set !== 'function' || typeof key !== 'string' || !key || !gateInput?.summary) {
    return false;
  }
  const summary = gateInput.summary;
  const record = {
    schemaVersion: SCHEMA_VERSION,
    issueKey: String(gateInput.issueKey ?? '').trim().toUpperCase(),
    verifiedAt: gateInput.verifiedAt || new Date().toISOString(),
    pageId: gateInput.pageId ? String(gateInput.pageId) : null,
    pageVersion: gateInput.pageVersion ?? null,
    pullRequestUrl: gateInput.pullRequestUrl ?? null,
    headCommit: gateInput.headCommit ?? null,
    wasTruncated: Boolean(gateInput.wasTruncated),
    requireLeadApproval: Boolean(gateInput.requireLeadApproval),
    summary: {
      total: Number(summary.total ?? 0),
      inScopeTotal: Number(summary.inScopeTotal ?? 0),
      evidenceFound: Number(summary.evidenceFound ?? 0),
      potentialMissing: Number(summary.potentialMissing ?? 0),
      insufficientContext: Number(summary.insufficientContext ?? 0),
      outOfScope: Number(summary.outOfScope ?? 0),
      coverageRatio: Number(summary.coverageRatio ?? 0),
      incompleteBatchCount: Number(summary.incompleteBatchCount ?? gateInput.incompleteBatchCount ?? 0)
    },
    leadApproval: gateInput.leadApproval && typeof gateInput.leadApproval === 'object'
      ? {
          approved: Boolean(gateInput.leadApproval.approved),
          approvedBy: String(gateInput.leadApproval.approvedBy || '').trim(),
          approvedAt: String(gateInput.leadApproval.approvedAt || new Date().toISOString())
        }
      : null
  };
  try {
    const setRes = await store.set(key, record);
    if (setRes === false) return false;
    return true;
  } catch {
    return false;
  }
}
