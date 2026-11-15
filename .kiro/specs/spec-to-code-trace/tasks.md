# Implementation Plan & Verification Gates — Spec-to-Code Trace

> **Execution Discipline**: Implement tasks strictly in sequence. No task may be marked `[x]` until its unit tests (`npm test`) and Forge manifest/bundle checks (`forge lint`) pass with zero errors. Never claim project completion until Phase 6 live E2E verification in Jira/Confluence/Bitbucket is confirmed.

---

## Phase 1: Multi-Format Confluence ADF Parser & Page Metadata

- [x] **Task 1.1: Expand `src/adf-requirements.mjs` for Real-World Confluence Specs**
  - Configure English-only section headings (`acceptance criteria`, `acceptance criterion`, `requirements`, `functional requirements`, `spec requirements`, `technical requirements`) and remove legacy Korean heading literals.
  - Add ADF `table` row extraction (header-aware `ID + Requirement` formatting, skipping status-only noise columns and empty rows, plus headerless table fallback).
  - Add ADF `panel` extraction (extracting nested lists/tables inside panels, or standalone requirement paragraphs when no list/table exists).
  - Support paragraph introductions followed by either a list or a `table`, and normalize + deduplicate extracted requirement strings in first-seen order.
- [x] **Task 1.2: Enrich `src/confluence-page.mjs` with Version & Web URL Metadata**
  - Return `pageVersion: typeof page?.version?.number === 'number' ? page.version.number : null` and safe same-site `webUrl` alongside `{ pageId, title, requirements }`.
- [x] **Task 1.3: Unit Tests for Phase 1 (`tests/adf-requirements.test.mjs`, `tests/confluence-page.test.mjs`)**
  - Test English `Requirements` / `Functional Requirements` / `Acceptance Criteria` headings, ADF `table` with `tableHeader` + `tableCell` rows, ADF `panel` callouts, nested lists inside panels, duplicate elimination, and `pageVersion` extraction.
  - **Gate**: `npm test` passes 100%.

---

## Phase 2: Production Diff Engine, Noise Filter & Grounding Summary

- [x] **Task 2.1: Upgrade `src/diff-evidence.mjs` & `src/bitbucket-diff.mjs`**
  - Implement `isNoisePath(path)` covering lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, etc.), build outputs (`dist/**`, `build/**`, `.next/**`, `coverage/**`), snapshots (`*.snap`), and minified bundles (`*.min.js`, `*.min.css`, `*.map`).
  - Implement git-quoted path decoding (`"b/path with spaces/..."` including C-escapes and UTF-8 octal sequences) and strip trailing tab timestamps on `+++ b/...` headers.
  - Implement `filterAndIndexDiff(diff)` returning `{ filteredDiff, lines, excludedFiles }` and `languageFromPath(path)` matching `@forge/react` `CodeBlock` languages.
  - Raise raw HTTP transport cap in `src/bitbucket-diff.mjs` from `100,000` to `500,000` chars while enforcing the `100,000`-char LLM budget strictly on `filteredDiff` in `src/analysis.mjs`.
- [x] **Task 2.2: Upgrade `src/verdicts.mjs` & `src/analysis.mjs` for Delegation Citations & Coverage Summary**
  - Update `validateVerdicts` to preserve optional `citation` on `INSUFFICIENT_CONTEXT` verdicts **only** when `verifyCitation(changedLines, citation)` returns `true` (stripping unverified optional citations safely), while keeping mandatory citation verification on `EVIDENCE_FOUND`.
  - Add `summarizeVerdicts(verdicts)` returning `{ total, evidenceFound, potentialMissing, insufficientContext, outOfScope, inScopeTotal, coverageRatio }`.
  - Update `analyzeChanges` prompt and return payload (`{ verdicts, summary, excludedFiles, diffHash, usage }`).
- [x] **Task 2.3: Unit Tests for Phase 2 (`tests/diff-evidence.test.mjs`, `tests/bitbucket-diff.test.mjs`, `tests/analysis.test.mjs`)**
  - Test `package-lock.json` + source file mixed PR diff (>100 KB raw, <100 KB filtered), all-noise diff error handling, quoted paths with spaces/UTF-8, verified vs unverified `INSUFFICIENT_CONTEXT` delegation citations, and `summarizeVerdicts` math (including all-`OUT_OF_SCOPE` edge case).
  - **Gate**: `npm test` passes 100%.

---

## Phase 3: Per-User KVS Snapshot Cache & `[Re-verify]` Delta Engine

- [x] **Task 3.1: Install `@forge/kvs` & Create `src/cache-store.mjs`**
  - Install `@forge/kvs` in `package.json` (`npm install @forge/kvs`).
  - Implement `buildCacheKey({ accountId, issueKey, pageId, pullRequestUrl })` using SHA-256 (`trace:v1:<40-hex>`), strictly rejecting missing `accountId` so cross-user cache sharing is impossible.
  - Implement `computeDelta(previousSnapshot, nextResult)` tracking `resolved`, `regressed`, and `changed` status transitions per requirement item plus `pageVersionChanged` and `diffChanged`.
  - Implement fault-tolerant `getCachedSnapshot` and `saveCachedSnapshot` (omitting raw diffs and enforcing `<= 200 KB` payload ceiling).
- [x] **Task 3.2: Wire Cache & Auto-Context into `src/linked-analysis.mjs` & `src/index.js`**
  - Implement `loadIssueContext({ accountId, siteUrl, issueKey }, deps)` that loads Jira remote links, identifies same-site Confluence pages and Bitbucket PRs, loads the default page's requirements (when present), and checks KVS for an existing per-user cached snapshot.
  - Upgrade `analyzeLinkedPullRequest` to support `forceRefresh`, return instant cached hit when `forceRefresh === false` and a valid snapshot exists (or run fresh analysis, compute `delta` against prior snapshot, save to KVS, and return `{ ...result, pageTitle, pageVersion, pullRequestUrl, cachedAt, fromCache, delta }`).
