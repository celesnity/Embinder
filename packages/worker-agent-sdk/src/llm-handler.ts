import { tool, type Tool, type ToolExecuteFunction, type ToolSet } from "ai";
import type { ZodType } from "zod";
import { runAgentLoop } from "@embinder/relay/chat";
import type { HandlerContext, TaskHandler } from "./worker.js";
import type { Task } from "./types.js";

const SUBMIT_RESULT_TOOL = "submit_result";

export interface DefineLLMHandlerOptions<TResult> {
  /** Static per-worker toolset — a worker has no browser session to derive tools from live,
   * see docs/superpowers/specs/2026-07-23-worker-agent-llm-handler-design.md. */
  tools: ToolSet;
  system: string | ((task: Task) => string);
  /** The LLM must call `submit_result` with a value matching this schema exactly once; that
   * value becomes the task result (complete_task({ result })). */
  resultSchema: ZodType<TResult>;
  stopWhen?: Parameters<typeof runAgentLoop>[0]["stopWhen"];
}

/** Builds a TaskHandler (worker.ts's existing `(task, ctx) => Promise<unknown>` contract) whose
 * body is an LLM tool-calling loop over `runAgentLoop` — the same single agent-loop primitive
 * packages/relay/src/chat.ts's mountChatRoute uses. Runs with no approval gate: a worker has no
 * live human watching a screen, so the trust boundary is task registration, not a live approver
 * (confirmed non-goal in the design spec). */
export function defineLLMHandler<TResult>(opts: DefineLLMHandlerOptions<TResult>): TaskHandler {
  return async (task: Task, _ctx: HandlerContext): Promise<TResult> => {
    const baseURL = process.env.LLM_BASE_URL ?? process.env.MINDER_API_BASE_URL;
    const model = process.env.LLM_MODEL ?? process.env.MINDER_MODEL;
    if (!baseURL || !model) {
      throw new Error(
        "defineLLMHandler: LLM_BASE_URL and LLM_MODEL must be set in the worker process's env " +
          "(same variable names mountChatRoute reads in @embinder/relay).",
      );
    }

    // `tool()`'s overloads resolve INPUT/OUTPUT/CONTEXT from the argument shape, but that
    // resolution relies on conditional types (e.g. NeverOptional) that can't reduce while
    // TResult is still an unresolved generic parameter of defineLLMHandler itself. The cast
    // below only tells the compiler what the concrete shape *would* resolve to once TResult
    // is bound at the call site — runtime is untouched, `execute` still just echoes `args`.
    const submitResult = tool<TResult, TResult, Record<string, unknown>>({
      description: `Submit the final result for this task. Call this exactly once when you are done — do not respond with plain text instead.`,
      inputSchema: opts.resultSchema,
      execute: async (args: TResult) => args,
    } as unknown as Tool<TResult, TResult, Record<string, unknown>> & {
      execute: ToolExecuteFunction<TResult, TResult, Record<string, unknown>>;
    });

    const result = runAgentLoop({
      baseURL,
      model,
      apiKey: process.env.LLM_KEY ?? process.env.OPENAI_API_KEY,
      system: typeof opts.system === "function" ? opts.system(task) : opts.system,
      messages: [{ role: "user", content: JSON.stringify(task.input) }],
      tools: { ...opts.tools, [SUBMIT_RESULT_TOOL]: submitResult },
      stopWhen: opts.stopWhen,
    });

    const toolCalls = await result.toolCalls;
    const submitCall = toolCalls.find((c) => c.toolName === SUBMIT_RESULT_TOOL);
    if (!submitCall) {
      throw new Error(`LLM did not call ${SUBMIT_RESULT_TOOL} within the step budget`);
    }
    return submitCall.input as TResult;
  };
}
