# Context proofing design

## Goal

Keep agent context proportional to its current task. An agent begins with one semantic
screen layer, discovers nested regions through focus tools, and performs at most one
scoped action before returning to its parent layer. The user sees the same discovery
path through driver.js and the ghost cursor.

This extends render-scoped context. It does not inspect or scrape DOM content. Every
summary and every reachable branch is declared by the app developer.

## Developer API

`AgentScope` is an optional wrapper for a region whose internals need progressive
disclosure.

```tsx
<AgentScope name="inbox" summary={() => ({ count: 8 })}>
  <AgentList /* existing agent-enabled descendants */ />
</AgentScope>
```

The scope name is unique within its rendered parent. `summary` returns JSON-safe,
semantic state for the region. The wrapper supplies its rendered element as the focus
anchor. Nesting `AgentScope` components creates a tree.

There are no per-action scope flags:

- Tools not under an `AgentScope` are direct root actions and remain callable in one step.
- A tool under a scope is scoped automatically by its nearest scope.
- The SDK generates a `focus_<scope>` discovery tool for each direct child scope.

This keeps the developer change to one wrapper where scoped exploration is wanted.

## Context tree and session lease

The provider attaches scope ancestry and scope metadata to its existing registrations.
The relay's capability registry stores the rendered scope tree and maintains an active
focus lease independently for every MCP or chat session.

At root, a session receives only:

- root-level direct tools;
- semantic summaries for root-level context pointers; and
- direct-child `focus_<scope>` tools.

Calling `focus_<scope>` validates that scope is a direct child of the session's active
scope. It replaces any unconsumed focus lease, activates the requested scope, and
returns the scope's developer-declared summary. The session then sees that scope's
direct actions, direct child focus tools, and semantic context only. It does not see
sibling or descendant actions.

A child action reserves its lease before entering the normal policy gate. The lease is
cleared when that action settles: success, policy denial, handler error, cancellation,
or timeout. The parent layer then becomes visible again. This preserves the requested
one-action focus behavior while allowing destructive actions to remain pending through
human approval.

Direct root actions do not need focus and do not change the active scope.

## Chat, MCP, and visualization flow

The relay must expose the same selected layer to both transport surfaces.

For MCP, `tools/list` filters capabilities by the connection's active focus lease. A
successful focus call changes the list exposed on the next `tools/list` request.

For the resident chat, `/chat` cannot keep its initial AI SDK tool map after focus.
The chat orchestrator treats a successful focus as a continuation boundary: it appends
the focus result, rebuilds the selected-layer system block and tools, and continues the
same assistant reply. The model can therefore focus and use one child action without a
new user message. After that action settles, it rebuilds the root or parent layer for
any subsequent tool step. Existing step limits remain enforced across the complete
reply, not per rebuild.

The provider emits a new display-only `focus` phase carrying scope identity and anchor.
When `viz` is enabled, driver.js and the ghost cursor highlight that anchor. The focus
highlight never locks interaction. Existing destructive action phases still lock the
target and render the current inline approval controls.

## Safety and failure behavior

- A focus target must be a direct child of the active scope; otherwise return `isError`.
- A scoped action must match the session's active lease. Unknown, stale, sibling, or
  descendant actions return `isError` before forwarding to the app handler.
- Focus and scoped-action leases never cross MCP/chat sessions.
- A new focus replaces a previous unconsumed lease.
- Scope summaries use the existing JSON stabilization, debounce, and 16 KB per-context
  cap. Oversize state is represented by the existing truncation marker.
- Maximum focus depth defaults to three. Deeper scope registrations remain rendered but
  are not discoverable until the application raises the configured bound deliberately.
- Scope unmount clears affected active leases; calls then fail with the existing
  capability-left-screen semantics.
- Policy, canonicalization, audit records, rate limits, and approval behavior remain
  authoritative and unchanged.

## Verification contract

Unit and integration coverage must prove:

1. Root context excludes scoped descendants and exposes only direct focus tools.
2. Focusing reveals only the focused scope's semantic summary, direct child focus tools,
   and direct scoped actions.
3. Context comes solely from `summary`; no DOM text or controls are serialized.
4. A focused child action succeeds through the existing gate, then restores its parent
   context after success, denial, handler failure, cancellation, and timeout.
5. A stale or out-of-scope action is rejected before the app handler executes.
6. Leases are isolated by MCP/chat session and are removed on unmount.
7. A resident-chat reply can focus, rebuild its tool map, call one scoped action, and
   continue without another user message while respecting the global step limit.
8. MCP `tools/list` changes after focus and excludes unavailable actions.
9. `viz` sends driver.js and the ghost cursor to the focused scope anchor without
   changing the existing destructive spotlight lock or approval path.
10. Existing React, relay, typecheck, and end-to-end suites remain green.

## Non-goals

- Automatic DOM discovery, text extraction, or accessibility-tree serialization.
- Per-action `direct` or `requiresFocus` flags.
- Multi-action focused sessions.
- Changing policy decisions, approval authority, audit schema, or rate-limit rules.
