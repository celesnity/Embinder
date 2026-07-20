import { installEmbinderBridge } from "./bridge.js";

const EMPTY_SCHEMA = { type: "object", properties: {} };
const RECORD_TOOL_NAMES = [
    "pocketbase_list_records",
    "pocketbase_create_record",
    "pocketbase_update_record",
    "pocketbase_delete_record",
];

const SECTIONS = {
    collections: "#/collections",
    logs: "#/logs",
    settings: "#/settings",
    mail: "#/settings/mail",
    storage: "#/settings/storage",
    backups: "#/settings/backups",
    crons: "#/settings/crons",
    export: "#/settings/export-collections",
    import: "#/settings/import-collections",
    sql: "#/settings/sql",
};

export function pocketBaseSection(hash = "") {
    const path = hash.split("?")[0];
    return Object.entries(SECTIONS).find(([, route]) => route === path)?.[0]
        || (path.startsWith("#/collections") ? "collections" : "unknown");
}

function activeCollection() {
    const collection = app.store.activeCollection;
    if (!collection?.id) throw new Error("Select a PocketBase collection first");
    return collection;
}

function assertMutableCollection(collection) {
    if (collection.type === "view") throw new Error(`Collection ${collection.name} is a read-only view`);
}

function recordJSON(record) {
    return typeof record?.toJSON === "function" ? record.toJSON() : JSON.parse(JSON.stringify(record));
}

export function pocketBaseScreenState() {
    const collection = app.store.activeCollection;
    return {
        section: pocketBaseSection(window.location.hash),
        route: window.location.hash || "#/collections",
        authenticated: Boolean(app.pb.authStore.isValid && app.store.superuser?.id),
        activeCollection: collection?.id
            ? {
                id: collection.id,
                name: collection.name,
                type: collection.type,
                system: Boolean(collection.system),
                fields: (collection.fields || []).filter((field) => !field.hidden).map((field) => ({
                    name: field.name,
                    type: field.type,
                    required: Boolean(field.required),
                })),
            }
            : null,
        collections: (app.store.collections || []).slice(0, 100).map((item) => ({
            name: item.name,
            type: item.type,
            system: Boolean(item.system),
        })),
    };
}

export function pocketBaseRoute({ section, collection, recordId }) {
    const route = SECTIONS[section];
    if (!route) throw new Error(`Unknown PocketBase section: ${section}`);
    if ((collection || recordId) && section !== "collections") {
        throw new Error("collection and recordId are only valid for the collections section");
    }

    const query = new URLSearchParams();
    if (collection) query.set("collection", collection);
    if (recordId) query.set("record", recordId);
    return query.size ? `${route}?${query}` : route;
}

function navigatePocketBase(options) {
    window.location.hash = pocketBaseRoute(options);
    return { ok: true, route: window.location.hash };
}

function stampAnchors() {
    document.querySelector(".app-main-nav")?.setAttribute("data-embinder-tool", "pocketbase_navigate");
    document.querySelector(".records-table")?.setAttribute("data-embinder-tool", "pocketbase_list_records");
    document.querySelector(".new-record-btn")?.setAttribute("data-embinder-tool", "pocketbase_create_record");
    document.querySelector(".records-table tbody tr.handle")?.setAttribute(
        "data-embinder-tool",
        "pocketbase_update_record",
    );
    document.querySelector(".records-bulkbar .danger")?.setAttribute(
        "data-embinder-tool",
        "pocketbase_delete_record",
    );
}

