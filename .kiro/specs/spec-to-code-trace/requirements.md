# Requirements Specification — Spec-to-Code Trace (Codegeist 2026 Edition)

## 1. Introduction & Product Goal

**Spec-to-Code Trace** is an Atlassian Forge native application built for **Codegeist 2026** (*Apps for Software Teams* main track + *Best Agents* Rovo bonus track). It bridges the verification gap between **Confluence specification pages**, **Jira issues**, and **Bitbucket Cloud pull requests**.

Instead of claiming that an LLM "proves" code correctness from a partial diff, Spec-to-Code Trace enforces **deterministic evidence grounding**:
1. Extract structured acceptance criteria and requirements from real-world Confluence ADF documents (headings, nested lists, tables, and callout panels).
2. Filter generated/lockfile noise from unified diffs while indexing verifiable added lines (`+`) and delegation call sites.
3. Classify each requirement into one of four explicit statuses (`EVIDENCE_FOUND`, `POTENTIAL_MISSING`, `INSUFFICIENT_CONTEXT`, `OUT_OF_SCOPE`) via Forge LLM (`claude-sonnet-5`), then enforce a deterministic post-LLM verification gate that downgrades any unverified line citation before a human reviewer ever sees it.
4. Surface the results inside a 1-click native `@forge/react` Jira Issue Panel with per-user cached snapshots, `[Re-verify]` delta tracking, and a conversational **Atlassian Rovo Agent** backed by the exact same grounding pipeline.

---

## 2. Glossary

