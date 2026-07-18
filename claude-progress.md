# claude-progress.md

The progress log. Every session reads this first and updates it last.
"Current Verified State" is the single source of truth for where the project stands.

## Current Verified State

- **Project name:** Embinder (renamed from GrabMyCursor/Minder/Warden; repo still `celesnity/GrabMyCursor`)
- **Repository root:** `D:\[Project]_Embinder`
- **Standard startup path:** `.\init.ps1` (install + verify + print start command)
- **Standard verification path:** `npm run typecheck` (exit 0) then `npm run e2e`
- **Toolchain (this host):** Windows 11, PowerShell, node 24.14.0, npm 11, tsx 4.23.1
- **Verified GREEN on this host (2026-07-18):**
  - `npm install` -> 0 vulnerabilities
  - `npm run typecheck` -> exit 0 across `@embinder/react` + `@embinder/relay`
  - `npm run e2e` -> **all assertions PASS, "E2E + GATE GREEN"** (now includes the chat-bubble
    /chat + CORS + off-allowlist assertions added by the Embinder sync)
- **Highest priority unfinished feature:** F-D8 (live-browser + spotlight + rate-limit proof)
- **Current blocker:** none.

## Session Record

### 2026-07-18 (b) - Rename to Embinder + sync with main

- **Goal:** Rename the project folder to the new name and sync with `origin/main`.
- **Completed:**
  - `git fetch` + `git merge --ff-only origin/main`: `d31eaab..0144295`
    ("Rebrand GrabMyCursor to Embinder ..." + a chat-bubble feature merge). Package renamed
    `grabmycursor` -> `embinder`, `@grabmycursor/*` -> `@embinder/*`,
    `grabmycursor.policy.json` -> `embinder.policy.json`, runtime dir `.grabmycursor/` -> `.embinder/`.
  - Re-applied the Windows spawn fix on top of the new upstream scripts (upstream still ships the
    bare `spawn('npx'|'npm')` bug): `e2e.mjs` relay via `process.execPath --import tsx`; `dev.mjs`
    `shell:true` + `taskkill /T` tree-kill.
  - Reinstalled deps (chat-bubble deps added) and re-verified: typecheck exit 0, e2e GREEN.
  - Rebranded the harness files (CLAUDE.md, init.ps1, this file, feature_list.json) to Embinder.
  - Renamed the folder `D:\[Project]_GrabMyCursor` -> `D:\[Project]_Embinder`.
- **Verification run:** `npm run typecheck` (exit 0); `npm run e2e` (all assertions PASS, GREEN).
- **Evidence recorded:** e2e adds chat assertions - `/chat streamed ok (200)`, `chat tool call
  landed via the gate`, `chat destructive paused + ran after approval`, `off-allowlist baseURL 400`,
  `/approver-token disabled by default 403`, CORS preflight 204 + echoes app origin.
- **Commits:** none (not requested). Working-tree changes: `scripts/e2e.mjs`, `scripts/dev.mjs`
  (re-applied Windows fix), `package-lock.json`, plus the untracked harness files.
- **Known risks:**
  - Live browser path (`:5173` + real MCP client), spotlight viz, and rate limit (AC-7) still not
    behaviorally verified on this host - only the headless wire protocol (F-D8).
  - The in-app chat bubble is proven headlessly (stub LLM) but not manually in a real browser.
- **Next best action:** F-D8 - live-browser smoke (`npm run dev`, MCP Inspector at `:7331/mcp`,
  drive `delete_all_tasks`, approve at `/approve`) + a manual chat-bubble click-through.

### 2026-07-18 (a) - Clone, baseline, harness

- Cloned repo, installed deps, confirmed typecheck exit 0.
- Fixed the Windows spawn bug in `e2e.mjs`/`dev.mjs`; `npm run e2e` -> 17/17 GREEN, re-runnable.
- Added the core-4 init-repo harness (CLAUDE.md, init.ps1, claude-progress.md, feature_list.json).
