'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});

async function scenario(browser, url, placeholder) {
  const name = placeholder ? 'missing exposure metadata' : 'Chromium fake camera';
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['camera'] });
  const errors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    if (placeholder) await context.addInitScript(() => {
      const strip = value => {
        const copy = { ...value };
        for (const key of ['exposureMode', 'exposureTime', 'iso', 'whiteBalanceMode', 'colorTemperature', 'exposureCompensation']) delete copy[key];
        return copy;
      };
      for (const method of ['getCapabilities', 'getSettings']) {
        const original = MediaStreamTrack.prototype[method];
        MediaStreamTrack.prototype[method] = function () { return strip(original.call(this)); };
      }
    });
    await page.goto(url);
    // Observe each rendered numeric value, including repeated equal values.
    await page.evaluate(() => {
      window.testValues = [];
      new MutationObserver(() => {
        const text = document.querySelector('#ppfdVal').textContent.trim();
        if (/^\d+(\.\d+)?$/.test(text) && window.testValues.length < 20) window.testValues.push(Number(text));
      }).observe(document.querySelector('#ppfdVal'), { childList: true, characterData: true, subtree: true });
    });
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => window.testValues.length >= 10);
    const mode = await page.locator('#hardwareVal').textContent();
    if (placeholder) {
      assert.equal(mode, 'Software (no-manual-control)');
      assert.match(await page.locator('#zoneBadge').textContent(), /Nur Platzhalter – keine Messung/);
      assert.match(await page.locator('#uncertaintyVal').textContent(), /Keine Messung:/);
      await page.locator('button[onclick="openCalibModal()"]').click();
      await page.locator('#refPPFD').fill('100');
      await page.locator('button[onclick="applyCalibration()"]').click();
      assert.match(await page.locator('#errorToast').textContent(), /Platzhalter/);
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ppfd_calib'))), []);
    } else {
      assert.equal(mode, 'Manuell');
      assert.match(await page.locator('#debugExpVal').textContent(), /min=10 max=100/);
      assert.match(await page.locator('#uncertaintyVal').textContent(), /ISO nicht gemeldet/);
      assert.doesNotMatch(await page.locator('#zoneBadge').textContent(), /Platzhalter/);
      const values = await page.evaluate(() => window.testValues.slice(0, 10));
      const median = [...values].sort((a, b) => a - b)[5];
      assert.ok(median > 0 && values[0] >= median * 0.8 && values[0] <= median * 1.2,
        `Initial display must not ramp up from zero: ${values}`);
    }
    await page.waitForFunction(async () => {
      const version = document.title.match(/v(\d+\.\d+\.\d+)/)?.[1];
      const registration = await navigator.serviceWorker.getRegistration();
      return !!registration?.active && (await caches.keys()).includes(`ppfd-v${version}`);
    });
    assert.deepEqual(errors, [], `${name}: browser errors`);
    console.log(`PASS: ${name} (display, mode, service worker${placeholder ? ', calibration blocked' : ', initial values'})`);
  } catch (error) {
    console.error(name, await page.locator('body').innerText().catch(() => 'Page unavailable'));
    throw error;
  } finally { await context.close(); }
}

(async () => {
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await scenario(browser, url, false);
    await scenario(browser, url, true);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
