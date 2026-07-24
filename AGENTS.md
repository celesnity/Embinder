# Embinder coding-agent instructions

These instructions apply to the entire repository.

## Mandatory reading gate for SDK integrations

Before planning or editing any work that uses Embinder to make another product or platform
AI-native, the coding agent performing the work must personally read each file below completely:

1. `docs/embinder-skill/SKILL.md`
2. `docs/embinder-skill/references/platform-playbook.md`
3. `docs/embinder-skill/references/architecture.md`
4. `docs/embinder-skill/references/integration.md`
5. `docs/embinder-skill/references/embinder-bridge.js`
6. The target product's repository instructions, developer documentation, route definitions,
   permissions model, setup instructions, and test instructions.

Do not delegate this reading to a subagent. If output is truncated, continue reading until EOF.
Do not make implementation edits before completing the reading gate.

In the first progress update for the integration, state:

- the five Embinder files read;
- the target documentation read;
- the stack verdict and selected React or framework-neutral path;
- the capability-matrix artifact that will define coverage.

Then follow the complete process and completion gate in `docs/embinder-skill/SKILL.md`. An SDK
integration is not complete until every non-blocked page/function row and every agent subsystem has
real-browser evidence, animations have been verified, and the final access-rights table is present.

If any required document changes during the implementation, reread that document before continuing.

## Repository baseline

Also follow `CLAUDE.md`, `claude-progress.md`, and `feature_list.json`. Preserve user changes and do
not claim verification that was not run on the current host.

## Git branching and sprint workflow

`main` is the repository source of truth. It is a protected branch: do not begin work there,
commit to it, merge into it locally, or push to it. Only an approved, CI-green pull request from
`release/*` may update `main`.

### Branch roles

| Branch | Purpose | Allowed inbound changes |
|---|---|---|
| `main` | Source of truth and completed releases | PR from `release/*` only; required CI and approval |
| `release/0.0.x` | One sprint's release candidate and production tag | PR from `feat/*` only; required CI and approval; tag `v0.0.x` for production |
| `feat/<name>` | One feature's implementation | Created from the active `release/0.0.x` |
| `development` | Current sprint integration/development environment | PR only; required CI and approval |

There is no direct push to `main`, `release/*`, or `development`. Treat these as protected even in
local work: do not make direct commits or local merges onto them. Do not push a feature branch or
open a PR unless the user asks.

### Before implementation

1. Confirm the current branch is `feat/<name>`. If it is `main`, `release/*`, or `development`,
   stop before editing and create or switch to the correct feature branch.
2. Confirm the feature branch was created from the active sprint's `release/0.0.x`, not `main`.
   If the active release branch is unknown or absent, ask the user which sprint/release to use;
   never invent one.
3. Keep one feature per `feat/<name>` branch. Preserve unrelated working-tree changes.

### Sprint lifecycle

1. Create `release/0.0.x` from `main` for the sprint.
2. Create each `feat/<name>` from that release branch.
3. Merge feature work into `development` through a CI-green, approved PR for the development
   environment.
4. Merge the same feature work into `release/0.0.x` through a CI-green, approved PR when it is
   ready for the sprint deployment.
5. Tag the release branch `v0.0.x` and deploy production.
6. Merge `release/0.0.x` into `main` through its CI-green, approved PR.

After a successful sprint deployment, sync `main` into feature work that did not ship; reset or
recreate `development` from `main`; optionally PR remaining features into `development`; then
create the next `release/0.0.x` from `main`.
