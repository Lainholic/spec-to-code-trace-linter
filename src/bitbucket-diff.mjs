const MAX_RAW_DIFF_CHARS = 500000;

function isSafeDiffRedirect(location, base) {
  if (location.origin !== 'https://api.bitbucket.org' || location.username || location.password || location.hash) {
    return false;
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(location.pathname); } catch { return false; }
  if (location.pathname.includes('\\') || decodedPath.includes('\\') || location.pathname.includes('//')) {
    return false;
  }
  const segments = location.pathname.split('/').slice(1);
  const decodedSegments = decodedPath.split('/').slice(1);
  if (segments.some(s => !s || s === '.' || s === '..') || decodedSegments.some(s => s === '.' || s === '..')) {
    return false;
  }
  if (!location.pathname.startsWith(`${base}/diff/`)) return false;
  const spec = location.pathname.slice(`${base}/diff/`.length);
  return spec.length > 0 && /^[a-zA-Z0-9_.:/%~{}-]+$/.test(spec);
}

function validatePullRequestRef(pr) {
  if (!pr || !/^[a-zA-Z0-9_-]+$/.test(pr.workspace ?? '') ||
      !/^[a-zA-Z0-9_.-]+$/.test(pr.repository ?? '') || ['.', '..'].includes(pr.repository) ||
      !/^\d{1,20}$/.test(pr.pullRequestId ?? '')) {
    throw new Error('Invalid Bitbucket pull request.');
  }
}

// The caller must provide a user-authorized Bitbucket request implementation.
export async function loadPullRequestDiff(pr, requestDiff) {
  validatePullRequestRef(pr);
  const base = `/2.0/repositories/${pr.workspace}/${pr.repository}`;
  let response = await requestDiff(`${base}/pullrequests/${pr.pullRequestId}/diff`);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    let location;
    try { location = new URL(response.headers.get('location')); } catch { throw new Error('Bitbucket returned an invalid diff redirect.'); }
    if (!isSafeDiffRedirect(location, base)) {
      throw new Error('Bitbucket returned an unsafe diff redirect.');
    }
    response = await requestDiff(`${location.pathname}${location.search}`);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Bitbucket authorization is required or access was denied.');
    throw new Error(`Bitbucket diff request failed (HTTP ${response.status}).`);
  }
  const size = Number(response.headers.get('content-length'));
  if (size > MAX_RAW_DIFF_CHARS) throw new Error('The pull request diff exceeds the 500 KB download limit.');
  const diff = await response.text();
  if (!diff.trim() || diff.length > MAX_RAW_DIFF_CHARS) {
    throw new Error('The diff is empty or exceeds the 500 KB download limit.');
  }
  return diff;
}

export async function loadPullRequestMetadata(pr, requestMeta) {
  validatePullRequestRef(pr);
  if (typeof requestMeta !== 'function') {
    throw new TypeError('Expected a Bitbucket metadata request function.');
  }
  const base = `/2.0/repositories/${pr.workspace}/${pr.repository}`;
  const response = await requestMeta(`${base}/pullrequests/${pr.pullRequestId}`);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Bitbucket authorization is required or access was denied.');
    }
    throw new Error(`Bitbucket PR metadata request failed (HTTP ${response.status}).`);
  }
  const data = await response.json();
  return {
    title: typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : null,
    state: typeof data?.state === 'string' && data.state.trim() ? data.state.trim() : null,
    sourceBranch: typeof data?.source?.branch?.name === 'string' && data.source.branch.name.trim()
      ? data.source.branch.name.trim()
      : null,
    destinationBranch: typeof data?.destination?.branch?.name === 'string' && data.destination.branch.name.trim()
      ? data.destination.branch.name.trim()
      : null,
    headCommit: typeof data?.source?.commit?.hash === 'string' && data.source.commit.hash.trim()
      ? data.source.commit.hash.trim()
      : null,
    updatedOn: typeof data?.updated_on === 'string' && data.updated_on.trim()
      ? data.updated_on.trim()
      : null
  };
}
