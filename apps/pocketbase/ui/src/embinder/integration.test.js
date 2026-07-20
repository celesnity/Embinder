import assert from "node:assert/strict";
import test from "node:test";

import { pocketBaseRoute, pocketBaseScreenState, pocketBaseSection } from "./integration.js";

test("PocketBase routes map to the supported Admin UI sections", () => {
    assert.equal(pocketBaseSection("#/collections?collection=posts"), "collections");
    assert.equal(pocketBaseSection("#/settings/backups"), "backups");
    assert.equal(pocketBaseSection("#/something-else"), "unknown");
    assert.equal(
        pocketBaseRoute({ section: "collections", collection: "posts", recordId: "abc 123" }),
        "#/collections?collection=posts&record=abc+123",
    );
    assert.throws(() => pocketBaseRoute({ section: "logs", collection: "posts" }), /only valid/);
    assert.throws(() => pocketBaseRoute({ section: "missing" }), /Unknown PocketBase section/);
});

test("screen context is bounded and omits hidden fields", () => {
    const collections = Array.from({ length: 105 }, (_, index) => ({
        id: `c${index}`,
        name: `collection_${index}`,
        type: "base",
        system: false,
        fields: [],
    }));
    collections[0].fields = [
        { name: "title", type: "text", required: true, hidden: false },
        { name: "secret", type: "password", required: false, hidden: true },
    ];

    globalThis.window = { location: { hash: "#/collections?collection=collection_0" } };
    globalThis.app = {
        pb: { authStore: { isValid: true } },
        store: { superuser: { id: "admin" }, activeCollection: collections[0], collections },
    };

    const state = pocketBaseScreenState();
    assert.equal(state.authenticated, true);
    assert.equal(state.collections.length, 100);
    assert.deepEqual(state.activeCollection.fields, [{ name: "title", type: "text", required: true }]);

    delete globalThis.window;
    delete globalThis.app;
});