- [x] **Task 3.3: Unit Tests for Phase 3 (`tests/cache-store.test.mjs`, `tests/linked-analysis.test.mjs`)**
  - Test user-scoped key isolation (`accountA !== accountB`), payload size guard, `POTENTIAL_MISSING -> EVIDENCE_FOUND` (`resolved`) and `EVIDENCE_FOUND -> POTENTIAL_MISSING` (`regressed`) delta computation, cache hit vs `forceRefresh` re-verification, and non-blocking fallback when KVS throws.
  - **Gate**: `npm test` passes 100%.

---

## Phase 4: Atlassian Rovo Agent & Action (*Best Agents* Bonus Track)

- [x] **Task 4.1: Implement `src/rovo-action.mjs` & Update `manifest.yml` / `src/index.js`**
  - Create `verifyIssueSpecForRovo(payload, context, deps)` supporting automatic selection of the primary linked Confluence page and Bitbucket PR when only `issueKey` is supplied, and returning structured diagnostic guidance (never throwing opaque stack traces) when links or Bitbucket OAuth credentials are missing.
  - Export `rovoVerifyHandler` in `src/index.js`.
  - Update `manifest.yml` with `storage:app` scope, `rovo:agent` (`spec-trace-agent`), `action` (`verify-issue-spec-action`), and `function` (`rovoVerify` with `bitbucket-oauth` provider).
- [x] **Task 4.2: Unit Tests & Manifest Lint Gate (`tests/rovo-action.test.mjs`)**
  - Test Rovo action auto-selection, explicit `pageId`/`pullRequestUrl` override, missing OAuth diagnostic response (`hasCredentials() === false`), and missing Jira links response.
  - Run `forge lint` (with `BITBUCKET_CLIENT_ID` resolved in-memory without printing) to prove zero schema/linter warnings or errors.
  - **Gate**: `npm test` + `forge lint` pass 100%.

---

## Phase 5: Complete Native `@forge/react` Jira Issue Panel Product UI

- [x] **Task 5.1: Rebuild `src/frontend/index.jsx` into a Competition-Grade Native Issue Panel**
  - Auto-load `loadIssueContext` on mount (`useEffect`) with `Spinner` skeleton state.
  - Render linked Spec & PR `Select` controls + external `LinkButton` shortcuts + 1-click **`Verify Requirements`** / **`Re-verify PR`** (`LoadingButton`).
  - Render `SectionMessage` delta banner when `delta` transitions exist after re-verification.
  - Render Coverage Summary card (`ProgressBar`, semantic `Lozenge` status counters, cached timestamp indicator, excluded noise files note).
  - Render `Tabs` (`All`, `Missing Risk`, `Found`, `Needs Context`, `Out of Scope`) containing styled Verdict Cards (`Box` + `xcss`, status & transition `Lozenge`, requirement title, reasoning, `CodeBlock` with inferred syntax highlighting, and `"View in Bitbucket PR"` `LinkButton`).
  - Preserve collapsible **"Manual Page ID / Paste Diff"** fallback form with `SectionMessage` error banners.
- [x] **Task 5.2: Frontend Helper Unit Tests & Bundle Verification**
  - Extract pure UI view-model helpers (`src/frontend/view-model.mjs` — status-to-Lozenge appearance mapping, tab filtering, delta badge formatting) and unit-test them in `tests/view-model.test.mjs`.
  - Run `npm test` and `forge lint`.
  - **Gate**: `npm test` + `forge lint` pass 100%.

---

## Phase 6: Live Cloud Deployment, Upgrade & End-to-End Verification

- [x] **Task 6.1: Deploy & Upgrade Installation on `one-atlas-hebl.atlassian.net`**
  - Deploy updated bundle to `development` environment (`forge deploy --non-interactive -e development`).
  - Upgrade site installation (`forge install --upgrade --non-interactive -s one-atlas-hebl.atlassian.net -p jira -e development` and Confluence if applicable) so `storage:app` and `rovo:agent` modules activate cleanly.
- [x] **Task 6.2: Live E2E Verification on `PLAT-33510` & Rovo Chat**
  - Verify in browser on `PLAT-33510`:
    1. Panel auto-detects Confluence page `2293824` (`Audit compliance`) and Bitbucket PR `#1` on mount without manual ID entry.
    2. 1-click **`Verify Requirements`** renders `ProgressBar`, status `Lozenge` counts, filter `Tabs`, `CodeBlock` snippets, and Bitbucket PR links.
    3. Reloading `PLAT-33510` hydrates the cached snapshot instantaneously; clicking **`Re-verify PR`** executes fresh verification and displays delta/up-to-date status.
    4. Test Rovo Agent (`Spec-to-Code Trace`) on `PLAT-33510` and verify `forge logs -e development` shows zero unhandled runtime errors.
  - Clean any temporary files, sync `C:\AI\sync_hub.py`, update `README.md` with honest verified status, and create local git checkpoint.

---

## Phase 7: Pre-Code Spec Readiness Linter & 3-Surface Atlassian Integration (Confluence + Jira + Rovo)

- [x] **Task 7.1: Implement `src/spec-linter.mjs` & Per-User Versioned KVS Cache (`src/cache-store.mjs`)**
  - Implement `detectHeuristicAmbiguity(text)` to detect subjective/unquantified spec words (`fast`, `quickly`, `gracefully`, `properly`, `seamless`, `user-friendly`, `as needed`, `appropriate`, `robust`, `efficiently`, `soon`, `etc.`) when unaccompanied by numeric/HTTP/metric bounds.
  - Implement `validateSpecLint(requirements, candidates)` enforcing 1:1 cardinality, `TESTABLE | AMBIGUOUS | UNVERIFIABLE_IN_DIFF`, non-empty `issue` and `suggestedRewrite` on non-`TESTABLE` items, and deterministic `summarizeSpecLint(items)` (`readinessScore = testable / total`).
  - Implement `lintSpecification(requirements, chat)` using Forge LLM (`claude-sonnet-5`) + `validateSpecLint`, and `lintConfluenceSpec({ accountId, pageId, forceRefresh }, deps)` cached in KVS under `trace:lint:v1:<40-hex>` keyed by `(accountId, pageId, pageVersion)`.
