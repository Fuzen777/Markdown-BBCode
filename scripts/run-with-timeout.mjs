// ==> Section 1 - Process-Tree Timeout Guard <==
import { spawn, spawnSync } from 'node:child_process';

const [timeoutArg, command, ...args] = process.argv.slice(2);
const timeoutSeconds = Number(timeoutArg);

if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || !command) {
  process.stderr.write('Usage: node scripts/run-with-timeout.mjs <seconds> <command> [...args]\n');
  process.exit(2);
}

const executable = command === 'node' ? process.execPath : command;
const useShell = command !== 'node' && process.platform === 'win32';
const child = spawn(executable, args, { stdio: 'inherit', shell: useShell });
let timedOut = false;

/** Forcefully terminates the child process and all spawned descendants on hang or abort. */
function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Ignore when the process already exited during taskkill.
  }
}

const timer = setTimeout(() => {
  timedOut = true;
  process.stderr.write(`\n[timeout] Command exceeded ${timeoutSeconds}s limit and was terminated: ${[command, ...args].join(' ')}\n`);
  killProcessTree(child.pid);
  process.exit(124);
}, Math.round(timeoutSeconds * 1000));

process.on('SIGINT', () => {
  clearTimeout(timer);
  killProcessTree(child.pid);
  process.exit(130);
});

process.on('SIGTERM', () => {
  clearTimeout(timer);
  killProcessTree(child.pid);
  process.exit(143);
});

child.on('error', error => {
  clearTimeout(timer);
  process.stderr.write(`[timeout] Failed to start ${command}: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (timedOut) return;
  process.exit(code ?? (signal ? 1 : 0));
});
