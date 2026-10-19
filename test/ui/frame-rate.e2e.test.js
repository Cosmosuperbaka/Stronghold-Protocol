// Player controls must reach the live Pixi ticker, survive reload, and keep rendering under a cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';

test('frame-rate choices show selection and receive their own touch at mobile widths', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
  let browser;
  t.after(async () => {
    const timer = setTimeout(() => browser?.process()?.kill(), 5000);
    try { await browser?.close(); } finally { clearTimeout(timer); await server.close(); }
  });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  for (const width of [640, 844, 1280]) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      const touch = width < 1000;
      await page.setViewport({ width, height: touch ? 360 : 720, isMobile: touch, hasTouch: touch });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      const open = async () => {
        await page.waitForSelector('.title-settings');
        await page.evaluate(() => document.querySelector('.title-settings').click());
        await page.waitForSelector('[data-testid="fps-limit"]');
      };
      await open();
      const display = '[role="switch"][aria-label="显示帧率"]';
      assert.equal(await page.$eval(display, e => e.getAttribute('aria-checked')), 'true');
      await page.$eval(display, e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
      if (touch) await page.tap(display); else await page.click(display);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('sp.pref.settings'))?.showFps === false);
      for (const [fps, nth] of [[30, 2], [60, 3], [120, 4], [0, 1]]) {
        const selector = `[data-testid="fps-limit"] button:nth-child(${nth})`;
        await page.$eval(selector, e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const target = await page.$eval(selector, e => {
          const r = e.getBoundingClientRect();
          return { width: r.width, height: r.height, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
            receivesTap: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e };
        });
        assert.equal(target.inside && target.receivesTap, true, `${width}px / ${fps}: target is visible and not covered by its neighbour`);
        if (touch) assert.ok(target.width >= 44 && target.height >= 44, 'touch targets are at least 44px');
        if (touch) await page.tap(selector); else await page.click(selector);
        await page.waitForFunction(fps => document.querySelector('[data-testid="fps-limit"] .is-on')?.textContent === (fps ? String(fps) : '不限'), {}, fps);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).fpsLimit), fps);
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await open();
      assert.equal(await page.$eval('[data-testid="fps-limit"] .is-on', e => e.textContent), '不限');
      assert.equal(await page.$eval(display, e => e.getAttribute('aria-checked')), 'false', 'FPS visibility survives reload');
      const output = path.resolve('.cache/ui-audit');
      fs.mkdirSync(output, { recursive: true });
      await page.$eval('[data-testid="fps-limit"]', e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.screenshot({ path: path.join(output, `fps-fixed-${width}.png`) });
    } finally { await context.close(); }
  }
});

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
  await page.waitForFunction(() => Number(document.querySelector('.fps-pill__value')?.textContent) > 0);
  assert.equal(await page.$eval('[data-testid="fps-display"]', e => e.previousElementSibling.classList.contains('ping')), true, 'FPS sits beside latency');
  const metricsButton = 'button[aria-controls="combat-metrics-panel"]';
  await page.waitForSelector(metricsButton);
  const open = async () => { await page.locator('[data-testid="settings-btn"]').click(); await page.waitForSelector('[data-testid="fps-limit"]'); };
  await open();
  const fpsDisplay = '[role="switch"][aria-label="显示帧率"]';
  assert.equal(await page.$eval(fpsDisplay, e => e.getAttribute('aria-checked')), 'true');
  const metrics = '[role="switch"][aria-label="作战统计"]';
  assert.equal(await page.$eval(metrics, e => e.getAttribute('aria-checked')), 'true');
  const radios = '[data-testid="fps-limit"] [role="radio"]';
  assert.deepEqual(await page.$$eval(radios, es => es.map(e => e.textContent)), ['不限', '30', '60', '120']);
  const rates = [];
  for (const [fps, nth] of [[30, 2], [60, 3], [120, 4], [0, 1]]) {
    await page.locator(`${radios}:nth-child(${nth})`).click();
    await page.waitForFunction(limit => globalThis.__SP_VIEW__.raw.debug.app.ticker.maxFPS === limit, {}, fps);
    assert.equal(await page.$eval(`${radios}[aria-checked="true"]`, e => e.textContent), fps ? String(fps) : '不限');
    assert.deepEqual(await page.$$eval(`${radios}.is-on`, es => es.map(e => e.textContent)), [fps ? String(fps) : '不限'], 'exactly the selected limit is highlighted');
    assert.equal(await page.$eval(`${radios}.is-on`, e => getComputedStyle(e).backgroundColor),
      await page.$eval('[data-testid="text-size"] .is-on', e => getComputedStyle(e).backgroundColor), 'frame limit uses the same visible selected style as text size');
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
    await page.waitForFunction(limit => {
      const value = Number(document.querySelector('.fps-pill__value')?.textContent);
      return value > 5 && (!limit || value <= limit * 1.3 + 3);
    }, {}, fps);
    rates.push(`${fps || 'unlimited'}=${measured.toFixed(1)}`);
  }
  await page.locator(`${radios}:nth-child(2)`).click();
  await page.locator(fpsDisplay).click();
  await page.waitForSelector('[data-testid="fps-display"]', { hidden: true });
  await page.locator(metrics).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector => !document.querySelector(selector), {}, metricsButton);
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await open();
  assert.equal(await page.$eval(`${radios}[aria-checked="true"]`, e => e.textContent), '30');
  assert.equal(await page.$eval(`${radios}.is-on`, e => e.textContent), '30', 'selected highlight survives reload');
  assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.debug.app.ticker.maxFPS), 30);
  assert.equal(await page.$('[data-testid="fps-display"]'), null);
  assert.equal(await page.$eval(fpsDisplay, e => e.getAttribute('aria-checked')), 'false');
  assert.equal(await page.$eval(metrics, e => e.getAttribute('aria-checked')), 'false');
  await page.locator(fpsDisplay).click();
  await page.waitForFunction(() => Number(document.querySelector('.fps-pill__value')?.textContent) > 5);
  await page.locator(metrics).click(); await page.keyboard.press('Escape');
  await page.waitForSelector(metricsButton);
  for (const [width, height, textSize] of [[640, 360, 'xl'], [844, 390, 'sm'], [1280, 720, 'sm']]) {
    await page.setViewport({ width, height });
    await page.evaluate(async size => (await import('/js/ui/settings.js')).updateSettings({ textSize: size }), textSize);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.$eval('.gtop', root => {
      const fps = root.querySelector('.fps-pill').getBoundingClientRect();
      const centre = root.querySelector('.gtop__center').getBoundingClientRect();
      return { fpsRight: fps.right, centreLeft: centre.left, top: fps.top, bottom: fps.bottom, height: innerHeight };
    });
    assert.ok(layout.fpsRight <= layout.centreLeft && layout.top >= 0 && layout.bottom <= layout.height, `${width}px: FPS stays clear of the central HUD`);
    fs.mkdirSync('.cache/ui-audit', { recursive: true });
    await page.screenshot({ path: `.cache/ui-audit/fps-live-${width}.png` });
  }
  assert.deepEqual(errors, []);
  t.diagnostic('Observed renderer FPS: ' + rates.join(', '));
});
