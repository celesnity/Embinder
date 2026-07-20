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

### 2026-07-20 - Universal AI-native implementation skill

- **Goal:** Turn the Embinder implementation skill into a clear, reusable process for coding agents integrating the SDK into any browser product.
- **Completed:**
  - Replaced wiring-oriented completion language with a mandatory route/page/function capability matrix and measurable coverage denominator.
  - Added page-by-page action, context, navigation, policy, visualization, persistence, and real-browser verification requirements.
  - Added an explicit diagnose-patch-retest loop that cannot end while non-blocked capability rows remain unverified.
  - Added resident-agent sub-system and animation completion gates, including the official mascot, ghost cursor, spotlight, responsive behavior, and reduced motion.
  - Added a required access-rights table covering CSP/WebSocket, Origin/CORS, auth, roles, API/data rules, iframe/sandboxing, filesystem/network, and server-only boundaries.
  - Replaced the minimal non-React bridge reference with reconnect/replay, connection state, context, phase listeners, and correct `call` phase execution.
  - Corrected stale documentation that treated PocketBase as unrelated; Todo and PocketBase are now documented as the React and non-React reference integrations.
  - Added `agents/openai.yaml` and a reusable bridge validation script.
  - Added a mandatory pre-edit reading gate to root `AGENTS.md`, `CLAUDE.md`, GitHub Copilot instructions, the skill body, and the skill default prompt. Coding agents must personally read all five Embinder implementation documents through EOF plus the target product's docs, then acknowledge the readings, stack verdict, selected path, and capability matrix before editing.
- **Verification:** skill validation PASS; bridge validation PASS; `git diff --check` PASS; a bounded independent read-only audit of the Todo app correctly refused false completion, produced capability/sub-system/rights evidence, and returned `Incomplete` where runtime proof was unavailable.

### 2026-07-18 (c) - PocketBase Admin UI resident agent

- **Goal:** Integrate the Embinder agent into `apps/pocketbase` after reading the Embinder platform playbook and PocketBase extension documentation.
- **Completed:**
  - Mapped the target as a vanilla JavaScript + Shablon + Vite SPA and installed a reconnecting framework-neutral bridge at the Admin UI entry.
  - Added authenticated, render-scoped PocketBase capabilities: screen context, navigation, refresh, and active-collection list/create/update/delete record actions.
  - Added a native resident chat bubble that consumes the relay's AI SDK UI stream, reuses the Embinder gear-head mascot, restores its motion system, and displays gate/action phases with DOM anchors.
  - Mounted the exact shared Todo ghost cursor and fixed the vanilla bridge so `call` phases both animate and execute their registered PocketBase actions.
  - Added the missing loopback WebSocket source to PocketBase's Admin UI CSP; live browser verification now reaches `Ready` with an enabled chat input and the ghost cursor mounted.
  - Classified all PocketBase tools in `embinder.policy.json`; record deletion is destructive and pauses at the out-of-tab approval surface.
  - Allowed PocketBase's default loopback origin (`:8090`) and aligned the chat route with documented `LLM_BASE_URL` / `LLM_MODEL` configuration.
  - Added `apps/pocketbase/ui/EMBINDER.md`, focused route/context tests, and rebuilt the embedded Admin UI assets.
  - Restored the required baseline on Windows: direct Node+tsx relay spawn, encoding-stable invisible-Unicode canonicalization, current archive policy entries, and deterministic inline-approval test env.
- **Verification run:** `npm run typecheck`; `npm run e2e`; `npm run test --prefix apps/pocketbase/ui`; `npm run build --prefix apps/pocketbase/ui`.
- **Evidence recorded:** typecheck exit 0; E2E all PASS / `E2E + GATE GREEN`; PocketBase tests 3/3 PASS (including call execution regression coverage); Vite production build exit 0 with 204 modules transformed.
- **Known risks:**
  - JSON record mutations are supported, but browser `File` values are outside the current tool schema.
  - `npm install --prefix apps/pocketbase/ui` reports one high-severity advisory in the vendored UI dependency tree; no dependency versions were changed in this feature.
- **Next best action:** Run the documented live smoke with a PocketBase backend on `:8090`, a configured local model, and the approval page open separately.

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