export function installPocketBaseEmbinder(options = {}) {
    const bridge = options.bridge || installEmbinderBridge({ url: options.url });
    const mounted = new Map();

    function mount(descriptor) {
        if (!mounted.has(descriptor.name)) mounted.set(descriptor.name, bridge.registerTool(descriptor));
    }

    function unmount(name) {
        mounted.get(name)?.unregister();
        mounted.delete(name);
    }

    function mountGlobalTools() {
        mount({
            name: "pocketbase_screen",
            title: "PocketBase screen",
            description:
                "Inspect the current PocketBase screen, including the selected collection and its field schema. Call this before creating a record when the required fields are not already known.",
            inputSchema: EMPTY_SCHEMA,
            annotations: { title: "PocketBase screen", readOnlyHint: true },
            execute: async () => pocketBaseScreenState(),
        });
        mount({
            name: "pocketbase_navigate",
            title: "Navigate PocketBase",
            description: `Navigate the Admin UI. section is one of: ${Object.keys(SECTIONS).join(", ")}`,
            inputSchema: {
                type: "object",
                properties: {
                    section: { type: "string" },
                    collection: { type: "string" },
                    recordId: { type: "string" },
                },
                required: ["section"],
            },
            annotations: { title: "Navigate PocketBase", readOnlyHint: true },
            execute: navigatePocketBase,
        });
        mount({
            name: "pocketbase_refresh",
            title: "Refresh PocketBase screen",
            description: "Reload the data backing the current PocketBase Admin UI screen",
            inputSchema: EMPTY_SCHEMA,
            annotations: { title: "Refresh PocketBase", readOnlyHint: true },
            execute: async () => {
                const section = pocketBaseSection(window.location.hash);
                if (section === "collections") await app.store.loadCollections(app.store.activeCollection?.id);
                else if (section === "settings") await app.store.loadSettings();
                else window.dispatchEvent(new HashChangeEvent("hashchange"));
                return { ok: true, section };
            },
        });
    }

    function mountRecordTools() {
        mount({
            name: "pocketbase_list_records",
            title: "List records",
            description: "List records from the collection currently selected in the PocketBase Admin UI",
            inputSchema: {
                type: "object",
                properties: {
                    filter: { type: "string" },
                    sort: { type: "string" },
                    page: { type: "integer" },
                    perPage: { type: "integer" },
                },
            },
            annotations: { title: "List active collection records", readOnlyHint: true },
            execute: async ({ filter, sort, page = 1, perPage = 20 }) => {
                const collection = activeCollection();
                const result = await app.pb.collection(collection.name).getList(
                    Math.max(1, page),
                    Math.min(100, Math.max(1, perPage)),
                    { filter: filter || undefined, sort: sort || undefined },
                );
                return {
                    collection: collection.name,
                    page: result.page,
                    totalPages: result.totalPages,
                    totalItems: result.totalItems,
                    items: result.items.map(recordJSON),
                };
            },
        });
        mount({
            name: "pocketbase_create_record",
            title: "Create record",
            description: "Create a JSON record in the collection currently selected in the PocketBase Admin UI",
            inputSchema: {
                type: "object",
                properties: { data: { type: "object" } },
                required: ["data"],
            },
            annotations: { title: "Create record" },
            execute: async ({ data }) => {
                const collection = activeCollection();
                assertMutableCollection(collection);
                const record = await app.pb.collection(collection.name).create(data);
                app.toasts.success(`Created record in ${collection.name}`);
                return { ok: true, collection: collection.name, record: recordJSON(record) };
            },
        });
        mount({
            name: "pocketbase_update_record",
            title: "Update record",
            description: "Update a JSON record in the collection currently selected in the PocketBase Admin UI",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string" }, data: { type: "object" } },
                required: ["id", "data"],
            },
            annotations: { title: "Update record" },
            execute: async ({ id, data }) => {
                const collection = activeCollection();
                assertMutableCollection(collection);
                const record = await app.pb.collection(collection.name).update(id, data);
                app.toasts.success(`Updated ${collection.name}/${id}`);
                return { ok: true, collection: collection.name, record: recordJSON(record) };
            },
        });
        mount({
            name: "pocketbase_delete_record",
            title: "Delete record",
            description:
                "Permanently delete a record from the collection currently selected in the PocketBase Admin UI",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
            },
            annotations: { title: "Delete record", destructiveHint: true },
            execute: async ({ id }) => {
                const collection = activeCollection();
                assertMutableCollection(collection);
                await app.pb.collection(collection.name).delete(id);
                app.toasts.success(`Deleted ${collection.name}/${id}`);
                return { ok: true, collection: collection.name, id };
            },
        });
    }

    function sync() {
        const authenticated = Boolean(app.pb.authStore.isValid && app.store.superuser?.id);
        if (!authenticated) {
            for (const name of [...mounted.keys()]) unmount(name);
            return;
        }

        mountGlobalTools();
        if (pocketBaseSection(window.location.hash) === "collections" && app.store.activeCollection?.id) {
            mountRecordTools();
        } else {
            RECORD_TOOL_NAMES.forEach(unmount);
        }
        bridge.setContext("pocketbase_screen", pocketBaseScreenState());
        queueMicrotask(stampAnchors);
    }

    window.addEventListener("hashchange", sync);
    document.addEventListener("record:save", sync);
    document.addEventListener("record:delete", sync);
    const unsubscribeAuth = app.pb.authStore.onChange(sync);
    const stateWatcher = watch(
        () =>
            JSON.stringify({
                ready: app.store._ready,
                superuser: app.store.superuser?.id,
                collection: app.store.activeCollection?.id,
                collections: app.store.collections?.map((item) => `${item.id}:${item.updated}`),
            }),
        sync,
    );
    const observer = new MutationObserver(stampAnchors);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();

    return {
        bridge,
        sync,
        destroy() {
            window.removeEventListener("hashchange", sync);
            document.removeEventListener("record:save", sync);
            document.removeEventListener("record:delete", sync);
            unsubscribeAuth?.();
            stateWatcher?.unwatch();
            observer.disconnect();
            for (const name of [...mounted.keys()]) unmount(name);
            bridge.close();
        },
    };
}