- **ADF (Atlassian Document Format)**: JSON document tree returned by the Confluence v2 Pages API (`body-format=atlas_doc_format`).
- **Requirement Item**: A normalized, non-empty acceptance criterion or functional requirement string extracted in deterministic document order (`1..30`).
- **Noise File**: Generated, lockfile, or minified artifacts in a PR diff (e.g., `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `*.min.js`, `dist/**`, `build/**`, `*.snap`) that waste context tokens without carrying primary requirement logic.
- **Verifiable Citation**: An object `{ path, line, text }` whose `path`, new-file `line` number, and exact `text` match an added line (`+`) parsed from the PR unified diff.
- **Grounding Gate**: Deterministic post-LLM validator (`validateVerdicts`) that guarantees cardinality, schema validity, and exact diff provenance.
- **Delta Transition**: Status change for a requirement item (`fromStatus -> toStatus`) between a previously cached verification snapshot and a fresh `[Re-verify]` run on the same `(accountId, issueKey, pageId, pullRequestUrl)` tuple.

---

## 3. Functional Requirements (EARS Format)

### Requirement 1: Multi-Format Confluence ADF Requirement Extraction

**User Story:** As a software engineer or tech lead writing specs in Confluence, I want Spec-to-Code Trace to extract requirements from headings, nested lists, requirement tables, and callout panels across standard English spec templates, so I do not have to reformat existing team specs into a single rigid bullet template.

#### Acceptance Criteria

1. **WHEN** a Confluence ADF document contains a heading whose normalized text (case-insensitive, trailing colon stripped) matches any supported English spec section title (`acceptance criteria`, `acceptance criterion`, `requirements`, `functional requirements`, `spec requirements`, `technical requirements`), **THE SYSTEM SHALL** activate requirement extraction for that section until a heading of equal or higher hierarchy (`level <= activeLevel`) is encountered.
2. **WHEN** an active spec section contains nested `bulletList`, `orderedList`, or `taskList` nodes, **THE SYSTEM SHALL** prefix leaf items with their ancestor item labels (`Parent: Child`) and omit bare category-parent labels that have extracted child items.
3. **WHEN** an active spec section contains an ADF `table` node, **THE SYSTEM SHALL** extract each non-header data row as a structured requirement item:
   - **IF** the table has a header row (`tableHeader` cells), **THEN THE SYSTEM SHALL** join non-empty cell values using `Header: Value` pairs or prioritize requirement/criterion description columns cleanly without duplicating empty cells.
   - **IF** a data row contains exclusively empty whitespace cells, **THEN THE SYSTEM SHALL** skip that row.
4. **WHEN** an active spec section contains an ADF `panel` node (e.g., `info`, `note`, `warning`, `success`), **THE SYSTEM SHALL** extract list items inside the panel, or single-statement requirement paragraphs when no list exists inside that panel.
5. **WHEN** a standalone paragraph outside an active heading ends with a supported introduction phrase (e.g., `Acceptance criteria:`, `Requirements:`, `Functional requirements:`), **THE SYSTEM SHALL** extract items from the immediately following list or table node only.
6. **WHEN** duplicate requirement strings (identical after trimming and normalizing internal whitespace) appear during extraction, **THE SYSTEM SHALL** deduplicate them while preserving first-seen document order.
7. **WHEN** the Confluence v2 API returns page metadata (`version.number`, `title`, `_links.webui`), **THE SYSTEM SHALL** return `{ pageId, title, pageVersion, webUrl, requirements }` to downstream callers.

---

### Requirement 2: Production Unified Diff Engine, Noise Filtering & Citation Provenance

**User Story:** As a code reviewer inspecting real-world pull requests, I want lockfiles and build artifacts filtered out automatically, quoted/renamed file paths parsed accurately, and citations verified for both direct implementations and delegated helper calls, so LLM token budgets focus on real source code and zero hallucinated file/line references ever appear.

#### Acceptance Criteria

1. **WHEN** `filterAndIndexDiff(diff)` processes a unified diff string, **THE SYSTEM SHALL** identify and exclude hunks belonging to known noise paths (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `composer.lock`, `*.min.js`, `*.min.css`, `*.map`, `*.snap`, `dist/**`, `build/**`, `.next/**`, `coverage/**`) before building the LLM prompt diff payload.
2. **WHEN** one or more files are excluded as noise, **THE SYSTEM SHALL** return an `excludedFiles` array listing the skipped paths and apply the `100,000`-character analysis limit to the **filtered** source diff rather than failing prematurely on lockfile bloat (while enforcing a hard raw safety ceiling of `500,000` characters on HTTP download).
3. **IF** a diff contains exclusively noise files and zero non-noise added lines remain after filtering, **THEN THE SYSTEM SHALL** throw a descriptive error stating that only generated/lockfile changes were found.
4. **WHEN** a unified diff header uses standard (`+++ b/path/to/file.ts`) or git-quoted (`+++ "b/path with spaces/file.ts"`) syntax, **THE SYSTEM SHALL** decode escaped characters (`\"`, `\\`, `\t`, octal UTF-8 sequences) and track accurate new-file line numbers across multiple hunks (`@@ -old,count +new,count @@`).
5. **WHEN** the LLM returns status `EVIDENCE_FOUND`, **THE SYSTEM SHALL** require a `citation` object `{ path, line, text }` that matches an indexed added line (`+`) in `changedLines`; **IF** `verifyCitation` fails, **THEN THE SYSTEM SHALL** downgrade the verdict to `INSUFFICIENT_CONTEXT` with a clear manual-review notice.
6. **WHEN** the LLM returns status `INSUFFICIENT_CONTEXT` AND includes an optional `citation` pointing to a delegation call site in the diff (e.g., calling an imported validator or external service), **THE SYSTEM SHALL** retain the `citation` **if and only if** `verifyCitation(changedLines, citation)` succeeds; **IF** the optional citation fails verification, **THEN THE SYSTEM SHALL** strip the unverified `citation` while keeping status `INSUFFICIENT_CONTEXT` (when reasoning is valid).
7. **WHEN** `validateVerdicts` completes, **THE SYSTEM SHALL** also compute a deterministic `summary` object `{ total, evidenceFound, potentialMissing, insufficientContext, outOfScope, coverageRatio }` where `coverageRatio` equals `evidenceFound / Math.max(1, total - outOfScope)`.

---

### Requirement 3: 1-Click Native `@forge/react` Jira Issue Panel UX

**User Story:** As a Jira user opening an issue during sprint review or PR triage, I want the Spec-to-Code Trace panel to automatically detect linked Confluence specs and Bitbucket pull requests, let me run verification in a single click, and present scannable progress metrics, filterable status tabs, syntax-formatted code citations, and deep links to Bitbucket.

#### Acceptance Criteria

1. **WHEN** the Jira Issue Panel mounts, **THE SYSTEM SHALL** automatically invoke `loadIssueContext` to fetch linked same-site Confluence pages, linked Bitbucket Cloud pull requests, and any per-user cached verification snapshot for the default `(pageId, pullRequestUrl)` pair without requiring the user to click "Find linked pages" first.
2. **WHEN** at least one same-site Confluence page and one Bitbucket PR are linked to the Jira issue, **THE SYSTEM SHALL** pre-select the first linked spec page and first linked PR in `Select` controls (allowing selection changes when multiple links exist) and render a primary 1-click **`Verify Requirements`** (`LoadingButton`) action.
3. **WHEN** an analysis result is present, **THE SYSTEM SHALL** render an executive summary header using `@forge/react` native components:
   - `ProgressBar` displaying `summary.coverageRatio` (`0..1`),
   - Status counter pills (`Lozenge` / `Badge`) for **Found** (`success`), **Potential Missing** (`danger` / `removed`), **Needs Context** (`warning` / `moved`), and **Out of Scope** (`neutral` / `default`),
   - Excluded noise file notice (when `excludedFiles.length > 0`) showing how many generated/lockfile paths were skipped.
4. **WHEN** verdicts are displayed, **THE SYSTEM SHALL** provide `Tabs` (`All`, `Potential Missing`, `Evidence Found`, `Needs Context`, `Out of Scope`) so reviewers can immediately isolate risk items (`POTENTIAL_MISSING`) without scrolling through satisfied items.
5. **WHEN** rendering each verdict card (`Box` with `xcss` border/padding tokens), **THE SYSTEM SHALL** display:
   - Requirement number & full requirement text,
   - Semantic `Lozenge` status badge (and delta transition badge if changed on `[Re-verify]`),
   - Concise AI reasoning text,
   - When `citation` is present: file path + line badge, syntax-highlighted `CodeBlock` (`language` inferred from file extension, fallback `'text'`), and a `LinkButton` opening the linked Bitbucket pull request diff in a new tab (`target="_blank"`).
6. **WHERE** a Jira issue lacks remote links (or the reviewer wants to test an unlinked page ID or pasted unified diff), **THE SYSTEM SHALL** provide a clean toggleable **"Manual Page ID / Paste Diff"** fallback section so manual workflows remain 100% functional.
7. **WHEN** any error occurs (missing OAuth consent, Confluence 403/404, empty criteria, oversized diff, or Forge LLM error), **THE SYSTEM SHALL** render a `SectionMessage` (`appearance="warning"` or `"error"`) with actionable human-readable guidance instead of raw unstyled text.

---

### Requirement 4: Per-User Snapshot Caching & `[Re-verify]` Delta Tracking

**User Story:** As a reviewer returning to a Jira issue after a developer pushes fixes to a pull request, I want the previous verification result to load instantaneously on panel open and a `[Re-verify]` button to highlight exactly which previously missing requirements are now evidenced in code.

#### Acceptance Criteria

1. **WHEN** a linked PR verification succeeds (`analyzeLinkedPullRequest`), **THE SYSTEM SHALL** store a compact snapshot in Forge Key-Value Store (`@forge/kvs`, `storage:app`) keyed by a deterministic SHA-256 digest of `(accountId, issueKey, pageId, pullRequestUrl)`.
2. **THE SYSTEM SHALL** isolate cached snapshots by `accountId` so one Atlassian user can never read requirement text or Bitbucket diff citations fetched under another user's Confluence/Bitbucket OAuth credentials.
3. **THE SYSTEM SHALL** omit raw unified diff strings from cached KVS records, storing only `{ schemaVersion: 1, cachedAt, issueKey, pageId, pageTitle, pageVersion, pullRequestUrl, diffHash, excludedFiles, summary, verdicts, delta }` and enforcing a payload size guard (`<= 200 KB`) well within Forge KVS limits.
4. **WHEN** `loadIssueContext` finds a cached snapshot for the active user and default `(pageId, pullRequestUrl)` pair, **THE SYSTEM SHALL** return the cached snapshot immediately along with `cachedAt` timestamp metadata so the UI renders in under 1 second without consuming Forge LLM tokens.
5. **WHEN** the user clicks **`Re-verify`** (`forceRefresh: true`), **THE SYSTEM SHALL** fetch the latest Confluence page (`pageVersion`) and latest Bitbucket PR diff (`diffHash`), run fresh verification, compute `delta` against the prior cached snapshot's verdicts matched by normalized `requirementText` (fallback `id`), persist the new snapshot, and return the `delta` summary.
6. **WHEN** `delta` contains status transitions (e.g., `POTENTIAL_MISSING -> EVIDENCE_FOUND` as **Resolved**, or `EVIDENCE_FOUND -> POTENTIAL_MISSING` as **Regressed**), **THE SYSTEM SHALL** display a `SectionMessage` delta banner summarizing resolved/regressed counts and render an inline transition `Lozenge` on each changed verdict card.

---

### Requirement 5: Atlassian Rovo Agent & Action Integration (*Best Agents* Bonus Track)

**User Story:** As an engineering lead or PM using Atlassian Rovo Chat across Jira and Confluence, I want to ask the **Spec-to-Code Trace** Rovo Agent to audit a Jira issue's linked pull request against its Confluence spec and receive grounded, citation-verified verdicts directly in conversation.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** declare a `rovo:agent` module (`key: spec-trace-agent`, `name: Spec-to-Code Trace`) and a custom `action` module (`key: verify-issue-spec-action`, `actionVerb: GET`) in `manifest.yml` compliant with `@forge/manifest` schema constraints (`name` <= 30 chars, `description` <= 255 chars, `conversationStarters` items <= 85 chars).
2. **WHEN** the Rovo Agent invokes `verify-issue-spec-action` with an `issueKey` (and optional `pageId`, `pullRequestUrl`), **THE SYSTEM SHALL** execute the exact same backend pipeline (`loadIssueLinks` -> auto-select first linked same-site page & Bitbucket PR when omitted -> `loadPullRequestDiff` -> `filterAndIndexDiff` -> `analyzeChanges` -> `validateVerdicts` -> per-user KVS cache update).
3. **IF** the user has not yet authorized Bitbucket Cloud OAuth or the issue has no linked Confluence page / Bitbucket PR, **THEN THE SYSTEM SHALL** return a structured diagnostic object instructing the Rovo Agent to tell the user which link or OAuth connection is missing without fabricating verdicts.
4. **THE SYSTEM SHALL** configure the Rovo Agent `prompt` to treat requirement and diff text as untrusted data, report exact `summary` counts, list `POTENTIAL_MISSING` and `INSUFFICIENT_CONTEXT` items prominently, cite `path:line` only from verified `citation` fields, and never claim semantic proof of runtime correctness.

---

### Requirement 6: Pre-Code Confluence Spec Readiness & Ambiguity Linter

**User Story:** As a product manager or tech lead authoring or reviewing a Confluence specification before development starts, I want Spec-to-Code Trace & Linter to audit extracted requirements for ambiguity, missing measurable thresholds, and static-diff unverifiability directly in Confluence, Jira, and Rovo Chat, so vague specs are fixed before engineers write code.

#### Acceptance Criteria

1. **WHEN** `lintSpecification(requirements, chat)` runs on `1..30` extracted requirement items, **THE SYSTEM SHALL** classify every item into one of three readiness statuses:
   - `TESTABLE`: States a concrete condition, actor/input, and observable behavior or threshold verifiable in code/tests.
   - `AMBIGUOUS`: Contains subjective, unquantified, or underspecified phrasing (e.g., *"fast"*, *"gracefully"*, *"user-friendly"*, *"as needed"*, *"properly"*, *"appropriate"*) or lacks concrete acceptance bounds.
   - `UNVERIFIABLE_IN_DIFF`: Describes runtime load SLAs, cloud infrastructure provisioning, or subjective visual styling that cannot be verified from a static pull request diff alone.
2. **WHEN** an item is classified as `AMBIGUOUS` or `UNVERIFIABLE_IN_DIFF`, **THE SYSTEM SHALL** provide a non-empty `issue` explanation and a concrete `suggestedRewrite` showing how to make the requirement measurable and testable (or which integration/load test gate to pair with it).
3. **THE SYSTEM SHALL** enforce a deterministic post-LLM validation gate (`validateSpecLint`) that guarantees 1:1 requirement cardinality, valid status enums, non-empty `issue` strings, deterministic vague-term fallback warnings if an entry is malformed, and a `summary` object `{ total, testable, ambiguous, unverifiableInDiff, readinessScore }` where `readinessScore` equals `testable / total`.
4. **THE SYSTEM SHALL** cache per-user spec lint snapshots in Forge KVS (`trace:lint:v1:<40-hex>`) keyed by `(accountId, pageId, pageVersion)` so reopening the same Confluence page version in Confluence, Jira, or Rovo renders instantaneously without redundant LLM calls, while automatically invalidating when `pageVersion` increments.
5. **THE SYSTEM SHALL** expose Spec Readiness Linting across all three Atlassian Cloud surfaces using existing read-only product permissions (`read:page:confluence`, `read:jira-work`, `storage:app`):
   - **Confluence Page Byline (`confluence:contentBylineItem`)**: Opens on any Confluence page (`context.extension.content.id`) to display extracted criteria, Readiness Score `ProgressBar`, status badges, and copy-ready suggested rewrites.
   - **Jira Issue Panel**: Provides a **`Lint Spec Quality`** action alongside **`Verify Requirements`** for the active Confluence spec page.
   - **Atlassian Rovo Agent (`lint-confluence-spec-action`)**: Allows users to ask Rovo to audit a Confluence page ID or Jira issue's linked spec for ambiguous requirements.

---

### Requirement 7: Multi-Line Grounded Diff Context, File-Anchor Deep Links & Markdown Review Export

**User Story:** As a pull request reviewer inspecting verdicts in the Jira Issue Panel, I want surrounding code context with the exact cited line highlighted, direct deep links to the cited file inside Bitbucket's PR diff, and a 1-click copyable Markdown review checklist, so I can complete code reviews without manual context switching.

#### Acceptance Criteria

1. **WHEN** `validateVerdicts` confirms an added-line citation `{ path, line, text }` via `verifyCitation`, **THE SYSTEM SHALL** deterministically enrich the citation (`enrichCitationContext`) from `filteredDiff` with `snippet` (up to 2 surrounding hunk context/added lines before and after the cited line) and `highlightLine` (`1`-based line offset of the verified line inside `snippet`).
2. **WHEN** the Jira Issue Panel renders a verified `citation`, **THE SYSTEM SHALL** pass `snippet` (fallback `text`) and `highlight={String(highlightLine)}` to `@forge/react` `CodeBlock` so reviewers see surrounding code structure with the exact verified line highlighted.
3. **WHEN** `pullRequestUrl` points to `https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`, **THE SYSTEM SHALL** build a file-anchored deep link (`#chg-{encodedPath}`) on the `"View File in Bitbucket PR"` button so clicking jumps directly to that file's diff in Bitbucket Cloud.
4. **WHEN** an analysis result is displayed in the Jira Issue Panel, **THE SYSTEM SHALL** provide an **`Export Review Markdown`** toggle that renders a clean, copyable Markdown PR review report (`CodeBlock language="markdown"`) summarizing coverage metrics, Potential Missing action items, Needs Context delegation checks, and verified `path:line` citations without any strikethrough syntax.

---

### Requirement 8: Multi-Stage Competition Showcase Kit

**User Story:** As a Codegeist 2026 judge evaluating Spec-to-Code Trace & Linter, I want a realistic enterprise software engineering scenario that demonstrates all 3 Spec Linter statuses, all 4 PR Trace statuses, lockfile noise exclusion, and a live `POTENTIAL_MISSING -> EVIDENCE_FOUND` `[Re-verify]` delta transition, while preserving existing baseline test artifacts untouched.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** include a complete English showcase specification and two-stage unified diff fixture (`docs/SHOWCASE_SCENARIO.md` + automated end-to-end pipeline verification in `tests/showcase-scenario.test.mjs`) modeled on an enterprise **Webhook Delivery & Audit Export Service** (`TypeScript`).
2. **THE SYSTEM SHALL** preserve existing repository branches (`feature/spec-trace-test`, `feature/criteria-test`), PR `#1`, and Jira issue `PLAT-33510` without deletion or destructive modification.

---

### Requirement 9: Deep Jira ADF Link Discovery & 2-Tier Unstructured Confluence PRD Extraction

**User Story:** As an engineer or PM whose team pastes Confluence spec smart cards and Bitbucket PR links inside the Jira issue description or writes PRDs using non-standard section headings (`Business Rules`, `Security Constraints`, checklists, or `MUST`/`SHALL` prose), I want Spec-to-Code Trace & Linter to discover those links and extract verbatim requirements automatically without forcing manual copy-pasting or rigid document reformatting.

#### Acceptance Criteria

1. **WHEN** `loadIssueLinks` inspects a Jira issue, **THE SYSTEM SHALL** extract Confluence page links and Bitbucket Cloud PR links from **both** Jira `/remotelink` records and the Jira issue `description` ADF tree (`inlineCard`, `blockCard`, `embedCard`, `link` text marks, and inline `https://` URLs), deduplicating identical targets cleanly.
2. **WHEN** a Confluence ADF page contains zero items under Tier-1 explicit headings (`Acceptance Criteria`, `Requirements`, etc.), **THE SYSTEM SHALL** execute a deterministic Tier-2 PRD extractor (`extractionMode: 'heuristic_prd'`) that extracts verbatim items from extended PRD headings (`Business Rules`, `Security`, `Security Constraints`, `Constraints`, `Validation Rules`, `User Stories`, `Edge Cases`, `Expected Behavior`, `Definition of Done`), standalone `taskList` checklists, and normative `MUST` / `SHALL` / HTTP-status paragraphs (up to 30 items) without fabricating non-existent text.
3. **THE SYSTEM SHALL** return `extractionMode` (`'explicit' | 'heuristic_prd' | 'none'`) from `loadRequirements` and display a transparent badge in the UI whenever Tier-2 heuristic PRD extraction was used.

---

### Requirement 10: Relevance-Prioritized Diff Hunk Budgeting for Large Pull Requests (>100 KB)

**User Story:** As a reviewer auditing a large enterprise pull request (>100 KB of source code after lockfile removal), I want Spec-to-Code Trace & Linter to prioritize production code hunks matching exported symbols and requirement keywords within the prompt budget instead of failing hard at 100 KB, while keeping exact new-file line numbers for citation verification.

#### Acceptance Criteria

1. **WHEN** `filteredDiff.length` exceeds `100,000` characters (up to the `500,000`-character transport ceiling), **THE SYSTEM SHALL** invoke `budgetDiffByRelevance(filteredDiff, requirements, 100000)` instead of throwing an immediate size error.
2. **THE SYSTEM SHALL** score file hunks deterministically using production-vs-test path weighting, exported symbol declarations (`export`, `function`, `class`, `interface`, `def`, `func`), and requirement keyword overlap, packing top-ranked hunks with intact `diff --git` and `@@ -old +new @@` headers so `changedLines` and `verifyCitation` preserve 100% exact line provenance.
3. **WHEN** one or more low-priority files/hunks are omitted to fit the budget, **THE SYSTEM SHALL** return `wasBudgeted: true` and `omittedFiles: string[]`, disclose omitted paths in the Jira UI and Markdown report, and instruct the LLM to prefer `INSUFFICIENT_CONTEXT` over `POTENTIAL_MISSING` when behavior may reside in omitted files.

---

### Requirement 11: Bitbucket PR Metadata & Live Stale-Snapshot Drift Detection

**User Story:** As a reviewer opening a Jira issue with a cached verification snapshot, I want to see live Bitbucket PR metadata (`OPEN`/`MERGED` state, source/target branches, latest commit short SHA) and receive an immediate warning banner if the Confluence spec version or PR head commit changed since the cached snapshot was recorded.

#### Acceptance Criteria

1. **WHEN** Bitbucket OAuth credentials are active, **THE SYSTEM SHALL** fetch PR metadata (`/2.0/repositories/{ws}/{repo}/pullrequests/{id}`) returning `{ title, state, sourceBranch, destinationBranch, headCommit, updatedOn }` alongside diff verification and during `loadIssueContext`.
2. **THE SYSTEM SHALL** store `headCommit` and `prMeta` inside the per-user KVS snapshot (`trace:v1:...`).
3. **WHEN** `loadIssueContext` hydrates a cached snapshot whose `pageVersion` differs from the live Confluence `pageVersion` OR whose `headCommit` differs from the live Bitbucket PR `headCommit`, **THE SYSTEM SHALL** return `staleness: { isStale: true, specOutdated, prOutdated, cachedPageVersion, livePageVersion, cachedHeadCommit, liveHeadCommit }` and render a prominent warning `SectionMessage` prompting **`Re-verify Pull Request`**.

---

### Requirement 12: Native Jira Workflow Transition Gate (`jira:workflowValidator`)

**User Story:** As an engineering manager enforcing release governance in Jira, I want an optional native `jira:workflowValidator` rule (`Spec-to-Code Trace Gate`) that prevents issues from transitioning to `Done` when specification verification has not been run, still flags `Potential Missing` requirements, was run against an unlinked manual page, or has become stale after a Confluence spec edit or PR link change.

#### Acceptance Criteria

1. **WHEN** `analyzeLinkedPullRequest` completes verification on an issue, **THE SYSTEM SHALL** persist the issue-wide aggregate gate record (`trace:gate:v1:<40-hex>`, keyed by `issueKey`) **ONLY IF** both `pageId` and `pullRequestUrl` are actively linked to `issueKey` (via Jira `/remotelink` or Jira `description` ADF). Verifications run against an unlinked manual `pageId` SHALL still save the user's private `trace:v1:...` snapshot, MUST NOT overwrite `trace:gate:v1:<issueKey>`, and SHALL return `gateSkippedUnlinkedPage: true`.
2. **THE SYSTEM SHALL** register a `jira:workflowValidator` module (`key: spec-trace-workflow-validator`) whose handler returns `{ result: false, errorMessage }` when:
   - no gate record exists for `issue.key`,
   - `summary.potentialMissing > 0`,
   - the gated `pageId` or `pullRequestUrl` is no longer linked to `issue.key` on live Jira inspection, or
   - the live Confluence specification `pageVersion` differs from `gate.pageVersion`;
   and returns `{ result: true }` only when `summary.potentialMissing === 0` and live link/version integrity holds.

---

### Requirement 13: Deletion & File-Removal Diff Indexing and Verifiable Removal Citations

**User Story:** As a reviewer auditing security cleanup, deprecation removal, or refactoring pull requests that contain only deleted (`-`) lines or deleted source files (`+++ /dev/null`), I want Spec-to-Code Trace & Linter to index, analyze, and citation-verify removed lines accurately instead of failing with `"No supported added lines were found in the diff"`.

#### Acceptance Criteria

1. **WHEN** `changedLines` and `filterAndIndexDiff` parse a unified diff, **THE SYSTEM SHALL** resolve file paths from both `+++ b/<newPath>` and `--- a/<oldPath>` (supporting deleted files where `+++ /dev/null` is paired with `--- a/<oldPath>`) and index both added (`+`, using 1-based new-file line numbers and `changeType: 'added'`) and removed (`-`, using 1-based old-file line numbers and `changeType: 'deleted'`) lines while still excluding generated/lockfile paths.
2. **WHEN** `verifyCitation` validates a candidate citation `{ path, line, text }`, **THE SYSTEM SHALL** accept exact matches against either an indexed `added` line or an indexed `deleted` line, and `enrichCitationContext` SHALL attach `changeType` (`'added' | 'deleted'`) along with surrounding hunk lines and 1-based `highlightLine`.
3. **WHEN** the UI or Markdown export renders a verified deletion citation (`changeType === 'deleted'`), **THE SYSTEM SHALL** label the line provenance clearly (e.g., `src/legacyAuth.js:14 (removed)`) so reviewers distinguish removed-line evidence from added-line evidence immediately.

---

### Requirement 14: Tier-3 Verbatim Narrative PRD Clause Extraction

**User Story:** As an engineer reviewing a Confluence PRD written in plain narrative prose without explicit `Acceptance Criteria` tables or RFC-2119 `MUST`/`SHALL` keywords, I want Spec-to-Code Trace & Linter to extract concrete behavioral sentences verbatim so unstructured specs do not fail with `0 criteria`.

#### Acceptance Criteria

1. **WHEN** both Tier-1 (`explicit`) and Tier-2 (`heuristic_prd`) extractors find zero items on a Confluence ADF document, **THE SYSTEM SHALL** run a deterministic Tier-3 narrative behavioral extractor (`extractionMode: 'narrative_prd'`) over extended specification headings (`Proposed Behavior`, `System Behavior`, `Behavior`, `Feature Specification`, `Specification`, `Error Handling`, `API Behavior`, `Workflow`, `Deliverables`, `Scope`) and narrative paragraphs/list items.
2. **THE SYSTEM SHALL** split multi-sentence paragraphs into atomic sentences and retain only concrete behavioral clauses (conditional `When`/`If`/`Upon`/`On` triggers paired with system outcomes, or explicit system/API/service/user behavioral verbs) up to 30 items, strictly preserving verbatim text from the Confluence document while filtering out questions (`?`), background history, and `TBD` placeholders.
3. **THE SYSTEM SHALL** surface `Narrative PRD Mode` as a distinct badge in both the Jira Issue Panel and Confluence Byline popup whenever `extractionMode === 'narrative_prd'`.

---

### Requirement 15: Asynchronous Chunked Analysis & Forge Timeout Resilience

**User Story:** As an enterprise development team verifying a large pull request (>15 files, >15 requirements), I want Spec-to-Code Trace to process analysis in fault-tolerant chunks with real-time progress updates so the 25-second Forge FaaS timeout never kills verification midway.

#### Acceptance Criteria

1. **WHEN** an issue verification contains >8 requirements or >100 KB of source diff, **THE SYSTEM SHALL** process requirement batches with per-batch timeout guards and intermediate KVS state saving.
2. **IF** any individual batch fails or times out, **THEN THE SYSTEM SHALL** preserve all previously successful verdicts, mark only the uncompleted batch as `INSUFFICIENT_CONTEXT`, and return a partial completion status rather than throwing an unhandled FaaS error.
3. **THE SYSTEM SHALL** provide an execution heartbeat timestamp so the UI panel and Rovo Agent can display exact batch progress (e.g., `Auditing batch 2/3...`).

---

### Requirement 16: Intelligent Rovo Agent Advisory & Code Scaffolding (*Best Agents* Track)

**User Story:** As an engineer interacting with Atlassian Rovo Chat, I want the Spec-to-Code Agent to not only return raw verification verdicts, but also proactively explain WHY a requirement is missing and generate copy-ready skeleton code or unit tests to satisfy the gap.

#### Acceptance Criteria

1. **WHEN** a user asks Rovo about a `POTENTIAL_MISSING` requirement on an issue, **THE SYSTEM SHALL** provide a dedicated action or response format detailing the exact missing condition and generating a concrete code/test skeleton based on the project language and Confluence criteria.
2. **THE SYSTEM SHALL** provide a conversational prompt that allows Rovo to recommend actionable next steps (e.g., "Would you like me to draft a pull request comment or generate a test case for requirement #2?").

---

### Requirement 17: Diff-Grounded Remediation Engine (Jira + Rovo) & Fail-Closed Governance Integrity

**User Story:** As a reviewer or developer resolving flagged requirements, I want both the Jira Issue Panel and Rovo Chat to generate repository-contextual implementation code and runnable fail-first unit tests grounded in the real pull request diff via `@forge/llm`, and I want workflow gates and status badges to fail closed whenever analysis batches time out, evidence is zero, links or pages become unreadable, or snapshots go stale.

#### Acceptance Criteria

1. **WHEN** a user invokes `suggest-fix-action` in Rovo Chat or clicks **`Suggest Fix & Test`** (`suggestRequirementFix`) in the Jira Issue Panel for a `POTENTIAL_MISSING` or `INSUFFICIENT_CONTEXT` requirement, **THE SYSTEM SHALL** gather real repository context (`changedFiles`, verified citation snippets, and up to `20,000` chars of relevance-budgeted Bitbucket PR or manual diff excerpts) and invoke `@forge/llm` (`claude-sonnet-5`) under a `15,000ms` timeout guard (`REMEDIATION_TIMEOUT_MS`) to generate a repo-matching `targetFile`, `testFile`, `rationale`, concrete `implementationScaffold`, and `await`-safe runnable `unitTestScaffold` (falling back deterministically to a repo-extension-aware guard and valid async test only if `chat` is unavailable or times out, never emitting a pass-on-throw `Not implemented` stub).
2. **THE SYSTEM SHALL** enforce same-site origin filtering (`siteUrl`) in `suggestFixForRovo` and `analyzeLinkedPullRequest` (`isLinkedPage` check) so cross-site Confluence pages cannot leak into remediation or overwrite `trace:gate:v1`.
3. **THE SYSTEM SHALL** propagate `incompleteBatchCount` and `changedFiles` from `analyzeChanges` into cached snapshots (`trace:v1`) and numeric-only workflow gate records (`trace:gate:v1`), and **THE SYSTEM SHALL** fail closed in `validateIssueTransition` (`{ result: false }`) whenever `incompleteBatchCount > 0`, `inScopeTotal > 0 && evidenceFound === 0`, or live `loadLinks` / `loadPage` integrity checks throw errors.
4. **THE SYSTEM SHALL** render accurate `Workflow Gate` lozenge states (`INCOMPLETE (Re-verify)`, `BLOCKED (0 Verified)`, `STALE (Spec Updated)`, `STALE (New Commit)`, `BLOCKED (N Missing)`, `PASS (Ready)`) aligned with live gate behavior, compute live Confluence `pageVersion` staleness when serving cached Rovo snapshots (`!hasOAuth`), and isolate `lintSpecification` batches with an `18,000ms` per-batch timeout (`LINT_BATCH_TIMEOUT_MS`) and `Promise.allSettled` fallback recovery.

### Requirement 18: Parser Robustness, Conflict Marker Protection & KVS Quota Compaction

**User Story:** As an enterprise reviewer handling real-world pull requests, I want the system to tolerate LLM formatting quirks like trailing commas, strictly reject git merge conflict markers from being cited as code evidence, accept string-coerced line numbers, and gracefully compact oversized cached snapshots before saving to KVS so large multi-file PRs never silently lose their cached verification results.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** parse LLM JSON responses with trailing commas before closing braces/brackets (`stripTrailingCommas`) without throwing unhandled syntax exceptions.
2. **THE SYSTEM SHALL** reject git merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in `resolveVerifiedCitation`, ensuring unresolved conflict headers can never be accepted as verified evidence lines.
3. **THE SYSTEM SHALL** accept string integer representations (e.g. `"42"`) in `citation.line`, coercing them to strict integer line numbers without rejecting valid citations.
4. **THE SYSTEM SHALL** normalize candidate status strings to uppercase trimmed tokens in `validateVerdicts` so case variations (e.g. `evidence_found`) do not cause false status degradation.
5. **THE SYSTEM SHALL** apply multi-stage graceful compaction in `saveCachedSnapshot` and `saveCachedSpecLint` whenever the serialized payload exceeds `MAX_SNAPSHOT_BYTES` (`200,000` bytes) by pruning verbose citation `snippet` multi-line context, bounding verdict `reasoning` to 100 characters, and capping auxiliary file lists, only rejecting the save if the compact payload still exceeds the ceiling.

---

### Requirement 19: Enterprise Project Governance Policies & Settings Surface

**User Story:** As an engineering manager or compliance lead, I want per-project governance settings in Jira Project Settings where I can configure custom requirement coverage thresholds, bind allowed Bitbucket workspaces, and require Tech Lead sign-offs before issues can be marked Done.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** register a `jira:projectSettingsPage` module (`Spec-to-Code Trace Settings`) accessible to project administrators under Project Settings.
2. **THE SYSTEM SHALL** persist and retrieve per-project governance policies via Forge KVS (`trace:proj:v1:{projectKey}`) with validation, clamping coverage thresholds to `[0.5, 1.0]`.
3. **WHEN** a custom Bitbucket workspace policy (`allowedWorkspace`) is configured, **THE SYSTEM SHALL** verify in `validateIssueTransition` that the pull request origin belongs to the authorized workspace, failing closed if unauthorized.
4. **WHEN** a custom coverage ratio threshold is configured (e.g. 90%), **THE SYSTEM SHALL** enforce the custom ratio in `validateIssueTransition` instead of the global default (80%).
5. **WHEN** mandatory sign-off is enabled, **THE SYSTEM SHALL** block workflow transitions until an authorized reviewer records approval via `approveTraceGate`.

---

### Requirement 20: LLM Rate Limit & 429 Jittered Exponential Backoff Resilience

**User Story:** As an enterprise development team reviewing dozens of PRs simultaneously, I want LLM rate limits (HTTP 429) and transient Atlassian platform hiccups to recover automatically with jittered backoff rather than failing the review.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** wrap all Forge LLM invocations in `invokeLlmWithRetry` with configurable retry bounds (`maxRetries = 3`, `initialDelayMs = 800ms`, `maxDelayMs = 5000ms`).
2. **WHEN** an invocation encounters a rate limit (HTTP 429, `RATE_LIMIT`, `QUOTA_EXCEEDED`) or transient server error (HTTP 503, `ETIMEDOUT`), **THE SYSTEM SHALL** calculate exponential delay with randomized jitter (`delay * (0.8 + 0.4 * Math.random())`) before retrying.
3. **WHEN** a non-transient error occurs (HTTP 400 Bad Request, invalid credentials, schema violation), **THE SYSTEM SHALL** fail immediately without consuming retry quotas.
4. **WHEN** all retries are exhausted, **THE SYSTEM SHALL** propagate the original error transparently for graceful batch fallback handling.

---

### Requirement 21: Enterprise Monorepo Wild Data Resilience & Internationalization (i18n)

**User Story:** As an international engineering organization working in large monorepos with bilingual Confluence specs, I want deep paths, git octal quotes, and Korean/Japanese PRD headings supported without truncation or corruption.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** decode Git-quoted multibyte paths with 3-digit octal sequences (`\355\225\253`) and spaces accurately into canonical UTF-8 file paths.
2. **THE SYSTEM SHALL** correctly track file renames (`rename from` / `rename to`) and file copies across deep monorepo directory trees.
3. **THE SYSTEM SHALL** index mixed binary diffs and git submodule pointers (`Subproject commit`) without desynchronizing subsequent line offset indexing.
4. **THE SYSTEM SHALL** recognize Korean (`요구사항`, `수용 기준`, `보안`, `제약사항`, `예외 케이스`, `검증 규칙`) and Japanese (`要件`, `受け入れ基準`, `セキュリティ`, `ビジネスルール`, `制約事項`) PRD headings alongside standard English headings.
5. **THE SYSTEM SHALL** extract multibyte Unicode keywords (`[\p{L}\p{N}_]{2,}/gu`) from requirements so non-Latin keywords actively boost hunk relevance scoring during 100KB budget packing.
6. **THE SYSTEM SHALL** pass a 60-file, 300KB monorepo stress test, safely budgeting within 100KB while preserving line provenance and disclosing omitted files.

---

## 4. Non-Functional, Security & Honesty Constraints

1. **Zero Secret Exposure**: Client IDs, OAuth secrets, bearer tokens, and raw authorization headers MUST NEVER be logged (`console.log`/`console.error`), returned to the frontend, or stored in KVS.
2. **SSRF & Redirect Safety**: Bitbucket diff fetching (`loadPullRequestDiff`) MUST keep `redirect: 'manual'` and validate 30x `Location` headers strictly via `isSafeDiffRedirect` (`https://api.bitbucket.org` origin, no credentials/hash, no `..` traversal, path scoped to `/2.0/repositories/{ws}/{repo}/diff/`).
3. **Prompt Injection Defense**: Both Jira panel analysis and Rovo action prompts MUST wrap Confluence requirements and PR diffs as untrusted JSON data payloads and forbid instruction following from user-authored specs or code comments.
4. **Read-Only Product Permissions**: Product scopes MUST remain minimal (`read:jira-work`, `read:page:confluence`, `storage:app` for app-private KVS, plus `bitbucket-oauth` `account` + `pullrequest`). The app MUST NOT request write/delete scopes on Jira, Confluence, or Bitbucket.
5. **No Strikethrough Formatting**: All UI copy, Rovo agent prompts, documentation, and comments MUST avoid double-tilde markdown syntax and HTML strikethrough elements.
