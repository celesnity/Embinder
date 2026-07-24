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
  - PocketBase Admin UI: focused tests **3/3 PASS** and Vite production build exit 0
  - Embinder implementation skill: `quick_validate.py` PASS; framework-neutral bridge validation PASS (call phase execution, registration-before-context replay, and reconnect replay)
- **Highest priority unfinished feature:** F-D8 (live-browser + spotlight + rate-limit proof)
- **Current blocker:** none.

## Session Record

### 2026-07-23 - Blackboard background Todo operator

- **Scope:** replaced the abandoned Todo-side Blackboard enrichment intake with a background-only operator design. External agents create natural-language `todo-operate` Blackboard tasks; `todo-worker.mjs` claims them, gets the live Todo capability/context snapshot through a server-only relay token, invokes existing browser tools through the relay, and completes/fails through the Worker Agent SDK lifecycle. Todo has no Blackboard UI or task-creation path.
- **Verification:** `npm run test` -> React 17 files/54 tests, relay 5 files/20 tests, worker SDK 3 files/16 tests PASS; `npm run typecheck` -> exit 0; `npm run e2e` -> `E2E + GATE GREEN`, including 401 without operator credential and authenticated mounted-tool snapshot discovery.
- **Remaining verification:** the real Blackboard server + LLM + Todo browser task execution flow is not run on this host. It remains required before this integration can be called complete.
- **No commit:** per user instruction.

### 2026-07-23 - Todo ⇄ Blackboard enrichment implementation

- **Scope:** added the relay-local Blackboard REST client and bridge, Todo task intake/poll-result delivery, generic `app-event` forwarding in `@embinder/react`, stable caller-supplied Todo IDs for result correlation, and a `todo-worker` process using `defineLLMHandler`.
- **Feature-off behavior:** `BLACKBOARD_URL` unset keeps `/blackboard-tasks` at 503, while the Todo UI continues normally and `todo-worker.mjs` logs that it is idle.
- **Verification on this host:** `node --import tsx scripts/todo-worker.mjs` -> worker reports `BLACKBOARD_URL not set — enrichment worker stays idle.`; `npm run test` -> React 17 files/54 tests, relay 7 files/25 tests, worker SDK 2 files/14 tests, Todo 1 file/1 test all PASS; `npm run typecheck` -> exit 0; `npm run e2e` -> `E2E + GATE GREEN`.
- **Known remaining verification:** the required real `agent-blackboard` + LLM + browser proof is not run: no local blackboard server / model endpoint was supplied for this session. Confirm a browser-added task becomes a completed blackboard task and visibly enriches the matching card without refresh before calling this integration complete.
- **No commit:** per user request.

### 2026-07-20 - Context proofing focus scopes

- **Scope:** added `AgentScope` to `@embinder/react`; declared semantic summaries and scope ancestry reach the relay without DOM scraping. Descendant tools inherit `embinderScope` automatically.
- **Relay:** added per-session scope tree, virtual `focus_<scope>` tools, one-action reservations, stale/out-of-scope rejection before browser forwarding, parent restoration after settled scoped action, and selected tool filtering for MCP/chat. Chat refreshes active tools/system context through AI SDK `prepareStep`.
- **Visualization:** focus phases drive the existing driver.js spotlight and ghost cursor to `[data-embinder-scope]`; focus does not lock UI, while destructive action approval stays unchanged.
- **Verification:** `npm test` -> React 15 files/50 tests PASS; relay 4 files/14 tests PASS. `npm run typecheck` -> exit 0. `npm run e2e` -> SC-focus root hidden child, semantic focus result, normal gate, and parent restore PASS; `E2E + GATE GREEN`.
- **Review:** user requested review later. No implementation commit yet. Existing unrelated `.gitignore`, `AGENTS.md`, and `skills-lock.json` changes remain untouched.

### 2026-07-20 - Fix chat focus visualization

- **Root cause:** MCP focus emitted a relay-to-app `focus` phase, but the resident `/chat` focus executor only changed the relay scope lease. Driver.js and ghost cursor therefore received no focus phase during chat use.
- **Fix:** `executeFocus` emits `{name, scopeId}` through an injected `onFocus` callback; server relays it to the app. Added regression test.
- **Verification:** `npm test --workspace @embinder/relay -- src/chat.test.ts` -> 7 tests PASS; `npm run typecheck` -> exit 0; `npm run e2e` -> all assertions PASS, `E2E + GATE GREEN`.

