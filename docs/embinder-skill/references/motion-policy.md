# Mascot motion policy

The resident mascot is a shared host-level visual subsystem. Mount it once with the top-level
`EmbinderProvider`; do not mount one per route, modal, iframe, or microfrontend.

`EmbinderProvider` accepts `motion`:

| Mode | Contract |
|---|---|
| `system` | Default. Follow live `prefers-reduced-motion` changes. |
| `full` | User explicitly opts in to idle wandering, target glides, trails, and feedback animation. |
| `reduced` | Keep the mascot stationary while retaining status, spotlight, and approval feedback. |
| `off` | Hide the mascot only; the spotlight, policy gate, and tools remain active. |

While idle the mascot wanders only when the effective mode permits motion. During a navigation or
tool call it travels to the declared anchor. While a critical action awaits approval it remains at
that anchor; it must not wander because that would break the visual connection between the pending
decision and its affected UI. On completion or denial it returns to idle after the existing delay.

For iframe and microfrontend hosts, the host owns the provider and shared motion policy. Children
send only validated lifecycle events through the typed host bridge; they never create duplicate
mascots or receive relay credentials.

Verification for every platform: prove idle position changes in `full`, remains stable in
`reduced`, the action target is correct, approval remains anchored, completion resumes idle, and
route/reconnect cycles leave exactly one pointer with `pointer-events: none`.