- [x] **Task 7.2: Wire Confluence Byline (`confluence:contentBylineItem`), Jira Panel & Rovo Lint Action**
  - Create `src/frontend/confluence-byline.jsx` (`@forge/react` Native UI Kit popup for `confluence:contentBylineItem` reading `context.extension.content.id`, displaying Readiness Score `ProgressBar`, status `Lozenge` pills, `Re-lint Spec`, and copyable `CodeBlock` suggested rewrites).
  - Add `lintSpecForRovo` in `src/rovo-action.mjs` (accepting `pageId` or `issueKey`), `lintConfluencePage` resolver + `rovoLintSpecHandler` in `src/index.js`, and update `manifest.yml` with `confluence:contentBylineItem` (`spec-readiness-byline`) and `lint-confluence-spec-action`.
- [x] **Task 7.3: Unit Tests for Phase 7 (`tests/spec-linter.test.mjs`, `tests/rovo-action.test.mjs`, `tests/cache-store.test.mjs`)**
  - Test `detectHeuristicAmbiguity`, `validateSpecLint` fallback handling, `lintConfluenceSpec` version-aware cache hit/miss, and `lintSpecForRovo` via both `pageId` and `issueKey`.
  - **Gate**: `npm test` passes 100%.

---

## Phase 8: Multi-Line Grounded Diff Context, File-Anchor Deep Links & Markdown Review Export

- [x] **Task 8.1: Implement `enrichCitationContext` in `src/diff-evidence.mjs` & Wire into `src/verdicts.mjs` / `src/analysis.mjs`**
  - Extract up to `±2` surrounding hunk context/added lines around each verified citation line in `filteredDiff`, attaching `{ snippet, highlightLine }` (`1`-based offset inside `snippet`) deterministically after `verifyCitation` passes.
- [x] **Task 8.2: Upgrade `src/frontend/view-model.mjs` & `src/frontend/index.jsx`**
  - Add `buildBitbucketFileUrl(pullRequestUrl, filePath)` (`#chg-<encodedPath>` on verified `https://bitbucket.org/.../pull-requests/...` URLs).
  - Add `buildMarkdownReport(analysis)` producing a clean, zero-strikethrough Markdown PR review report with coverage summary, Potential Missing action items, Needs Context checks, and `path:line` citations.
  - Upgrade `src/frontend/index.jsx` with `Lint Spec Quality` drawer, multi-line highlighted `CodeBlock` (`highlight={String(citation.highlightLine)}`), `"View File in Bitbucket PR"` deep links, and toggleable **`Export Review Markdown`** `CodeBlock`.
- [x] **Task 8.3: Unit Tests for Phase 8 (`tests/diff-evidence.test.mjs`, `tests/view-model.test.mjs`, `tests/analysis.test.mjs`)**
  - Test multi-line `snippet` + exact `highlightLine` calculation across multi-hunk files, Bitbucket `#chg-` URL generation, and Markdown report export (including mechanical zero-strikethrough verification).
  - **Gate**: `npm test` + `forge lint` pass 100%.

---

## Phase 9: Competition Showcase Kit, Cloud Deployment & Live Verification

- [x] **Task 9.1: Author Showcase Kit (`docs/SHOWCASE_SCENARIO.md`) & End-to-End Pipeline Test (`tests/showcase-scenario.test.mjs`)**
  - Create a realistic English **Webhook Delivery & Audit Export Service** showcase spec (ADF Table + Nested List + Warning Panel + Ambiguous item + Runtime p99 SLA item) and 2-stage PR diffs (`Commit 1` with `package-lock.json` noise + all 4 verdict types -> `Commit 2` fixing HMAC signature for `MISSING -> FOUND` delta transition).
  - Verify the entire pipeline (`extractRequirements` -> `lintSpecification` -> `analyzeChanges` Commit 1 -> `analyzeChanges` Commit 2 -> `computeDelta` -> `buildMarkdownReport`) deterministically in `tests/showcase-scenario.test.mjs`.
- [x] **Task 9.2: Deploy & Upgrade on `one-atlas-hebl.atlassian.net` (Jira + Confluence + Rovo)**
  - Run `forge lint`, `forge deploy` (`development`), and confirm `isLatest: true` on both Jira and Confluence so `spec-readiness-byline` and `lint-confluence-spec-action` activate cleanly.
  - Add parallel requirement sharding (`LINT_BATCH_SIZE = 6` in `src/spec-linter.mjs`, `ANALYSIS_BATCH_SIZE = 10` in `src/analysis.mjs`) after live E2E exposed cold-start 25s FaaS wall-clock risk on 12-item specs.
  - Verify zero temporary files remain, sync `README.md` and `C:\AI\sync_hub.py`, commit locally, and confirm live E2E across Confluence Byline (`Readiness Score: 4 / 12, 33%`), Jira Panel (`Cached` Spec Lint + `Export Review Markdown` + `#chg-sales.js`), and Rovo Spec Linter.

---

## Phase 10: Deep Jira ADF Link Discovery & 2-Tier Unstructured Confluence PRD Extractor

- [x] **Task 10.1: Upgrade `src/jira-links.mjs` & `src/index.js` for Jira Issue `description` ADF Smart Cards & Inline Links**
  - Implement `extractUrlsFromAdf(adf)` traversing `inlineCard`, `blockCard`, `embedCard`, `link` marks, and inline `https://` URLs.
  - Extend `loadIssueLinks(issueKey, requestLinks, requestIssue)` to merge `/remotelink` links with links parsed from `/rest/api/3/issue/{key}?fields=description` cleanly without breaking if `requestIssue` is absent.
