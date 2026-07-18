# Embinder demo — records the gate firing headlessly.
# Render with:  vhs assets/demo.tape   (https://github.com/charmbracelet/vhs)
# Output: assets/demo.gif  → then swap it into the README hero demo block.

Output assets/demo.gif

Set Shell "bash"
Set FontSize 20
Set Width 1200
Set Height 700
Set Padding 24
Set Theme "Catppuccin Mocha"

Type "npm run e2e" Sleep 500ms Enter
# Let the E2E prove the whole pipeline: write passes, destructive pauses at the
# gate, approve runs it, deny blocks it, audit + hardening checks — 25 assertions.
Sleep 8s
Type "# ✅ E2E + GATE GREEN — 25 assertions, the agent never skipped the human." Sleep 500ms Enter
Sleep 3s
