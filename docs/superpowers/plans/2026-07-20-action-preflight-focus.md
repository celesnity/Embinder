# Action Preflight Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Visibly focus every agent action target before its existing action/gate flow begins.

**Architecture:** `runGatedCall` emits a display-only focus phase using the action name and canonical argument preview, then immediately emits existing intent/gate phases. Spotlight and ghost cursor resolve collection items from `args.id` and retain the focus animation without delaying action execution.

**Tech Stack:** TypeScript ESM, Vitest, MCP relay, React, driver.js.

## Global Constraints

- Skip virtual `focus_*` tools; they already emit one scope-targeted phase.
- Do not delay policy, approval, audit, canonicalization, rate limits, or browser forwarding.
- Preserve existing destructive spotlight lock and inline approval behavior.

### Task 1: Relay action preflight phase

**Files:**
- Modify: `packages/relay/src/server.ts`
- Modify: `scripts/e2e.mjs`

- [ ] Write an e2e assertion that a direct action produces `focus` before `intent` and includes its canonical args.
- [ ] Run `rtk npm run e2e`; expect the new assertion to fail because direct actions only emit `intent`.
- [ ] In `runGatedCall`, after canonicalizing args and before `intent`, call:

```ts
emitToApp('focus', { name, argsPreview: canonicalPreview });
```

- [ ] Run `rtk npm run e2e`; expect all existing assertions plus preflight ordering to pass.

### Task 2: UI item target and linger proof

**Files:**
- Modify: `packages/react/src/spotlight.ts`
- Modify: `packages/react/src/ghost-cursor.ts`
- Modify: `packages/react/src/resolve-target.test.ts`

- [ ] Write failing target test proving a focus phase with `argsPreview.id` resolves `[data-embinder-item]`.
- [ ] Update focus handlers to pass `argsPreview.id` into `resolveAgentTarget`; keep the 700 ms clear/idle timer.
- [ ] Run `rtk npm test --workspace @embinder/react -- src/resolve-target.test.ts` and `rtk npm run typecheck`.

### Task 3: Full verification

- [ ] Close the live Todo tab to prevent reconnect interference with fixed-port e2e.
- [ ] Run `rtk npm test`, `rtk npm run typecheck`, and `rtk npm run e2e`.
- [ ] Record only observed output in `feature_list.json` and `claude-progress.md`.
