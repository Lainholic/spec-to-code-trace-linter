import { buildIssueGateKey, getIssueGateSummary } from './cache-store.mjs';
import { pullRequestFromUrl } from './jira-links.mjs';
import { getProjectSettings } from './project-settings.mjs';

export async function validateIssueTransition(
  event,
  { store, loadLinks, loadPage, loadPrMeta, siteOrigin = null, strictResolution = null, minCoverageRatio = null, requireLeadApproval = null } = {}
) {
  const issueKey = typeof event?.issue?.key === 'string' ? event.issue.key.trim() : '';
  if (!issueKey) {
    return {
      result: false,
      errorMessage: 'Spec-to-Code Trace Gate could not determine the Jira issue key for this transition.'
    };
  }

  const projectKey = issueKey.includes('-') ? issueKey.split('-')[0].toUpperCase() : null;
  const projectSettings = projectKey && store
    ? await getProjectSettings(store, projectKey)
    : null;

  const effectiveMinCoverage = typeof minCoverageRatio === 'number'
    ? minCoverageRatio
    : (projectSettings?.minCoverageRatio ?? 0.8);

  const effectiveStrict = strictResolution !== null
    ? Boolean(strictResolution)
    : Boolean(projectSettings?.strictResolution);

  const effectiveRequireApproval = requireLeadApproval !== null
    ? Boolean(requireLeadApproval)
    : Boolean(projectSettings?.requireLeadApproval);

  const gateKey = buildIssueGateKey({ issueKey });
  const gate = gateKey ? await getIssueGateSummary(store, gateKey) : null;

  if (!gate) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: run "Verify Requirements" on a linked Confluence spec and Bitbucket PR before moving this issue forward.`
    };
  }

  if (projectSettings?.allowedWorkspace && gate.pullRequestUrl) {
    const pr = pullRequestFromUrl(gate.pullRequestUrl);
    if (pr && pr.workspace.toLowerCase() !== projectSettings.allowedWorkspace.toLowerCase()) {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: pull request workspace (${pr.workspace}) does not match required workspace policy (${projectSettings.allowedWorkspace}).`
      };
    }
  }

  const s = gate.summary;
  const rawIncomplete = s?.incompleteBatchCount ?? gate?.incompleteBatchCount ?? 0;
  const incompleteBatchCount = Number.isInteger(rawIncomplete) ? rawIncomplete : 0;
  const countFields = [
    s?.total,
    s?.inScopeTotal,
    s?.evidenceFound,
    s?.potentialMissing,
    s?.insufficientContext,
    s?.outOfScope,
    incompleteBatchCount
  ];
  const allValidIntegers = countFields.every(c => Number.isInteger(c) && c >= 0);
  if (!allValidIntegers || s.total <= 0) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: gate record has invalid, non-numeric, or empty criteria metrics.`
    };
  }

  // Schema invariant: total must equal inScope + outOfScope, and inScope must equal found + missing + needsContext
  if (
    s.inScopeTotal + s.outOfScope !== s.total ||
    s.evidenceFound + s.potentialMissing + s.insufficientContext !== s.inScopeTotal
  ) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: gate record has inconsistent criteria metrics (total must equal inScope + outOfScope, and inScope must equal found + missing + needsContext).`
    };
  }

  // Issue identity invariant: gate record must belong to this exact issue
  if (gate.issueKey && gate.issueKey.toUpperCase() !== issueKey.toUpperCase()) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: gate record belongs to ${gate.issueKey}, not ${issueKey}.`
    };
  }

  const missingCount = s.potentialMissing;
  const foundCount = s.evidenceFound;
  const inScopeTotal = s.inScopeTotal;
  const insufficientCount = s.insufficientContext;

  if (inScopeTotal <= 0) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: 0 in-scope functional requirements were found (all items classified out of scope). Ensure the specification defines testable requirements.`
    };
  }

  if (gate.wasTruncated) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: Confluence specification exceeds the 30-item limit and was truncated. Split the specification into smaller, testable sub-pages before transition.`
    };
  }

  if (incompleteBatchCount > 0) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: ${incompleteBatchCount} verification batch(es) timed out or failed before all requirements were audited. Click "Re-verify Pull Request" to complete full verification.`
    };
  }

  if (missingCount > 0) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: ${missingCount} requirement(s) are still flagged as Potential Missing (${foundCount}/${inScopeTotal} in-scope criteria verified). Resolve missing criteria and click "Re-verify Pull Request".`
    };
  }

  if (inScopeTotal > 0 && foundCount === 0) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: 0/${inScopeTotal} in-scope criteria have verified code evidence (${insufficientCount} marked Needs Context). Provide verifiable code diff evidence and re-verify.`
    };
  }

  if (effectiveStrict && insufficientCount > 0) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: ${insufficientCount} requirement(s) are marked Needs Context (${foundCount}/${inScopeTotal} verified). Strict gate requires all in-scope criteria to have verified code evidence.`
    };
  }

  const actualRatio = inScopeTotal > 0 ? foundCount / inScopeTotal : 0;
  if (actualRatio < effectiveMinCoverage) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: evidence coverage ratio (${(actualRatio * 100).toFixed(1)}%) is below required threshold (${(effectiveMinCoverage * 100).toFixed(0)}%). Only ${foundCount}/${inScopeTotal} criteria verified (${insufficientCount} Needs Context).`
    };
  }

  if (typeof loadLinks === 'function') {
    let links;
    try {
      links = await loadLinks(issueKey);
    } catch {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: could not verify live Jira issue link integrity. Retry or re-verify.`
      };
    }
    const prStillLinked = Array.isArray(links?.pullRequests) &&
      links.pullRequests.some(pr => pr.url === gate.pullRequestUrl);
    if (!prStillLinked) {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: the verified pull request is no longer linked to this issue. Run "Verify Requirements" against the active pull request.`
      };
    }
    const pageStillLinked = Array.isArray(links?.pages) &&
      links.pages.some(p =>
        String(p.pageId) === String(gate.pageId) &&
        (!siteOrigin || !p.site || p.site === siteOrigin)
      );
    if (!pageStillLinked) {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: verified Confluence specification (page ${gate.pageId}) is not linked to this issue. Link the specification page on the Jira issue and re-verify.`
      };
    }
  }

  if (typeof loadPrMeta === 'function' && gate.pullRequestUrl) {
    let livePr;
    try {
      livePr = await loadPrMeta(gate.pullRequestUrl);
    } catch {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: could not verify live Bitbucket pull request commit integrity.`
      };
    }
    if (livePr === null || (livePr && !livePr.headCommit)) {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: unable to resolve live Bitbucket pull request head commit. Re-verify Pull Request.`
      };
    }
    if (livePr && (!gate.headCommit || livePr.headCommit !== gate.headCommit)) {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: pull request commit drifted from #${(gate.headCommit || 'none').slice(0, 7)} to #${livePr.headCommit.slice(0, 7)}. Click "Re-verify Pull Request" before moving forward.`
      };
    }
  }

  if (typeof loadPage === 'function' && gate.pageId) {
    let livePage;
    try {
      livePage = await loadPage(gate.pageId);
    } catch {
      return {
        result: false,
        errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: could not load linked Confluence specification (page ${gate.pageId}) to verify version integrity.`
      };
    }
    if (livePage === undefined) {
      // Live Confluence unavailable from Jira workflow validator context — rely on verified KVS gate record
    } else {
      const liveVer = livePage?.pageVersion;
      if (liveVer === null || liveVer === undefined) {
        return {
          result: false,
          errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: unable to verify live Confluence page version. Click "Re-verify Pull Request" before moving forward.`
        };
      }
      if (gate.pageVersion === null || gate.pageVersion === undefined || gate.pageVersion !== liveVer) {
        return {
          result: false,
          errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: Confluence specification updated from v${gate.pageVersion ?? 'unknown'} to v${liveVer} after verification. Click "Re-verify Pull Request" before moving this issue forward.`
        };
      }
    }
  }

  const mustApprove = effectiveRequireApproval || Boolean(gate.requireLeadApproval);
  if (mustApprove && !gate.leadApproval?.approved) {
    return {
      result: false,
      errorMessage: `Spec-to-Code Trace Gate blocked transition for ${issueKey}: Human-in-the-Loop governance requires Tech Lead sign-off before transition. Review the trace report and click "Approve Trace Gate" in the issue panel.`
    };
  }

  const res = { result: true };
  if (gate.leadApproval?.approved) {
    res.leadApproved = true;
    res.approvedBy = gate.leadApproval.approvedBy || null;
  }
  return res;
}
