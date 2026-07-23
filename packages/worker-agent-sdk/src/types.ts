/**
 * Mirrors the agent-blackboard repo's `apps/blackboard-server/src/dto/task.rs` `TaskResponse`
 * field-for-field, including snake_case field names — the SDK deserializes server JSON
 * directly, with no camelCase remapping layer, to avoid a translation-bug class for zero DX
 * benefit at this stage. See docs/superpowers/specs/2026-07-23-worker-agent-sdk-design.md.
 */
export type TaskStatus = "pending" | "claimed" | "completed" | "failed";

export interface Task {
  id: string;
  tenant_id: string;
  blackboard_id: string;
  capability: string;
  status: TaskStatus;
  subject: string;
  input: unknown;
  result: unknown | null;
  failure_reason: string | null;
  assigned_agent_id: string | null;
  attempt_count: number;
  claimed_at: string | null;
  lease_expires_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AgentIdentity {
  id: string;
  tenant_id: string;
  name: string;
  labels: string[];
  capabilities: string[];
}

/** Connection config shared by every internal REST call. Never persisted by the SDK — see the
 * design spec's "Auth: where does apiKey live?" decision. */
export interface BlackboardConnectionConfig {
  baseUrl: string;
  apiKey: string;
}
