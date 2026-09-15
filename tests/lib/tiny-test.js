/**
 * Minimal, dependency-free test harness -- this repo ships zero npm
 * dependencies and no build step (see DEPLOYMENT.md in the mothership
 * repo for the shared reasoning). Sequential named cases, plain
 * node:assert/strict, non-zero exit on any failure.
 *
 * Usage: node tests/security/<file>.test.js
 */
import assert from 'node:assert/strict';

const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export async function run() {
  let failed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      console.log(`  ok  - ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL - ${name}`);
      console.error(`         ${err && err.message ? err.message : err}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
}

export { assert };
