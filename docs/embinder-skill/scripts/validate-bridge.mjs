import assert from "node:assert/strict";

import { installEmbinderBridge } from "../references/embinder-bridge.js";

const sent = [];
const sockets = [];

class FakeWebSocket {
    static OPEN = 1;

    constructor() {
        this.readyState = 0;
        this.listeners = new Map();
        this.sent = [];
        sockets.push(this);
        setImmediate(() => {
            this.readyState = FakeWebSocket.OPEN;
            this.emit("open", {});
        });
    }

    addEventListener(type, listener) {
        const values = this.listeners.get(type) || [];
        values.push(listener);
        this.listeners.set(type, values);
    }

    emit(type, event) {
        for (const listener of this.listeners.get(type) || []) listener(event);
    }

    send(value) {
        const message = JSON.parse(value);
        this.sent.push(message);
        sent.push(message);
    }

    drop() {
        this.readyState = 3;
        this.emit("close", {});
    }

    close() {
        this.readyState = 3;
        this.emit("close", {});
    }
}

globalThis.WebSocket = FakeWebSocket;
globalThis.document = {};
globalThis.fetch = async () => ({ ok: true, json: async () => ({ token: "test" }) });

const bridge = installEmbinderBridge();
const connectionStates = [];
let argsSeen;
let callPhaseSeen = false;

bridge.onConnection(({ state }) => connectionStates.push(state));
bridge.onPhase((phase) => {
    if (phase.type === "call") callPhaseSeen = true;
});
bridge.registerTool({
    name: "create_record",
    inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
    },
    execute: async (args) => {
        argsSeen = args;
        return { ok: true, id: "r1" };
    },
});
bridge.registerTool({
    name: "screen_context",
    inputSchema: { type: "object", properties: {} },
    annotations: { embinderContextOnly: true },
});
bridge.setContext("screen_context", { route: "/records" });

await bridge.whenOpen;
assert.deepEqual(sockets[0].sent.map((message) => message.type), ["register", "register", "context"]);

sockets[0].emit("message", {
    data: JSON.stringify({
        type: "call",
        id: "c1",
        name: "create_record",
        args: { title: "test" },
    }),
});
await new Promise((resolve) => setImmediate(resolve));

assert.equal(callPhaseSeen, true, "call must reach the visual phase listener");
assert.deepEqual(argsSeen, { title: "test" }, "call must execute the local handler");
assert.deepEqual(sent.at(-1), {
    type: "result",
    id: "c1",
    result: { ok: true, id: "r1" },
});

sockets[0].drop();
await new Promise((resolve) => setTimeout(resolve, 1100));
await new Promise((resolve) => setImmediate(resolve));

assert.equal(sockets.length, 2, "bridge must reconnect after a dropped socket");
assert.deepEqual(sockets[1].sent.map((message) => message.type), ["register", "register", "context"]);
assert(connectionStates.includes("retrying"));
assert(connectionStates.filter((state) => state === "open").length >= 2);

bridge.close();
console.log("Embinder framework-neutral bridge validation: PASS");
