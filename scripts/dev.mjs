// One-command dev: run relay + todo together with prefixed, colorized output.
//   npm run dev
import { spawn } from 'node:child_process';

const procs = [
  { name: 'relay', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev', '-w', '@grabmycursor/relay'] },
  { name: 'todo ', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev', '-w', 'todo'] },
];

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (line) => `${color}[${name}]\x1b[0m ${line}`;
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) process.stdout.write(prefix(l) + '\n');
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
});

const shutdown = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log('\x1b[32m[grabmycursor]\x1b[0m relay → http://127.0.0.1:7331  ·  todo → http://localhost:5173  ·  approvals → http://127.0.0.1:7331/approve');
