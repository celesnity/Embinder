# Warden / Minder

WebMCP-native relay with a **server-side policy gate**. An agent talks MCP to the relay;
the relay forwards tool calls to a browser app over WebSocket — but destructive calls pause
at a human-approval gate that lives on the server, outside the tab the agent can drive.

```
Agent ──http /mcp──▶  @minder/relay  ──ws /app──▶  Browser app (@minder/react)
                          │
                          └── policy gate (pause / deny / approve) ── approval surface
```

## Layout

| Path | What |
|---|---|
| `apps/todo` | Vite + React reference app. 5 actions exposed as WebMCP tools. |
| `packages/react` | `@minder/react` — `MinderProvider` (document.modelContext shim over ws) + re-exported `useWebMCP`. |
| `packages/relay` | `@minder/relay` — MCP server + ws hub + gate (`server/gate/approval/audit/security`). |
| `minder.policy.json` | Authoritative per-tool risk (read / write / destructive). Deny-by-default. |
| `.references/` | Cloned upstream source (SDK v1.29.0, WebMCP, spec, CopilotKit) — gitignored, reference only. |

## Run

```bash
npm install
npm run relay      # relay on http://127.0.0.1:7331/mcp  (ws app: ws://127.0.0.1:7331/app)
npm run todo       # todo app on http://localhost:5173
```

Point an MCP client at `http://127.0.0.1:7331/mcp`:

```bash
npx @modelcontextprotocol/inspector    # then connect to the /mcp URL
```

## Build status

- ✅ Scaffold: npm workspaces, all packages typecheck clean.
- ✅ Relay spine boots (T-C1/C2/C3): MCP streamable HTTP + stdio, ws `/app` hub, dynamic
  tool register/unregister, call bridge, `__minder_ready` primer before `connect()`.
- ✅ `@minder/react`: `MinderProvider` ws shim + `useWebMCP` (T-B1/B2).
- ✅ Todo app: `useReducer` + 5 tools, `delete_task` / `delete_all_tasks` flagged destructive.
- 🚧 Gate (T-D1/D2): wired; read/write pass through, destructive blocks pending the
  approval surface (T-E1/E2), audit (T-F1), rate limit (T-F2), security (T-G1/G2).

See `MINDER_BUILD_GUIDE.md` for the task-by-task plan.
