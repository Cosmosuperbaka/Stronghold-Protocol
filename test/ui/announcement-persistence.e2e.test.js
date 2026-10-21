import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console notice persistence: opt-in, save/reload, failed save retry and responsive controls', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notice-persist-ui-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, studio: false });
  const admin = await startAdmin({ lobby: server.lobby, port: 0, resultsDir: path.join(dir, 'results'), settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  fs.mkdirSync('.cache/notice-persistence', { recursive: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    const open = async () => {
      await page.click('[data-tab="server"]');
      await page.waitForFunction(() => !document.querySelector('#site-notice-persist').disabled);
    };
    await open();
    assert.equal(await page.$eval('#site-notice-persist', e => e.checked), true);
    await page.click('#site-notice-persist'); await page.click('#site-notice-persist-save');
    await page.waitForFunction(() => document.querySelector('#site-notice-persist-status').textContent.includes('重启后不恢复'));
    const now = Date.now();
    server.lobby.announcements.set({ text: '保留测试', level: 'info', startAt: now, endAt: now + 60000 });
    const original = server.lobby.announcements.frame().announcement;
    await page.click('#site-notice-persist');
    assert.equal(server.lobby.announcements.persistEnabled, false, 'editing is not saving');
    await page.click('#site-notice-persist-save');
    await page.waitForFunction(() => document.querySelector('#site-notice-persist-status').textContent.startsWith('已保存'));
    assert.equal(server.lobby.announcements.persistEnabled, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'announcement-state.json'), 'utf8')).notice, original);
    await page.reload({ waitUntil: 'domcontentloaded' }); await open();
    assert.equal(await page.$eval('#site-notice-persist', e => e.checked), true);
    let fail = true;
    await page.setRequestInterception(true);
    page.on('request', r => fail && r.method() === 'POST' && r.url().endsWith('/api/announcement-persistence')
      ? r.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模拟写入失败' }) }) : r.continue());
    await page.click('#site-notice-persist'); await page.click('#site-notice-persist-save');
    await page.waitForFunction(() => document.querySelector('#site-notice-persist-status').textContent.includes('模拟写入失败'));
    assert.equal(server.lobby.announcements.persistEnabled, true);
    fail = false; await page.click('#site-notice-persist-save');
    await page.waitForFunction(() => document.querySelector('#site-notice-persist-status').textContent.includes('重启后不恢复'));
    assert.equal(server.lobby.announcements.persistEnabled, false);
    assert.deepEqual(server.lobby.announcements.frame().announcement, original, 'disabling never withdraws the current notice');
    for (const [width, height] of [[1280, 900], [390, 844]]) {
      await page.setViewport({ width, height });
      await page.$eval('#site-notice-persist', e => e.scrollIntoView({ block: 'center' }));
      assert.ok(await page.$eval('#site-notice-persist-save', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
      await page.screenshot({ path: `.cache/notice-persistence/console-${width}.png` });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await admin.close(); server.server.closeAllConnections(); await server.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
