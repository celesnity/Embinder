import { defineLLMHandler, defineWorkerAgent, getOperatorSnapshot, operatorTools } from '../packages/worker-agent-sdk/src/index.ts';
import { z } from 'zod';

const baseUrl = process.env.BLACKBOARD_URL;
const apiKey = process.env.BLACKBOARD_API_KEY ?? 'dev-key';
const blackboardId = process.env.BLACKBOARD_ID;
const operatorToken = process.env.EMBINDER_OPERATOR_TOKEN;
const relayBaseUrl = process.env.EMBINDER_OPERATOR_BASE_URL ?? 'http://127.0.0.1:7331';

if (!baseUrl || !blackboardId || !operatorToken) {
  console.log('[todo-worker] BLACKBOARD_URL, BLACKBOARD_ID, and EMBINDER_OPERATOR_TOKEN are required — operator stays idle.');
} else {
  const worker = defineWorkerAgent({
    name: 'todo-operator-worker-1', capabilities: ['todo-operate'], baseUrl, apiKey, blackboardId,
  });
  const operator = { relayBaseUrl, operatorToken };
  worker.handle('todo-operate', async (task, ctx) => {
    const snapshot = await getOperatorSnapshot(operator);
    if (!snapshot.length) throw new Error('todo_capability_unavailable');
    return defineLLMHandler({
      system: (item) => `You operate the connected Todo app. Use only supplied tools. Instruction: ${item.subject}\nDetails: ${JSON.stringify(item.input)}`,
      tools: operatorTools(operator, ctx.taskId, snapshot),
      resultSchema: z.object({ summary: z.string(), actions: z.array(z.string()).max(10) }),
    })(task, ctx);
  });
  await worker.run({
    leaseSeconds: 300,
    pollIntervalMs: 2_000,
    onError: (error) => console.error('[todo-worker] claim error:', error),
  });
}