- [x] **Task 10.2: Implement Tier-2 Heuristic PRD Extractor in `src/adf-requirements.mjs` & `src/confluence-page.mjs`**
  - Implement `extractRequirementsWithMeta(adf)` supporting Tier-1 `explicit` extraction first and Tier-2 `heuristic_prd` fallback (extended PRD headings such as `Business Rules`, `Security`, `Constraints`, `User Stories`, `Edge Cases`, `Definition of Done`, standalone `taskList` items, and normative `MUST`/`SHALL`/HTTP-status statements, capped at 30 verbatim items).
  - Surface `extractionMode` badge in `src/frontend/index.jsx` and `src/frontend/confluence-byline.jsx`.
- [x] **Task 10.3: Unit Tests for Phase 10 (`tests/jira-links.test.mjs`, `tests/adf-requirements.test.mjs`, `tests/confluence-page.test.mjs`)**
  - Test `inlineCard` / `blockCard` / markdown `link` extraction from Jira description ADF, deduplication with `/remotelink`, and Tier-2 unstructured PRD extraction vs non-spec pages.

---

## Phase 11: Symbol & Relevance-Prioritized Hunk Budgeting for Large PRs (>100 KB)

- [x] **Task 11.1: Implement `budgetDiffByRelevance` in `src/diff-evidence.mjs` & Wire into `src/analysis.mjs`**
  - Score per-file hunks using production-vs-test path weights, exported/public symbol declarations, and requirement keyword overlap; pack top hunks within `100,000` chars preserving exact `diff --git`, `+++ b/...`, and `@@ -old +new @@` headers so `verifyCitation` remains 100% exact.
  - Return `wasBudgeted` and `omittedFiles` from `analyzeChanges`, disclose omitted files in `src/frontend/index.jsx` and `buildMarkdownReport`, and instruct the LLM to prefer `INSUFFICIENT_CONTEXT` over `POTENTIAL_MISSING` when logic may reside in omitted files.
- [x] **Task 11.2: Unit Tests for Phase 11 (`tests/diff-evidence.test.mjs`, `tests/analysis.test.mjs`)**
  - Test a >120 KB multi-file source diff (production TypeScript service + huge test fixture file), verifying production service hunks are retained with exact line citations while oversized test fixtures are omitted and disclosed in `omittedFiles`.

---

## Phase 12: Bitbucket PR Metadata (`headCommit`, Branch, State) & Live Stale-Snapshot Drift Detection

- [x] **Task 12.1: Implement `loadPullRequestMetadata` in `src/bitbucket-diff.mjs` & Staleness Engine in `src/cache-store.mjs` / `src/linked-analysis.mjs`**
  - Fetch `/2.0/repositories/{ws}/{repo}/pullrequests/{id}` JSON (`title`, `state`, `sourceBranch`, `destinationBranch`, `headCommit`, `updatedOn`).
  - Persist `headCommit` and `prMeta` in cached snapshots, compute `computeStaleness(cachedSnapshot, { pageVersion, headCommit })`, and return live `prMeta` + `staleness` from `loadIssueContext`.
  - Render PR state/branch/commit lozenges and the `"Cached Snapshot Outdated"` warning banner (`buildStalenessBanner`) in `src/frontend/view-model.mjs` and `src/frontend/index.jsx`.
- [x] **Task 12.2: Unit Tests for Phase 12 (`tests/bitbucket-diff.test.mjs`, `tests/linked-analysis.test.mjs`, `tests/view-model.test.mjs`)**
  - Test Bitbucket PR metadata parsing, `specOutdated` (`v2 -> v3`) and `prOutdated` (`#abc1234 -> #def5678`) staleness detection, and UI banner formatting.

---

## Phase 13: Native Jira Workflow Validator Gate (`jira:workflowValidator`) & Live Cloud Verification

- [x] **Task 13.1: Implement `src/workflow-validator.mjs`, Privacy-Safe Gate Store (`src/cache-store.mjs`), & `manifest.yml` Wiring**
  - Store zero-content aggregate gate status (`trace:gate:v1:<40-hex>`) on linked PR verification.
  - Implement `validateIssueTransition(event, deps)` blocking transitions when unverified or `potentialMissing > 0` and allowing transitions when `potentialMissing === 0`.
  - Wire `jira:workflowValidator` (`spec-trace-workflow-validator`) and `workflowValidatorHandler` in `manifest.yml` and `src/index.js`.
- [x] **Task 13.2: Unit Tests, `forge lint`, Cloud Deployment (`v3.6.0`), & Live Browser Verification**
  - Test `validateIssueTransition` (unverified block, `potentialMissing > 0` block, `potentialMissing === 0` pass).
  - Run `npm test` (57/57 pass) and `forge lint` (`0 issues`), deploy `v3.6.0` to `one-atlas-hebl.atlassian.net` (`isLatest: true`), and verify live in browser:
    1. Cold `Re-lint Spec` on Confluence `2293824` completed in a single run with zero 25s timeout (`Readiness Score: 3 / 12, 25%`, `Testable: 3`, `Ambiguous: 9`),
    2. Jira `PLAT-33510` panel displayed live Bitbucket PR #1 metadata (`PR OPEN`, `feature/criteria-test -> feature/spec-trace-test`, `#fa8f783`) and completed `Re-verify Pull Request` (`1 / 4, 25%`, delta banner shown),
    3. `Spec-to-Code Trace Gate` verified selectable in Jira Workflow Transition Validators list.
