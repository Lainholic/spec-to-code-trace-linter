# Devpost Final Submission Package — Spec-to-Code Trace & Linter

> **Target Competition**: Atlassian Codegeist 2026  
> **App ID**: `ari:cloud:ecosystem::app/db5b3454-250f-4148-bdcc-3214120a138d`  
> **Current Verified Deployments**: `development` (`v5.0.0`, installed on `one-atlas-hebl.atlassian.net`, Jira & Confluence `Up-to-date`), `production` (`v4.0.0` deployed, `0` site installs)  
> **License**: MIT ([`LICENSE`](file:///C:/AI/projects/codegeist-2026/LICENSE))

---

## 1. Copy-Paste Devpost Form Fields

### Project Name
```text
Spec-to-Code Trace & Linter
```

### Elevator Pitch / Tagline (Under 200 chars)
```text
Connect Confluence specs to Bitbucket PR diffs with strict line-cited LLM evidence, readiness linting, physical Jira workflow gates, and Rovo TDD fix scaffolds.
```

### Built With (Tags)
```text
atlassian-forge, jira-cloud, confluence-cloud, bitbucket-cloud, atlassian-rovo, nodejs, forge-react, forge-llm, oauth2
```

### Full Submission Story Source
Paste directly from [`docs/DEVPOST_SUBMISSION.md`](file:///C:/AI/projects/codegeist-2026/docs/DEVPOST_SUBMISSION.md), which covers:
- **Inspiration**: Eliminating "LGTM" rubber-stamp approvals and Jira-to-Bitbucket specification drift.
- **What It Does**: Four native Forge surfaces (`Spec Readiness Linter`, `Spec-to-Code Trace & Linter`, `Spec-to-Code Trace Gate`, `Spec-to-Code Trace` Rovo agent).
- **How We Built It**: 100% Forge-hosted `nodejs24.x` ESM, `@forge/react` Native UI Kit (`Tabs`, `CodeBlock`, `SectionMessage`, `Lozenge`, `ProgressBar`), Bitbucket OAuth 2.0 (3LO), per-user KVS snapshots, `18s` batch timeout guard with `Promise.allSettled` & fail-closed gate checks.
- **Challenges & Triumphs**: Syntactic `+[L<num>]` / `-[L<num>]` hunk verifier, lockfile noise budgeter, diff-grounded `@forge/llm` remediation scaffolds (`Jira + Rovo`), and anti-poisoned fail-closed `trace:gate:v1` + live `api.asApp()` workflow gate enforcement.
- **Verified Engineering Metrics**: `72/72` Node 24 unit/integration tests passing, 3 minimal scopes (`read:page:confluence`, `read:jira-work`, `storage:app`) with zero write/delete scopes, `dev v5.0.0` (installed & up-to-date) & `prod v4.0.0` deployed.

### Try It Out / Testing URLs
- Testing Guide: [`docs/TESTING_INSTRUCTIONS.md`](file:///C:/AI/projects/codegeist-2026/docs/TESTING_INSTRUCTIONS.md)
- Reproducible Sandbox Scenario: [`docs/SHOWCASE_SCENARIO.md`](file:///C:/AI/projects/codegeist-2026/docs/SHOWCASE_SCENARIO.md)
- Live Test Jira Board: `https://one-atlas-hebl.atlassian.net/jira/software/projects/PLAT/boards`

---

## 2. Media & Visual Evidence Inventory

1. **Interactive 1080p Demo Deck**: [`docs/demo-slides.html`](file:///C:/AI/projects/codegeist-2026/docs/demo-slides.html)
2. **Demo Script (04:30 Pacing)**: [`docs/DEMO_VIDEO_SCRIPT.md`](file:///C:/AI/projects/codegeist-2026/docs/DEMO_VIDEO_SCRIPT.md)
3. **Recording Runbook**: [`docs/RECORDING_RUNBOOK.md`](file:///C:/AI/projects/codegeist-2026/docs/RECORDING_RUNBOOK.md)
4. **Video Packager (`ffmpeg` `< 300s` gate)**: [`scripts/package-demo-video.ps1`](file:///C:/AI/projects/codegeist-2026/scripts/package-demo-video.ps1)
5. **Captured 1080p Deck Slides (`_reports/submission_package_20261114/`)**:
   - `01_cover_spec_drift_problem_1080p.png` (Act 1 Split-Screen Cover)
   - `02_recording_cue_launchpad_1080p.png` (Acts 2–5 Launchpad & Copyable Rovo Prompts)
   - `03_forge_4surface_architecture_1080p.png` (Outro 4-Surface Architecture & Security Proof)

---

## 3. Remaining User-Gated Pre-Submit Checklist (4 Manual Actions)

> These steps require interactive authentication, public external publishing, or explicit submission actions that are intentionally left for 환님 to execute manually.

1. **[ ] Configure Production OAuth & Sharing Link (If Providing Public Judge Install)**:
   - Run `forge providers configure bitbucket-oauth -e production` with your Bitbucket Cloud OAuth secret (`BITBUCKET_CLIENT_ID` is already encrypted on `production`).
   - Enable sharing under Developer Console (`/distribution`) so judges can use the Forge install link or install onto a judge test site.
2. **[ ] Record & Package 5-Minute Demo Video (`< 300s`)**:
   - Sign into `one-atlas-hebl.atlassian.net` in Brave and **reset `PLAT-33511` from `Done` back to `To Do`** before pressing Record.
   - Follow [`docs/RECORDING_RUNBOOK.md`](file:///C:/AI/projects/codegeist-2026/docs/RECORDING_RUNBOOK.md), then run `.\scripts\package-demo-video.ps1 -InputPath <raw-capture>` to verify `1920x1080` and `< 300.0s`.
   - Optionally capture live Atlassian UI screenshots (`Confluence 5111809`, `PLAT-33510`, `PLAT-33511`, `Rovo`) while logged in to pair with the 3 deck PNGs on Devpost.
3. **[ ] Push Public Repository & Upload Unlisted/Public YouTube Demo**:
   - Push the local commit (`git push`) only when ready to publish the repository URL for judging.
   - Upload `Spec-to-Code-Trace-Demo-1080p.mp4` to YouTube (`< 5:00`) and copy the share URL.
4. **[ ] Finalize & Submit on Devpost**:
   - Open Devpost Codegeist 2026 submission draft, paste the copy blocks above, attach gallery PNGs + YouTube URL + public repo/install links, verify required checkboxes, and click **Submit**.
