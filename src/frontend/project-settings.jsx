import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Checkbox,
  Heading,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  useProductContext,
  xcss
} from '@forge/react';
import { invoke } from '@forge/bridge';

const containerStyle = xcss({
  padding: 'space.200',
  maxWidth: '720px'
});

const cardStyle = xcss({
  backgroundColor: 'elevation.surface',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'border.radius.100',
  padding: 'space.200'
});

const COVERAGE_OPTIONS = [
  { label: '70% — Standard (Permits minor gap)', value: '0.70' },
  { label: '80% — Recommended (Balanced governance)', value: '0.80' },
  { label: '90% — High Assurance (Strict teams)', value: '0.90' },
  { label: '100% — Zero Gap (Every in-scope criterion verified)', value: '1.00' }
];

function ProjectSettingsApp() {
  const context = useProductContext();
  const projectKey = context?.extension?.project?.key || context?.extension?.project?.id || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [requireLeadApproval, setRequireLeadApproval] = useState(false);
  const [minCoverageRatio, setMinCoverageRatio] = useState('0.80');
  const [strictResolution, setStrictResolution] = useState(false);
  const [allowedWorkspace, setAllowedWorkspace] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    if (!projectKey) return;
    invoke('getProjectSettings', { projectId: projectKey })
      .then(settings => {
        if (settings) {
          setRequireLeadApproval(Boolean(settings.requireLeadApproval));
          setMinCoverageRatio(Number(settings.minCoverageRatio ?? 0.8).toFixed(2));
          setStrictResolution(Boolean(settings.strictResolution));
          setAllowedWorkspace(settings.allowedWorkspace || '');
          setUpdatedAt(settings.updatedAt || null);
        }
      })
      .catch(err => {
        setSaveError(err?.message || 'Failed to load project settings.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectKey]);

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      const updated = await invoke('saveProjectSettings', {
        projectId: projectKey,
        settings: {
          requireLeadApproval,
          minCoverageRatio: Number(minCoverageRatio),
          strictResolution,
          allowedWorkspace
        }
      });
      if (updated) {
        setUpdatedAt(updated.updatedAt || new Date().toISOString());
        setSaveSuccess(true);
      }
    } catch (err) {
      setSaveError(err?.message || 'Failed to save project settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box padding="space.300">
        <Inline space="space.100" alignBlock="center">
          <Spinner size="medium" />
          <Text>Loading Spec-to-Code Trace governance settings for {projectKey}...</Text>
        </Inline>
      </Box>
    );
  }

  return (
    <Box xcss={containerStyle}>
      <Stack space="space.200">
        <Box>
          <Inline spread="space-between" alignBlock="center">
            <Heading size="medium">Spec-to-Code Trace & Linter Governance</Heading>
            {projectKey && <Lozenge appearance="inprogress">Project: {projectKey}</Lozenge>}
          </Inline>
          <Text color="color.text.subtlest">
            Configure automated workflow gate policies and pull request verification rules for this Jira project.
          </Text>
        </Box>

        {saveSuccess && (
          <SectionMessage appearance="success" title="Settings Saved">
            <Text>Project trace governance policies have been updated and are active for all workflow transitions.</Text>
          </SectionMessage>
        )}

        {saveError && (
          <SectionMessage appearance="error" title="Configuration Error">
            <Text>{saveError}</Text>
          </SectionMessage>
        )}

        <Box xcss={cardStyle}>
          <Stack space="space.200">
            <Heading size="small">Workflow Gate Enforcement Rules</Heading>

            <Box>
              <Checkbox
                isChecked={requireLeadApproval}
                onChange={e => setRequireLeadApproval(e.target.checked)}
                label="Mandatory Tech Lead Sign-off"
              />
              <Text size="small" color="color.text.subtlest">
                Requires a designated Tech Lead or QA Engineer to review the grounded evidence trace and click "Approve Trace Gate" before issues can transition to Done.
              </Text>
            </Box>

            <Box>
              <Checkbox
                isChecked={strictResolution}
                onChange={e => setStrictResolution(e.target.checked)}
                label="Strict Resolution (Zero Needs Context)"
              />
              <Text size="small" color="color.text.subtlest">
                Blocks issue transition if any requirement is classified as Needs Context (all criteria must have verified code evidence).
              </Text>
            </Box>

            <Box>
              <Label label="Minimum Required Coverage Threshold" />
              <Select
                options={COVERAGE_OPTIONS}
                value={COVERAGE_OPTIONS.find(opt => opt.value === minCoverageRatio) || COVERAGE_OPTIONS[1]}
                onChange={opt => setMinCoverageRatio(opt?.value || '0.80')}
              />
              <Text size="small" color="color.text.subtlest">
                The minimum ratio of in-scope requirements that must have verified code citations in the pull request.
              </Text>
            </Box>
          </Stack>
        </Box>

        <Box xcss={cardStyle}>
          <Stack space="space.200">
            <Heading size="small">Enterprise Bitbucket Security Policy</Heading>
            <Box>
              <Label label="Allowed Bitbucket Workspace" />
              <Textfield
                value={allowedWorkspace}
                onChange={e => setAllowedWorkspace(e.target.value)}
                placeholder="e.g. synapse-codegeist"
              />
              <Text size="small" color="color.text.subtlest">
                Restrict linked pull requests to a verified corporate Bitbucket workspace. Transitions are blocked if PRs originate from personal or foreign workspaces.
              </Text>
            </Box>
          </Stack>
        </Box>

        <Inline spread="space-between" alignBlock="center">
          <LoadingButton
            appearance="primary"
            isLoading={saving}
            onClick={handleSave}
          >
            Save Project Policies
          </LoadingButton>
          {updatedAt && (
            <Text size="small" color="color.text.subtlest">
              Last saved: {new Date(updatedAt).toLocaleString()}
            </Text>
          )}
        </Inline>
      </Stack>
    </Box>
  );
}

ForgeReconciler.render(<ProjectSettingsApp />);
