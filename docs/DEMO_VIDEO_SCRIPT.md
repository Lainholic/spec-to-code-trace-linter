# Atlassian Codegeist 2026 — 5-Minute Demo Video Script

## Title: Spec-to-Code Trace & Linter: Grounded PRD Verification & Workflow Gates for Atlassian Cloud
- **Track**: Apps for Software Teams & Best Agents (Rovo)
- **Target Duration**: 04:30 (Max 05:00 limit)
- **Host / Narrator**: Product Engineer Voice

---

## Storyboard & Timeline

### [00:00 - 00:45] Act 1: The Problem — Specification Drift & Rubber-Stamp PR Reviews
- **Visual**:
  - Open [`docs/demo-slides.html`](file:///C:/AI/projects/codegeist-2026/docs/demo-slides.html) Slide 1 (`1 · Act 1 Cover: Spec Drift`) full-screen at 1080p.
  - Highlight the split comparison: Confluence PRD `E2E Narrative & Deletion Spec` (`5111809`) on the left vs Bitbucket PR diff with 40 changed files and noisy `package-lock.json` churn on the right.
  - Point out the red rubber-stamp callout (`"Looks fine, LGTM!"` dragged to `Done`) blocked by the bottom 3-pillar summary strip.
- **Voiceover**:
  > *"Every engineering team knows this painful moment: product managers spend days drafting detailed PRDs in Confluence, but when pull requests arrive in Bitbucket, reviewers are overwhelmed by thousands of lines of diffs.*
  > *Critical security controls, HMAC signatures, and legacy deletions slip through unnoticed. The ticket gets dragged to 'Done', and bugs hit production.*
  > *Meet Spec-to-Code Trace & Linter — the first Forge app that physically connects Confluence specifications with Bitbucket git diffs, verified by LLMs with strict line citations, and enforced by real Jira workflow transition gates."*

---

### [00:45 - 01:30] Act 2: Surface 1 — Confluence Spec Readiness Linter
- **Visual**:
  - Open Confluence page `E2E Narrative & Deletion Spec` (`5111809`) — and optionally cross-reference structured spec page (`2293824`, 12 criteria) tied to `PLAT-33510`.
  - Point cursor to the byline item under the page title: **Spec Readiness Linter**.
  - Click to open the Forge Native UI Kit modal (`@forge/react`).
  - Point out the live `Narrative PRD Mode` scan breakdown:
    - **Readiness Score: 3 / 4 (75%)** (`TESTABLE` functional controls like HMAC verification, removing legacy MD5 auth, and rate limiting).
    - **1 criterion flagged yellow** (`UNVERIFIABLE_IN_DIFF` / Runtime SLA, such as `p99 latency`).
- **Voiceover**:
  > *"It starts before a single line of code is written.*
  > *Right on the Confluence page, the Spec Readiness Linter parses both structured specs and free-form narrative PRDs to check if acceptance criteria are actually verifiable in a git diff.*
  > *Functional controls like HMAC signing and deprecating legacy MD5 auth are flagged as Testable.*
  > *Meanwhile, runtime performance SLAs like p99 latency are separated as Non-Diff requirements upfront, steering teams to load testing rather than expecting reviewers to eyeball latency inside a commit."*

---

### [01:30 - 02:45] Act 3: Surface 2 & 3 — Jira Issue Panel & The Physical Workflow Gate
- **Visual**:
  - Open Jira Issue `PLAT-33510` (linked to Confluence `2293824` and incomplete Bitbucket `PR #1`).
  - Scroll to the **Spec-to-Code Trace & Linter** panel:
    - Point to **11 Missing Risk** (`Missing Risk` tab), **Evidence Coverage: 1 / 12 (8%)**, and lozenge **Workflow Gate: BLOCKED (11 Missing)**.
  - Attempt to transition the Jira status dropdown from `To Do` / `In Progress` to **Done**.
  - **Hold 2 seconds on the red validator error**: Jira physically rejects the transition with:
    `"Spec-to-Code Trace Gate blocked transition for PLAT-33510: 11 requirement(s) are still flagged as Missing Risk (1/12 in-scope criteria verified)."`
- **Voiceover**:
  > *"Now, let's see how this protects your release process.*
  > *On ticket PLAT-33510, the developer linked Confluence spec 2293824 and opened PR #1, yet only 1 of 12 criteria has verified code evidence.*
  > *Notice the panel clearly warns that 11 criteria remain at Missing Risk, and the Workflow Gate lozenge reads BLOCKED.*
  > *When the developer tries to move the ticket to 'Done', Jira's native workflowValidator physically blocks the transition.*
  > *No more accidental releases. No more honor-system promises. The gate holds the line."*

---

### [02:45 - 03:30] Act 4: The Fix, Grounded Citations, and Gate Passage
- **Pre-Recording Setup Note**: Ensure `PLAT-33511` is pre-reset from `Done` back to `To Do` before recording so the transition demonstrates live gate passage.
- **Visual**:
  - Switch to Jira ticket `PLAT-33511` linked to Confluence `5111809` and complete Bitbucket `PR #2`.
  - Open the **Spec-to-Code Trace & Linter** panel:
    - **Evidence Coverage: 3 / 3 (100%)** (`Out of Scope: 1` SLA kept separate).
    - **Workflow Gate: PASS (Ready)** green lozenge.
  - Click the **`Found (3)`** tab inside the panel (and show tab counts `All`, `Missing Risk`, `Found`, `Needs Context`, `Out of Scope`):
    - Point to `verifyWebhookSignature`: Syntax-highlighted `CodeBlock` citation verified strictly against the Bitbucket diff hunk plus its `#chg-` diff anchor link.
    - Point to `allowInsecureMd5Auth`: Highlighted with the **`(removed)`** deletion badge on `-` lines, proving deprecated auth fallback code was deleted.
    - Point to `enforceRateLimit`: Verified HTTP 429 rate-limit enforcement.
  - Click **Export Review Markdown** and paste the generated grounded audit table into a comment draft.
  - Change status to **Done**: The transition succeeds instantly!
- **Voiceover**:
  > *"Now look at PLAT-33511, where the developer completed the fix in PR #2.*
  > *Inside the Found tab, every single verdict displays an exact line-numbered citation and clickable Bitbucket diff anchor `#chg-` verified against raw git hunks.*
  > *It even catches deletion requirements — showing a red removal badge to prove insecure legacy MD5 code was stripped out.*
  > *With one click, reviewers copy a grounded Markdown audit report for PR comments.*
  > *And because coverage hits 100%, the Workflow Gate opens and the ticket moves cleanly to Done."*

---

### [03:30 - 04:15] Act 5: Surface 4 — Atlassian Rovo Agent & Fix Scaffolding
- **Visual**:
  - Open Atlassian Rovo Chat and select agent **`Spec-to-Code Trace`**.
  - Paste Prompt 1 (copy-ready on `demo-slides.html` Slide 2):
    *"Verify the linked PR on PLAT-33510 against its Confluence spec."*
  - Show Rovo invoking `verify-issue-spec-action` and summarizing verified findings vs missing requirements.
  - Paste Prompt 2:
    *"Suggest a fix and unit test scaffold for the missing requirement on PLAT-33510."*
  - Show Rovo invoking `suggest-fix-action` and returning:
    - Target file recommendation and grounded fix rationale.
    - Copy-ready implementation scaffold.
    - Fail-first TDD test (`assert.rejects`).
- **Voiceover**:
  > *"For teams using Atlassian Rovo, Spec-to-Code Trace turns chat into an active release copilot.*
  > *Ask Rovo to verify any ticket's linked PR directly in chat via verify-issue-spec-action.*
  > *When gaps appear, ask for a fix scaffold — suggest-fix-action generates implementation skeletons paired with fail-first Node unit tests so teams close gaps with Test-Driven Development."*

---

### [04:15 - 04:30] Outro: Built 100% on Atlassian Forge
- **Visual**:
  - Switch back to [`docs/demo-slides.html`](file:///C:/AI/projects/codegeist-2026/docs/demo-slides.html) Slide 3 (`3 · Outro: 4-Surface Architecture`) full-screen at 1080p.
  - Show the 4 native surface cards (`confluence:contentBylineItem`, `jira:issuePanel`, `jira:workflowValidator`, `rovo:agent + 3 actions`) and bottom trust bar (`72 / 72 PASS`, `3 Scopes`, `18s Guard`, `@forge/llm`).
- **Voiceover**:
  > *"Built 100% natively on Atlassian Forge with three minimal read and storage scopes, per-user OAuth 2.0 isolation, and deterministic citation checks.*
  > *Spec-to-Code Trace & Linter: Bring truth back to your pull requests. Thank you!"*
