import { extractRequirementsWithMeta } from './adf-requirements.mjs';

function extractSafeWebUrl(links) {
  const base = links?.base;
  const webui = links?.webui;
  if (typeof base !== 'string' || typeof webui !== 'string' || !webui.startsWith('/')) return null;
  try {
    const baseUrl = new URL(base);
    if (baseUrl.protocol !== 'https:' || !baseUrl.hostname.endsWith('.atlassian.net') || baseUrl.username || baseUrl.password || baseUrl.port) {
      return null;
    }
    const basePath = baseUrl.pathname.replace(/\/$/, '');
    const suffix = webui.startsWith(basePath + '/') ? webui : `${basePath}${webui}`;
    return `${baseUrl.origin}${suffix}`;
  } catch {
    return null;
  }
}

export async function loadRequirements(pageId, requestPage) {
  const id = String(pageId ?? '').trim();
  if (!/^\d{1,20}$/.test(id)) throw new Error('Enter a numeric Confluence page ID.');

  const response = await requestPage(id);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('You do not have access to this Confluence page.');
    if (response.status === 404) throw new Error('Confluence page not found or not accessible.');
    throw new Error(`Confluence request failed (HTTP ${response.status}).`);
  }
  const page = await response.json();
  const body = page?.body?.atlas_doc_format?.value;
  if (typeof body !== 'string') throw new Error('Confluence did not return the page in ADF format.');
  let adf;
  try { adf = JSON.parse(body); } catch { throw new Error('Confluence returned an invalid page body.'); }
  const pageVersion = Number.isInteger(page?.version?.number) ? page.version.number : null;
  const webUrl = extractSafeWebUrl(page?._links);
  const { requirements, extractionMode, wasTruncated } = extractRequirementsWithMeta(adf);
  const result = {
    title: page.title,
    pageId: id,
    pageVersion,
    webUrl,
    extractionMode,
    requirements
  };
  if (wasTruncated) result.wasTruncated = true;
  return result;
}
