# Atlassian Codegeist 2026 — Testing Instructions

## App Name: Spec-to-Code Trace & Linter
- **Categories**: *Apps for Software Teams* (Main Track), *Best Agents* (Rovo Bonus Track)
- **Target Site**: `https://one-atlas-hebl.atlassian.net`
- **Supported Surfaces**: Jira Issue Panel, Confluence Content Byline, Jira Workflow Transition Gate Validator, Atlassian Rovo Agent & Actions

---

## 1. Quick Overview

**Spec-to-Code Trace & Linter** bridges the gap between requirements and implementation. It extracts specifications from Confluence PRDs (tables, nested bullet lists, callout panels, and narrative paragraphs), indexes Bitbucket PR diffs, and computes real-time, grounded evidence for each requirement with strict line-level citations.

It also introduces an automated **Jira Workflow Transition Gate** that physically prevents tickets from transitioning to `Done` until 100% of in-scope requirements have verified code evidence in the pull request.

---

## 2. Evaluation Paths & Live Test Environment

Judges can evaluate **Spec-to-Code Trace & Linter** through three transparent paths depending on workspace access:

1. **Path A — Pre-Configured Cloud Sandbox (`one-atlas-hebl.atlassian.net`)** *(Requires collaborator/judge account sign-in on Atlassian Cloud + Bitbucket 3LO authorization)*:
   - **Jira Project**: `https://one-atlas-hebl.atlassian.net/jira/software/projects/PLAT/boards`
   - **Test Artifacts Ready in Sandbox**:

| Artifact Type | Key / URL | Purpose | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **Jira Ticket (Gated Blocked)** | `PLAT-33510` (Confluence Spec `2293824`) | Incomplete PR (`PR #1`) | **11 Missing Risk** (`1/12`, `8%`). Attempting transition to `Done` is **physically blocked** by `Spec-to-Code Trace Gate`. |
| **Jira Ticket (Fully Verified)** | `PLAT-33511` (Confluence Spec `5111809`) | Complete PR (`PR #2`) | **3/3 (100%) Found**, `1 Out of Scope` SLA, `Workflow Gate: PASS (Ready)`. Transition to `Done` **succeeds cleanly**. |
| **Confluence Spec (Narrative PRD)** | Page ID: `5111809` (`E2E Narrative & Deletion Spec`) | Spec Readiness Linter | **Readiness Score 3/4 (75%)** (`Narrative PRD Mode`: 3 Testable, 1 Runtime SLA). |
| **Bitbucket Cloud PRs** | `PR #1` (`PLAT-33510`), `PR #2` (`PLAT-33511`) | Linked diffs | Real git diff parsing with noise filtering & `#chg-` hunk links. |