- [x] **Task 13.3: Precision Hardening (`isEligibleOutOfScope`, Workflow Gate UI Pill, 4-Item Parallel Sharding, `v3.9.0`) & Live Runtime Telemetry Verification**
  - Enforce deterministic `isEligibleOutOfScope` gate (`src/verdicts.mjs`), render live `Workflow Gate` status badge + KVS sync timestamp (`src/frontend/index.jsx`), shard `analyzeChanges` into `ANALYSIS_BATCH_SIZE = 4` with `max_completion_tokens: 3000` (`src/analysis.mjs`), and emit zero-secret runtime duration telemetry (`src/index.js`).
  - Run `npm test` (`59/59` pass) and `forge lint` (`0 issues`), deploy `v3.9.0` (`isLatest: true`), and verify both in live browser (`PLAT-33510`) and Forge runtime logs (`invocationId: 2a7a9501-b285-4a04-80ff-f361fb416145`):
    1. End-to-end server execution completed in **`6,566 ms`** (`analyzeLinkedPullRequest.ok`, `forceRefresh: true`, `fromCache: false`),
    2. Live UI updated to **`Live · 2026-11-12 07:24 UTC`**, restoring **`Evidence Coverage: 1 / 12 in-scope criteria (8%), Out of Scope: 0`** and flagging the 8 reclassified items via delta banner,
    3. Live UI synchronized **`Workflow Gate: BLOCKED (11 Missing)`** and **`KVS record synced · 2026-11-12 07:24 UTC · Commit #fa8f783`**.

---

## Phase 14: Protocol Gate Integrity, Deletion-Diff Provenance & Narrative PRD Extraction

- [x] **Task 14.1: Anti-Poisoning & Live Drift Checks for `Spec-to-Code Trace Gate` (`src/linked-analysis.mjs`, `src/workflow-validator.mjs`, `src/index.js`, `src/frontend/view-model.mjs`, `src/frontend/index.jsx`)**
  - Restrict `saveIssueGateSummary` (`trace:gate:v1:<issueKey>`) strictly to verifications where both `pageId` and `pullRequestUrl` are actively linked to `issueKey` (`isLinkedPage === true`), returning `gateSkippedUnlinkedPage: true` otherwise.
  - Wire `api.asApp()` Jira link + Confluence page version checks into `workflowValidatorHandler` (`src/index.js`) and `validateIssueTransition` (`src/workflow-validator.mjs`) so unlinked PR swaps or Confluence `pageVersion` bumps after a prior `PASS` block Jira transitions immediately.
- [x] **Task 14.2: Deletion (`-`) & Removed-File (`+++ /dev/null`) Indexing and Citation Provenance (`src/diff-evidence.mjs`, `src/analysis.mjs`, `src/verdicts.mjs`, `src/frontend/view-model.mjs`, `src/frontend/index.jsx`)**
  - Parse `--- a/<oldPath>` headers alongside `+++ b/<newPath>`, index `-` lines with 1-based `oldLine` numbers and `changeType: 'deleted'`, enrich verified deletion citations with hunk context, and surface `(removed)` provenance labels in UI and Markdown reports.
- [x] **Task 14.3: Tier-3 Verbatim Narrative PRD Behavioral Clause Extractor (`src/adf-requirements.mjs`, `src/frontend/index.jsx`, `src/frontend/confluence-byline.jsx`)**
  - Add `extractNarrativePrdRequirements(adf)` (`extractionMode: 'narrative_prd'`) splitting narrative prose into atomic verbatim sentences and matching concrete conditional (`When`/`If`/`Upon`) and system/service behavioral clauses while rejecting questions, fluff, and `TBD` items.
- [x] **Task 14.4: Unit & Integration Tests, `forge lint`, and `v3.10.0` Cloud Deployment**
  - Add comprehensive unit tests across `tests/workflow-validator.test.mjs`, `tests/linked-analysis.test.mjs`, `tests/diff-evidence.test.mjs`, `tests/analysis.test.mjs`, `tests/adf-requirements.test.mjs`, and `tests/view-model.test.mjs`.
  - Verify `npm test` (`63/63` pass), `forge lint` (`0 issues`), zero strikethrough, and deploy `v3.10.0` (`isLatest: true`) to `one-atlas-hebl.atlassian.net`.

---

## Phase 15: Full-Loop Real Cloud E2E Proof (`BLOCKED -> Fix Commit -> Drift Alert -> Re-verify -> PASS + Live Workflow Validator`)

- [x] **Task 15.1: Stage Isolated Real Cloud Verification Scenario (Preserving `PLAT-33510`, `2293824`, and `PR #1` Untouched)**
  - Created isolated Confluence PRD `5111809` (`E2E Narrative & Deletion Spec`, H2 `Proposed Behavior` + 4 plain paragraphs covering HMAC SHA-256 verification, deprecated MD5 deletion, HTTP 429 rate limiting, and p99 runtime load SLA), Bitbucket `PR #2` (`e2e-loop-pr -> e2e-loop-base`), and Jira `PLAT-33511` (`E2E Full Loop Verification` with auto-discovered description links).
- [x] **Task 15.2: Fix Real-World Narrative Shadowing & Mixed-Hunk Citation Provenance (`v3.11.0`)**
  - Unified unstructured PRD extraction in `src/adf-requirements.mjs` so a single `HTTP 429` / RFC-2119 clause no longer shadows sibling `Proposed Behavior` narrative and SLA paragraphs (`extractionMode: 'narrative_prd'`, extracting all 4 clauses in order), and invalidated stale extractor-mode KVS lint/trace caches (`src/cache-store.mjs`, `src/linked-analysis.mjs`, `src/spec-linter.mjs`, `src/index.js`).
  - Added per-line hunk tags (`+[L<num>]`, `-[L<num>]`) via `annotateDiffForPrompt` (`src/diff-evidence.mjs`, `src/analysis.mjs`) and indentation/tag-safe canonical resolution via `resolveVerifiedCitation` (`src/diff-evidence.mjs`, `src/verdicts.mjs`) while preserving strict integer line-number provenance (`66/66` unit tests pass).
