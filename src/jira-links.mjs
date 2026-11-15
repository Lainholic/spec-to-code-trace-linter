function pageFromUrl(rawUrl, globalId = null) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.atlassian.net') || url.username || url.password || url.port) return null;

  const pathMatch = /^\/wiki\/spaces\/[^/]+\/pages\/(?:edit-v2\/)?(\d{1,20})(?:\/([^/?#]+))?(?:\/|$)/.exec(url.pathname);
  let pageId = pathMatch?.[1] ?? (url.pathname === '/wiki/pages/viewpage.action' ? url.searchParams.get('pageId') : null);
  let slugTitle = null;
  if (pathMatch?.[2]) {
    try {
      const decoded = decodeURIComponent(pathMatch[2].replace(/\+/g, ' ')).trim();
      if (decoded) slugTitle = decoded;
    } catch {}
  }

  if (!pageId && url.pathname.startsWith('/wiki/') && typeof globalId === 'string') {
    const globalMatch = /(?:^|[?&])pageId=(\d{1,20})(?:&|$)/.exec(globalId);
    if (globalMatch) pageId = globalMatch[1];
  }

  if (!/^\d{1,20}$/.test(pageId ?? '')) return null;
  return { pageId, site: url.origin, slugTitle };
}

function pageFromLink(link) {
  const parsed = pageFromUrl(link?.object?.url, link?.globalId);
  if (!parsed) return null;
  return { pageId: parsed.pageId, site: parsed.site };
}

export function pullRequestFromUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'bitbucket.org' || url.username || url.password || url.port) return null;
  const match = /^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/pull-requests\/(\d{1,20})(?:\/|$)/.exec(url.pathname);
  return match
    ? {
        workspace: match[1],
        repository: match[2],
        pullRequestId: match[3],
        url: `https://bitbucket.org/${match[1]}/${match[2]}/pull-requests/${match[3]}`
      }
    : null;
}

export function extractUrlsFromAdf(adf) {
  if (!adf || typeof adf !== 'object') return [];
  const entries = new Map();

  const recordUrl = (rawUrl, rawTitle = null) => {
    if (typeof rawUrl !== 'string') return;
    const cleaned = rawUrl.trim().replace(/[.,;:!?]+$/, '');
    if (!cleaned.startsWith('https://')) return;
    const title = typeof rawTitle === 'string' && rawTitle.trim() && !rawTitle.trim().startsWith('https://')
      ? rawTitle.trim()
      : null;
    const existing = entries.get(cleaned);
    if (!existing) {
      entries.set(cleaned, { url: cleaned, title });
    } else if (!existing.title && title) {
      existing.title = title;
    }
  };

  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (['inlineCard', 'blockCard', 'embedCard'].includes(node.type)) {
      recordUrl(node.attrs?.url, null);
    }
    if (node.type === 'text') {
      const text = typeof node.text === 'string' ? node.text : '';
      if (Array.isArray(node.marks)) {
        for (const mark of node.marks) {
          if (mark?.type === 'link' && typeof mark.attrs?.href === 'string') {
            recordUrl(mark.attrs.href, text);
          }
        }
      }
      const inlineMatches = text.match(/https:\/\/[^\s)<>"'\]]+/g);
      if (inlineMatches) {
        for (const match of inlineMatches) {
          recordUrl(match, null);
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };

  walk(adf);
  return [...entries.values()];
}

export async function loadIssueLinks(issueKey, requestLinks, requestIssue = null) {
  if (typeof issueKey !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issueKey)) {
    throw new Error('Jira issue context is unavailable.');
  }
  const [response, issueResponse] = await Promise.all([
    requestLinks(issueKey),
    typeof requestIssue === 'function'
      ? Promise.resolve().then(() => requestIssue(issueKey)).catch(() => null)
      : Promise.resolve(null)
  ]);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('You do not have access to this Jira issue.');
    throw new Error(`Jira links request failed (HTTP ${response.status}).`);
  }
  const links = await response.json();
  if (!Array.isArray(links)) throw new Error('Jira returned invalid issue links.');
  const pages = new Map();
  const pullRequests = new Map();
  for (const link of links) {
    const page = pageFromLink(link);
    if (page) {
      const key = `${page.site}/${page.pageId}`;
      if (!pages.has(key)) {
        pages.set(key, {
          ...page,
          title: typeof link?.object?.title === 'string' && link.object.title.trim() ? link.object.title : 'Confluence page'
        });
      }
    }
    const pullRequest = pullRequestFromUrl(link?.object?.url);
    if (pullRequest && !pullRequests.has(pullRequest.url)) pullRequests.set(pullRequest.url, pullRequest);
  }

  if (issueResponse && issueResponse.ok && typeof issueResponse.json === 'function') {
    const issuePayload = await issueResponse.json().catch(() => null);
    const descAdf = issuePayload?.fields?.description;
    if (descAdf && typeof descAdf === 'object') {
      for (const entry of extractUrlsFromAdf(descAdf)) {
        const parsedPage = pageFromUrl(entry.url);
        if (parsedPage) {
          const key = `${parsedPage.site}/${parsedPage.pageId}`;
          if (!pages.has(key)) {
            pages.set(key, {
              pageId: parsedPage.pageId,
              site: parsedPage.site,
              title: entry.title || parsedPage.slugTitle || 'Confluence page'
            });
          }
        }
        const pullRequest = pullRequestFromUrl(entry.url);
        if (pullRequest && !pullRequests.has(pullRequest.url)) {
          pullRequests.set(pullRequest.url, pullRequest);
        }
      }
    }
  }

  return { pages: [...pages.values()], pullRequests: [...pullRequests.values()] };
}