2. **Path B — Install in Your Own Atlassian Developer Site** *(via Forge Install Link / `forge install`)*:
   - Enable sharing in Atlassian Developer Console and install the app onto any Jira + Confluence Cloud site, link Bitbucket Cloud OAuth 2.0 (3LO), and follow [`docs/SHOWCASE_SCENARIO.md`](file:///C:/AI/projects/codegeist-2026/docs/SHOWCASE_SCENARIO.md) to reproduce the blocked-to-passed lifecycle cleanly on your own site.
3. **Path C — Self-Hosted Automated Verification (`Node.js 24`)**:
   - Clone the repository and run `node --test tests/*.test.mjs` (`72/72` offline unit & integration tests covering ADF extraction, diff chunking/noise filtering, citation verification, KVS caching, diff-grounded Rovo/Jira remediation, spec linter resilience, and fail-closed workflow gate hardening).

---

## 3. Step-by-Step Evaluation Walkthrough (Under 3 Minutes)

### Step 1: Confluence Spec Readiness Linter
1. Navigate to Confluence page:
   `https://one-atlas-hebl.atlassian.net/wiki/spaces/MSD/pages/5111809/E2E+Narrative+Deletion+Spec`
2. Look directly below the page title at the content byline item: click **Spec Readiness Linter**.
3. **Observe**:
   - The modal analyzes all requirements in the document.
   - Shows **Readiness Score: 3 / 4 (75%)**.
   - `verifyWebhookSignature`, `allowInsecureMd5Auth`, and `enforceRateLimit` are marked **TESTABLE**.
   - The p99 latency requirement is flagged as **UNVERIFIABLE_IN_DIFF** (Runtime / Non-Diff) with advice to verify via performance load tests rather than PR diffs.

---

### Step 2: Jira Issue Panel & Grounded Code Evidence
1. Navigate to Jira Issue `PLAT-33511`:
   `https://one-atlas-hebl.atlassian.net/browse/PLAT-33511`
   *(Note: If `PLAT-33511` was left in `Done` from a prior run, switch its status back to `To Do` first so Step 3 can verify the live transition.)*
2. Scroll to the **Spec-to-Code Trace & Linter** panel on the issue.
3. If prompted to connect Bitbucket, click **Connect Bitbucket Account** (OAuth 2.0 3LO).
4. **Observe**:
   - **Evidence Coverage: 3 / 3 (100%)** (`Out of Scope: 1` Runtime SLA kept distinct from diff risk)
   - **Workflow Gate: PASS (Ready)**
   - Click the **`Found (3)`** tab (alongside `All`, `Missing Risk`, `Needs Context`, and `Out of Scope`) to inspect the inline **CodeBlock** citation cards and clickable `#chg-` Bitbucket diff anchor links:
     - `verifyWebhookSignature`: Shows exact verified 1-based line citations where HMAC SHA-256 signing is executed.
     - `allowInsecureMd5Auth`: Highlighted with a red **(removed)** badge, proving that the diff deleted the insecure legacy fallback as required.
     - `enforceRateLimit`: Shows HTTP 429 rate-limiting enforcement.
   - Click **Export Review Markdown** to copy a pre-formatted, grounded review table ready for PR comments.

---

### Step 3: Physical Jira Workflow Gate (Try Transitioning to Done)
1. Navigate to `PLAT-33510` (`https://one-atlas-hebl.atlassian.net/browse/PLAT-33510`):
   - Notice that the panel displays **11 Missing Risk** requirements (`1 / 12`, `8%`) and **Workflow Gate: BLOCKED (11 Missing)**.
   - Try to change the status dropdown from `To Do` / `In Progress` to **`Done`**.
   - **Observe**: Jira physically **rejects the transition** via the `Spec-to-Code Trace Gate` workflow validator and displays an error banner blocking `Done` while unresolved missing criteria remain.
2. Now navigate back to `PLAT-33511` (`https://one-atlas-hebl.atlassian.net/browse/PLAT-33511`):
   - Here all 3 in-scope criteria are verified (100%).
   - Change status to **`Done`**.
   - **Observe**: The transition **passes cleanly** without any block!

---

### Step 4: Atlassian Rovo Agent & Chat Actions (*Best Agents Bonus Track*)
1. Open Atlassian Rovo Chat anywhere in Jira or Confluence and select Rovo Agent **`Spec-to-Code Trace`**.
2. Ask Rovo:
   > *"Lint the Confluence spec on PLAT-33511 for ambiguous requirements."*
   - Rovo invokes `lint-confluence-spec-action` and returns a breakdown of testable vs non-diff runtime requirements.
3. Ask Rovo:
   > *"Verify the linked PR on PLAT-33510 against its Confluence spec."*
   - Rovo invokes `verify-issue-spec-action` and summarizes verified findings vs missing requirements.
4. Ask Rovo:
   > *"Suggest a fix and unit test scaffold for the missing requirement on PLAT-33510."*
   - Rovo invokes `suggest-fix-action` (also available inline on Jira Issue Panel cards via **Suggest Fix & Test**) and provides:
     - Repository-matched target file & test path grounded in PR diff files.
     - Concrete implementation scaffold & runnable fail-first unit test (`@forge/llm`, with repo-aware deterministic fallback).
     - Actionable next steps.

---

## 4. Self-Hosted / Fresh Installation Instructions (Optional)

If judges wish to install the app on their own Atlassian Cloud test site:

1. **Prerequisites**:
   - Atlassian Cloud site with Jira Software and Confluence.
   - Bitbucket Cloud workspace.
   - Node.js 20+ and Forge CLI (`npm install -g @forge/cli`).
2. **Clone & Install**:
   ```bash
   git clone <repository-url>
   cd codegeist-2026
   npm install
   ```
3. **Register Forge App**:
   ```bash
   forge register
   ```
4. **Deploy & Install**:
   ```bash
   export BITBUCKET_CLIENT_ID="<your-bitbucket-oauth-client-id>"
   forge deploy -e development
   forge install -s <your-site>.atlassian.net -p jira -e development
   forge install -s <your-site>.atlassian.net -p confluence -e development
   ```
5. **Configure Bitbucket OAuth Credentials**:
   ```bash
   forge providers configure bitbucket-oauth -e development
   # Enter your Bitbucket OAuth Client ID and Secret when prompted
   ```
