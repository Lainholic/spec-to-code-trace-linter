import { loadPullRequestDiff, loadPullRequestMetadata } from './bitbucket-diff.mjs';
import { analyzeChanges } from './analysis.mjs';
import {
  buildCacheKey,
  buildIssueGateKey,
  buildIssueSelectionKey,
  computeDelta,
  computeStaleness,
  getCachedSnapshot,
  getIssueGateSummary,
  getLastIssueSelection,
  saveCachedSnapshot,
  saveIssueGateSummary,
  saveLastIssueSelection
} from './cache-store.mjs';

function normalizeOrigin(siteUrl) {
  if (typeof siteUrl !== 'string' || !siteUrl.trim()) return null;
  try {
    return new URL(siteUrl).origin;
  } catch {
    return siteUrl.replace(/\/$/, '');
  }
}

function isNumericPageId(value) {
  return /^\d{1,20}$/.test(String(value ?? '').trim());
}

async function tryFetchPrMetadata(pr, { hasBitbucketAuth, connectJson } = {}) {
  if (!pr || typeof connectJson !== 'function') return null;
  try {
    if (typeof hasBitbucketAuth === 'function') {
      const authed = await hasBitbucketAuth();
      if (!authed) return null;
    }
    const requestMeta = await connectJson({ interactive: false });
    if (typeof requestMeta !== 'function') return null;
    return await loadPullRequestMetadata(pr, requestMeta);
  } catch {
    return null;
  }
}

export async function loadIssueContext(
  { accountId, siteUrl, issueKey, pageId, pullRequestUrl },
  { loadLinks, loadPage, hasBitbucketAuth, connectJson, store }
) {
  const links = await loadLinks(issueKey);
  const origin = normalizeOrigin(siteUrl);
  const sameSitePages = origin ? links.pages.filter(page => page.site === origin) : links.pages;
  const skippedCrossSiteCount = Math.max(0, links.pages.length - sameSitePages.length);

  const selectionKey = buildIssueSelectionKey({ accountId, issueKey });
  const savedSelection = selectionKey ? await getLastIssueSelection(store, selectionKey) : null;

  const explicitPageId = isNumericPageId(pageId) ? String(pageId).trim() : null;
  const selectedPageId = explicitPageId
    || (savedSelection?.pageId && (!sameSitePages.length || sameSitePages.some(p => p.pageId === savedSelection.pageId) || isNumericPageId(savedSelection.pageId))
      ? savedSelection.pageId
      : null)
    || (sameSitePages[0]?.pageId ?? null);

  const selectedPullRequestUrl = (pullRequestUrl && links.pullRequests.some(pr => pr.url === pullRequestUrl)
    ? pullRequestUrl
    : null)
    || (savedSelection?.pullRequestUrl && links.pullRequests.some(pr => pr.url === savedSelection.pullRequestUrl)
      ? savedSelection.pullRequestUrl
      : null)
    || (links.pullRequests[0]?.url ?? null);

  const selectedPr = selectedPullRequestUrl
    ? links.pullRequests.find(pr => pr.url === selectedPullRequestUrl) || null
    : null;

  const [pageResult, prMeta] = await Promise.all([
    (async () => {
      if (!selectedPageId || typeof loadPage !== 'function') return { page: null, pageError: null };
      try {
        return { page: await loadPage(selectedPageId), pageError: null };
      } catch (err) {
        return { page: null, pageError: err?.message || 'Could not load linked Confluence page.' };
      }
    })(),
    tryFetchPrMetadata(selectedPr, { hasBitbucketAuth, connectJson })
  ]);

  const { page, pageError } = pageResult;

  const isAccessDenied = Boolean(
    pageError &&
    /access.*denied|do not have access|unauthorized|forbidden|HTTP (?:401|403)|not found|404/i.test(pageError)
  );

  let cachedAnalysis = null;
  if (accountId && selectedPageId && selectedPullRequestUrl && store) {
    if (!pageError) {
      const cacheKey = buildCacheKey({
        accountId,
        issueKey,
        pageId: selectedPageId,
        pullRequestUrl: selectedPullRequestUrl
      });
      cachedAnalysis = await getCachedSnapshot(store, cacheKey);
    }
  }

  const staleness = cachedAnalysis
    ? computeStaleness(cachedAnalysis, {
        livePageVersion: page?.pageVersion ?? null,
        liveHeadCommit: prMeta?.headCommit ?? null,
        liveRequirementCount: Array.isArray(page?.requirements) ? page.requirements.length : null,
        liveExtractionMode: page?.extractionMode ?? null
      })
    : null;

  const gateKey = buildIssueGateKey({ issueKey });
  const issueGate = gateKey && store ? await getIssueGateSummary(store, gateKey) : null;

  if (selectionKey && explicitPageId && page) {
    await saveLastIssueSelection(store, selectionKey, {
      pageId: explicitPageId,
      pullRequestUrl: selectedPullRequestUrl
    });
  }

  return {
    issueKey,
    pages: sameSitePages,
    skippedCrossSiteCount,
    pullRequests: links.pullRequests,
    selectedPageId,
    selectedPullRequestUrl,
    page,
    pageError,
    accessDenied: isAccessDenied,
    prMeta: prMeta || cachedAnalysis?.prMeta || null,
    staleness,
    issueGate,
    cachedAnalysis
  };
}