- [x] **Task 15.3: Re-verify Full 4-Clause Narrative & Deletion Loop Live on `PLAT-33511` (`v3.11.0`)**
  - Verified live on `one-atlas-hebl.atlassian.net` (`v3.11.0`):
    1. Confluence `5111809` (`E2E Narrative & Deletion Spec`) `Re-lint Spec` displayed `Narrative PRD Mode`, **4 criteria**, and **`Readiness Score: 3 / 4 (75%)`** (3 `Testable`, 1 `Runtime / Non-Diff` SLA).
    2. Jira `PLAT-33511` (`E2E Full Loop Verification`) + Bitbucket `PR #2` (`#f0889e7`) `Re-verify Pull Request` displayed `Narrative PRD Mode`, **4 criteria**, **`Evidence Coverage: 3 / 3 (100%)`**, **`Out of Scope: 1`**, **`Workflow Gate: PASS (Ready)`**, **`Found: 3`** (`verifyWebhookSignature`, `allowInsecureMd5Auth` with `(removed)` deletion badge, and `enforceRateLimit` transitioning `NEEDS CONTEXT -> FOUND`).
- [x] **Task 15.4: Live Jira Workflow Transition Gate Physical Verification (2026-11-13)**
  - Added `Spec-to-Code Trace Gate` validator to `* -> Done` in `Software Simplified Workflow for Project PLAT` and published draft.
  - Tested `PLAT-33510` (11 Missing): Transition to `Done` physically blocked by Jira with error: `Spec-to-Code Trace Gate blocked transition for PLAT-33510: 11 requirement(s) are still flagged as Potential Missing (1/12 in-scope criteria verified).`, maintaining `To Do` state.
  - Tested `PLAT-33511` (3/3 100% PASS): Transition to `Done` succeeded with zero errors, ticket status moved to `Done` with panel showing `PASS (Ready)`.

---

## Phase 16: Forge `production` Environment Readiness

- [x] **Task 16.1: Inspect & Prepare Forge `production` Environment Configuration**
  - Verified initial `production` state (`prodVarKeys: []`, `prodInstallCount: 0`), configured `BITBUCKET_CLIENT_ID` on `production` (`prodVarKeys: ["BITBUCKET_CLIENT_ID"]`), and deployed `v3.10.0` bundle to `production` (`hasBitbucketProviderOnProd: true`). Only `forge providers configure bitbucket-oauth -e production` (Bitbucket OAuth secret) + site installation remain before external judge sharing.

---

## Phase 17: Fault-Tolerant Batch Recovery & Enterprise Large PR Resilience (Post-Audit Hardening)

- [x] **Task 17.1: Git Diff Edge-Case & Binary/Rename/CRLF Normalization (`v3.12.0`)**
  - Handled binary diff headers (`Binary files differ`, `GIT binary patch`), submodule commits (`160000`), file renames/copies (`rename from/to`), CRLF line endings, and code-implementable exclusion guards on `OUT_OF_SCOPE` in `src/diff-evidence.mjs` and `src/verdicts.mjs` (`68/68` tests pass, deployed in `82fce44`).
- [x] **Task 17.2: Per-Batch Failsafe Isolation in `src/analysis.mjs`**
  - In `analyzeChanges`, wrapped batch execution in `Promise.allSettled` with graceful fallback: if batch N encounters a network blip, 504 gateway timeout, or model error while other batches succeed, the uncompleted batch items are isolated and downgraded to `INSUFFICIENT_CONTEXT` (`recoveredError` attached) without aborting the entire verification run; if all batches fail, the root error is rethrown. Unit tests verified in `tests/analysis.test.mjs`.
- [x] **Task 17.3: Rovo Agent Code Scaffolding Action (`suggest-fix-action` in `manifest.yml` & `src/rovo-action.mjs`)**
  - Implemented `suggestFixForRovo` in `src/rovo-action.mjs` and exported `rovoSuggestFixHandler` in `src/index.js`. Registered `suggest-fix-action` under `action` and `rovo:agent` in `manifest.yml`. When invoked with `issueKey` and optional `requirementId`, the action retrieves the requirement statement from per-user KVS snapshot or Confluence spec, infers appropriate target files (`auth.js`, `rate-limiter.js`, `cache.js`, `telemetry.js`, etc.), and produces copy-ready implementation skeletons and Node.js test suites with actionable next steps so Rovo acts as an active pair programming assistant.
- [x] **Task 17.4: Automated Unit & Integration Tests for Phase 17**
  - Added unit test suites in `tests/analysis.test.mjs` (partial batch failure recovery) and `tests/rovo-action.test.mjs` (fix suggestion generation with auto-selection and error diagnostics). All 70 unit tests pass 100%. `forge lint` verified with 0 errors and 0 warnings.

---

## Phase 18: Dual-Model Adversarial Hardening (Haiku & DeepSeek Edge-Case Defense)

- [x] **Task 18.1: Forge 20s Hard-Timeout Guard on LLM Batch Analysis (`src/analysis.mjs`)**
  - Implemented `withTimeout` (`Promise.race`) with `BATCH_TIMEOUT_MS = 18000` (18s safe guard) so hung or delayed LLM batch requests cannot stall the FaaS process up to Forge's fatal 25s threshold.
  - When an individual batch exceeds 18 seconds, it is cleanly isolated and downgraded to `INSUFFICIENT_CONTEXT` (`recoveredError: 'TIMEOUT_BATCH-N_18000MS'`) while preserving all parallel successful batches.
