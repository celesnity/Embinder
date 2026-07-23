/**
 * Mirrors the agent-blackboard repo's `apps/blackboard-server/src/error.rs` `{"error":
 * "<message>"}` response shape exactly, so callers can branch on `status` without the SDK
 * inventing its own error taxonomy on top of the server's. Thrown for any non-2xx response
 * except `409` on `claimTask`, which `rest-client.ts` reports through its return value instead
 * (see the design spec's Decisions table for why the two are handled differently).
 */
export class BlackboardApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = "BlackboardApiError";
    this.status = status;
    this.body = body;
  }

  static async fromResponse(response: Response): Promise<BlackboardApiError> {
    const body = await response.text();
    const message = extractMessage(body) ?? `request failed with status ${response.status}`;
    return new BlackboardApiError(response.status, body, message);
  }
}

function extractMessage(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
    return undefined;
  } catch {
    return body.length > 0 ? body : undefined;
  }
}
