import assert from "node:assert/strict";
import test from "node:test";

import { installEmbinderBridge } from "./bridge.js";

test("call phases also execute the registered PocketBase tool", async () => {
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;
    const sent = [];
    let socket;

    class FakeWebSocket {
        static OPEN = 1;

        constructor() {
            this.readyState = FakeWebSocket.OPEN;
            this.listeners = new Map();
            socket = this;
        }

        addEventListener(type, listener) {
            this.listeners.set(type, listener);
        }

        send(payload) {
            sent.push(JSON.parse(payload));
        }

        close() {}

        emit(type, data) {
            this.listeners.get(type)?.({ data: JSON.stringify(data) });
        }
    }

    globalThis.document = {};
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ token: "test" }) });
    globalThis.WebSocket = FakeWebSocket;

    try {
        const bridge = installEmbinderBridge({ exposeGlobal: false });
        await new Promise((resolve) => setImmediate(resolve));
        socket.emit("open", {});

        let received;
        bridge.registerTool({
            name: "pocketbase_create_record",
            inputSchema: { type: "object" },
            execute: async (args) => {
                received = args;
                return { ok: true, id: "record-1" };
            },
        });

        socket.emit("message", {
            type: "call",
            id: "call-1",
            name: "pocketbase_create_record",
            args: { data: { title: "Embinder test" } },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(received, { data: { title: "Embinder test" } });
        assert.deepEqual(sent.at(-1), {
            type: "result",
            id: "call-1",
            result: { ok: true, id: "record-1" },
        });
        bridge.close();
    } finally {
        globalThis.document = originalDocument;
        globalThis.fetch = originalFetch;
        globalThis.WebSocket = originalWebSocket;
    }
});
