const DEFAULT_URL = "ws://127.0.0.1:7331/app";
const PHASE_TYPES = new Set(["intent", "gate", "decided", "call", "done"]);

function httpBaseFrom(wsUrl) {
    return wsUrl.replace(/^ws/, "http").replace(/\/app$/, "");
}

function stripDescriptor(descriptor) {
    return {
        name: descriptor.name,
        title: descriptor.title,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
        annotations: descriptor.annotations,
    };
}

/**
 * Framework-neutral Embinder bridge for PocketBase's vanilla browser UI.
 * Handlers stay in this browser tab; only JSON Schema descriptors cross the wire.
 */
export function installEmbinderBridge(options = {}) {
    const url = options.url || DEFAULT_URL;
    const tools = new Map();
    const contexts = new Map();
    const resultOutbox = [];
    const phaseListeners = new Set();
    let socket;
    let reconnectTimer;
    let reconnectAttempt = 0;
    let closed = false;
    let resolveFirstOpen;

    const whenOpen = new Promise((resolve) => {
        resolveFirstOpen = resolve;
    });

    function send(payload) {
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }

    function replayState() {
        for (const descriptor of tools.values()) {
            send({ type: "register", tool: stripDescriptor(descriptor) });
        }
        for (const [name, state] of contexts) {
            send({ type: "context", name, state });
        }
        for (const result of resultOutbox.splice(0)) {
            send(result);
        }
    }

    async function connect() {
        if (closed) return;

        let token = options.token;
        if (!token) {
            try {
                const response = await fetch(`${httpBaseFrom(url)}/app-token`, { cache: "no-store" });
                if (!response.ok) throw new Error(`token request failed (${response.status})`);
                token = (await response.json()).token;
            } catch (error) {
                scheduleReconnect(error);
                return;
            }
        }

        socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
        socket.addEventListener("open", () => {
            reconnectAttempt = 0;
            replayState();
            resolveFirstOpen?.();
            resolveFirstOpen = null;
        });
        socket.addEventListener("message", handleMessage);
        socket.addEventListener("close", () => scheduleReconnect());
        socket.addEventListener("error", () => socket?.close());
    }

    function scheduleReconnect(error) {
        if (closed || reconnectTimer) return;
        if (error) console.warn("[embinder] relay unavailable; retrying", error);
        const delay = Math.min(1000 * (2 ** reconnectAttempt++), 15000);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    }

    function handleMessage(event) {
        const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        if (PHASE_TYPES.has(message.type)) {
            for (const listener of phaseListeners) listener(message);
            if (message.type !== "call") return;
        }

        const descriptor = tools.get(message.name);
        if (!descriptor?.execute) {
            send({ type: "result", id: message.id, error: `Capability ${message.name} is not mounted` });
            return;
        }

        Promise.resolve(descriptor.execute(message.args || {}))
            .then((result) => {
                const payload = { type: "result", id: message.id, result };
                if (!send(payload)) resultOutbox.push(payload);
            })
            .catch((error) => {
                const payload = { type: "result", id: message.id, error: String(error?.message || error) };
                if (!send(payload)) resultOutbox.push(payload);
            });
    }

    const api = {
        whenOpen,
        registerTool(descriptor) {
            tools.set(descriptor.name, descriptor);
            send({ type: "register", tool: stripDescriptor(descriptor) });
            return {
                unregister() {
                    tools.delete(descriptor.name);
                    contexts.delete(descriptor.name);
                    send({ type: "unregister", name: descriptor.name });
                },
            };
        },
        setContext(name, state) {
            contexts.set(name, state);
            send({ type: "context", name, state });
        },
        onPhase(listener) {
            phaseListeners.add(listener);
            return () => phaseListeners.delete(listener);
        },
        close() {
            closed = true;
            clearTimeout(reconnectTimer);
            socket?.close();
        },
    };

    if (options.exposeGlobal !== false) {
        Object.defineProperty(document, "modelContext", {
            value: { registerTool: (descriptor) => api.registerTool(descriptor) },
            configurable: true,
        });
    }

    connect();
    return api;
}
