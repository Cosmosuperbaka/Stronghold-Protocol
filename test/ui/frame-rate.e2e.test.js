// Player controls must reach the live Pixi ticker, survive reload, and keep rendering under a cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('frame-rate controls apply all limits live and persist; combat statistics default on preserves opt-out', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-frame-rate-'));
  const h = makeMatch({ humans: 1, fake: true }).start().toPrep();
  let admin, browser;
  t.after(async () => {
    await browser?.close(); await admin?.close(); h.m.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const room = { code: 'TEST', mode: 'solo', difficulty: 'NORMAL', seats: [], spectators: [], match: h.m };
  admin = await startAdmin({ lobby: { rooms: new Map([['TEST', room]]), safeData: () => h.m.data, onMatchEnd() {} },
    port: 0, recovery: false, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'),
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
  await page.goto(admin.url + '/live?room=TEST&playerId=p_0&board=2d', { waitUntil: 'domcontentloaded' });
  const ready = () => page.waitForFunction(() => globalThis.__SP_VIEW__?.kind === 'engine'
    && !!globalThis.__SP_VIEW__.raw.debug?.app?.ticker, { timeout: 30000 });
  await ready();
  const metricsButton = 'button[aria-controls="combat-metrics-panel"]';
  await page.waitForSelector(metricsButton);
  const open = async () => { await page.locator('[data-testid="settings-btn"]').click(); await page.waitForSelector('[data-testid="fps-limit"]'); };
  await open();
  const metrics = '[role="switch"][aria-label="作战统计"]';
  assert.equal(await page.$eval(metrics, e => e.getAttribute('aria-checked')), 'true');
  const radios = '[data-testid="fps-limit"] [role="radio"]';
  assert.deepEqual(await page.$$eval(radios, es => es.map(e => e.textContent)), ['不限', '30', '60', '120']);
  const rates = [];
  for (const [fps, nth] of [[30, 2], [60, 3], [120, 4], [0, 1]]) {
    await page.locator(`${radios}:nth-child(${nth})`).click();
    await page.waitForFunction(limit => globalThis.__SP_VIEW__.raw.debug.app.ticker.maxFPS === limit, {}, fps);
    assert.equal(await page.$eval(`${radios}[aria-checked="true"]`, e => e.textContent), fps ? String(fps) : '不限');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).fpsLimit), fps);
    const measured = await page.evaluate(async () => {
      const ticker = globalThis.__SP_VIEW__.raw.debug.app.ticker;
      let count = 0; const tick = () => count++;
      const start = performance.now(); ticker.add(tick);
      await new Promise(resolve => setTimeout(resolve, 1200));
      ticker.remove(tick);
      return count * 1000 / (performance.now() - start);
    });
    assert.ok(measured > 5 && (!fps || measured <= fps * 1.2 + 2), `${fps} cap: ${measured.toFixed(1)} FPS`);
    rates.push(`${fps || 'unlimited'}=${measured.toFixed(1)}`);
  }
  await page.locator(`${radios}:nth-child(2)`).click();
  await page.locator(metrics).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector => !document.querySelector(selector), {}, metricsButton);
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await open();
  assert.equal(await page.$eval(`${radios}[aria-checked="true"]`, e => e.textContent), '30');
  assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.debug.app.ticker.maxFPS), 30);
  assert.equal(await page.$eval(metrics, e => e.getAttribute('aria-checked')), 'false');
  await page.locator(metrics).click(); await page.keyboard.press('Escape');
  await page.waitForSelector(metricsButton);
  assert.deepEqual(errors, []);
  t.diagnostic('Observed renderer FPS: ' + rates.join(', '));
});
