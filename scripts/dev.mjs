// One-command dev: run relay + todo together with prefixed, colorized output.
//   npm run dev
import { spawn } from 'node:child_process';

// On Windows, npm is npm.cmd, which recent Node refuses to spawn without a shell
// (EINVAL). Use shell:true cross-platform; tree-kill on shutdown so ports free.
const useShell = process.platform === 'win32';
const procs = [
  { name: 'relay', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev', '-w', '@embinder/relay'] },
  { name: 'todo ', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev', '-w', 'todo'] },
];

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: useShell });
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

// shell:true wraps each child in cmd.exe on Windows; killing that wrapper orphans
// vite/tsx (they keep ports 5173/7331). taskkill /T tears down the whole tree.
const killChild = (c) => {
  if (process.platform === 'win32' && c.pid) {
    spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore', shell: true });
  } else {
    c.kill();
  }
};
const shutdown = () => { for (const c of children) killChild(c); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log('\x1b[32m[embinder]\x1b[0m relay → http://127.0.0.1:7331  ·  todo → http://localhost:5173  ·  approvals → on screen in the app tab');
