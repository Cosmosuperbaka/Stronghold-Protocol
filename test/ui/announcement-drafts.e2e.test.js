import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console drafts: template, safe preview, persistence, copy, guarded replacement, retry and deletion', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-notice-editor-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, studio: false });
  const admin = await startAdmin({ lobby: server.lobby, port: 0, settingsFile: path.join(dir, 'settings.json'), resultsDir: path.join(dir, 'results'), log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  mkdirSync('.cache/announcement-drafts', { recursive: true });
  try {
    const page = await browser.newPage(), errors = [], sent = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST') sent.push(new URL(r.url()).pathname); });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    const open = async () => { await page.click('[data-tab="server"]'); await page.waitForSelector('#site-notice-template', { visible: true }); };
    const press = action => page.click(`[data-notice-editor="${action}"]`);
    const edit = async (selector, value) => page.$eval(selector, (el, value) => { el.value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, value);
    const save = async action => { await press(action); await page.waitForFunction(() => document.querySelector('#site-notice-draft-status').textContent.includes('草稿已保存到服务器')); };
    await open();
    assert.equal(await page.$$eval('#site-notice-template option', v => v.length), 5);
    await page.select('#site-notice-template', 'rules'); await press('template');
    await page.waitForSelector('#site-notice-preview table');
    await edit('#site-notice-draft-title', '规则草稿');
    await page.select('#site-notice-delay', '600000');
    await save('save');
    const firstId = await page.$eval('#site-notice-drafts', e => e.value);
    assert.equal(server.lobby.announcements.frame().announcement, null);
    await page.reload({ waitUntil: 'domcontentloaded' }); await open();
    await page.waitForFunction(() => document.querySelector('#site-notice-drafts').options.length === 2);
    await page.select('#site-notice-drafts', firstId); await press('load');
    await page.waitForSelector('#site-notice-preview table');
    assert.equal(await page.$eval('#site-notice-delay', e => e.value), '600000');
    const source = ['# 预览标题', '', '**加粗**', '', '| 列 | 内容 |', '| --- | --- |', '| 项目 | 值 |', '', '<script>window.__NOTICE_XSS__=true</script>', '', '![图片](https://example.com/tracker.png)', '', '[危险](javascript:alert(1))', '', '```text', 'long'.repeat(100), '```'].join(String.fromCharCode(10));
    await edit('#site-notice-text', source);
    await page.waitForSelector('#site-notice-preview h1');
    assert.equal(await page.$('#site-notice-preview script, #site-notice-preview img, #site-notice-preview a'), null);
    assert.equal(await page.evaluate(() => globalThis.__NOTICE_XSS__), undefined);
    assert.ok((await page.$eval('#site-notice-preview', e => e.textContent)).includes('<script>'));
    await page.select('#site-notice-template', 'maintenance');
    page.once('dialog', dialog => dialog.dismiss()); await press('template');
    assert.equal(await page.$eval('#site-notice-text', e => e.value), source);
    await edit('#site-notice-draft-title', '规则副本'); await save('new');
    assert.equal(await page.$$eval('#site-notice-drafts option', e => e.length), 3);
    await page.select('#site-notice-format', 'plain');
    await page.waitForFunction(() => !document.querySelector('#site-notice-preview h1'));
    assert.match(await page.$eval('#site-notice-preview', e => e.textContent), /^# 预览标题/);
    await page.select('#site-notice-format', 'markdown');
    let fail = true;
    await page.setRequestInterception(true);
    page.on('request', r => fail && r.method() === 'POST' && r.url().endsWith('/api/announcement-drafts') ? r.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '测试磁盘错误' }) }) : r.continue());
    await edit('#site-notice-draft-title', '保存失败重试'); await press('save');
    await page.waitForFunction(() => document.querySelector('#site-notice-draft-status').textContent.includes('测试磁盘错误'));
    assert.equal(await page.$eval('#site-notice-text', e => e.value), source);
    fail = false; await save('save');
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await page.$eval('#site-notice-preview', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
      await page.$eval('#site-announcement', e => e.scrollIntoView());
      await page.screenshot({ path: `.cache/announcement-drafts/console-${width}.png`, fullPage: true });
    }
    page.once('dialog', dialog => dialog.accept()); await press('delete');
    await page.waitForFunction(() => document.querySelector('#site-notice-draft-status').textContent.includes('草稿已删除'));
    assert.equal(await page.$eval('#site-notice-text', e => e.value), source);
    assert.equal(server.lobby.announcements.frame().announcement, null);
    assert.ok(!sent.includes('/api/action'), 'draft actions never call the announcement publish endpoint');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await admin.close(); server.server.closeAllConnections(); await server.close(); rmSync(dir, { recursive: true, force: true });
  }
});
