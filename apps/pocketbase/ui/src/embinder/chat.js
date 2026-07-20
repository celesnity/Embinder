import "./chat.css";
import { ROBOT_HEAD } from "../../../../../packages/react/src/chat/robot-head.ts";
import { createGhostCursor } from "../../../../../packages/react/src/ghost-cursor.ts";

const RELAY_BASE = "http://127.0.0.1:7331";

function messageElement(role, text = "") {
    const element = document.createElement("div");
    element.className = `embinder-message ${role}`;
    element.textContent = text;
    return element;
}

async function readAssistantStream(response, onDelta, onStatus) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
            const line = event.split("\n").find((item) => item.startsWith("data: "));
            if (!line || line === "data: [DONE]") continue;
            const part = JSON.parse(line.slice(6));
            if (part.type === "text-delta") {
                text += part.delta || "";
                onDelta(text);
            } else if (part.type === "tool-input-available") {
                onStatus(`Running ${part.toolName}…`);
            } else if (part.type === "error") {
                throw new Error(part.errorText || "The agent request failed");
            }
        }
    }
    return text;
}

export function mountPocketBaseEmbinderChat(bridge, options = {}) {
    const relayBase = options.relayBase || RELAY_BASE;
    const ghostCursor = createGhostCursor();
    const messages = [];
    const root = document.createElement("div");
    root.className = "embinder-chat";
    root.innerHTML = `
        <button class="embinder-chat-toggle" type="button" aria-expanded="false" aria-label="Open Embinder agent" data-open="false">
            <span class="embinder-toggle-mascot"><img src="${ROBOT_HEAD}" alt=""></span>
            <span class="embinder-toggle-close" aria-hidden="true">×</span>
            <span class="embinder-online-dot" aria-hidden="true"></span>
        </button>
        <section class="embinder-chat-panel" aria-label="Embinder agent" hidden>
            <header>
                <span class="embinder-chat-brand"><img src="${ROBOT_HEAD}" alt=""><strong>Embinder agent</strong></span>
                <span class="embinder-chat-state">Connecting…</span>
            </header>
            <div class="embinder-chat-messages" aria-live="polite">
                <div class="embinder-chat-empty">
                    <span class="embinder-empty-mascot"><img src="${ROBOT_HEAD}" alt="Embinder mascot"></span>
                    <strong>Ready inside PocketBase</strong>
                    <span>Ask me to work with the screen in front of you.</span>
                </div>
            </div>
            <form class="embinder-chat-form">
                <input aria-label="Message Embinder" placeholder="Ask the agent…" autocomplete="off" disabled>
                <button type="submit" disabled>Send</button>
            </form>
        </section>`;
    document.body.appendChild(root);

    const toggle = root.querySelector(".embinder-chat-toggle");
    const panel = root.querySelector(".embinder-chat-panel");
    const list = root.querySelector(".embinder-chat-messages");
    const state = root.querySelector(".embinder-chat-state");
    const form = root.querySelector(".embinder-chat-form");
    const input = form.querySelector("input");
    const sendButton = form.querySelector("button");
    const intents = new Map();
    let activeAnchor;
    let ready = false;
    let running = false;

    function setStatus(text) {
        state.textContent = text;
    }

    function setRunning(value) {
        running = value;
        input.disabled = !ready || running;
        sendButton.disabled = !ready || running;
    }

    function append(role, text) {
        root.querySelector(".embinder-chat-empty")?.remove();
        const element = messageElement(role, text);
        list.appendChild(element);
        list.scrollTop = list.scrollHeight;
        return element;
    }

    function clearSpotlight() {
        activeAnchor?.classList.remove("embinder-action-active", "embinder-action-awaiting");
        activeAnchor = null;
    }

    const removePhaseListener = bridge.onPhase((phase) => {
        ghostCursor.handle(phase);
        if (phase.type === "intent") {
            intents.set(phase.id, phase.name);
            clearSpotlight();
            activeAnchor = document.querySelector(`[data-embinder-tool="${CSS.escape(phase.name)}"]`);
            activeAnchor?.classList.add("embinder-action-active");
            setStatus(`Preparing ${phase.name}…`);
        } else if (phase.type === "gate" && phase.status === "awaiting") {
            activeAnchor?.classList.add("embinder-action-awaiting");
            setStatus("Waiting for owner approval…");
        } else if (phase.type === "decided") {
            setStatus(phase.decision === "approved" ? "Approved; running…" : "Denied");
        } else if (phase.type === "done") {
            intents.delete(phase.id);
            clearSpotlight();
            setStatus("Ready");
        }
    });

    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
        toggle.dataset.open = String(!panel.hidden);
        if (!panel.hidden) input.focus();
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || running) return;
        input.value = "";
        messages.push({ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] });
        append("user", text);
        const assistantElement = append("assistant", "Thinking…");
        setRunning(true);
        setStatus("Working…");

        try {
            const response = await fetch(`${relayBase}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || `Agent request failed (${response.status})`);
            }
            const answer = await readAssistantStream(
                response,
                (value) => {
                    assistantElement.textContent = value;
                    list.scrollTop = list.scrollHeight;
                },
                setStatus,
            );
            const finalAnswer = answer || "Done.";
            assistantElement.textContent = finalAnswer;
            messages.push({
                id: crypto.randomUUID(),
                role: "assistant",
                parts: [{ type: "text", text: finalAnswer }],
            });
            setStatus("Ready");
        } catch (error) {
            assistantElement.textContent = error?.message || String(error);
            assistantElement.classList.add("error");
            setStatus("Needs attention");
        } finally {
            setRunning(false);
            input.focus();
        }
    });

    Promise.all([
        fetch(`${relayBase}/chat-config`, { cache: "no-store" }).then((response) => response.json()),
        bridge.whenOpen,
    ])
        .then(([config]) => {
            ready = Boolean(config.baseURL && config.model);
            setRunning(false);
            setStatus(ready ? "Ready" : "Set LLM_BASE_URL and LLM_MODEL");
        })
        .catch(() => {
            ready = false;
            setRunning(false);
            setStatus("Start the Embinder relay");
        });

    return {
        destroy() {
            removePhaseListener();
            ghostCursor.destroy();
            clearSpotlight();
            root.remove();
        },
    };
}
