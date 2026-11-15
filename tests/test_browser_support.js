'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { repeatCount, runBatch, saveFailure } = require('./helpers/browser_support');

test('repeat count defaults to one and accepts only integers 1–20', () => {
  assert.equal(repeatCount(), 1);
  assert.equal(repeatCount('10'), 10);
  assert.equal(repeatCount(20), 20);
  for (const value of ['0', '-1', '21', '1.5', '', 'NaN', '1; echo bad']) assert.throws(() => repeatCount(value));
});

test('a failure stays failed while later independent scenarios still run', async () => {
  const calls = [];
  const results = await runBatch([{ name: 'first' }, { name: 'second' }], async task => {
    calls.push(task.name);
    if (task.name === 'first') throw new Error('intentional fixture failure');
  });
  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual(results.map(r => r.status), ['failed', 'passed']);
  assert.match(results[0].error, /intentional fixture failure/);
});

test('diagnostics retain the original error and trace even if screenshot fails', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ppfd-diagnostics-'));
  let traced = false;
  try {
    await saveFailure({ directory, error: new Error('original assertion'), messages: [{ type: 'error', text: 'browser error' }],
      page: {
        evaluate: async () => [17, 18],
        locator: () => ({ innerText: async () => 'page text' }),
        screenshot: async () => { throw new Error('page crashed'); },
      },
      context: { tracing: { stop: async ({ path: target }) => { traced = true; await fs.writeFile(target, 'test trace'); } } },
    });
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'diagnostics.json'), 'utf8'));
    assert.equal(traced, true);
    assert.match(saved.error, /original assertion/);
    assert.deepEqual(saved.values, [17, 18]);
    assert.deepEqual(saved.diagnosticErrors, ['screenshot: page crashed']);
    assert.equal(saved.messages[0].text, 'browser error');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
