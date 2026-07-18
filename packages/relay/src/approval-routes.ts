// Approval HTTP surface (T-E1/E2) — mounted on the relay's Express app (port 7331).
// GET  /approve        -> self-contained HTML page (served with the approver-token embedded)
// GET  /api/pending    -> SSE stream of the pending queue
// POST /api/decide      -> requires the approver-token (anti self-approve, AC-4)
//
// The token is embedded in the page the human loads. The agent-driven app tab (:5173) never
// loads /approve, so it never holds the token — a self-approve from its DevTools returns 403.

import type { Express, Request, Response } from 'express';
import { listPending, subscribe, decide } from './approval.js';
import { tokenMatches } from './security.js';

export function mountApprovalRoutes(app: Express, approverToken: string): void {
  app.get('/approve', (_req: Request, res: Response) => {
    res.type('html').send(renderPage(approverToken));
  });

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

  // Decide a pending call. Token-gated (NOT origin-gated — the page's own origin is 7331).
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

function renderPage(approverToken: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Minder · Approvals</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;background:#0b0b0d;color:#eaeaea}
  h1{font-size:1.2rem} .sub{color:#888;font-size:.85rem;margin-top:-.4rem}
  .empty{color:#666;padding:2rem;text-align:center;border:1px dashed #333;border-radius:8px}
  .card{border:1px solid #333;border-radius:10px;padding:1rem;margin:1rem 0;background:#141416}
  .tool{font-weight:600;font-size:1.05rem} .risk{color:#e5b53b;font-size:.75rem;text-transform:uppercase;margin-left:.5rem}
  pre{background:#0e0e10;border:1px solid #2a2a2e;border-radius:6px;padding:.6rem;overflow:auto;font-size:.8rem;margin:.4rem 0}
  .tamper{color:#ff5b5b;border-color:#5b1a1a;background:#1a0e0e}
  .warn{color:#ff5b5b;font-weight:600}
  .row{display:flex;gap:.5rem;margin-top:.6rem}
  button{cursor:pointer;padding:.5rem 1rem;border-radius:6px;border:1px solid #444;font-weight:600}
  .approve{background:#183d1e;color:#7ee29a;border-color:#2a5} .deny{background:#3d1818;color:#ff8a8a;border-color:#a33}
  .lbl{color:#888;font-size:.75rem}
</style></head><body>
<h1>Minder · Approvals</h1>
<p class="sub">Out-of-tab human gate. You are seeing the exact canonical bytes that will execute.</p>
<div id="list"><div class="empty">No pending calls. Trigger a destructive tool to see it here.</div></div>
<script>
  const TOKEN=${JSON.stringify(approverToken)};
  const list=document.getElementById('list');
  const pending=new Map();
  function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
  function render(){
    if(pending.size===0){list.innerHTML='<div class="empty">No pending calls.</div>';return;}
    list.innerHTML=[...pending.values()].map(p=>{
      const rawJson=esc(JSON.stringify(p.raw,null,2));
      const canJson=esc(JSON.stringify(p.canonical,null,2));
      const tamper=p.tampered?'<p class="warn">⚠️ Hidden/invisible unicode detected — raw ≠ canonical. Executing the canonical (clean) bytes.</p>':'';
      return '<div class="card'+(p.tampered?' tamper':'')+'">'
        +'<div><span class="tool">'+esc(p.tool)+'</span><span class="risk">'+esc(p.risk)+'</span></div>'
        +tamper
        +'<div class="lbl">canonical (executes):</div><pre>'+canJson+'</pre>'
        +(p.tampered?'<div class="lbl">raw (as received):</div><pre class="tamper">'+rawJson+'</pre>':'')
        +'<div class="row"><button class="approve" onclick="decide(\\''+p.id+'\\',true)">Approve</button>'
        +'<button class="deny" onclick="decide(\\''+p.id+'\\',false)">Deny</button></div></div>';
    }).join('');
  }
  async function decide(id,approve){
    await fetch('/api/decide',{method:'POST',headers:{'Content-Type':'application/json','x-approver-token':TOKEN},body:JSON.stringify({id,approve})});
  }
  const es=new EventSource('/api/pending');
  es.onmessage=(e)=>{const m=JSON.parse(e.data);
    if(m.type==='init'){pending.clear();m.pending.forEach(p=>pending.set(p.id,p));}
    else if(m.type==='add'){pending.set(m.pending.id,m.pending);}
    else if(m.type==='remove'){pending.delete(m.pending.id);}
    render();
  };
</script></body></html>`;
}
