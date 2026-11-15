# Codegeist 2026 Live Judge Showcase Scenario

This turnkey scenario demonstrates every capability of **Spec-to-Code Trace & Linter** across **Confluence**, **Jira**, **Bitbucket Cloud**, and **Atlassian Rovo** in under 120 seconds, while keeping baseline test artifacts (`PLAT-33510`, `PR #1`, `feature/spec-trace-test`, `feature/criteria-test`) untouched.

---

## 1. Confluence Specification Page (`Webhook Delivery & Audit Export v1.0`)

Create a new Confluence page on `one-atlas-hebl.atlassian.net` with the following multi-format specification (uses a Table, a Nested Bullet List, and a Warning Callout Panel under `Functional Requirements` / `Acceptance Criteria`):

### Functional Requirements

| ID | Requirement | Priority | Status |
| :--- | :--- | :--- | :--- |
| REQ-01 | Reject export requests exceeding 10,000 records with HTTP 413 Payload Too Large. | P0 | Draft |
| REQ-02 | Sign every outbound webhook request using HMAC-SHA256 in the `X-Signature-256` header. | P0 | Draft |
| REQ-03 | Handle transient downstream webhook failures gracefully as needed. | P1 | Draft |

### Acceptance Criteria

- **Audit & Data Governance**
  - Persist an encrypted 3-year compliance audit record containing `actorAccountId` and ISO-8601 `exportedAt` timestamp on every export.
  - Redact `apiSecret` and `authorizationHeader` fields before serializing any audit payload to JSON.

> **Warning Panel**: Sustain p99 response latency below 150ms across 5,000 concurrent export requests during regional load testing.

---

## 2. What Each Surface Demonstrates

### Surface A — Confluence Content Byline (`Spec Readiness Linter`)
Open the Confluence spec page and click **Spec Readiness Linter** under the page title (before writing code):
- **`REQ-01`**, **`REQ-02`**, and **Audit Governance** bullets -> **`TESTABLE`** (Green)
- **`REQ-03`** (*"Handle transient downstream webhook failures gracefully as needed"*) -> **`AMBIGUOUS`** (Red) with copy-ready **Suggested Testable Rewrite** (*e.g., Retry HTTP 502/503/504 responses up to 3 times with exponential backoff of 1s, 5s, and 25s before routing to the dead-letter queue*)
- **Warning Panel SLA** (*"Sustain p99 response latency below 150ms..."*) -> **`UNVERIFIABLE_IN_DIFF`** (`Runtime / Non-Diff`, Yellow) recommending a CI k6/Gatling load benchmark gate

### Surface B — Jira Issue Panel (`Stage 1 Pull Request` -> `Stage 2 Re-verify`)

#### Stage 1 Pull Request Diff (Initial Implementation — Missing `X-Signature-256` HMAC)
Includes a noisy `package-lock.json` change plus `src/export/webhook-exporter.ts`:
- **Noise Filter**: Automatically skips `package-lock.json` so prompt budget focuses 100% on TypeScript source code.
- **`EVIDENCE_FOUND` (Green)**:
  - `REQ-01` (`> 10_000` check throwing HTTP 413) — rendered with 5-line highlighted TypeScript snippet + `#chg-src/export/webhook-exporter.ts` deep link.
  - Redaction of `apiSecret` and `authorizationHeader` — rendered with highlighted TypeScript snippet.
- **`POTENTIAL_MISSING` (Red/Yellow Risk)**:
  - `REQ-02` (`X-Signature-256` HMAC-SHA256 signing) — developer sent raw `fetch` without signing the payload!
- **`INSUFFICIENT_CONTEXT` (Amber — Zero False-Rejection Intelligence)**:
  - 3-year encrypted compliance archive — diff calls `await auditVault.archiveComplianceRecord(...)`, citing the exact delegation call line while noting that 3-year KMS retention lives inside `auditVault`.
- **`OUT_OF_SCOPE` (Neutral Gray)**:
  - `p99 < 150ms at 5,000 concurrent requests` — excluded from `inScopeTotal` denominator so static coverage math stays fair.

#### Stage 2 Pull Request Diff (`[Re-verify Pull Request]` After Pushing HMAC Fix)
Developer adds `computeHmacSha256(body, webhookSecret)` + `'X-Signature-256': signature` and clicks **`Re-verify Pull Request`**:
- **Delta Banner (`SectionMessage appearance="success"`)**: *"1 previously flagged requirement(s) now have verified code evidence"*
- **Inline Card Badge**: **`RESOLVED: MISSING RISK -> FOUND`** on `REQ-02` with exact line citation!
- **1-Click Reviewer Export**: Click **`Export Review Markdown`** to copy the complete grounded checklist into the PR review comment.

### Surface C — Atlassian Rovo Agent (`Spec-to-Code Trace`)
Ask Rovo Chat from anywhere in Jira or Confluence:
1. `"Lint the Confluence spec on <ISSUE-KEY> for ambiguous requirements"` -> Invokes `lint-confluence-spec-action`
2. `"Verify the linked PR on <ISSUE-KEY> against its Confluence spec"` -> Invokes `verify-issue-spec-action`
