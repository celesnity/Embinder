// Framework-neutral Embinder browser bridge for Vue, Svelte, Angular, Solid,
// vanilla JavaScript, and client-hydrated SSR applications.
//
// Install once at the client entry. Tool handlers stay in the browser. The
// bridge reconnects, replays tools before context, exposes connection state,
// forwards lifecycle phases to visual drivers, and executes `call` messages.

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
 * @param {object} [options]
 * @param {string} [options.url]
 * @param {string} [options.token]
 * @param {boolean} [options.exposeGlobal]
 */
export function installEmbinderBridge(options = {}) {
    const url = options.url || DEFAULT_URL;
    const tools = new Map();
    const contexts = new Map();
    const resultOutbox = [];
    const phaseListeners = new Set();
    const connectionListeners = new Set();
    let socket;
    let reconnectTimer;
    let reconnectAttempt = 0;
    let closed = false;
    let resolveFirstOpen;

    const whenOpen = new Promise((resolve) => {
        resolveFirstOpen = resolve;
    });

    function emitConnection(state, detail) {
        for (const listener of connectionListeners) listener({ state, detail });
    }

    function send(payload) {
        if (socket?.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(payload));
        return true;
    }

    // Ordering matters: the relay cannot attach context to a pointer/tool it
    // has not registered yet.
    function replayState() {
        for (const descriptor of tools.values()) {
            send({ type: "register", tool: stripDescriptor(descriptor) });
        }
        for (const [name, state] of contexts) {
            send({ type: "context", name, state });
        }
        for (const result of resultOutbox.splice(0)) send(result);
    }

    function scheduleReconnect(error) {
        if (closed || reconnectTimer) return;
        const delay = Math.min(1000 * (2 ** reconnectAttempt++), 15000);
        emitConnection("retrying", { delay, error: error?.message || String(error || "") });
        reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            connect();
        }, delay);
    }

    async function connect() {
        if (closed) return;
        emitConnection("connecting");

        let token = options.token;
        if (!token) {
            try {
                const response = await fetch(`${httpBaseFrom(url)}/app-token`, { cache: "no-store" });
                if (!response.ok) throw new Error(`token request failed (${response.status})`);
                token = (await response.json()).token;
                if (!token) throw new Error("token response was empty");
            } catch (error) {
                scheduleReconnect(error);
                return;
            }
        }

        socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
        socket.addEventListener("open", () => {
            reconnectAttempt = 0;
            replayState();
            emitConnection("open");
            resolveFirstOpen?.();
            resolveFirstOpen = undefined;
        });
        socket.addEventListener("message", handleMessage);
        socket.addEventListener("close", () => scheduleReconnect(new Error("socket closed")));
        socket.addEventListener("error", () => socket?.close());
    }

    function handleMessage(event) {
        let message;
        try {
            message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch (error) {
            console.warn("[embinder] ignored invalid relay message", error);
            return;
        }

        // `call` is both a visual phase and the instruction to execute. Notify
        // visual listeners, but do not return before running the handler.
        if (PHASE_TYPES.has(message.type)) {
            for (const listener of phaseListeners) listener(message);
            if (message.type !== "call") return;
        }

        const descriptor = tools.get(message.name);
        if (!descriptor?.execute) {
            const payload = {
                type: "result",
                id: message.id,
                error: `Capability ${message.name} is not mounted in the current page state`,
            };
            if (!send(payload)) resultOutbox.push(payload);
            return;
        }

        Promise.resolve(descriptor.execute(message.args || {}))
            .then((result) => {
                const payload = { type: "result", id: message.id, result };
                if (!send(payload)) resultOutbox.push(payload);
            })
            .catch((error) => {
                const payload = {
                    type: "result",
                    id: message.id,
                    error: String(error?.message || error),
                };
                if (!send(payload)) resultOutbox.push(payload);
            });
    }

    const api = {
        whenOpen,

        registerTool(descriptor, registerOptions = {}) {
            if (!descriptor?.name) throw new Error("Embinder tool name is required");
            if (typeof descriptor.execute !== "function"
                && !descriptor.annotations?.embinderContextOnly) {
                throw new Error(`Embinder tool ${descriptor.name} needs an execute handler`);
            }

            tools.set(descriptor.name, descriptor);
            send({ type: "register", tool: stripDescriptor(descriptor) });

            const unregister = () => {
                if (tools.get(descriptor.name) !== descriptor) return;
                tools.delete(descriptor.name);
                contexts.delete(descriptor.name);
                send({ type: "unregister", name: descriptor.name });
            };
            registerOptions.signal?.addEventListener("abort", unregister, { once: true });
            return { unregister };
        },

        setContext(name, state) {
            contexts.set(name, state);
            send({ type: "context", name, state });
        },

        onPhase(listener) {
            phaseListeners.add(listener);
            return () => phaseListeners.delete(listener);
        },

        onConnection(listener) {
            connectionListeners.add(listener);
            listener({ state: socket?.readyState === WebSocket.OPEN ? "open" : "connecting" });
            return () => connectionListeners.delete(listener);
        },

        isOpen() {
            return socket?.readyState === WebSocket.OPEN;
        },

        close() {
            closed = true;
            clearTimeout(reconnectTimer);
            socket?.close();
            emitConnection("closed");
        },
    };

    if (options.exposeGlobal !== false && typeof document !== "undefined") {
        Object.defineProperty(document, "modelContext", {
            value: {
                registerTool: (descriptor, registerOptions) =>
                    api.registerTool(descriptor, registerOptions),
            },
            configurable: true,
        });
    }

    connect();
    return api;
}

export default installEmbinderBridge;