export async function analyzeLinkedPullRequest(
  { accountId, siteUrl, issueKey, pageId, pullRequestUrl, forceRefresh = false },
  { loadLinks, loadPage, connect, connectJson, chat, store = null, now = () => new Date().toISOString() }
) {
  const selectionKey = buildIssueSelectionKey({ accountId, issueKey });
  const cacheKey = buildCacheKey({ accountId, issueKey, pageId, pullRequestUrl });
  const gateKey = buildIssueGateKey({ issueKey });

  const [links, previousSnapshot] = await Promise.all([
    loadLinks(issueKey),
    cacheKey && store ? getCachedSnapshot(store, cacheKey) : Promise.resolve(null)
  ]);

  const pr = links.pullRequests.find(item => item.url === pullRequestUrl);
  if (!pr) throw new Error('This pull request is not linked to the current issue.');
  const origin = normalizeOrigin(siteUrl);
  const eligiblePages = origin ? links.pages.filter(p => p.site === origin) : links.pages;
  const isLinkedPage = eligiblePages.some(item => String(item.pageId) === String(pageId));

  if (!forceRefresh && previousSnapshot) {
    if (typeof loadPage === 'function') {
      try {
        await loadPage(pageId);
      } catch (err) {
        throw new Error(err?.message || 'Confluence specification is not accessible or was removed.');
      }
    }
    let issueGate = gateKey && store ? await getIssueGateSummary(store, gateKey) : null;
    const writes = [];
    if (selectionKey && store) {
      writes.push(saveLastIssueSelection(store, selectionKey, {
        pageId: String(pageId),
        pullRequestUrl: pr.url,
        updatedAt: previousSnapshot.cachedAt
      }));
    }
    if (isLinkedPage && !issueGate && gateKey && store && previousSnapshot.summary) {
      const backfilledGate = {
        issueKey: String(issueKey ?? '').trim().toUpperCase(),
        verifiedAt: previousSnapshot.cachedAt,
        pageId: String(pageId),
        pageVersion: previousSnapshot.pageVersion ?? null,
        pullRequestUrl: pr.url,
        headCommit: previousSnapshot.headCommit ?? null,
        wasTruncated: Boolean(previousSnapshot.wasTruncated),
        incompleteBatchCount: Number(previousSnapshot.incompleteBatchCount ?? previousSnapshot.summary?.incompleteBatchCount ?? 0),
        summary: previousSnapshot.summary
      };
      writes.push(saveIssueGateSummary(store, gateKey, backfilledGate));
      issueGate = backfilledGate;
    }
    if (writes.length > 0) await Promise.all(writes);
    return {
      ...previousSnapshot,
      issueGate,
      gateSkippedUnlinkedPage: !isLinkedPage,
      fromCache: true
    };
  }

  const [page, requestDiff] = await Promise.all([
    loadPage(pageId),
    connect()
  ]);
  if (!page.requirements.length) throw new Error('No acceptance criteria found on this page.');

  const [diff, prMeta] = await Promise.all([
    loadPullRequestDiff(pr, requestDiff),
    tryFetchPrMetadata(pr, { connectJson })
  ]);
  const analysis = await analyzeChanges(page.requirements, diff, chat);

  const cachedAt = now();
  const delta = previousSnapshot
    ? computeDelta(previousSnapshot, {
        verdicts: analysis.verdicts,
        pageVersion: page.pageVersion ?? null,
        diffHash: analysis.diffHash
      })
    : null;

  const headCommit = prMeta?.headCommit ?? null;
  const resultRecord = {
    issueKey,
    pageId: String(pageId),
    pageTitle: page.title ?? null,
    pageVersion: page.pageVersion ?? null,
    extractionMode: page.extractionMode ?? null,
    pullRequestUrl: pr.url,
    headCommit,
    prMeta: prMeta ?? null,
    cachedAt,
    fromCache: false,
    wasTruncated: Boolean(page.wasTruncated),
    verdicts: analysis.verdicts,
    summary: analysis.summary,
    changedFiles: analysis.changedFiles || [],
    incompleteBatchCount: Number(analysis.incompleteBatchCount ?? 0),
    excludedFiles: analysis.excludedFiles,
    wasBudgeted: Boolean(analysis.wasBudgeted),
    omittedFiles: analysis.omittedFiles || [],
    diffHash: analysis.diffHash,
    usage: analysis.usage,
    delta
  };

  const gatePayload = {
    issueKey: String(issueKey ?? '').trim().toUpperCase(),
    verifiedAt: cachedAt,
    pageId: String(pageId),
    pageVersion: page.pageVersion ?? null,
    pullRequestUrl: pr.url,
    headCommit,
    wasTruncated: Boolean(page.wasTruncated),
    incompleteBatchCount: Number(analysis.incompleteBatchCount ?? 0),
    summary: analysis.summary
  };

  const persistOps = [];
  if (cacheKey && store) persistOps.push(saveCachedSnapshot(store, cacheKey, resultRecord));
  if (selectionKey && store) {
    persistOps.push(saveLastIssueSelection(store, selectionKey, {
      pageId: String(pageId),
      pullRequestUrl: pr.url,
      updatedAt: cachedAt
    }));
  }
  let activeIssueGate = null;
  let gatePersisted = false;
  if (gateKey && store) {
    if (isLinkedPage) {
      gatePersisted = await saveIssueGateSummary(store, gateKey, gatePayload);
      if (!gatePersisted && typeof store.delete === 'function') {
        await store.delete(gateKey).catch(() => {});
      }
      activeIssueGate = gatePersisted ? gatePayload : null;
    } else {
      activeIssueGate = await getIssueGateSummary(store, gateKey);
    }
  }
  if (persistOps.length > 0) await Promise.all(persistOps);

  return {
    ...resultRecord,
    issueGate: activeIssueGate,
    gatePersisted: isLinkedPage ? gatePersisted : null,
    gateSkippedUnlinkedPage: !isLinkedPage
  };
}
