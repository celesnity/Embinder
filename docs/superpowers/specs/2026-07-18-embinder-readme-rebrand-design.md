# Embinder SDK — README Rebrand & Enhancement — Design

_Date: 2026-07-18_
_Status: proposed → awaiting user review_

## Goal

Enhance `README.md` following the "README Builder — Resource Pack" guidance, and rebrand
the project from **GrabMyCursor** to **Embinder SDK** in the README. The current README is
already strong (hero, badges, Mermaid, Alerts, `<details>` FAQ, compare table, honest status);
this pass fixes gaps and applies the new identity.

Positioning is unchanged: **"A map for agents to drive your app — with a human gate they can't skip."**
The new logo (robot driving a car with a map, waypoints, destination flag) supports the metaphor.

## Scope (this task)

1. **Rebrand in README only.** All 13 "GrabMyCursor" identity mentions → "Embinder SDK".
   Package/file/code renames are **out of scope** here — captured as a plan below.
2. **Hero logo.** Add `assets/logo.png` (the new Embinder logo) to the hero with alt text,
   alongside the existing `assets/banner.png`. Single variant for now (no dark version yet).
3. **Package references in README → `@embinder/*` (target).** Show `@embinder/react`,
   `@embinder/relay`, `embinder.policy.json`. Add a `> [!NOTE]` stating packages currently
   ship under `@grabmycursor/*` until the rename lands, so install instructions aren't misleading.
4. **Fix broken demo GIF.** README references `assets/demo.gif`, which does not exist.
   - Commit `assets/demo.tape` — a VHS script for the ~12s flow
     (agent calls `delete_all_tasks` → button locks → `/approve`).
   - Replace the dangling `<img src="assets/demo.gif">` with a short "demo recording coming"
     note linking `docs/DEMO.md`. No broken image link ships.
5. **Add missing sections/files.**
   - Concise **Contributing** section in the README.
   - **LICENSE** file (MIT) so "MIT (intended)" becomes true.
6. **Polish.** Re-verify all in-page anchor links after the rename. No TOC (README ~195 lines,
   under the ~200-line threshold; inline nav stays).

## Non-goals

- Renaming npm scopes, folders, imports, or the policy filename in code (see plan below).
- Redesigning the value prop, diagrams, or compare table beyond the name swap.
- Recording the actual demo GIF (needs a live run; the `.tape` makes it one command).

## README section order (unchanged, per resource pack blueprint)

hero (logo + banner + 1-line value prop) → badges → demo (gated) → What it is →
How it works (Mermaid) → Packages → Quick start → Declaring an action → The gate, seen →
How it compares → FAQ → Status → **Contributing (new)** → Built with → License.

## Quality checklist (resource pack §5) — target state

- [x] Value prop clear in 5s (hero + one sentence).
- [x] Demo slot near top — gated with a note (no broken link) + `.tape` ready.
- [x] Quick start ≤5 commands, fastest win first.
- [x] Architecture in Mermaid, not ASCII.
- [x] No fabricated metrics/badges; static brand-colored badges.
- [x] Alerts used for status + caveats.
- [x] Anchor-correct inline nav (no TOC needed under ~200 lines).
- [x] Images have alt text.
- [x] Ends with status, contributing, built-with, license (+ real LICENSE file).

---

## Deliverable: package-rename plan (later, out of this task's scope)

Make the README's forward-looking `@embinder/*` references real. Ordered checklist:

1. **npm scope + names**
   - `packages/react/package.json`: `@grabmycursor/react` → `@embinder/react`
   - `packages/relay/package.json`: `@grabmycursor/relay` → `@embinder/relay`
   - Update `dependencies`/`devDependencies` cross-refs in all workspace `package.json`.
2. **Policy file**
   - `grabmycursor.policy.json` → `embinder.policy.json`; update every loader/path reference.
3. **Imports & symbols**
   - Grep for `@grabmycursor/` across `packages/`, `apps/`, `scripts/`, `docs/`; update imports.
   - `GrabMyCursorProvider` → `EmbinderProvider` (and any `GrabMyCursor*` symbols); keep a
     re-export alias for one release if backward-compat matters.
4. **Runtime strings / ws paths / branding** in `apps/todo`, relay logs, approval page copy.
5. **Repo-level**
   - `BUILD_STATUS.md` (currently "Minder / Warden") and other docs → Embinder.
   - Decide on GitHub repo rename (`GrabMyCursor` → `Embinder` / `embinder-sdk`) and update
     `origin` remote + README links. (Manual — GitHub Settings.)
6. **Verify:** `npm install` + `npm run e2e` green after the rename; grep shows zero
   `grabmycursor` outside `.references/`.

Each step is mechanical; do it as its own PR/commit after this README pass is approved.

---

## Open questions

None — name (Embinder SDK), rename depth (README + plan), positioning (keep map/drive),
package refs (`@embinder/*` now + note), and demo handling (`.tape` + gated image) are all decided.
