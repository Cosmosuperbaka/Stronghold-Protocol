// Real console settings controls: save/reset, restart-visible state, error recovery and narrow layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { getUniteLayerGains, resetHostSettings } from '../../server/match/hostSettings.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

test('console 联防 layers: save, undo, reload, failure recovery and desktop/mobile layout', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-admin-settings-'));
  let srv, admin, browser;
  resetHostSettings();
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    const open = async () => { await page.click('[data-tab="settings"]'); await page.waitForSelector('#unite-layers-enabled'); };
    const checked = () => page.$eval('#unite-layers-enabled', (el) => el.checked);
    await open();
    assert.equal(await page.$eval('#rooms', (el) => el.getBoundingClientRect().height), 0, 'other tabs stay hidden');
    assert.equal(await checked(), false);
    await page.click('#unite-layers-enabled');
    await page.click('[data-unite-layers-reset]');
    assert.equal(await checked(), false, 'undo restores the saved value');
    await page.click('#unite-layers-enabled');
    await page.click('[data-unite-layers-save]');
    await page.waitForFunction(() => document.querySelector('#unite-layers-saved').textContent.includes('已保存'));
    assert.equal(getUniteLayerGains(), true);
    await page.click('[data-prep-save]');
    await page.waitForFunction(() => document.querySelector('#prep-saved')?.textContent === '已保存');
    assert.equal(getUniteLayerGains(), true, 'saving timers preserves the custom rule');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    assert.equal(await checked(), true, 'reload reads the saved state');

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/settings')) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: '测试保存失败' }) });
      else req.continue();
    });
    await page.click('#unite-layers-enabled');
    await page.click('[data-unite-layers-save]');
    await page.waitForFunction(() => document.querySelector('#unite-layers-saved').textContent.includes('保存失败'));
    assert.equal(getUniteLayerGains(), true, 'failed save leaves the server unchanged');
    assert.equal(await page.$eval('[data-unite-layers-save]', (el) => el.disabled), false, 'can retry');
    await page.click('[data-unite-layers-reset]');
    assert.equal(await checked(), true);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#msg')).display === 'none');

    mkdirSync(OUT, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      const fits = await page.$eval('#unite-layers-form', (form) => {
        const rect = form.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && form.scrollWidth <= form.clientWidth;
      });
      assert.ok(fits, `${name}: controls stay within the viewport`);
      await page.screenshot({ path: path.join(OUT, `admin-unite-layers-${name}.png`) });
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (admin) await admin.close();
    if (srv) await srv.close();
    resetHostSettings();
    rmSync(dir, { recursive: true, force: true });
  }
});
