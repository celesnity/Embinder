# Embinder in the PocketBase Admin UI

## Stack verdict

PocketBase's Admin UI is a client-rendered vanilla JavaScript SPA built with Shablon templates and Vite. Its browser entry is `src/main.js`; application state and the authenticated PocketBase SDK client are available through `window.app.store` and `window.app.pb`.

The integration therefore uses Embinder's framework-neutral JSON-over-WebSocket bridge, not the React package. Tool handlers run in the authenticated Admin UI tab and reuse the existing PocketBase SDK client, including its record lifecycle events.

## Platform map

| Surface | Existing PocketBase source | Embinder capability |
|---|---|---|
| App entry | `src/main.js` | Installs the bridge and resident chat once |
| Screen and collection state | `src/store.js` | `pocketbase_screen` context-only pointer |
| Hash router | `src/router.js` | `pocketbase_navigate` |
| Current page data | Store loaders | `pocketbase_refresh` |
| Active collection records | `app.pb.collection(name)` | list/create/update/delete record tools |

Record tools are render-scoped: they are registered only while an authenticated superuser is on `#/collections` with an active collection. Navigating elsewhere unregisters them after the relay's normal grace period.

## Tools and policy

| Tool | Risk | Behavior |
|---|---|---|
| `pocketbase_screen` | read | Sends the current route, collection fields, and a bounded collection index to the agent prompt; the agent can also refresh this information on demand |
| `pocketbase_navigate` | read | Navigates among supported Admin UI routes and opens a collection/record |
| `pocketbase_refresh` | read | Reloads the current screen's backing data |
| `pocketbase_list_records` | read | Reads up to 100 records from the active collection |
| `pocketbase_create_record` | write | Creates a JSON record through the authenticated SDK client |
| `pocketbase_update_record` | write | Updates a JSON record through the authenticated SDK client |
| `pocketbase_delete_record` | destructive | Permanently deletes one record only after out-of-tab approval |

Risk is authoritative in the repository root `embinder.policy.json`. The delete tool pauses at `http://127.0.0.1:7331/approve`; the PocketBase tab cannot approve its own call.

## Run locally

From the repository root, start the relay with model configuration:

```powershell
$env:LLM_BASE_URL = "http://127.0.0.1:1234/v1"
$env:LLM_MODEL = "your-model"
npm run relay
```

In another terminal, run the Admin UI against a PocketBase backend at `127.0.0.1:8090`:

```powershell
npm run dev --prefix apps/pocketbase/ui
```

Open the Vite URL, sign in as a PocketBase superuser, and use the ✦ button. For the embedded Admin UI, build it with:

```powershell
npm run build --prefix apps/pocketbase/ui
```

The relay accepts PocketBase's standard loopback origins on ports 5173 (Vite) and 8090 (standalone PocketBase). PocketBase's Admin UI content-security policy explicitly permits the loopback WebSocket used by the Embinder bridge.

Once a collection is open, this is enough to test record creation:

> Check the collection that's open, then create one test record. Fill every required field with sensible values, use "Embinder test" for the main text field, and tell me the new record ID.

The floating mascot is the same agent cursor used by the Todo app. It wanders while idle, moves to the matching PocketBase control when a tool runs, and remains separate from your real mouse pointer.

## Current boundaries

- JSON record fields are supported; browser `File` uploads are not represented in the agent tool schema.
- Record tools operate on the collection currently visible in the Admin UI, by design.
- Canvas-only controls would not have a stable spotlight anchor. The integrated record and navigation surfaces use normal DOM anchors.
- PocketBase server hooks and Go-only operations remain backend concerns and are not exposed as browser tools.
