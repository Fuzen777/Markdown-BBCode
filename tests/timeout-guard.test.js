// ==> Section 1 - Test Timeout Watchdog Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('run-with-timeout returns exit code 0 for fast passing commands', () => {
  const passed = spawnSync(process.execPath, ['scripts/run-with-timeout.mjs', '5', 'node', '-e', 'process.exit(0)'], { encoding: 'utf8' });
  assert.equal(passed.status, 0);
});

test('run-with-timeout preserves non-zero exit codes from failed commands', () => {
  const failed = spawnSync(process.execPath, ['scripts/run-with-timeout.mjs', '5', 'node', '-e', 'process.exit(7)'], { encoding: 'utf8' });
  assert.equal(failed.status, 7);
});

test('run-with-timeout terminates hung commands promptly with exit code 124', () => {
  const startedAt = performance.now();
  const hung = spawnSync(
    process.execPath,
    ['scripts/run-with-timeout.mjs', '0.5', 'node', '-e', 'setTimeout(() => {}, 30000)'],
    { encoding: 'utf8' },
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(hung.status, 124);
  assert.match(hung.stderr, /\[timeout\]/);
  assert.ok(elapsedMs < 5000, `Expected hang termination under 5000 ms, got ${elapsedMs} ms`);
});
