import api, { __getRuntime, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { chat } from '@forge/llm';
import { kvs } from '@forge/kvs';
import { analyzeChanges } from './analysis.mjs';
import { buildIssueGateKey, buildSpecLintCacheKey, getCachedSpecLint, getIssueGateSummary, saveIssueGateSummary } from './cache-store.mjs';
import { loadRequirements } from './confluence-page.mjs';
import { loadIssueLinks, pullRequestFromUrl } from './jira-links.mjs';
import { loadPullRequestMetadata } from './bitbucket-diff.mjs';
import { analyzeLinkedPullRequest, loadIssueContext } from './linked-analysis.mjs';
import { lintSpecForRovo, suggestFixForRovo, verifyIssueSpecForRovo } from './rovo-action.mjs';
import { lintConfluenceSpec } from './spec-linter.mjs';
import { validateIssueTransition } from './workflow-validator.mjs';
import { getProjectSettings as loadProjSettings, saveProjectSettings as persistProjSettings } from './project-settings.mjs';

function safeRuntimeAccountId() {
  try {
    const aaid = __getRuntime()?.aaid;
    return typeof aaid === 'string' && aaid.trim() ? aaid.trim() : null;
  } catch {
    return null;
  }
}

function createDeps({ allowBitbucketAuth = true } = {}) {
  let cachedHasCreds = null;
  const getBitbucketClient = () => api.asUser().withProvider('bitbucket-oauth', 'bitbucket-api');
  const checkHasCredentials = async () => {
    if (cachedHasCreds === null) {
      cachedHasCreds = Promise.resolve()
        .then(() => getBitbucketClient().hasCredentials())
        .catch(() => false);
    }
    return cachedHasCreds;
  };

  return {
    getRuntimeAccountId: safeRuntimeAccountId,
    loadLinks: issueKey => loadIssueLinks(
      issueKey,
      key => api.asUser().requestJira(
        route`/rest/api/3/issue/${key}/remotelink`,
        { headers: { Accept: 'application/json' } }
      ),
      key => api.asUser().requestJira(
        route`/rest/api/3/issue/${key}?fields=description`,
        { headers: { Accept: 'application/json' } }
      )
    ),
    loadPage: pageId => loadRequirements(pageId, id => api.asUser().requestConfluence(
      route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`,
      { headers: { Accept: 'application/json' } }
    )),
    hasBitbucketAuth: allowBitbucketAuth ? checkHasCredentials : undefined,
    connect: allowBitbucketAuth
      ? async () => {
          const bitbucket = getBitbucketClient();
          if (!(await checkHasCredentials())) {
            cachedHasCreds = null;
            await bitbucket.requestCredentials();
          }
          return path => bitbucket.fetch(path, { redirect: 'manual', headers: { Accept: 'text/plain' } });
        }
      : undefined,
    connectJson: allowBitbucketAuth
      ? async ({ interactive = false } = {}) => {
          const bitbucket = getBitbucketClient();
          if (!(await checkHasCredentials())) {
            if (!interactive) return null;
            cachedHasCreds = null;
            await bitbucket.requestCredentials();
          }
          return path => bitbucket.fetch(path, { redirect: 'manual', headers: { Accept: 'application/json' } });
        }
      : undefined,
    chat,
    store: kvs
  };
}

const resolver = new Resolver();

resolver.define('loadIssueContext', async ({ payload, context }) => {
  return loadIssueContext(
    {
      accountId: context?.accountId || safeRuntimeAccountId(),
      siteUrl: context?.siteUrl,
      issueKey: context?.extension?.issue?.key,
      pageId: payload?.pageId,
      pullRequestUrl: payload?.pullRequestUrl
    },
    createDeps()
  );
});

resolver.define('loadIssueLinks', async ({ context }) => {
  return createDeps().loadLinks(context?.extension?.issue?.key);
});

resolver.define('loadRequirements', async ({ payload }) => {
  return createDeps().loadPage(payload?.pageId);
});

resolver.define('analyzeDiff', async ({ payload }) => {
  const deps = createDeps();
  const page = await deps.loadPage(payload?.pageId);
  return analyzeChanges(page.requirements, payload?.diff, chat);
});

resolver.define('analyzeLinkedPullRequest', async ({ payload, context }) => {
  const startedAt = Date.now();
  const forceRefresh = Boolean(payload?.forceRefresh);
  try {
    const result = await analyzeLinkedPullRequest(
      {
        accountId: context?.accountId || safeRuntimeAccountId(),
        siteUrl: context?.siteUrl,
        issueKey: context?.extension?.issue?.key,
        pageId: payload?.pageId,
        pullRequestUrl: payload?.pullRequestUrl,
        forceRefresh
      },
      createDeps()
    );
    console.info(JSON.stringify({
      event: 'analyzeLinkedPullRequest.ok',
      forceRefresh,
      fromCache: Boolean(result?.fromCache),
      durationMs: Date.now() - startedAt,
      summary: result?.summary ?? null
    }));
    return result;
  } catch (err) {
    console.warn(JSON.stringify({
      event: 'analyzeLinkedPullRequest.failed',
      forceRefresh,
      durationMs: Date.now() - startedAt,
      errorType: err?.name || 'Error',
      reason: String(err?.message || 'unknown').slice(0, 120)
    }));
    throw err;
  }
});

resolver.define('loadConfluenceBylineContext', async ({ payload, context }) => {
  const deps = createDeps();
  const accountId = context?.accountId || safeRuntimeAccountId();
  const pageId = String(payload?.pageId ?? context?.extension?.content?.id ?? '').trim();
  const page = await deps.loadPage(pageId);
  const lintKey = buildSpecLintCacheKey({
    accountId,
    pageId: page.pageId,
    pageVersion: page.pageVersion
  });
  const rawCachedLint = lintKey ? await getCachedSpecLint(deps.store, lintKey) : null;
  const cachedLint = rawCachedLint &&
    Array.isArray(rawCachedLint.items) &&
    rawCachedLint.items.length === page.requirements.length &&
    (!page.extractionMode || !rawCachedLint.extractionMode || rawCachedLint.extractionMode === page.extractionMode)
      ? rawCachedLint
      : null;
  return {
    page,
    cachedLint: cachedLint ? { ...cachedLint, fromCache: true } : null
  };
});

resolver.define('lintConfluencePage', async ({ payload, context }) => {
  const pageId = String(payload?.pageId ?? context?.extension?.content?.id ?? '').trim();
  return lintConfluenceSpec(
    {
      accountId: context?.accountId || safeRuntimeAccountId(),
      pageId,
      forceRefresh: Boolean(payload?.forceRefresh)
    },
    createDeps()
  );
});

resolver.define('suggestRequirementFix', async ({ payload, context }) => {
  const startedAt = Date.now();
  try {
    const result = await suggestFixForRovo(
      {
        ...payload,
        issueKey: payload?.issueKey || context?.extension?.issue?.key
      },
      context,
      createDeps()
    );
    console.info(JSON.stringify({
      event: 'suggestRequirementFix.ok',
      durationMs: Date.now() - startedAt,
      source: result?.remediation?.source ?? null,
      alreadyImplemented: Boolean(result?.remediation?.alreadyImplemented)
    }));
    return result;
  } catch (err) {
    console.warn(JSON.stringify({
      event: 'suggestRequirementFix.failed',
      durationMs: Date.now() - startedAt,
      errorType: err?.name || 'Error',
      reason: String(err?.message || 'unknown').slice(0, 120)
    }));
    throw err;
  }
});

async function checkProjectAdminPermission(projectKey) {
  if (!projectKey) {
    throw new Error('Permission Denied: Missing projectKey.');
  }
  if (typeof api?.asUser !== 'function') {
    return true;
  }
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`);
    if (res && res.ok) {
      const data = await res.json();
      const havePerm = data?.permissions?.ADMINISTER_PROJECTS?.havePermission;
      if (havePerm === true) {
        return true;
      }
      throw new Error('Permission Denied: Only Project Administrators or Tech Leads with ADMINISTER_PROJECTS permission can perform this action.');
    }
    throw new Error(`Permission Check Failed: HTTP ${res?.status || 'unknown'}`);
  } catch (err) {
    if (err?.message?.includes('Permission Denied')) throw err;
    throw new Error(`Permission Verification Failed: ${err?.message || 'Access check failed'}`);
  }
}

resolver.define('approveTraceGate', async ({ payload, context }) => {
  const issueKey = payload?.issueKey || context?.extension?.issue?.key;
  if (!issueKey) throw new Error('Cannot approve trace gate without an issue key.');
  const projectKey = issueKey.includes('-') ? issueKey.split('-')[0].toUpperCase() : null;
  if (projectKey) {
    await checkProjectAdminPermission(projectKey);
  }
  const gateKey = buildIssueGateKey({ issueKey });
  const gate = gateKey ? await getIssueGateSummary(kvs, gateKey) : null;
  if (!gate || !gate.summary) {
    throw new Error(`No verification gate record found for ${issueKey}. Verify requirements before approving.`);
  }
  const approver = context?.accountId || safeRuntimeAccountId() || 'Tech Lead';
  gate.leadApproval = {
    approved: true,
    approvedBy: approver,
    approvedAt: new Date().toISOString()
  };
  const saved = await saveIssueGateSummary(kvs, gateKey, gate);
  if (!saved) throw new Error('Failed to record lead approval in storage.');
  return gate;
});

resolver.define('getProjectSettings', async ({ payload, context }) => {
  const projectId = String(payload?.projectId || context?.extension?.project?.id || context?.extension?.project?.key || '').trim();
  if (!projectId) return null;
  return loadProjSettings(kvs, projectId);
});

resolver.define('saveProjectSettings', async ({ payload, context }) => {
  const projectId = String(payload?.projectId || context?.extension?.project?.id || context?.extension?.project?.key || '').trim();
  if (!projectId) throw new Error('Missing project identifier');
  await checkProjectAdminPermission(projectId.toUpperCase());
  const userAccountId = context?.accountId || safeRuntimeAccountId();
  const ok = await persistProjSettings(kvs, projectId, payload?.settings, { userAccountId });
  if (!ok) throw new Error('Failed to save project settings to storage');
  return loadProjSettings(kvs, projectId);
});

export const handler = resolver.getDefinitions();

export async function rovoVerifyHandler(payload, context) {
  return verifyIssueSpecForRovo(payload, context, createDeps());
}

export async function rovoLintSpecHandler(payload, context) {
  return lintSpecForRovo(payload, context, createDeps({ allowBitbucketAuth: false }));
}

export async function rovoSuggestFixHandler(payload, context) {
  return suggestFixForRovo(payload, context, createDeps({ allowBitbucketAuth: false }));
}

function resolveEventSiteOrigin(event) {
  const candidate = event?.siteUrl || event?.context?.siteUrl || event?.context?.cloudUrl || null;
  if (typeof candidate === 'string' && candidate.startsWith('https://')) {
    try { return new URL(candidate).origin; } catch {}
  }
  return null;
}

export async function workflowValidatorHandler(event) {
  return validateIssueTransition(event, {
    store: kvs,
    siteOrigin: resolveEventSiteOrigin(event),
    loadLinks: issueKey => loadIssueLinks(
      issueKey,
      key => api.asApp().requestJira(
        route`/rest/api/3/issue/${key}/remotelink`,
        { headers: { Accept: 'application/json' } }
      ),
      key => api.asApp().requestJira(
        route`/rest/api/3/issue/${key}?fields=description`,
        { headers: { Accept: 'application/json' } }
      )
    ),
    loadPage: async (pageId) => {
      try {
        const client = typeof api.asUser === 'function' ? api.asUser() : api.asApp();
        return await loadRequirements(pageId, id => client.requestConfluence(
          route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`,
          { headers: { Accept: 'application/json' } }
        ));
      } catch {
        try {
          return await loadRequirements(pageId, id => api.asApp().requestConfluence(
            route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`,
            { headers: { Accept: 'application/json' } }
          ));
        } catch {
          return undefined;
        }
      }
    },
    loadPrMeta: async (pullRequestUrl) => {
      const pr = pullRequestFromUrl(pullRequestUrl);
      if (!pr) return undefined;
      try {
        const bb = api.asUser().withProvider('bitbucket-oauth', 'bitbucket-api');
        if (!await bb.hasCredentials()) return undefined;
        return await loadPullRequestMetadata(pr, path => bb.fetch(path, { headers: { Accept: 'application/json' } }));
      } catch {
        return undefined;
      }
    }
  });
}