- [x] **Task 18.2: Hardened Fail-Safes & Honest Scaffolding for `suggest-fix-action` (`src/rovo-action.mjs`)**
  - Re-throw `isAuthChallengeError` (e.g. `NeedsAuthenticationError`) immediately in `loadLinks` and `loadPage` so Rovo Chat displays the native OAuth login card instead of confusing users with `REQUIREMENT_NOT_FOUND`.
  - Added `alreadyImplemented: true` early return when a requirement is already `EVIDENCE_FOUND`, returning the verified line citation instead of generating bogus scaffolds.
  - Generates fail-first unit tests enforcing TDD (`throw new Error('Not implemented')` & `assert.rejects`) with escaped JSON requirement text, preventing unwritten code from passing CI silently.
  - Forwarded `wasBudgeted` and `omittedFiles` metadata in both live and cached Rovo responses (`verifyIssueSpecForRovo`) so users know exactly when files were excluded due to PR size.
- [x] **Task 18.3: Unit & Integration Verification Suite (`tests/analysis.test.mjs`, `tests/rovo-action.test.mjs`)**
  - Added unit test cases verifying 18s batch timeout isolation, OAuth re-throw on suggest-fix, fail-first test scaffolding, already-implemented detection, and `omittedFiles` payload forwarding.
  - All 70 unit tests pass 100% (`npm test`). `forge lint` verified with **0 errors, 0 warnings, No issues found**.


---

## Phase 19: Devpost 2026 Contest Submission & Showcase Deliverables

- [x] **Task 19.1: Comprehensive Testing Instructions for Judges (`docs/TESTING_INSTRUCTIONS.md`)**
  - Documented turnkey pre-configured test artifacts (`PLAT-33510` blocked gate, `PLAT-33511` passing gate, Confluence `5111809` PRD, Bitbucket PRs) and clean 3-minute evaluation walkthrough.
  - Documented optional self-hosted fresh install guide for custom Atlassian Cloud test sites.
- [x] **Task 19.2: 5-Minute YouTube Demo Video Script (`docs/DEMO_VIDEO_SCRIPT.md`)**
  - Structured 5-act storyboard within the 5-minute contest limit (04:30 target) covering: Problem, Confluence Linter, Jira Workflow Gate Block (`PLAT-33510`), Fix & Passage (`PLAT-33511`), and Rovo Agent chat actions with fail-first TDD scaffolding.
- [x] **Task 19.3: Devpost Submission Text & Architecture Overview (`docs/DEVPOST_SUBMISSION.md`)**
  - Completed official Devpost markdown writeup covering inspiration, multi-surface capabilities, Forge technical architecture, and engineering triumphs.

---

## Phase 20: Deep Engineering Hardening — Diff-Grounded Remediation, Fail-Closed Gate Governance & Spec Linter Resilience

- [x] **Task 20.1: Update Kiro Specs (`.kiro/specs/spec-to-code-trace/{requirements,design,tasks}.md`)**
  - Specify Requirement 17, error-handling matrix rows, and Phase 20 implementation/verification tasks prior to modifying `src/`.
- [x] **Task 20.2: Analysis Provenance, KVS Gate Telemetry & Fault-Tolerant Spec Linter (`src/analysis.mjs`, `src/cache-store.mjs`, `src/spec-linter.mjs`)**
  - Export `changedFiles`, `incompleteBatchCount`, and `recoveredErrors` from `analyzeChanges`; persist `changedFiles` and `incompleteBatchCount` in KVS snapshots and `trace:gate:v1` numeric gate summaries.
  - Add `LINT_BATCH_TIMEOUT_MS = 18000` (`withTimeout`) and `Promise.allSettled` partial batch recovery to `lintSpecification`.
- [x] **Task 20.3: Fail-Closed Workflow Validator Governance & Stale Badge Alignment (`src/linked-analysis.mjs`, `src/workflow-validator.mjs`, `src/frontend/view-model.mjs`)**
  - Enforce same-site `isLinkedPage` check in `analyzeLinkedPullRequest`.
  - Fail closed in `validateIssueTransition` on `incompleteBatchCount > 0`, zero verified in-scope evidence (`inScopeTotal > 0 && evidenceFound === 0`), live `loadLinks`/`loadPage` failures, and site origin mismatch.
  - Align `formatWorkflowGateBadge(issueGate, staleness)` with gate governance and staleness detection (`INCOMPLETE`, `BLOCKED (0 Verified)`, `STALE (Spec Updated)`, `STALE (New Commit)`).
- [x] **Task 20.4: Replace Hardcoded `suggestFixForRovo` Stub with Diff-Grounded `@forge/llm` Remediation & Wire Jira Panel Action (`src/rovo-action.mjs`, `src/index.js`, `src/frontend/index.jsx`)**
  - Upgrade `suggestFixForRovo` to ground fixes in real PR/manual diff excerpts and `changedFiles` via `@forge/llm` (`REMEDIATION_TIMEOUT_MS = 15000`) with repo-aware deterministic fallback (`await`-safe unit tests, zero `Not implemented` pass-on-throw bug, same-site filtering) and add live Confluence staleness detection to cached Rovo verification responses.
  - Add `suggestRequirementFix` resolver (`src/index.js`) with safe `hasCredentials()` handling and render inline **`Suggest Fix & Test`** remediation cards on `POTENTIAL_MISSING` / `INSUFFICIENT_CONTEXT` items in `src/frontend/index.jsx`.
- [x] **Task 20.5: Expand Automated Tests, Correct Documentation Accuracy, Read-Only Cloud Check & Commit Locally**
  - Add unit/integration coverage in `tests/{rovo-action,workflow-validator,view-model,spec-linter,analysis,linked-analysis}.test.mjs`, fix `/wiki/spaces/MSD/` links and Devpost component inaccuracies, verify `node --test` (`72/72 PASS`) + `forge lint --approve MAJOR_VERSION_RULE --non-interactive` (`No issues found`), complete read-only cloud CDP visual audit, and sync `README.md` + `synapse_hub.html` (Phase 20 cloud `forge deploy` awaiting user approval).
