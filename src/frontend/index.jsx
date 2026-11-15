import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  CodeBlock,
  Form,
  FormFooter,
  Heading,
  Inline,
  Label,
  LinkButton,
  LoadingButton,
  Lozenge,
  ProgressBar,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  Textfield,
  useForm,
  useProductContext,
  xcss
} from '@forge/react';
import { invoke } from '@forge/bridge';
import {
  buildBitbucketFileUrl,
  buildDeltaBanner,
  buildMarkdownReport,
  buildStalenessBanner,
  buildTabItems,
  formatCitationLocation,
  formatShortCommit,
  formatTimestamp,
  formatTransitionBadge,
  formatWorkflowGateBadge,
  getLintStatusMeta,
  getPrStateLozenge,
  getStatusMeta,
  inferCodeLanguage
} from './view-model.mjs';

const cardStyle = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.medium'
});

const verdictCardStyles = {
  EVIDENCE_FOUND: xcss({
    borderColor: 'color.border.success',
    borderStyle: 'solid',
    borderWidth: 'border.width',
    borderRadius: 'radius.medium'
  }),
  POTENTIAL_MISSING: xcss({
    borderColor: 'color.border.danger',
    borderStyle: 'solid',
    borderWidth: 'border.width',
    borderRadius: 'radius.medium'
  }),
  INSUFFICIENT_CONTEXT: xcss({
    borderColor: 'color.border.warning',
    borderStyle: 'solid',
    borderWidth: 'border.width',
    borderRadius: 'radius.medium'
  }),
  OUT_OF_SCOPE: xcss({
    borderColor: 'color.border',
    borderStyle: 'solid',
    borderWidth: 'border.width',
    borderRadius: 'radius.medium'
  })
};

const citationBoxStyle = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small'
});

function summarizeFallback(verdicts) {
  const list = Array.isArray(verdicts) ? verdicts : [];
  const evidenceFound = list.filter(v => v.status === 'EVIDENCE_FOUND').length;
  const potentialMissing = list.filter(v => v.status === 'POTENTIAL_MISSING').length;
  const insufficientContext = list.filter(v => v.status === 'INSUFFICIENT_CONTEXT').length;
  const outOfScope = list.filter(v => v.status === 'OUT_OF_SCOPE').length;
  const inScopeTotal = Math.max(0, list.length - outOfScope);
  return {
    total: list.length,
    evidenceFound,
    potentialMissing,
    insufficientContext,
    outOfScope,
    inScopeTotal,
    coverageRatio: inScopeTotal > 0 ? evidenceFound / inScopeTotal : 0
  };
}

