const EXT_LANGUAGE_MAP = new Map([
  ['ts', 'typescript'],
  ['tsx', 'tsx'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'jsx'],
  ['py', 'python'],
  ['java', 'java'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rb', 'ruby'],
  ['php', 'php'],
  ['cs', 'csharp'],
  ['cpp', 'cpp'],
  ['c', 'c'],
  ['swift', 'swift'],
  ['kt', 'kotlin'],
  ['scala', 'scala'],
  ['json', 'json'],
  ['yml', 'yaml'],
  ['yaml', 'yaml'],
  ['css', 'css'],
  ['scss', 'sass'],
  ['html', 'html'],
  ['xml', 'xml'],
  ['sql', 'sql'],
  ['sh', 'bash'],
  ['bash', 'bash'],
  ['ps1', 'powershell'],
  ['md', 'markdown'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['toml', 'toml']
]);

export const STATUS_META = {
  EVIDENCE_FOUND: {
    label: 'Evidence Found',
    shortLabel: 'Found',
    lozengeAppearance: 'success'
  },
  POTENTIAL_MISSING: {
    label: 'Potential Missing',
    shortLabel: 'Missing Risk',
    lozengeAppearance: 'removed'
  },
  INSUFFICIENT_CONTEXT: {
    label: 'Insufficient Context',
    shortLabel: 'Needs Context',
    lozengeAppearance: 'moved'
  },
  OUT_OF_SCOPE: {
    label: 'Out of Scope',
    shortLabel: 'Out of Scope',
    lozengeAppearance: 'default'
  }
};

export function getStatusMeta(status) {
  return STATUS_META[status] || {
    label: status || 'Unknown',
    shortLabel: status || 'Unknown',
    lozengeAppearance: 'default'
  };
}

export function inferCodeLanguage(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return 'text';
  const base = filePath.split('/').pop() || '';
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return 'text';
  return EXT_LANGUAGE_MAP.get(base.slice(dot + 1).toLowerCase()) || 'text';
}

export function buildTabItems(verdicts) {
  const list = Array.isArray(verdicts) ? verdicts : [];
  return [
    { key: 'ALL', label: 'All', items: list },
    { key: 'POTENTIAL_MISSING', label: 'Missing Risk', items: list.filter(v => v.status === 'POTENTIAL_MISSING') },
    { key: 'EVIDENCE_FOUND', label: 'Found', items: list.filter(v => v.status === 'EVIDENCE_FOUND') },
    { key: 'INSUFFICIENT_CONTEXT', label: 'Needs Context', items: list.filter(v => v.status === 'INSUFFICIENT_CONTEXT') },
    { key: 'OUT_OF_SCOPE', label: 'Out of Scope', items: list.filter(v => v.status === 'OUT_OF_SCOPE') }
  ].map(tab => ({ ...tab, count: tab.items.length }));
}

export function buildDeltaBanner(delta) {
  if (!delta || typeof delta !== 'object') return null;
  const resolved = Number(delta.resolvedCount ?? 0);
  const regressed = Number(delta.regressedCount ?? 0);
  const changed = Number(delta.changedCount ?? 0);
  const versionNote = delta.pageVersionChanged ? ' (Confluence spec version updated)' : '';

  if (changed === 0) {
    return {
      appearance: 'information',
      title: `Re-verification complete${versionNote}`,
      body: delta.diffChanged || delta.pageVersionChanged
        ? 'Checked the latest spec and pull request diff — all requirement statuses remained unchanged.'
        : 'Spec version and pull request diff are unchanged since the previous snapshot.'
    };
  }

  if (regressed > 0) {
    return {
      appearance: 'warning',
      title: `Re-verification flagged ${regressed} regression(s)${versionNote}`,
      body: `${resolved} requirement(s) newly evidenced in code; ${regressed} requirement(s) moved to Potential Missing.`
    };
  }

  if (resolved > 0) {
    return {
      appearance: 'success',
      title: `${resolved} previously flagged requirement(s) now have verified code evidence${versionNote}`,
      body: `Updated ${changed} requirement status(es) against the latest pull request diff.`
    };
  }

  return {
    appearance: 'information',
    title: `Updated ${changed} requirement status(es)${versionNote}`,
    body: 'Requirement classifications changed after re-evaluating the latest spec and pull request diff.'
  };
}

export function formatTransitionBadge(transition) {
  if (!transition || typeof transition !== 'object' || !transition.fromStatus || !transition.toStatus) return null;
  const fromShort = getStatusMeta(transition.fromStatus).shortLabel.toUpperCase();
  const toShort = getStatusMeta(transition.toStatus).shortLabel.toUpperCase();

  if (transition.direction === 'resolved') {
    return { appearance: 'new', text: `RESOLVED: ${fromShort} -> ${toShort}` };
  }
  if (transition.direction === 'regressed') {
    return { appearance: 'removed', text: `REGRESSED: ${fromShort} -> ${toShort}` };
  }
  return { appearance: 'inprogress', text: `UPDATED: ${fromShort} -> ${toShort}` };
}

export function formatTimestamp(isoString) {
  if (typeof isoString !== 'string' || !isoString.trim()) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export function formatShortCommit(hash) {
  if (typeof hash !== 'string' || !hash.trim()) return null;
  const clean = hash.trim();
  if (!/^[a-fA-F0-9]{7,64}$/.test(clean)) return clean.slice(0, 12);
  return `#${clean.slice(0, 7)}`;
}

export function getPrStateLozenge(state) {
  if (typeof state !== 'string' || !state.trim()) return null;
  const upper = state.trim().toUpperCase();
  if (upper === 'OPEN') return { appearance: 'inprogress', label: 'PR OPEN' };
  if (upper === 'MERGED') return { appearance: 'success', label: 'PR MERGED' };
  if (upper === 'DECLINED' || upper === 'SUPERSEDED') return { appearance: 'removed', label: `PR ${upper}` };
  return { appearance: 'default', label: `PR ${upper}` };
}

export function formatWorkflowGateBadge(issueGate, staleness = null, { requireLeadApproval = false } = {}) {
  if (!issueGate || !issueGate.summary) {
    return {
      appearance: 'moved',
      label: 'Workflow Gate: UNVERIFIED'
    };
  }
  if (issueGate.wasTruncated) {
    return {
      appearance: 'removed',
      label: 'Workflow Gate: BLOCKED (Spec Truncated >30)'
    };
  }
  const missing = Number(issueGate.summary.potentialMissing ?? 0);
  if (missing > 0) {
    return {
      appearance: 'removed',
      label: `Workflow Gate: BLOCKED (${missing} Missing)`
    };
  }
  const incompleteBatchCount = Number(issueGate.summary.incompleteBatchCount ?? 0);
  if (incompleteBatchCount > 0) {
    return {
      appearance: 'removed',
      label: 'Workflow Gate: INCOMPLETE (Re-verify)'
    };
  }
  const inScopeTotal = Number(issueGate.summary.inScopeTotal ?? 0);
  const evidenceFound = Number(issueGate.summary.evidenceFound ?? 0);
  if (inScopeTotal <= 0) {
    return {
      appearance: 'removed',
      label: 'Workflow Gate: BLOCKED (0 In-Scope)'
    };
  }
  if (evidenceFound === 0) {
    return {
      appearance: 'removed',
      label: 'Workflow Gate: BLOCKED (0 Verified)'
    };
  }
  const coverageRatio = inScopeTotal > 0 ? evidenceFound / inScopeTotal : 0;
  if (coverageRatio < 0.8) {
    return {
      appearance: 'removed',
      label: `Workflow Gate: BLOCKED (Low Coverage ${(coverageRatio * 100).toFixed(0)}%)`
    };
  }
  if (staleness?.isStale) {
    if (staleness.specOutdated) {
      return { appearance: 'moved', label: 'Workflow Gate: STALE (Spec Updated)' };
    }
    if (staleness.prOutdated) {
      return { appearance: 'moved', label: 'Workflow Gate: STALE (New Commit)' };
    }
    return { appearance: 'moved', label: 'Workflow Gate: STALE (Re-verify)' };
  }

  const s = issueGate.summary;
  if (
    s.total !== undefined && s.inScopeTotal !== undefined && (
      s.total <= 0 ||
      (s.outOfScope !== undefined && s.inScopeTotal + s.outOfScope !== s.total) ||
      (s.evidenceFound !== undefined && s.potentialMissing !== undefined && s.insufficientContext !== undefined &&
       s.evidenceFound + s.potentialMissing + s.insufficientContext !== s.inScopeTotal)
    )
  ) {
    return {
      appearance: 'removed',
      label: 'Workflow Gate: BLOCKED (Invalid Metrics)'
    };
  }

  const mustApprove = requireLeadApproval || Boolean(issueGate.requireLeadApproval);
  if (mustApprove) {
    if (!issueGate.leadApproval?.approved) {
      return {
        appearance: 'inprogress',
        label: 'Workflow Gate: AWAITING SIGN-OFF'
      };
    }
    return {
      appearance: 'success',
      label: `Workflow Gate: PASS (Signed by ${issueGate.leadApproval.approvedBy || 'Lead'})`
    };
  }

  return {
    appearance: 'success',
    label: 'Workflow Gate: PASS (Ready)'
  };
}

export function buildStalenessBanner(staleness) {
  if (!staleness || typeof staleness !== 'object' || !staleness.isStale) return null;
  const reasons = [];
  if (staleness.specOutdated) {
    reasons.push(`Confluence spec updated from v${staleness.cachedPageVersion} to v${staleness.livePageVersion}`);
  }
  if (staleness.prOutdated) {
    const prevShort = formatShortCommit(staleness.cachedHeadCommit) || 'previous commit';
    const liveShort = formatShortCommit(staleness.liveHeadCommit) || 'latest commit';
    reasons.push(`Bitbucket PR head commit advanced from ${prevShort} to ${liveShort}`);
  }
  return {
    appearance: 'warning',
    title: 'Cached verification snapshot is outdated',
    body: `${reasons.join(' and ')}. Click "Re-verify Pull Request" to evaluate the latest changes.`
  };
}

export const LINT_STATUS_META = {
  TESTABLE: {
    label: 'Testable',
    shortLabel: 'Testable',
    lozengeAppearance: 'success'
  },
  AMBIGUOUS: {
    label: 'Ambiguous',
    shortLabel: 'Ambiguous',
    lozengeAppearance: 'removed'
  },
  UNVERIFIABLE_IN_DIFF: {
    label: 'Runtime / Non-Diff',
    shortLabel: 'Runtime / Non-Diff',
    lozengeAppearance: 'moved'
  }
};

export function getLintStatusMeta(status) {
  return LINT_STATUS_META[status] || {
    label: status || 'Unknown',
    shortLabel: status || 'Unknown',
    lozengeAppearance: 'default'
  };
}

export function buildLintTabItems(items) {
  const list = Array.isArray(items) ? items : [];
  return [
    { key: 'ALL', label: 'All', items: list },
    { key: 'AMBIGUOUS', label: 'Ambiguous', items: list.filter(i => i.status === 'AMBIGUOUS') },
    { key: 'UNVERIFIABLE_IN_DIFF', label: 'Runtime / Non-Diff', items: list.filter(i => i.status === 'UNVERIFIABLE_IN_DIFF') },
    { key: 'TESTABLE', label: 'Testable', items: list.filter(i => i.status === 'TESTABLE') }
  ].map(tab => ({ ...tab, count: tab.items.length }));
}

export function buildBitbucketFileUrl(pullRequestUrl, filePath) {
  if (typeof pullRequestUrl !== 'string' || !pullRequestUrl.trim()) return null;
  let parsed;
  try {
    parsed = new URL(pullRequestUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'bitbucket.org') {
    return null;
  }
  parsed.hash = '';
  const cleanBase = parsed.toString();
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return cleanBase;
  }
  const normalizedPath = filePath.replace(/^\/+/, '');
  return `${cleanBase}#chg-${encodeURI(normalizedPath)}`;
}

export function formatCitationLocation(citation) {
  if (!citation || typeof citation.path !== 'string' || !Number.isInteger(citation.line)) return '';
  const removedTag = citation.changeType === 'deleted' ? ' (removed)' : '';
  if (
    Number.isInteger(citation.startLine) &&
    Number.isInteger(citation.endLine) &&
    citation.startLine !== citation.endLine
  ) {
    return `${citation.path}:${citation.line} (L${citation.startLine}-L${citation.endLine})${removedTag}`;
  }
  return `${citation.path}:${citation.line}${removedTag}`;
}

function sanitizeMarkdownInline(text) {
  return String(text ?? '')
    .replace(/~{2,}/g, '-')
    .replace(/\r?\n+/g, ' ')
    .trim();
}

export function buildMarkdownReport(analysis) {
  if (!analysis || !Array.isArray(analysis.verdicts)) return '';
  const verdicts = analysis.verdicts;
  const summary = analysis.summary || {
    total: verdicts.length,
    evidenceFound: verdicts.filter(v => v.status === 'EVIDENCE_FOUND').length,
    potentialMissing: verdicts.filter(v => v.status === 'POTENTIAL_MISSING').length,
    insufficientContext: verdicts.filter(v => v.status === 'INSUFFICIENT_CONTEXT').length,
    outOfScope: verdicts.filter(v => v.status === 'OUT_OF_SCOPE').length,
    inScopeTotal: Math.max(0, verdicts.length - verdicts.filter(v => v.status === 'OUT_OF_SCOPE').length),
    coverageRatio: 0
  };
  const pct = Math.round((summary.coverageRatio || 0) * 100);
  const lines = [];

  lines.push('## Spec-to-Code Trace Review Report');
  const metaParts = [];
  if (analysis.pageTitle) {
    const verSuffix = analysis.pageVersion !== null && analysis.pageVersion !== undefined ? ` (v${analysis.pageVersion})` : '';
    metaParts.push(`**Spec**: ${sanitizeMarkdownInline(analysis.pageTitle)}${verSuffix}`);
  }
  if (analysis.issueKey) {
    metaParts.push(`**Issue**: ${sanitizeMarkdownInline(analysis.issueKey)}`);
  }
  if (metaParts.length > 0) {
    lines.push(metaParts.join(' | '));
  }
  if (analysis.pullRequestUrl) {
    const prDetails = [];
    if (analysis.prMeta?.state) prDetails.push(sanitizeMarkdownInline(analysis.prMeta.state.toUpperCase()));
    if (analysis.prMeta?.sourceBranch && analysis.prMeta?.destinationBranch) {
      prDetails.push(`${sanitizeMarkdownInline(analysis.prMeta.sourceBranch)} -> ${sanitizeMarkdownInline(analysis.prMeta.destinationBranch)}`);
    }
    const shortSha = formatShortCommit(analysis.headCommit || analysis.prMeta?.headCommit);
    if (shortSha) prDetails.push(`\`${shortSha}\``);
    const prSuffix = prDetails.length > 0 ? ` (${prDetails.join(' · ')})` : '';
    lines.push(`**Pull Request**: ${analysis.pullRequestUrl}${prSuffix}`);
  }
  lines.push(
    `**Verified Coverage**: ${summary.evidenceFound} / ${summary.inScopeTotal} in-scope criteria (${pct}%) — ` +
    `Found: ${summary.evidenceFound}, Missing Risk: ${summary.potentialMissing}, Needs Context: ${summary.insufficientContext}, Out of Scope: ${summary.outOfScope}`
  );
  if (Array.isArray(analysis.omittedFiles) && analysis.omittedFiles.length > 0) {
    lines.push(
      `**Large PR Budget Note**: Omitted ${analysis.omittedFiles.length} lower-priority file(s) to fit context limits (${analysis.omittedFiles.slice(0, 8).map(sanitizeMarkdownInline).join(', ')}).`
    );
  }
  lines.push('');

  const missing = verdicts.filter(v => v.status === 'POTENTIAL_MISSING');
  if (missing.length > 0) {
    lines.push('### Action Required — Potential Missing Criteria');
    for (const item of missing) {
      lines.push(`- [ ] **#${item.id}**: ${sanitizeMarkdownInline(item.requirementText)}`);
      lines.push(`  - Reviewer Note: ${sanitizeMarkdownInline(item.reasoning)}`);
    }
    lines.push('');
  }

  const contextItems = verdicts.filter(v => v.status === 'INSUFFICIENT_CONTEXT');
  if (contextItems.length > 0) {
    lines.push('### Needs Manual Context Check (Delegated / External)');
    for (const item of contextItems) {
      const cite = item.citation ? ` (\`${item.citation.path}:${item.citation.line}\`)` : '';
      lines.push(`- [ ] **#${item.id}**: ${sanitizeMarkdownInline(item.requirementText)}${cite}`);
      lines.push(`  - Note: ${sanitizeMarkdownInline(item.reasoning)}`);
    }
    lines.push('');
  }

  const found = verdicts.filter(v => v.status === 'EVIDENCE_FOUND');
  if (found.length > 0) {
    lines.push('### Verified Code Evidence');
    for (const item of found) {
      const removedNote = item.citation?.changeType === 'deleted' ? ' (removed)' : '';
      const cite = item.citation ? ` — \`${item.citation.path}:${item.citation.line}\`${removedNote}` : '';
      lines.push(`- [x] **#${item.id}**: ${sanitizeMarkdownInline(item.requirementText)}${cite}`);
    }
    lines.push('');
  }

  const outOfScope = verdicts.filter(v => v.status === 'OUT_OF_SCOPE');
  if (outOfScope.length > 0) {
    lines.push('### Out of Static Diff Scope (Verify via CI / Runtime Tests)');
    for (const item of outOfScope) {
      lines.push(`- **#${item.id}**: ${sanitizeMarkdownInline(item.requirementText)} — ${sanitizeMarkdownInline(item.reasoning)}`);
    }
    lines.push('');
  }

  lines.push('_Generated by Spec-to-Code Trace & Linter (Grounded added-line citation gate enabled; verify runtime behavior manually)._');
  return lines.join('\n');
}