- [x] **Task 20.6: Parser Robustness, Conflict Marker Protection & KVS Quota Compaction Hardening**
  - Implement `stripTrailingCommas` in `parseJsonResponse` (`src/analysis.mjs`) to tolerate common LLM trailing comma JSON anomalies.
  - Reject git merge conflict markers (`/^(?:<{7}|={7}|>{7})(?:\s|$)/`) and coerce string integer line numbers in `resolveVerifiedCitation` (`src/diff-evidence.mjs`).
  - Normalize candidate statuses to uppercase trimmed strings in `validateVerdicts` (`src/verdicts.mjs`).
  - Implement multi-stage graceful compaction for oversized cached snapshots and spec linter results in `saveCachedSnapshot` and `saveCachedSpecLint` (`src/cache-store.mjs`), 서large multi-file PRs never fail to cache in KVS.
  - Expand test coverage to **75/75 PASS** with zero failures (`tests/analysis.test.mjs`, `tests/diff-evidence.test.mjs`, `tests/cache-store.test.mjs`).

---

## Phase 21: Enterprise Project Governance & Settings Surface

- [x] **Task 21.1: Jira Project Settings Module & UI (`manifest.yml`, `src/frontend/project-settings.jsx`)**
  - Register `jira:projectSettingsPage` (`Spec-to-Code Trace Settings`) in `manifest.yml`.
  - Build `@forge/react` UI in `src/frontend/project-settings.jsx` allowing project leads to configure coverage thresholds (70~100%), allowed Bitbucket workspaces, strict verification enforcement, and mandatory Tech Lead approvals.
- [x] **Task 21.2: Project Governance Policy Storage & Gate Enforcement (`src/project-settings.mjs`, `src/workflow-validator.mjs`, `src/index.js`)**
  - Implement `getProjectSettings` and `saveProjectSettings` in `src/project-settings.mjs` backed by Forge KVS (`trace:proj:v1:{projectKey}`).
  - Wire project policies into `validateIssueTransition` (`src/workflow-validator.mjs`): enforce custom coverage ratio thresholds and block PRs originating outside authorized Bitbucket workspaces.
  - Add `approveTraceGate` resolver in `src/index.js` for Tech Lead sign-off workflows.
- [x] **Task 21.3: Automated Test Coverage (`tests/project-settings.test.mjs`, `tests/workflow-validator.test.mjs`)**
  - Verify default policy fallback, custom policy persistence, coverage ratio boundary clamping `[0.5, 1.0]`, and workflow gate workspace blocking.

---

## Phase 22: Forge LLM Rate-Limit (429) & Resilience Engine

- [x] **Task 22.1: Jittered Exponential Backoff Engine (`src/llm-resilience.mjs`)**
  - Implement `invokeLlmWithRetry` with configurable retry bounds (`maxRetries = 3`, `initialDelayMs = 800ms`, `maxDelayMs = 5000ms`).
  - Add randomized jitter calculation (`delay * (0.8 + 0.4 * Math.random())`) to prevent thundering herd on transient 429/503/timeout spikes.
  - Fail immediately on non-transient 400 Bad Request or authentication failures without wasting retries.
- [x] **Task 22.2: Universal LLM Pipeline Integration (`src/analysis.mjs`, `src/spec-linter.mjs`, `src/rovo-action.mjs`)**
  - Wrap requirement batch analysis, specification linting, and Rovo remediation fix generation in `invokeLlmWithRetry`.
- [x] **Task 22.3: Automated Resilience Tests (`tests/llm-resilience.test.mjs`)**
  - Verify immediate pass-through, successful second-attempt retry on 429, immediate fast-fail on 400, and retry exhaustion propagation.

---

## Phase 23: Enterprise Monorepo Wild Data Resilience, Unicode i18n & Codex Defect Eradication

- [x] **Task 23.1: Monorepo Deep Paths & Git Octal Decoding (`src/diff-evidence.mjs`)**
  - Support UTF-8 3-digit octal sequence unquoting (`\355\225\253`) and spaces in `decodeGitQuotedString`.
  - Correctly track multi-directory file renames (`rename from` / `rename to`) and file copies in `changedLines` and `removedLines`.
  - Handle mixed binary diffs (`Binary files differ`) and submodule commits (`160000`) without line offset desynchronization.
- [x] **Task 23.2: Internationalization (i18n) & Unicode Keyword Relevance (`src/adf-requirements.mjs`, `src/diff-evidence.mjs`)**
  - Support Korean (`요구사항`, `수용 기준`, `보안`, `제약사항`, `예외 케이스`, `검증 규칙`) and Japanese (`要件`, `受け入れ基準`, `セキュリティ`, `ビジネスルール`, `制約事項`) PRD headings.
  - Extract multibyte Unicode keywords (`[\p{L}\p{N}_]{2,}/gu`) so non-Latin requirements actively boost diff hunk relevance scoring during 100KB budget packing.
- [x] **Task 23.3: 60-File, 300KB Monorepo Stress Test (`tests/wild-data-resilience.test.mjs`)**
  - Verify budgeting, line provenance integrity, and omitted file disclosures across 60 files and 300KB diffs.
- [x] **Task 23.4: Codex Defect Eradication (`tests/cleanliness-defects.test.mjs`)**
  - ID normalization (`String(id).trim()`) across verdict validation.
  - Confluence 404/Error cache suppression (`ACCESS_DENIED`, `NOT_FOUND`, `PAGE_ERROR`).
  - KVS gate write failure invalidation (`store.delete(gateKey)` on failed write to prevent lingering stale `PASS`).
  - Workflow validator fail-closed on null `livePr.headCommit` and null `livePage.pageVersion`.
  - Metric algebraic invariant badge check aligned in `view-model.mjs`.
- [x] **Task 23.5: Full Test Suite Verification & Cloud Deployment**
  - **101/101 tests pass across 18 test suites** (`node --test tests/*.test.mjs`).
  - `forge lint` verified with **0 errors, 0 warnings**.
  - `development` deployed to **`v6.3.0`** (installed & up-to-date on Jira & Confluence).
  - `production` deployed to **`v5.3.0`**.
