# 5-Minute Demo Recording Runbook (`Spec-to-Code Trace & Linter`)

> **Target Spec**: 1920x1080 (16:9), 30 fps, strictly under `05:00` (`< 300.0s`, recommended `04:20 – 04:40`)
> **Script**: [DEMO_VIDEO_SCRIPT.md](file:///C:/AI/projects/codegeist-2026/docs/DEMO_VIDEO_SCRIPT.md) | **Interactive Deck**: [demo-slides.html](file:///C:/AI/projects/codegeist-2026/docs/demo-slides.html)

---

## 1. Pre-Recording Environment Checklist (5 Minutes Before Record)

1. **Display & Browser Setup (Brave)**
   - Set Windows display scale to `100%` (or keep Brave zoom at `100%` inside a `1920x1080` maximized or borderless window).
   - Hide bookmarks bar (`Ctrl+Shift+B`) and switch DevTools/extensions clutter off.
   - Sign in cleanly on `one-atlas-hebl.atlassian.net` and verify Bitbucket Cloud OAuth 2.0 (3LO) connection is active on the Forge panel so login interstitials do not interrupt Act 3 or Act 4.

2. **Tab Order in Brave (Left to Right)**
   - **Tab 1**: Local deck [`docs/demo-slides.html`](file:///C:/AI/projects/codegeist-2026/docs/demo-slides.html) opened on **Slide 1 (`1 · Act 1 Cover: Spec Drift`)** (keep **Slide 2** open in a second utility window or secondary monitor for the `04:30` countdown timer and 1-click Copy Rovo prompts).
   - **Tab 2**: Confluence spec `5111809` (`E2E Narrative & Deletion Spec`) — `https://one-atlas-hebl.atlassian.net/wiki/spaces/MSD/pages/5111809/E2E+Narrative+Deletion+Spec`
   - **Tab 3**: Confluence structured spec `2293824` (optional 2-second cutaway for the 12-criterion `PLAT-33510` baseline)
   - **Tab 4**: Jira Issue `PLAT-33510` (`1 / 12 (8%)`, `Workflow Gate: BLOCKED`) — `https://one-atlas-hebl.atlassian.net/browse/PLAT-33510`
   - **Tab 5**: Jira Issue `PLAT-33511` (`3 / 3 (100%)`, `Workflow Gate: PASS (Ready)`) — `https://one-atlas-hebl.atlassian.net/browse/PLAT-33511`
   - **Tab 6**: Rovo Chat pane ready with agent **`Spec-to-Code Trace`** selected.

3. **Critical State Reset Before Recording**
   - **Reset `PLAT-33511` status back to `To Do`** before pressing Record! If `PLAT-33511` was left in `Done` from an earlier QA run, Act 4 will not demonstrate the live `To Do -> Done` gate passage.
   - Confirm `PLAT-33510` is NOT in `Done` (leave in `To Do` or `In Progress`) so attempting `-> Done` reliably triggers the red `Spec-to-Code Trace Gate` error dialog.
   - Run one quick warm-up click on **Spec Readiness Linter** (`5111809`) and **Spec-to-Code Trace & Linter** (`PLAT-33510` / `PLAT-33511`) so Forge KVS snapshot cache responds without cold-start stalls during recording.

---

## 2. Audio & Voiceover Options

- **Option A — Live Narration in OBS / Windows Screen Recorder**:
  - Record desktop audio muted (avoids notification dings) + clean microphone track at 48 kHz while reading the `Voiceover` blocks in [DEMO_VIDEO_SCRIPT.md](file:///C:/AI/projects/codegeist-2026/docs/DEMO_VIDEO_SCRIPT.md).
  - Keep **Slide 2 (`Recording Cue Launchpad`)** visible on your reference monitor and click **Start** on the `04:30` countdown timer right as OBS starts.
- **Option B — Screen Capture First + Separate Web Narration Mux**:
  - Capture a clean silent 1080p video recording following the timestamps below (`00:00` to `04:30`).
  - Record clean voiceover separately (or generate narration audio via web tools such as Gemini / Google Flow) and mux both streams cleanly using [`scripts/package-demo-video.ps1`](file:///C:/AI/projects/codegeist-2026/scripts/package-demo-video.ps1).

---

## 3. Exact Cue Sheet During Recording

| Time | Act | Screen Focus | Required Visual Proof on Frame |
| :--- | :--- | :--- | :--- |
| `00:00 – 00:45` | Act 1 | Brave Tab 1 (`demo-slides.html` Slide 1) | Split-screen Confluence PRD vs noisy PR diff + `"Looks fine, LGTM!"` rubber-stamp risk |
| `00:45 – 01:30` | Act 2 | Brave Tab 2 (Confluence `5111809`) | Byline **Spec Readiness Linter** modal showing `3 / 4 (75%)` and yellow `Runtime / Non-Diff` SLA badge |
| `01:30 – 02:45` | Act 3 | Brave Tab 4 (Jira `PLAT-33510`) | `1 / 12 (8%)`, `11 Missing Risk`, `Workflow Gate: BLOCKED` lozenge, then attempt `-> Done` and hold 2s on red validator error |
| `02:45 – 03:30` | Act 4 | Brave Tab 5 (Jira `PLAT-33511`) | `3 / 3 (100%)` PASS lozenge, **`Found (3)`** tab showing `verifyWebhookSignature` `CodeBlock`, `allowInsecureMd5Auth` **`(removed)`** badge, `#chg-` link, **Export Review Markdown** click + paste, then clean `-> Done` transition |
| `03:30 – 04:15` | Act 5 | Brave Tab 6 (Rovo Chat) | Paste Prompt 1 from Slide 2 (`verify-issue-spec-action`) + Prompt 2 (`suggest-fix-action`) showing file suggestion + code skeleton + `assert.rejects` TDD test |
| `04:15 – 04:30` | Outro | Brave Tab 1 (`demo-slides.html` Slide 3) | 4 Forge Surface cards (`confluence:contentBylineItem`, `jira:issuePanel`, `jira:workflowValidator`, `rovo:agent`) + bottom metrics bar |

---

## 4. Post-Recording 1080p FFmpeg Packaging & Hard Duration Gate

Run the PowerShell packager in `C:\AI\projects\codegeist-2026`:

```powershell
# Case 1: Single screen+mic MP4/MKV capture -> normalized 1080p YouTube/Devpost MP4
.\scripts\package-demo-video.ps1 -InputPath ".\_work\demo\raw-capture.mp4"

# Case 2: Separate silent video + external voiceover WAV/MP3/M4A -> muxed 1080p MP4
.\scripts\package-demo-video.ps1 `
  -InputPath ".\_work\demo\silent-capture.mp4" `
  -VoiceoverPath ".\_work\demo\voiceover.m4a"
```

### What `package-demo-video.ps1` Verifies Automatically
1. Checks `ffmpeg` and `ffprobe` are installed on `PATH`.
2. Fails immediately if the source recording duration is `>= 300.0s` (5-minute hackathon limit).
3. Normalizes video to `1920x1080`, `30 fps`, square pixels, `yuv420p`, H.264 `-crf 18`, `+faststart`.
4. Applies EBU R128 loudness normalization (`I=-16`, `TP=-1.5`) on audio at `48 kHz` AAC `192 kbps`.
5. Re-probes the rendered `.mp4` and confirms output duration is strictly `< 300.0s` before reporting `PASS`.