function App() {
  const manualPageForm = useForm();
  const manualDiffForm = useForm();
  const productContext = useProductContext();

  const [loadingContext, setLoadingContext] = useState(true);
  const [contextError, setContextError] = useState('');
  const [pages, setPages] = useState([]);
  const [pullRequests, setPullRequests] = useState([]);
  const [skippedCrossSiteCount, setSkippedCrossSiteCount] = useState(0);

  const [selectedPageId, setSelectedPageId] = useState(null);
  const [selectedPrUrl, setSelectedPrUrl] = useState(null);
  const [activePage, setActivePage] = useState(null);
  const [loadingPage, setLoadingPage] = useState(false);

  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  const [showCriteriaList, setShowCriteriaList] = useState(false);
  const [showManualMode, setShowManualMode] = useState(false);
  const [showMarkdownExport, setShowMarkdownExport] = useState(false);

  const [specLint, setSpecLint] = useState(null);
  const [lintingSpec, setLintingSpec] = useState(false);
  const [showSpecLintPanel, setShowSpecLintPanel] = useState(false);
  const [prMeta, setPrMeta] = useState(null);
  const [staleness, setStaleness] = useState(null);
  const [issueGate, setIssueGate] = useState(null);

  const [fixSuggestions, setFixSuggestions] = useState({});
  const [openFixIds, setOpenFixIds] = useState({});
  const [loadingFixId, setLoadingFixId] = useState(null);
  const [fixErrors, setFixErrors] = useState({});
  const [lastManualDiff, setLastManualDiff] = useState('');
  const [expandedCards, setExpandedCards] = useState({});
  const [allExpanded, setAllExpanded] = useState(false);

  function resetFixState() {
    setFixSuggestions({});
    setOpenFixIds({});
    setLoadingFixId(null);
    setFixErrors({});
    setExpandedCards({});
    setAllExpanded(false);
  }

  const [approvingGate, setApprovingGate] = useState(false);
  const [approvalError, setApprovalError] = useState(null);

  async function handleApproveGate() {
    setApprovingGate(true);
    setApprovalError(null);
    try {
      const updatedGate = await invoke('approveTraceGate');
      setIssueGate(updatedGate);
    } catch (err) {
      setApprovalError(err?.message || 'Failed to record lead approval.');
    } finally {
      setApprovingGate(false);
    }
  }

  async function refreshContext(overridePageId = null, overridePrUrl = null) {
    setLoadingContext(true);
    setContextError('');
    setApprovalError(null);
    resetFixState();
    setLastManualDiff('');
    try {
      const ctx = await invoke('loadIssueContext', {
        pageId: overridePageId || undefined,
        pullRequestUrl: overridePrUrl || undefined
      });
      setPages(ctx.pages || []);
      setPullRequests(ctx.pullRequests || []);
      setSkippedCrossSiteCount(ctx.skippedCrossSiteCount || 0);
      setSelectedPageId(ctx.selectedPageId || null);
      setSelectedPrUrl(ctx.selectedPullRequestUrl || null);
      setActivePage(ctx.page || null);
      setPrMeta(ctx.prMeta || null);
      setStaleness(ctx.staleness || null);
      setIssueGate(ctx.issueGate || null);
      if (ctx.pageError) setContextError(ctx.pageError);

      if (ctx.cachedAnalysis) {
        setAnalysis({ ...ctx.cachedAnalysis, fromCache: true });
      } else {
        setAnalysis(null);
      }

      const hasReadySelection = Boolean((ctx.pages?.length || ctx.page) && ctx.pullRequests?.length);
      if (!hasReadySelection) {
        setShowManualMode(true);
      } else if (ctx.cachedAnalysis) {
        setShowManualMode(false);
      }
    } catch (err) {
      setContextError(err?.message || 'Could not load linked Confluence pages and Bitbucket pull requests.');
      setShowManualMode(true);
    } finally {
      setLoadingContext(false);
    }
  }

  useEffect(() => {
    refreshContext();
  }, []);

  async function handleSelectPage(option) {
    const nextPageId = option?.value || null;
    setSelectedPageId(nextPageId);
    setSpecLint(null);
    setShowSpecLintPanel(false);
    setAnalysisError('');
    if (!nextPageId) return;
    await refreshContext(nextPageId, selectedPrUrl);
  }

  async function handleSelectPr(option) {
    const nextPrUrl = option?.value || null;
    setSelectedPrUrl(nextPrUrl);
    setAnalysisError('');
    if (!nextPrUrl) return;
    await refreshContext(selectedPageId, nextPrUrl);
  }

  async function runLinkedVerification(forceRefresh = false) {
    if (!selectedPageId || !selectedPrUrl) return;
    setAnalyzing(true);
    setAnalysisError('');
    resetFixState();
    setLastManualDiff('');
    try {
      const res = await invoke('analyzeLinkedPullRequest', {
        pageId: selectedPageId,
        pullRequestUrl: selectedPrUrl,
        forceRefresh
      });
      setAnalysis(res);
      if (res.prMeta) setPrMeta(res.prMeta);
      if (res.issueGate) setIssueGate(res.issueGate);
      setStaleness(null);
      setSelectedTabIndex(0);
    } catch (err) {
      setAnalysisError(err?.message || 'Could not verify the linked pull request.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSuggestFix(verdict, forceRegenerate = false) {
    const idKey = String(verdict.id);
    if (!forceRegenerate && fixSuggestions[idKey]) {
      setOpenFixIds(prev => ({ ...prev, [idKey]: !prev[idKey] }));
      return;
    }
    setLoadingFixId(idKey);
    setFixErrors(prev => {
      const next = { ...prev };
      delete next[idKey];
      return next;
    });
    try {
      const res = await invoke('suggestRequirementFix', {
        pageId: selectedPageId || activePage?.pageId || undefined,
        pullRequestUrl: analysis?.pullRequestUrl || selectedPrUrl || undefined,
        requirementId: idKey,
        requirementText: verdict.requirementText,
        currentStatus: verdict.status,
        reasoning: verdict.reasoning,
        changedFiles: analysis?.changedFiles || undefined,
        diff: !(analysis?.pullRequestUrl || selectedPrUrl) && lastManualDiff ? lastManualDiff : undefined
      });
      if (!res?.ok) {
        throw new Error(res?.message || 'Could not generate a fix scaffold for this requirement.');
      }
      setFixSuggestions(prev => ({ ...prev, [idKey]: res }));
      setOpenFixIds(prev => ({ ...prev, [idKey]: true }));
    } catch (err) {
      setFixErrors(prev => ({ ...prev, [idKey]: err?.message || 'Could not generate fix scaffold.' }));
    } finally {
      setLoadingFixId(null);
    }
  }

  async function runSpecQualityLint(forceRefresh = false) {
    const targetPageId = selectedPageId || activePage?.pageId;
    if (!targetPageId) return;
    setLintingSpec(true);
    setAnalysisError('');
    try {
      const res = await invoke('lintConfluencePage', {
        pageId: targetPageId,
        forceRefresh
      });
      setSpecLint(res);
      setShowSpecLintPanel(true);
    } catch (err) {
      setAnalysisError(err?.message || 'Could not audit Confluence specification quality.');
    } finally {
      setLintingSpec(false);
    }
  }

  async function handleManualLoadPage(formData) {
    setLoadingPage(true);
    setAnalysisError('');
    setContextError('');
    try {
      const cleanPageId = String(formData.pageId ?? '').trim();
      const loaded = await invoke('loadRequirements', { pageId: cleanPageId });
      setSpecLint(null);
      setShowSpecLintPanel(false);
      setActivePage(loaded);
      setSelectedPageId(loaded.pageId);
      await refreshContext(loaded.pageId, selectedPrUrl);
    } catch (err) {
      setContextError(err?.message || 'Could not load this Confluence page.');
    } finally {
      setLoadingPage(false);
    }
  }

  async function handleManualAnalyzeDiff(formData) {
    const targetPageId = activePage?.pageId || selectedPageId;
    if (!targetPageId) {
      setAnalysisError('Load a Confluence specification page first before analyzing a pasted diff.');
      return;
    }
    setAnalyzing(true);
    setAnalysisError('');
    resetFixState();
    setLastManualDiff(formData.diff || '');
    try {
      const res = await invoke('analyzeDiff', { pageId: targetPageId, diff: formData.diff });
      setAnalysis({
        ...res,
        pageId: targetPageId,
        pageTitle: activePage?.title || null,
        pullRequestUrl: null,
        cachedAt: new Date().toISOString(),
        fromCache: false,
        delta: null
      });
      setSelectedTabIndex(0);
    } catch (err) {
      setAnalysisError(err?.message || 'Could not analyze the pasted unified diff.');
    } finally {
      setAnalyzing(false);
    }
  }

  if (loadingContext && !pages.length && !pullRequests.length && !activePage) {
    return (
      <Box padding="space.200">
        <Inline space="space.150" alignBlock="center">
          <Spinner size="medium" />
          <Text>Detecting linked Confluence specs and Bitbucket pull requests…</Text>
        </Inline>
      </Box>
    );
  }

  const effectivePages = pages.length > 0
    ? pages
    : (activePage ? [{ pageId: activePage.pageId, title: activePage.title || 'Loaded Spec' }] : []);
  const pageOptions = effectivePages.map(p => ({
    label: `${p.title} (Page ${p.pageId})`,
    value: p.pageId
  }));
  const selectedPageOption = pageOptions.find(o => o.value === selectedPageId) || null;

  const prOptions = pullRequests.map(pr => ({
    label: `${pr.workspace}/${pr.repository} · PR #${pr.pullRequestId}`,
    value: pr.url
  }));
  const selectedPrOption = prOptions.find(o => o.value === selectedPrUrl) || null;

  const siteOrigin = productContext?.siteUrl ? productContext.siteUrl.replace(/\/$/, '') : '';
  const specWebUrl = activePage?.webUrl || (siteOrigin && selectedPageId ? `${siteOrigin}/wiki/pages/viewpage.action?pageId=${selectedPageId}` : null);

  const summary = analysis?.summary || (analysis?.verdicts ? summarizeFallback(analysis.verdicts) : null);
  const tabs = analysis?.verdicts ? buildTabItems(analysis.verdicts) : [];
  const deltaBanner = analysis?.delta ? buildDeltaBanner(analysis.delta) : null;
  const activePrMeta = prMeta || analysis?.prMeta || null;
  const prStateBadge = getPrStateLozenge(activePrMeta?.state);
  const prShortCommit = formatShortCommit(activePrMeta?.headCommit || analysis?.headCommit);
  const activeGate = issueGate || analysis?.issueGate || null;
  const gateSpecDrift = Boolean(
    !staleness &&
    activeGate?.pageId &&
    activePage?.pageId &&
    String(activeGate.pageId) === String(activePage.pageId) &&
    activeGate?.pageVersion !== null &&
    activeGate?.pageVersion !== undefined &&
    activePage?.pageVersion !== null &&
    activePage?.pageVersion !== undefined &&
    activeGate.pageVersion !== activePage.pageVersion
  );
  const effectiveStaleness = staleness || (gateSpecDrift ? {
    isStale: true,
    specOutdated: true,
    prOutdated: false,
    cachedPageVersion: activeGate.pageVersion,
    livePageVersion: activePage.pageVersion
  } : null);
  const stalenessBanner = buildStalenessBanner(effectiveStaleness);
  const gateBadge = (pullRequests.length > 0 || activeGate) ? formatWorkflowGateBadge(activeGate, effectiveStaleness) : null;
  const activePrLink = analysis?.pullRequestUrl || selectedPrUrl || null;
  const incompleteBatchCount = Number(summary?.incompleteBatchCount ?? analysis?.incompleteBatchCount ?? 0);

  return (
    <Stack space="space.200">
      <Box backgroundColor="elevation.surface.sunken" padding="space.150" xcss={cardStyle}>
        <Stack space="space.150">
          <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
            <Inline space="space.100" alignBlock="center" shouldWrap={true}>
              <Heading size="small">Spec-to-Code Trace & Linter</Heading>
              {activePage?.pageVersion !== null && activePage?.pageVersion !== undefined && (
                <Lozenge appearance="information">Spec v{activePage.pageVersion}</Lozenge>
              )}
              {activePage?.extractionMode === 'heuristic_prd' && (
                <Lozenge appearance="moved">Heuristic PRD Mode</Lozenge>
              )}
              {activePage?.extractionMode === 'narrative_prd' && (
                <Lozenge appearance="moved">Narrative PRD Mode</Lozenge>
              )}
              {activePage?.requirements && (
                <Lozenge appearance="default">{activePage.requirements.length} criteria</Lozenge>
              )}
              {gateBadge && (
                <Lozenge appearance={gateBadge.appearance}>{gateBadge.label}</Lozenge>
              )}
            </Inline>
            <Inline space="space.100" shouldWrap={true}>
              <Button
                appearance="subtle"
                spacing="compact"
                isDisabled={loadingContext || analyzing}
                onClick={() => refreshContext(selectedPageId, selectedPrUrl)}
              >
                Refresh Links
              </Button>
              <Button
                appearance="subtle"
                spacing="compact"
                onClick={() => setShowManualMode(prev => !prev)}
              >
                {showManualMode ? 'Hide Manual Input' : 'Manual Page / Paste Diff'}
              </Button>
            </Inline>
          </Inline>

          {effectivePages.length > 0 && pullRequests.length > 0 ? (
            <Stack space="space.150">
              <Stack space="space.050">
                <Inline spread="space-between" alignBlock="center">
                  <Text size="small" weight="semibold">Linked Confluence Specification</Text>
                  {specWebUrl && (
                    <LinkButton href={specWebUrl} target="_blank" appearance="subtle-link" spacing="none">
                      Open Spec in Confluence
                    </LinkButton>
                  )}
                </Inline>
                <Select
                  inputId="linked-spec-select"
                  options={pageOptions}
                  value={selectedPageOption}
                  onChange={handleSelectPage}
                  isDisabled={analyzing || loadingContext}
                />
              </Stack>

              <Stack space="space.050">
                <Inline spread="space-between" alignBlock="center">
                  <Text size="small" weight="semibold">Linked Bitbucket Pull Request</Text>
                  {selectedPrUrl && (
                    <LinkButton href={selectedPrUrl} target="_blank" appearance="subtle-link" spacing="none">
                      Open PR in Bitbucket
                    </LinkButton>
                  )}
                </Inline>
                <Select
                  inputId="linked-pr-select"
                  options={prOptions}
                  value={selectedPrOption}
                  onChange={handleSelectPr}
                  isDisabled={analyzing || loadingContext}
                />
                {(prStateBadge || (activePrMeta?.sourceBranch && activePrMeta?.destinationBranch) || prShortCommit) && (
                  <Inline space="space.075" alignBlock="center" shouldWrap={true}>
                    {prStateBadge && (
                      <Lozenge appearance={prStateBadge.appearance}>{prStateBadge.label}</Lozenge>
                    )}
                    {activePrMeta?.sourceBranch && activePrMeta?.destinationBranch && (
                      <Lozenge appearance="default" maxWidth={320}>
                        {activePrMeta.sourceBranch} -&gt; {activePrMeta.destinationBranch}
                      </Lozenge>
                    )}
                    {prShortCommit && (
                      <Lozenge appearance="information">{prShortCommit}</Lozenge>
                    )}
                  </Inline>
                )}
              </Stack>

              <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                  <LoadingButton
                    appearance="primary"
                    isLoading={analyzing}
                    isDisabled={!selectedPageId || !selectedPrUrl || lintingSpec || (activePage && activePage.requirements?.length === 0)}
                    onClick={() => runLinkedVerification(Boolean(analysis))}
                  >
                    {analysis ? 'Re-verify Pull Request' : 'Verify Requirements'}
                  </LoadingButton>
                  {activePage?.requirements?.length > 0 && (
                    <LoadingButton
                      appearance="default"
                      isLoading={lintingSpec}
                      isDisabled={analyzing}
                      onClick={() => {
                        if (specLint && showSpecLintPanel) {
                          setShowSpecLintPanel(false);
                        } else if (specLint) {
                          setShowSpecLintPanel(true);
                        } else {
                          runSpecQualityLint(false);
                        }
                      }}
                    >
                      {specLint && showSpecLintPanel ? 'Hide Spec Audit' : 'Lint Spec Quality'}
                    </LoadingButton>
                  )}
                  {activePage?.requirements?.length > 0 && (
                    <Button
                      appearance="subtle"
                      onClick={() => setShowCriteriaList(prev => !prev)}
                    >
                      {showCriteriaList ? 'Hide Criteria' : `Preview Criteria (${activePage.requirements.length})`}
                    </Button>
                  )}
                </Inline>
                <Text size="small" color="color.text.subtlest">
                  Powered by Forge LLM · Grounded diff citation gate enabled
                </Text>
              </Inline>
            </Stack>
          ) : (
            <Stack space="space.100">
              <SectionMessage
                appearance="information"
                title="Link a Confluence spec page and Bitbucket pull request for 1-click verification"
              >
                <Text>
                  Found {pages.length} same-site Confluence page link(s) and {pullRequests.length} Bitbucket pull request remote link(s) on this issue.
                  Add remote links on the Jira issue and click Refresh Links, or verify manually below.
                </Text>
              </SectionMessage>
              {activePage?.requirements?.length > 0 && (
                <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                  <LoadingButton
                    appearance="primary"
                    isLoading={lintingSpec}
                    isDisabled={analyzing}
                    onClick={() => runSpecQualityLint(Boolean(specLint))}
                  >
                    {specLint ? 'Re-lint Spec Quality' : 'Lint Spec Quality (Pre-PR)'}
                  </LoadingButton>
                  <Button
                    appearance="default"
                    onClick={() => setShowCriteriaList(prev => !prev)}
                  >
                    {showCriteriaList ? 'Hide Criteria' : `Preview Criteria (${activePage.requirements.length})`}
                  </Button>
                </Inline>
              )}
            </Stack>
          )}

          {skippedCrossSiteCount > 0 && (
            <Text size="small" color="color.text.subtlest">
              Skipped {skippedCrossSiteCount} Confluence link(s) from another Atlassian site for tenant isolation.
            </Text>
          )}
        </Stack>
      </Box>

      {(contextError || analysisError) && (
        <SectionMessage appearance="error" title="Action required">
          <Text>{analysisError || contextError}</Text>
        </SectionMessage>
      )}

      {analyzing && (
        <SectionMessage appearance="information" title="Verifying pull request diff against Confluence specification…">
          <Inline space="space.100" alignBlock="center">
            <Spinner size="small" />
            <Text>Fetching live Bitbucket diff and auditing criteria in parallel (typically 8–15 seconds). Please keep this panel open until Live timestamp updates.</Text>
          </Inline>
        </SectionMessage>
      )}

      {activePage && activePage.requirements?.length === 0 && (
        <SectionMessage appearance="warning" title="No acceptance criteria or requirements section found">
          <Text>
            Page "{activePage.title}" did not contain an English Acceptance Criteria or Requirements heading, list, table, or panel.
          </Text>
        </SectionMessage>
      )}

      {showCriteriaList && activePage?.requirements?.length > 0 && (
        <Box padding="space.150" xcss={cardStyle}>
          <Stack space="space.075">
            <Heading size="xsmall">Extracted Criteria from "{activePage.title}"</Heading>
            {activePage.requirements.map((req, idx) => (
              <Text key={idx} size="small">{idx + 1}. {req}</Text>
            ))}
          </Stack>
        </Box>
      )}

      {showSpecLintPanel && specLint && specLint.summary && (
        <Box padding="space.150" xcss={cardStyle}>
          <Stack space="space.150">
            <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
              <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                <Heading size="small">
                  Spec Readiness: {specLint.summary.testable} / {specLint.summary.total} directly testable ({Math.round(specLint.summary.readinessScore * 100)}%)
                </Heading>
                {specLint.cachedAt && (
                  <Lozenge appearance={specLint.fromCache ? 'default' : 'inprogress'} maxWidth={240}>
                    {specLint.fromCache ? `Cached · ${formatTimestamp(specLint.cachedAt)}` : `Live · ${formatTimestamp(specLint.cachedAt)}`}
                  </Lozenge>
                )}
              </Inline>
              <LoadingButton
                appearance="subtle"
                spacing="compact"
                isLoading={lintingSpec}
                onClick={() => runSpecQualityLint(true)}
              >
                Re-lint Spec
              </LoadingButton>
            </Inline>

            <ProgressBar
              value={specLint.summary.readinessScore}
              appearance={specLint.summary.ambiguous === 0 && specLint.summary.testable > 0 ? 'success' : 'default'}
              ariaLabel="Specification readiness score"
            />

            <Inline space="space.100" shouldWrap={true}>
              <Lozenge appearance="success">Testable: {specLint.summary.testable}</Lozenge>
              <Lozenge appearance="removed">Ambiguous: {specLint.summary.ambiguous}</Lozenge>
              <Lozenge appearance="moved">Runtime / Non-Diff: {specLint.summary.unverifiableInDiff}</Lozenge>
            </Inline>

            {Number(specLint.incompleteBatchCount || 0) > 0 ? (
              <SectionMessage appearance="warning" title={`${specLint.incompleteBatchCount} lint batch(es) incomplete`}>
                <Text>Some requirements fell back to heuristic validation due to timeout. Click &quot;Re-lint Spec&quot; to complete full analysis.</Text>
              </SectionMessage>
            ) : specLint.items.filter(item => item.status !== 'TESTABLE').length === 0 ? (
              <SectionMessage appearance="success" title="All extracted requirements are concrete and code-verifiable">
                <Text>Every requirement defines clear observable behavior suitable for pull request verification.</Text>
              </SectionMessage>
            ) : (
              <Stack space="space.100">
                {specLint.items.filter(item => item.status !== 'TESTABLE').map(item => {
                  const lintMeta = getLintStatusMeta(item.status);
                  return (
                    <Box key={item.id} backgroundColor="elevation.surface.sunken" padding="space.100" xcss={citationBoxStyle}>
                      <Stack space="space.075">
                        <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                          <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                            <Lozenge appearance={lintMeta.lozengeAppearance}>{lintMeta.label}</Lozenge>
                            {item.signals?.length > 0 && (
                              <Lozenge appearance="default" maxWidth={240}>
                                Signal: {item.signals.join(', ')}
                              </Lozenge>
                            )}
                          </Inline>
                          <Text size="small" color="color.text.subtlest">Criterion #{item.id}</Text>
                        </Inline>
                        <Text weight="semibold">{item.id}. {item.requirementText}</Text>
                        <Text size="small">{item.issue}</Text>
                        {item.suggestedRewrite && (
                          <Stack space="space.050">
                            <Text size="small" weight="semibold">Suggested Testable Rewrite</Text>
                            <CodeBlock
                              language="markdown"
                              text={item.suggestedRewrite}
                              showLineNumbers={false}
                              shouldWrapLongLines={true}
                            />
                          </Stack>
                        )}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </Box>
      )}

      {stalenessBanner && (
        <SectionMessage appearance={stalenessBanner.appearance} title={stalenessBanner.title}>
          <Text>{stalenessBanner.body}</Text>
        </SectionMessage>
      )}

      {deltaBanner && (
        <SectionMessage appearance={deltaBanner.appearance} title={deltaBanner.title}>
          <Text>{deltaBanner.body}</Text>
        </SectionMessage>
      )}

      {analysis && summary && (
        <Stack space="space.150">
          <Box padding="space.150" xcss={cardStyle}>
            <Stack space="space.100">
              <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                <Heading size="small">
                  Evidence Coverage: {summary.evidenceFound} / {summary.inScopeTotal} in-scope criteria ({Math.round(summary.coverageRatio * 100)}%)
                </Heading>
                {analysis.cachedAt && (
                  <Lozenge appearance={analysis.fromCache ? 'default' : 'inprogress'} maxWidth={280}>
                    {analysis.fromCache ? `Cached · ${formatTimestamp(analysis.cachedAt)}` : `Live · ${formatTimestamp(analysis.cachedAt)}`}
                  </Lozenge>
                )}
              </Inline>

              <ProgressBar
                value={summary.coverageRatio}
                appearance={summary.potentialMissing === 0 && summary.evidenceFound > 0 ? 'success' : 'default'}
                ariaLabel="Verified requirement coverage"
              />

              <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                <Inline space="space.100" shouldWrap={true}>
                  <Lozenge appearance="success">Found: {summary.evidenceFound}</Lozenge>
                  <Lozenge appearance="removed">Missing Risk: {summary.potentialMissing}</Lozenge>
                  <Lozenge appearance="moved">Needs Context: {summary.insufficientContext}</Lozenge>
                  <Lozenge appearance="default">Out of Scope: {summary.outOfScope}</Lozenge>
                  {gateBadge && (
                    <Lozenge appearance={gateBadge.appearance}>{gateBadge.label}</Lozenge>
                  )}
                </Inline>
                <Inline space="space.100" shouldWrap={true}>
                  {activeGate && (
                    activeGate.leadApproval?.approved ? (
                      <Lozenge appearance="success">
                        Lead Signed: {activeGate.leadApproval.approvedBy}
                      </Lozenge>
                    ) : (
                      <Button
                        appearance="primary"
                        spacing="compact"
                        isDisabled={approvingGate || analyzing}
                        onClick={handleApproveGate}
                      >
                        {approvingGate ? 'Signing...' : 'Sign-off & Approve Gate'}
                      </Button>
                    )
                  )}
                  <Button
                    appearance="subtle"
                    spacing="compact"
                    onClick={() => setShowMarkdownExport(prev => !prev)}
                  >
                    {showMarkdownExport ? 'Hide Markdown Report' : 'Export Review Markdown'}
                  </Button>
                </Inline>
              </Inline>

              {approvalError && (
                <SectionMessage appearance="warning">
                  <Text>{approvalError}</Text>
                </SectionMessage>
              )}

              {showMarkdownExport && (
                <Box backgroundColor="elevation.surface.sunken" padding="space.100" xcss={citationBoxStyle}>
                  <Stack space="space.050">
                    <Text size="small" weight="semibold">Copy-Ready Pull Request Review Report (Markdown)</Text>
                    <CodeBlock
                      language="markdown"
                      text={buildMarkdownReport(analysis)}
                      showLineNumbers={false}
                      shouldWrapLongLines={true}
                    />
                  </Stack>
                </Box>
              )}

              {analysis.excludedFiles?.length > 0 && (
                <Text size="small" color="color.text.subtlest">
                  Excluded {analysis.excludedFiles.length} generated/lockfile path(s) from prompt budget: {analysis.excludedFiles.slice(0, 5).join(', ')}
                  {analysis.excludedFiles.length > 5 ? '…' : ''}
                </Text>
              )}

              {analysis.omittedFiles?.length > 0 && (
                <Text size="small" color="color.text.warning">
                  Large PR budget active: omitted {analysis.omittedFiles.length} lower-priority file(s) to fit context limits ({analysis.omittedFiles.slice(0, 5).join(', ')}
                  {analysis.omittedFiles.length > 5 ? '…' : ''}).
                </Text>
              )}

              {analysis.gateSkippedUnlinkedPage && (
                <Text size="small" color="color.text.warning">
                  Specification page is not linked on this Jira issue — personal snapshot saved, issue Workflow Gate unchanged. Link the Confluence page to this issue to update the Workflow Gate.
                </Text>
              )}

              {activeGate?.verifiedAt && (
                <Text size="small" color="color.text.subtlest">
                  Spec-to-Code Trace Gate KVS record synced · {formatTimestamp(activeGate.verifiedAt)}
                  {activeGate.headCommit ? ` · Commit ${formatShortCommit(activeGate.headCommit)}` : ''}
                </Text>
              )}

              <Text size="small" color="color.text.subtlest">
                Every cited line is deterministically verified against added (+) or removed (-) lines in the diff. Review runtime behavior manually.
              </Text>
            </Stack>
          </Box>

          {incompleteBatchCount > 0 && (
            <SectionMessage appearance="warning" title="Partial analysis timeout detected — Workflow Gate remains blocked">
              <Text>
                {incompleteBatchCount} evaluation batch(es) hit a runtime timeout or recovered as Needs Context before finishing. Click &quot;Re-verify Pull Request&quot; to complete full verification.
              </Text>
            </SectionMessage>
          )}

          <Tabs id="spec-trace-verdict-tabs" selected={selectedTabIndex} onChange={setSelectedTabIndex}>
            <TabList>
              {tabs.map(tab => (
                <Tab key={tab.key}>{tab.label} ({tab.count})</Tab>
              ))}
            </TabList>
            {tabs.map(tab => (
              <TabPanel key={tab.key}>
                <Box paddingBlockStart="space.150" paddingBlockEnd="space.200">
                  {tab.items.length === 0 ? (
                    <Box padding="space.150" xcss={cardStyle}>
                      <Text color="color.text.subtlest">No requirements in "{tab.label}".</Text>
                    </Box>
                  ) : (
                    <Stack space="space.100">
                      <Inline spread="space-between" alignBlock="center" space="space.100">
                        <Text size="small" color="color.text.subtlest">
                          Showing {tab.items.length} criteria · Click Details to inspect reasoning and diff citations
                        </Text>
                        <Button
                          appearance="subtle"
                          spacing="compact"
                          onClick={() => {
                            const next = !allExpanded;
                            setAllExpanded(next);
                            const updated = {};
                            tab.items.forEach(v => { updated[String(v.id)] = next; });
                            setExpandedCards(updated);
                          }}
                        >
                          {allExpanded ? 'Collapse All ▲' : 'Expand All ▼'}
                        </Button>
                      </Inline>
                      {tab.items.map(verdict => {
                        const meta = getStatusMeta(verdict.status);
                        const transition = analysis.delta?.transitions?.[String(verdict.id)] || null;
                        const transitionBadge = formatTransitionBadge(transition);
                        const isExpanded = Boolean(expandedCards[String(verdict.id)] ?? allExpanded);
                        return (
                          <Box
                            key={verdict.id}
                            padding="space.100"
                            xcss={verdictCardStyles[verdict.status] || cardStyle}
                          >
                            <Stack space="space.075">
                              <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                                <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                                  <Lozenge appearance={meta.lozengeAppearance}>{meta.label}</Lozenge>
                                  {transitionBadge && (
                                    <Lozenge appearance={transitionBadge.appearance} maxWidth={240}>
                                      {transitionBadge.text}
                                    </Lozenge>
                                  )}
                                  <Text weight="semibold">#{verdict.id}. {verdict.requirementText}</Text>
                                </Inline>
                                <Inline space="space.050" alignBlock="center">
                                  {verdict.citation && (
                                    <Inline space="space.050" alignBlock="center">
                                      {verdict.citation.changeType === 'deleted' && (
                                        <Lozenge appearance="removed">REMOVED</Lozenge>
                                      )}
                                      <Lozenge appearance="information" maxWidth={260}>
                                        {formatCitationLocation(verdict.citation)}
                                      </Lozenge>
                                    </Inline>
                                  )}
                                  <Button
                                    appearance="subtle"
                                    spacing="compact"
                                    onClick={() => setExpandedCards(prev => ({
                                      ...prev,
                                      [String(verdict.id)]: !Boolean(prev[String(verdict.id)] ?? allExpanded)
                                    }))}
                                  >
                                    {isExpanded ? 'Hide ▲' : 'Details ▼'}
                                  </Button>
                                </Inline>
                              </Inline>

                              {isExpanded && (
                                <Stack space="space.100" paddingBlockStart="space.050">
                                  <Text>{verdict.reasoning}</Text>

                                  {verdict.citation && (
                                    <Box backgroundColor="elevation.surface.sunken" padding="space.100" xcss={citationBoxStyle}>
                                      <Stack space="space.075">
                                        <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                                          <Inline space="space.050" alignBlock="center">
                                            {verdict.citation.changeType === 'deleted' && (
                                              <Lozenge appearance="removed">REMOVED</Lozenge>
                                            )}
                                            <Lozenge appearance="information" maxWidth={420}>
                                              {formatCitationLocation(verdict.citation)}
                                            </Lozenge>
                                          </Inline>
                                          {activePrLink && (
                                            <LinkButton
                                              href={buildBitbucketFileUrl(activePrLink, verdict.citation.path) || activePrLink}
                                              target="_blank"
                                              appearance="subtle-link"
                                              spacing="none"
                                            >
                                              View File in Bitbucket PR
                                            </LinkButton>
                                          )}
                                        </Inline>
                                        <CodeBlock
                                          language={inferCodeLanguage(verdict.citation.path)}
                                          text={verdict.citation.snippet || verdict.citation.text}
                                          highlight={verdict.citation.highlightLine ? String(verdict.citation.highlightLine) : undefined}
                                          showLineNumbers={false}
                                          shouldWrapLongLines={true}
                                        />
                                      </Stack>
                                    </Box>
                                  )}

                                  {(verdict.status === 'POTENTIAL_MISSING' || verdict.status === 'INSUFFICIENT_CONTEXT') && (
                                    <Stack space="space.100">
                                      <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                                        <LoadingButton
                                          appearance="subtle"
                                          spacing="compact"
                                          isLoading={loadingFixId === String(verdict.id)}
                                          isDisabled={analyzing || (Boolean(loadingFixId) && loadingFixId !== String(verdict.id))}
                                          onClick={() => handleSuggestFix(verdict, false)}
                                        >
                                          {fixSuggestions[String(verdict.id)]
                                            ? (openFixIds[String(verdict.id)] ? 'Hide Fix Scaffold' : 'Show Fix Scaffold')
                                            : 'Suggest Fix & Test'}
                                        </LoadingButton>
                                        {fixSuggestions[String(verdict.id)] && (
                                          <LoadingButton
                                            appearance="subtle"
                                            spacing="compact"
                                            isLoading={loadingFixId === String(verdict.id)}
                                            isDisabled={analyzing || (Boolean(loadingFixId) && loadingFixId !== String(verdict.id))}
                                            onClick={() => handleSuggestFix(verdict, true)}
                                          >
                                            Regenerate Fix
                                          </LoadingButton>
                                        )}
                                      </Inline>
                                      {fixErrors[String(verdict.id)] && (
                                        <Text size="small" color="color.text.danger">{fixErrors[String(verdict.id)]}</Text>
                                      )}
                                      {openFixIds[String(verdict.id)] && fixSuggestions[String(verdict.id)]?.remediation && (
                                        <Box backgroundColor="elevation.surface.sunken" padding="space.100" xcss={citationBoxStyle}>
                                          <Stack space="space.075">
                                            <Inline space="space.075" alignBlock="center" shouldWrap={true}>
                                              <Lozenge appearance={fixSuggestions[String(verdict.id)].remediation.source === 'llm' ? 'new' : 'default'}>
                                                {fixSuggestions[String(verdict.id)].remediation.source === 'llm'
                                                  ? 'Forge LLM + Diff Context'
                                                  : 'Repo-Aware Scaffold'}
                                              </Lozenge>
                                              {fixSuggestions[String(verdict.id)].remediation.targetFile && (
                                                <Lozenge appearance="information" maxWidth={320}>
                                                  Target: {fixSuggestions[String(verdict.id)].remediation.targetFile}
                                                </Lozenge>
                                              )}
                                              {fixSuggestions[String(verdict.id)].remediation.testFile && (
                                                <Lozenge appearance="default" maxWidth={320}>
                                                  Test: {fixSuggestions[String(verdict.id)].remediation.testFile}
                                                </Lozenge>
                                              )}
                                            </Inline>
                                            {fixSuggestions[String(verdict.id)].remediation.rationale && (
                                              <Text size="small">{fixSuggestions[String(verdict.id)].remediation.rationale}</Text>
                                            )}
                                            {fixSuggestions[String(verdict.id)].remediation.implementationScaffold && (
                                              <Stack space="space.050">
                                                <Text size="small" weight="semibold">Implementation Scaffold</Text>
                                                <CodeBlock
                                                  language={inferCodeLanguage(fixSuggestions[String(verdict.id)].remediation.targetFile)}
                                                  text={fixSuggestions[String(verdict.id)].remediation.implementationScaffold}
                                                  showLineNumbers={true}
                                                  shouldWrapLongLines={true}
                                                />
                                              </Stack>
                                            )}
                                            {fixSuggestions[String(verdict.id)].remediation.unitTestScaffold && (
                                              <Stack space="space.050">
                                                <Text size="small" weight="semibold">Fail-First Unit Test</Text>
                                                <CodeBlock
                                                  language={inferCodeLanguage(fixSuggestions[String(verdict.id)].remediation.testFile)}
                                                  text={fixSuggestions[String(verdict.id)].remediation.unitTestScaffold}
                                                  showLineNumbers={true}
                                                  shouldWrapLongLines={true}
                                                />
                                              </Stack>
                                            )}
                                          </Stack>
                                        </Box>
                                      )}
                                    </Stack>
                                  )}
                                </Stack>
                              )}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
              </TabPanel>
            ))}
          </Tabs>
        </Stack>
      )}

      {showManualMode && (
        <Box padding="space.150" xcss={cardStyle}>
          <Stack space="space.150">
            <Heading size="xsmall">Manual Page ID & Unified Diff Fallback</Heading>
            <Form onSubmit={manualPageForm.handleSubmit(handleManualLoadPage)}>
              <Label labelFor={manualPageForm.getFieldId('pageId')}>Same-site Confluence Page ID</Label>
              <Textfield
                {...manualPageForm.register('pageId', { required: true })}
                placeholder="e.g. 2293824"
              />
              <FormFooter>
                <LoadingButton type="submit" isLoading={loadingPage}>
                  Load Page Criteria
                </LoadingButton>
              </FormFooter>
            </Form>

            {(activePage?.requirements?.length > 0 || selectedPageId) && (
              <Form onSubmit={manualDiffForm.handleSubmit(handleManualAnalyzeDiff)}>
                <Label labelFor={manualDiffForm.getFieldId('diff')}>Unified Diff (git diff)</Label>
                <TextArea
                  {...manualDiffForm.register('diff', { required: true })}
                  placeholder="Paste unified diff starting with diff --git a/... b/..."
                />
                <FormFooter>
                  <LoadingButton type="submit" isLoading={analyzing}>
                    Verify Pasted Diff
                  </LoadingButton>
                </FormFooter>
              </Form>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
