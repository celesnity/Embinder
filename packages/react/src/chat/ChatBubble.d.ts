export interface ChatBubbleConfig {
    /** relay chat endpoint. Default `${configBase}/chat`. */
    api?: string;
    /** Override the relay-provided OpenAI-compatible base URL (rarely needed). */
    baseURL?: string;
    /** Override the relay-provided model id (rarely needed). */
    model?: string;
}
interface ChatBubbleProps extends ChatBubbleConfig {
    /** Relay http base, injected by EmbinderProvider (e.g. http://127.0.0.1:7331). */
    configBase?: string;
}
export declare function ChatBubble(cfg?: ChatBubbleProps): import("react").JSX.Element;
export {};
