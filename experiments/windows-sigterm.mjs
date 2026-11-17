// Linux-only preloader for the Windows exit-reporting regression in issue #3.
// Usage after npm run build:
// node --import ./experiments/windows-sigterm.mjs --test --test-timeout=15000 \
//   --test-name-pattern='stdio lifecycle' tests/integration.test.mjs
// This simulates forced termination and its exit tuple, not a native Windows run.
import { ChildProcess } from 'node:child_process';

if (process.platform !== 'linux') throw new Error('Run this simulation on Linux');
const forced = new WeakSet();
const kill = ChildProcess.prototype.kill;
const emit = ChildProcess.prototype.emit;

ChildProcess.prototype.kill = function (signal) {
  if (signal === 'SIGTERM') {
    forced.add(this);
    return kill.call(this, 'SIGKILL'); // Bypass the child JavaScript handler.
  }
  return kill.call(this, signal);
};
ChildProcess.prototype.emit = function (event, ...args) {
  if (forced.has(this) && (event === 'exit' || event === 'close') && args[1] === 'SIGKILL') {
    args[1] = 'SIGTERM'; // Node on Windows reports the originally requested signal.
  }
  return emit.call(this, event, ...args);
};
Object.defineProperty(process, 'platform', { value: 'win32' });
