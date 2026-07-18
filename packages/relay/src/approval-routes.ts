// Approval HTTP surface (T-E1/E2) — mounted on the relay's Express app (port 7331).
// GET  /api/pending    -> SSE stream of the pending queue
// POST /api/decide      -> requires the approver-token
//
// Approvals happen ON SCREEN: the app tab fetches the approver-token from /approver-token and
// the spotlight renders inline Approve/Deny buttons that POST /api/decide. The out-of-tab
// /approve HTML page was removed — inline on-screen approval is the only path.

import type { Express, Request, Response } from 'express';
import { listPending, subscribe, decide } from './approval.js';
import { tokenMatches } from './security.js';

export function mountApprovalRoutes(app: Express, approverToken: string): void {
  // Live pending queue over SSE.
  app.get('/api/pending', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'init', pending: listPending() });
    const unsub = subscribe((e) => send(e));
    const ka = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(ka);
      unsub();
    });
  });

  // Decide a pending call. Token-gated so only a holder of the approver-token can decide.
  app.post('/api/decide', (req: Request, res: Response) => {
    const token = (req.get('x-approver-token') || req.body?.token) as string | undefined;
    if (!tokenMatches(token, approverToken)) {
      return res.status(403).json({ error: 'forbidden: approver token required' });
    }
    const { id, approve } = (req.body ?? {}) as { id?: string; approve?: boolean };
    if (!id) return res.status(400).json({ error: 'id required' });
    const ok = decide(id, Boolean(approve), 'ui');
    return res.json({ ok });
  });
}
