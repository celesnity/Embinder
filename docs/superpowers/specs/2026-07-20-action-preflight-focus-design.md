# Action preflight focus design

## Goal

Every agent action visibly focuses its exact UI target before the relay runs the existing gate and browser call. The action remains immediate; the focus animation lingers independently so the interaction does not feel abrupt.

## Behavior

- Every relay-routed action except virtual `focus_*` discovery tools emits a display-only `focus` phase before `intent` and `gate`.
- The phase carries action name and canonical argument preview. It has no `scopeId`, so the UI resolves the action's own anchor; collection actions use `args.id` to resolve the exact item.
- Driver.js and ghost cursor begin animation on the phase. The focus highlight remains for 700 ms even when a read/write action finishes earlier.
- The relay does not wait for the animation. Policy evaluation, approval, audit, rate limits, canonicalization, and browser forwarding begin immediately after emission.
- A destructive gate may replace the short focus popover with its existing locked approval popover.
- Virtual `focus_*` tools retain current behavior: target the declared scope anchor, return semantic context, and do not emit a second action-preflight focus.

## Proof

1. A direct action emits focus before intent/gate with its action name and argument preview.
2. Item-scoped actions resolve the item from `args.id`; non-item actions resolve the tool anchor.
3. Virtual focus emits exactly one scope-targeted focus phase.
4. Driver.js and ghost cursor preserve focus display long enough to be visible without delaying execution.
5. Existing gate, audit, and action e2e assertions remain green.