### 2026-07-20 - Reconnect after relay restart

- **Root cause:** provider created one WebSocket and never reconnected after the relay was restarted; chat then saw no app tools and reported an application connection error.
- **Fix:** reconnect after close and rehydrate scope registrations, scope summaries, tool registrations, and bound context snapshots. Regression test confirms a second socket re-registers mounted tools.
- **Current verification:** React reconnect test 11/11 PASS; chat focus test 7/7 PASS; typecheck exit 0. Full fixed-port e2e is recorded below.

### 2026-07-20 - Action preflight and focus target proof

- **Fix:** every non-virtual action emits a display-only focus phase before gate processing; exact task-card targets resolve from `args.id`. Read-only collection tools now declare semantic focus anchors, so Driver.js and the ghost cursor do not fall back to a centered empty overlay.
- **Verification:** `npm test --workspace @embinder/react` -> 15 files/52 tests PASS; `npm test --workspace @embinder/relay` -> 4 files/15 tests PASS; `npm run typecheck` -> exit 0; `npm run e2e` -> all assertions PASS, `E2E + GATE GREEN`.

### 2026-07-19 - AgentForm Task 3 verification and evidence

- **AgentForm scope:** verified the completed `@embinder/react` AgentForm component and its integration without changing implementation.
- **Verification on this host:** `npm test --workspace @embinder/react` -> Vitest 14 test files passed, 46 tests passed, exit 0; `npm run typecheck` -> `@embinder/react` and `@embinder/relay` `tsc -p tsconfig.json --noEmit`, exit 0; `npm run e2e` -> all SC assertions PASS, `E2E + GATE GREEN`, exit 0.
- **Feature state:** recorded fresh evidence and marked only `F-AGENTFORM` as `passing` in `feature_list.json`.
- **Deferred reviewer minor:** direct human-path tests for individual textarea and select controls remain a test-coverage improvement; no implementation change made in this verification task.
- **Commit:** none (not requested).

**Addendum — final AgentForm fix:** Fresh rerun after final review approval: `npm test --workspace @embinder/react` -> 14 test files and 48 tests passed, exit 0; `npm run typecheck` -> exit 0 across `@embinder/react` and `@embinder/relay`; `npm run e2e` -> all SC assertions PASS, `E2E + GATE GREEN`, exit 0. Final review approved.

### 2026-07-19 - Remove out-of-tab /approve; agent components; ghost-cursor tuning

- **Agent components** shipped in `@embinder/react` (AgentButton/Input/Select/Div/Checkbox/RadioGroup/Toggle/Link + `createAgentElement` factory + dispatch helpers). react suite 33/33, typecheck 0. Wired AgentButton (undo, mark_all_done) + AgentInput (set_search) into apps/todo Toolbar; added `set_search: write` to policy.
- **e2e baseline greened** on Node 26: SC-6 tamper test repointed to `bulk_delete` (delete_task is policy `write`); `restore_task` declared `write` (was deny-by-default destructive, hung SC-4 re-delivery). e2e 36/36 GREEN, re-runnable.
- **Ghost cursor:** `resolveEl` now picks the largest visible on-screen element among multiple same-tool anchors (accuracy); `glideTo` duration now distance-proportional (feel). Hotspot HOTX/HOTY left as the manual calibration lever. Visual-only - live look still owed (F-D8).
- **Removed the out-of-tab /approve page (PRODUCT DECISION, user-confirmed).** Inline on-screen Approve/Deny is now the ONLY path. `/approver-token` always serves the token; `approval-routes.ts` drops `/approve` + `renderPage`; `spotlight.ts createSpotlight(decideBase)` drops the approveUrl fallback link; provider updated. This DROPS anti-self-approve (AC-4) - the agent-driven tab now holds the approver token. The token CHECK on /api/decide remains (wrong token -> 403). See F-SEC notes.
- **Verification:** `npm run typecheck` exit 0; `npm run e2e` -> 36/36 PASS, 'E2E + GATE GREEN', exit 0 (assertion inverted: `/approver-token serves the token -> 200`).
- **Uncommitted** on `main`: agent-component todo integration, ghost-cursor tuning, and the /approve removal are all in the working tree (not yet committed).

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
