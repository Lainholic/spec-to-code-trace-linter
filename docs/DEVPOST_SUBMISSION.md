# Atlassian Codegeist 2026 Submission

## 1. Project Overview
- **App Name**: Spec-to-Code Trace & Linter
- **Tagline**: Bridge Confluence PRDs, Bitbucket Git Diffs, Jira Workflow Gates, and Rovo AI Agents with Grounded Line-Level Evidence.
- **Tracks**:
  - Main Track: **Apps for Software Teams**
  - Bonus Track: **Best Agents (Atlassian Rovo)**
- **App ID**: `ari:cloud:ecosystem::app/db5b3454-250f-4148-bdcc-3214120a138d`
- **Hosted Cloud Site**: `https://one-atlas-hebl.atlassian.net`

---

## 2. Inspiration & The Core Problem

Modern software teams document product requirements extensively in Confluence. However, during fast-paced development cycles, pull requests in Bitbucket often contain hundreds of changed lines and noisy lockfiles. Reviewers face cognitive overload, resulting in "rubber-stamp" approvals (`LGTM!`) where critical acceptance criteria, compliance checks, or security headers are accidentally omitted.

When tickets are dragged across Jira boards to `Done`, teams rely solely on good faith rather than cryptographic or syntactic evidence that the specification was actually built.

**Spec-to-Code Trace & Linter** eliminates this disconnect. It parses Confluence specifications, filters noise in Bitbucket diffs, pairs each requirement with grounded line-level code citations, and physically blocks Jira transitions until all in-scope requirements are proven to exist in the pull request.

---

## 3. What It Does

### 1. Confluence Spec Readiness Linter (`confluence:contentBylineItem`)
Before code is written, engineers and product managers can click the byline item under any Confluence spec page title. The linter categorizes criteria into:
- **`TESTABLE`**: Concrete syntactic behaviors verifiable in code.
- **`AMBIGUOUS`**: Vague statements (e.g., "handle errors gracefully") with copy-ready concrete rewrites.
- **`UNVERIFIABLE_IN_DIFF`**: Runtime performance, latency SLAs, or infrastructure behaviors that belong in k6/Gatling CI gates rather than git diffs.

### 2. Grounded Git Diff Evidence Engine (`jira:issuePanel`)
On linked Jira issues, the app:
- Discovers linked Confluence PRDs and Bitbucket pull requests automatically.
- Strips noise (lockfiles, generated bundles, minified assets) using production-grade filter rules.
- Analyzes TypeScript, JavaScript, and other source diffs against acceptance criteria.
- Validates that every citation matches the actual modified hunk lines. If an AI model hallucinates a line number or code snippet, our engine catches and rejects it.
- Distinguishes **Addition** vs **Deletion** requirements (e.g., verifying that insecure legacy authentication was actually removed).

### 3. Physical Jira Workflow Transition Gate (`jira:workflowValidator`)
Rather than providing passive advice, the app registers a native Jira Workflow Validator on transitions to `Done`. If unverified requirements remain (`Potential Missing`), Jira physically aborts the transition with an explicit error banner listing the missing items.

### 4. Atlassian Rovo Agent & Actions (`rovo:agent`, `action`)
Integrated deeply into Atlassian Rovo (and surfaced inline via **`Suggest Fix & Test`** inside the Jira Issue Panel):
- **`verify-issue-spec-action`**: Verifies any issue's PR directly in chat and computes live Confluence `pageVersion` staleness when serving cached snapshots.
- **`lint-confluence-spec-action`**: Lints specifications on the fly with `Promise.allSettled` batch timeout isolation.
- **`suggest-fix-action`**: Generates repository-contextual implementation code and runnable fail-first unit tests grounded in real PR diff files via `@forge/llm` (with repo-aware deterministic fallback).

---

## 4. How We Built It (Technical Architecture)

Built 100% natively on **Atlassian Forge** (`nodejs24.x` ESM):
- **Runtime**: Node.js FaaS (`@forge/api`, `@forge/react`, `@forge/kvs`, `@forge/llm`).
- **UI System**: Modern `@forge/react` Native UI Kit featuring `Tabs` (`All`, `Missing Risk`, `Found`, `Needs Context`, `Out of Scope`), inline `CodeBlock` citation & remediation cards, `SectionMessage`, `Lozenge`, and `ProgressBar` coverage meters.
- **Authentication**: Seamless OAuth 2.0 (3LO) via Forge External Auth Providers for Bitbucket Cloud API access.
- **Caching & Delta Engine**: Per-user isolated KVS snapshots (`trace:v1:<hash>`) enabling instant cache hits, zero cross-user leakage, and smart delta badges (`RESOLVED: MISSING -> FOUND`) upon re-verification.
- **Fail-Closed Gate & Failsafe Architecture**:
  - Hard `18s` batch timeout guard (`analysis.mjs` & `spec-linter.mjs`) with `Promise.allSettled` isolation inside Forge's 25-second ceiling, plus `15s` timeout guard on `@forge/llm` fix scaffolding.
  - Fail-closed `Spec-to-Code Trace Gate` (`validateIssueTransition`) blocking transitions on `potentialMissing > 0`, partial batch timeouts (`incompleteBatchCount > 0`), `0` verified in-scope criteria, stale spec versions, or live Jira/Confluence API check failures.
  - Native OAuth challenge propagation (`isAuthChallengeError`) ensuring Rovo displays interactive login cards.

---

## 5. Challenges & Engineering Triumphs

1. **Hallucination-Proof Grounding**:
   LLMs can invent code citations. We implemented a strict syntactic verifier that checks proposed line numbers (`+[L<num>]`, `-[L<num>]`) and code snippets against raw unified diff hunks. If a citation fails verification, it is stripped or downgraded rather than misreporting unverified lines.
2. **Handling Huge PRs & Noise**:
   A 50,000-line `package-lock.json` would consume the entire LLM token window. Our diff pipeline indexes files and filters lockfiles, build artifacts, and minified bundles before budgeting source code chunks.
3. **Enterprise Jira Workflow Enforcement & Anti-Poisoning**:
   Workflow validators run under tight Jira invocation context without interactive OAuth prompts. Our `Spec-to-Code Trace Gate` checks the issue-wide aggregate gate record (`trace:gate:v1:<hash>`) protected by `isLinkedPage === true` anti-poisoning guards plus live `api.asApp()` issue-link and Confluence `pageVersion` drift verification before approving `Done` transitions.

---

## 6. Verified Engineering & Security Metrics

- **Automated Verification**: `72 / 72` unit & integration tests passing on Node 24 (`node --test tests/*.test.mjs`) with zero failures.
- **Minimal Least-Privilege Scopes**: Exactly 3 Forge scopes (`read:page:confluence`, `read:jira-work`, `storage:app`) with zero Jira or Confluence write/delete scopes.
- **Bounded Execution Guard**: `18s` hard batch timeout + `Promise.allSettled` isolation inside Forge's 25-second ceiling.
- **Cloud Deployments Verified**: Forge `development` (`v4.1`) & `production` (`v3.1`) prior to Phase 20 local hardening (awaiting updated bundle deployment & live re-verification).

---

## 7. What's Next for Spec-to-Code Trace

- Support for GitHub and GitLab Cloud PR diffs via Forge Remote.
- Automatic PR comment synchronization when Confluence specifications are updated during active sprint cycles.
- Custom enterprise linting rule configuration directly in Confluence space settings.
