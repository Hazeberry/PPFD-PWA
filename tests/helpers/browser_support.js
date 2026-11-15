'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function repeatCount(value = '1') {
  if (!/^(?:[1-9]|1[0-9]|20)$/.test(String(value))) {
    throw new Error('BROWSER_TEST_REPEATS must be an integer from 1 to 20');
  }
  return Number(value);
}

// Never retry away a failure. Finish the remaining independent scenarios.
async function runBatch(tasks, execute) {
  const results = [];
  for (const task of tasks) {
    const started = Date.now();
    try {
      await execute(task);
      results.push({ ...task, status: 'passed', durationMs: Date.now() - started });
    } catch (error) {
      console.error(`FAIL: ${task.name}: ${error.message}`);
      results.push({ ...task, status: 'failed', durationMs: Date.now() - started, error: error.stack || String(error) });
    }
  }
  return results;
}

async function saveFailure({ directory, page, context, error, messages }) {
  await fs.mkdir(directory, { recursive: true });
  const diagnosticErrors = [];
  async function capture(name, action) {
    try { return await action(); }
    catch (failure) { diagnosticErrors.push(`${name}: ${failure.message}`); return null; }
  }
  const values = await capture('values', () => page.evaluate(() => window.testValues || []));
  const text = await capture('page text', () => page.locator('body').innerText({ timeout: 5000 }));
  await capture('screenshot', () => page.screenshot({ path: path.join(directory, 'screenshot.png'), fullPage: true, timeout: 5000 }));
  // A screenshot failure (e.g. crashed page) must not prevent saving the trace.
  await capture('trace', () => context.tracing.stop({ path: path.join(directory, 'trace.zip') }));
  await fs.writeFile(path.join(directory, 'diagnostics.json'), JSON.stringify({
    error: error.stack || String(error), values, text, messages, diagnosticErrors,
  }, null, 2) + '\n');
}

module.exports = { repeatCount, runBatch, saveFailure };
