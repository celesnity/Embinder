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
