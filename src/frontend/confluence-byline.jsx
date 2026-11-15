import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  CodeBlock,
  Heading,
  Inline,
  LoadingButton,
  Lozenge,
  ProgressBar,
  SectionMessage,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  xcss
} from '@forge/react';
import { invoke } from '@forge/bridge';
import {
  buildLintTabItems,
  formatTimestamp,
  getLintStatusMeta
} from './view-model.mjs';

const cardStyle = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.medium'
});

const itemCardStyles = {
  TESTABLE: xcss({
    borderColor: 'color.border.success',
    borderStyle: 'solid',
    borderWidth: 'border.width',
    borderRadius: 'radius.medium'
  }),
  AMBIGUOUS: xcss({
    borderColor: 'color.border.danger',
    borderStyle: 'solid',
    borderWidth: 'border.width',
    borderRadius: 'radius.medium'
  }),
  UNVERIFIABLE_IN_DIFF: xcss({
    borderColor: 'color.border.warning',
    borderStyle: 'solid',
    borderWidth: 'border.width',
    borderRadius: 'radius.medium'
  })
};

const rewriteBoxStyle = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small'
});

function ConfluenceBylineApp() {
  const [loading, setLoading] = useState(true);
  const [linting, setLinting] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(null);
  const [lintResult, setLintResult] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const ctx = await invoke('loadConfluenceBylineContext');
        if (!mounted) return;
        setPage(ctx.page || null);
        setLintResult(ctx.cachedLint || null);
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || 'Could not load Confluence page requirements.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function handleRunLint(forceRefresh = false) {
    setLinting(true);
    setError('');
    try {
      const res = await invoke('lintConfluencePage', { forceRefresh });
      setLintResult(res);
      setSelectedTab(0);
    } catch (err) {
      setError(err?.message || 'Could not audit specification readiness.');
    } finally {
      setLinting(false);
    }
  }

  if (loading) {
    return (
      <Box padding="space.200">
        <Inline space="space.150" alignBlock="center">
          <Spinner size="medium" />
          <Text>Extracting specification criteria from Confluence ADF…</Text>
        </Inline>
      </Box>
    );
  }

  const criteriaCount = page?.requirements?.length || 0;
  const tabs = lintResult?.items ? buildLintTabItems(lintResult.items) : [];
  const summary = lintResult?.summary || null;

  return (
    <Box padding="space.150">
      <Stack space="space.150">
        <Box backgroundColor="elevation.surface.sunken" padding="space.150" xcss={cardStyle}>
          <Stack space="space.100">
            <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
              <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                <Heading size="small">Spec Readiness Linter</Heading>
                {page?.pageVersion !== null && page?.pageVersion !== undefined && (
                  <Lozenge appearance="information">Spec v{page.pageVersion}</Lozenge>
                )}
                {page?.extractionMode === 'heuristic_prd' && (
                  <Lozenge appearance="moved">Heuristic PRD Mode</Lozenge>
                )}
                {page?.extractionMode === 'narrative_prd' && (
                  <Lozenge appearance="moved">Narrative PRD Mode</Lozenge>
                )}
                <Lozenge appearance="default">{criteriaCount} criteria</Lozenge>
              </Inline>
              {criteriaCount > 0 && (
                <LoadingButton
                  appearance="primary"
                  isLoading={linting}
                  onClick={() => handleRunLint(Boolean(lintResult))}
                >
                  {lintResult ? 'Re-lint Spec' : 'Audit Spec Readiness'}
                </LoadingButton>
              )}
            </Inline>
            <Text size="small" color="color.text.subtlest">
              Catches ambiguous phrasing and static-diff blind spots before engineering begins.
            </Text>
          </Stack>
        </Box>

        {error && (
          <SectionMessage appearance="error" title="Spec readiness check failed">
            <Text>{error}</Text>
          </SectionMessage>
        )}

        {criteriaCount === 0 && !error && (
          <SectionMessage appearance="warning" title="No specification criteria detected on this page">
            <Text>
              Add a heading named Acceptance Criteria, Requirements, Functional Requirements, Spec Requirements, or Technical Requirements with a list, table, or panel to enable readiness linting.
            </Text>
          </SectionMessage>
        )}

        {criteriaCount > 0 && !lintResult && !linting && (
          <Box padding="space.150" xcss={cardStyle}>
            <Stack space="space.075">
              <Heading size="xsmall">Extracted Criteria Preview ({criteriaCount})</Heading>
              {page.requirements.slice(0, 8).map((req, idx) => (
                <Text key={idx} size="small">{idx + 1}. {req}</Text>
              ))}
              {criteriaCount > 8 && (
                <Text size="small" color="color.text.subtlest">
                  +{criteriaCount - 8} more criteria ready for readiness linting.
                </Text>
              )}
            </Stack>
          </Box>
        )}

        {lintResult && summary && (
          <Stack space="space.150">
            <Box padding="space.150" xcss={cardStyle}>
              <Stack space="space.100">
                <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                  <Heading size="small">
                    Readiness Score: {summary.testable} / {summary.total} directly testable ({Math.round(summary.readinessScore * 100)}%)
                  </Heading>
                  {lintResult.cachedAt && (
                    <Lozenge appearance={lintResult.fromCache ? 'default' : 'inprogress'} maxWidth={260}>
                      {lintResult.fromCache ? `Cached · ${formatTimestamp(lintResult.cachedAt)}` : `Live · ${formatTimestamp(lintResult.cachedAt)}`}
                    </Lozenge>
                  )}
                </Inline>

                <ProgressBar
                  value={summary.readinessScore}
                  appearance={summary.ambiguous === 0 && summary.testable > 0 ? 'success' : 'default'}
                  ariaLabel="Specification readiness score"
                />

                <Inline space="space.100" shouldWrap={true}>
                  <Lozenge appearance="success">Testable: {summary.testable}</Lozenge>
                  <Lozenge appearance="removed">Ambiguous: {summary.ambiguous}</Lozenge>
                  <Lozenge appearance="moved">Runtime / Non-Diff: {summary.unverifiableInDiff}</Lozenge>
                  {Number(lintResult.incompleteBatchCount || 0) > 0 && (
                    <Lozenge appearance="inprogress">{lintResult.incompleteBatchCount} Batch(es) Incomplete</Lozenge>
                  )}
                </Inline>
              </Stack>
            </Box>

            <Tabs id="confluence-spec-lint-tabs" selected={selectedTab} onChange={setSelectedTab}>
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
                        <Text color="color.text.subtlest">No criteria in "{tab.label}".</Text>
                      </Box>
                    ) : (
                      <Stack space="space.150">
                        {tab.items.map(item => {
                          const meta = getLintStatusMeta(item.status);
                          return (
                            <Box
                              key={item.id}
                              padding="space.150"
                              xcss={itemCardStyles[item.status] || cardStyle}
                            >
                              <Stack space="space.100">
                                <Inline spread="space-between" alignBlock="center" shouldWrap={true} space="space.100">
                                  <Inline space="space.100" alignBlock="center" shouldWrap={true}>
                                    <Lozenge appearance={meta.lozengeAppearance}>{meta.label}</Lozenge>
                                    {item.signals?.length > 0 && (
                                      <Lozenge appearance="default" maxWidth={240}>
                                        Signal: {item.signals.join(', ')}
                                      </Lozenge>
                                    )}
                                  </Inline>
                                  <Text size="small" color="color.text.subtlest">Criterion #{item.id}</Text>
                                </Inline>

                                <Text weight="semibold">{item.id}. {item.requirementText}</Text>
                                <Text>{item.issue}</Text>

                                {item.suggestedRewrite && (
                                  <Box backgroundColor="elevation.surface.sunken" padding="space.100" xcss={rewriteBoxStyle}>
                                    <Stack space="space.050">
                                      <Text size="small" weight="semibold">Suggested Testable Rewrite</Text>
                                      <CodeBlock
                                        language="markdown"
                                        text={item.suggestedRewrite}
                                        showLineNumbers={false}
                                        shouldWrapLongLines={true}
                                      />
                                    </Stack>
                                  </Box>
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
      </Stack>
    </Box>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <ConfluenceBylineApp />
  </React.StrictMode>
);
