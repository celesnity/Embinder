# CLAUDE.md - Embinder operating rules

You are working on **Embinder**: a WebMCP-native SDK that lets an AI agent drive a
web app through declared tools, with a **server-side human approval gate** and a live
action **spotlight**. Monorepo (npm workspaces): `@embinder/relay` (MCP server + gate),
`@embinder/react` (app SDK), `apps/todo` (reference app).

## Mandatory reading gate for every product integration

Before planning or editing any use of this SDK in another product/platform, personally read these
files completely; do not delegate the reading to a subagent:

1. `docs/embinder-skill/SKILL.md`
2. `docs/embinder-skill/references/platform-playbook.md`
3. `docs/embinder-skill/references/architecture.md`
4. `docs/embinder-skill/references/integration.md`
5. `docs/embinder-skill/references/embinder-bridge.js`
6. The target product's instructions, developer docs, routes, permissions, setup, and tests.

If a read is truncated, continue to EOF. Do not modify implementation code until the gate is
complete. In the first progress update, list what was read, give the stack verdict and chosen
integration path, and identify the capability matrix that will define full page/function coverage.
Follow the skill's test loop, completion gate, animation requirements, and final access-rights table.

## Before you write any code (every session)

1. Read **`claude-progress.md`** -> "Current Verified State". That is the single source of truth.
2. Read **`feature_list.json`**. Pick up the one feature already `in_progress`, or the lowest
   `priority` number that is `not_started`. Never start a second feature while one is in progress.
3. Run the baseline: **`.\init.ps1`** (install + typecheck + e2e). If it is not GREEN, STOP and
   fix the baseline first - do not build on a red baseline.

## How to work

- **One feature at a time.** Set exactly one feature to `in_progress` in `feature_list.json`.
- Stay inside the selected feature's scope. If you find unrelated issues, note them in
  `claude-progress.md` "Known risks" - do not fix them in the same session.
- Match the existing code: TypeScript, ESM, Zod raw-shape input schemas, per-session `McpServer`.
  Risk is authoritative in `embinder.policy.json` (`read`/`write` pass, `destructive` pauses,
  unknown tools deny-by-default) - `destructiveHint` from the app is only a default.
- Prefer the headless proof over manual clicking: `npm run e2e` exercises the full wire protocol.

## Standard paths (this host: Windows, node 24, PowerShell)

| Purpose | Command |
|---|---|
| Startup harness | `.\init.ps1` |
| Install | `npm install` |
| Verify (baseline) | `npm run typecheck` then `npm run e2e` |
| Run the app | `npm run dev`  (relay :7331 + todo :5173) |
| Approvals surface | on screen — inline Approve/Deny in the app tab (the out-of-tab /approve page was removed) |

## Definition of done (the most important section)

A feature is `passing` ONLY when ALL of these hold - no exceptions:

1. **It matches the target behavior** in the feature's `user_visible_behavior`.
2. **You ran the verification** in that feature's `verification` steps on THIS host, and it passed.
3. **Evidence is recorded** in the feature's `evidence` field: the exact command run and the
   real output (e.g. "npm run e2e -> 17/17 PASS, E2E + GATE GREEN"). Do not paste claims you
   did not produce this session - do not inherit `BUILD_STATUS.md`'s numbers as your own.
4. `npm run typecheck` is still **exit 0** across all workspaces.
5. **`claude-progress.md` is updated** with a new session record.

If you cannot produce evidence, the feature is not `passing`. Mark it `in_progress` or `blocked`
with the reason, and record what verification is still owed.

## End of session (clean state)

- `.\init.ps1` still GREEN (or the blocker is written down in `claude-progress.md`).
- `feature_list.json` reflects reality - no false `passing` entries.
- No half-finished, unrecorded work. The next session can continue from repo artifacts alone.
- Do not commit unless asked. `audit.jsonl` and `.grabmycursor/` are gitignored runtime output.

## Git branching and sprint workflow

Follow `AGENTS.md` as the authoritative branch policy. In particular, never start implementation,
commit, merge, or push on `main`, `release/*`, or `development`. Work only on `feat/<name>` created
from the active `release/0.0.x`; protected-branch changes happen only through CI-green, approved
pull requests according to the documented sprint lifecycle.
