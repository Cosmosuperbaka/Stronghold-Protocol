// Real browser controls against the update backend with tiny mocked release downloads; never updates this checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startAdmin } from '../../server/admin.js';
import { updatePaths } from '../../server/release-update.js';
import { CHROME, hasChrome, ROOT } from '../e2e/client.mjs';
import { tag, releaseFor, put } from '../helpers/release-fixture.js';
import { APP_VERSION } from '../../shared/constants.js';
import { RELEASE_TAG } from '../../server/release-version.js';

test('console Release updates: check/retry, confirmation/cancel, progress, restart token refresh, desktop/mobile', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 45000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-update-ui-'));
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION }));
  const staticOptions = { publicDir: path.join(ROOT, 'public'), sharedDir: path.join(ROOT, 'shared') };
  const lobby = { rooms: new Map(), safeData: () => ({}), onMatchEnd() {}, staticOptions };
  let admin, browser, failed = true, downloads = 0, complete, restart = false;
  let options;
  const onReady = async () => {
    if (!restart) return;
    put(root, 'logs/release-version.json', JSON.stringify({ app: APP_VERSION, tag }));
    const port = admin.port;
    await admin.close();
    admin = await startAdmin({ ...options, port });
  };
  options = { lobby, port: 0, root, resultsDir: path.join(root, 'records'), settingsFile: path.join(root, 'logs', 'settings.json'), onUpdateReady: onReady,
    log: { warn() {}, error() {}, info() {} }, updateOptions: {
      fetchImpl: async () => failed ? new Response('', { status: 403 }) : new Response(JSON.stringify([releaseFor(), releaseFor(undefined, 'v0.2.5-extended.1'), releaseFor(undefined, 'v0.2.5')])),
      stageRelease: async ({ progress }) => {
        downloads++; progress({ state: 'downloading', received: 1000, size: 2000 });
        return new Promise((r) => { complete = () => r({ stage: root, tag }); });
      }, schedule: async () => {},
    } };
  try {
    admin = await startAdmin(options);
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('[data-update-check]:not([disabled])');
    assert.equal(await page.$eval('[data-update-install]', (el) => el.disabled), true);
    await page.click('[data-update-check]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('403'));
    failed = false;
    await page.click('[data-update-check]');
    await page.waitForSelector('[data-update-install]:not([disabled])');
    await page.click('#release-update summary');
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.$eval('#release-update', (el) => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth), `${name} update controls fit`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} page fits`);
      await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
    }
    lobby.rooms.set('TEST', { match: { ended: false } });
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('进行的对局'));
    assert.equal(downloads, 0, 'cancel never downloads');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('正在下载'));
    assert.equal(downloads, 1);
    assert.equal(await page.$eval('[data-update-install]', (el) => el.disabled), true);
    await page.click('[data-tab="rooms"]'); await page.click('[data-tab="settings"]');
    try { await page.waitForFunction(() => document.querySelector('#release-update-state')?.textContent.includes('正在下载')); }
    catch (e) {
      const response = await fetch(admin.url + '/api/update', { headers: { 'x-admin-token': admin.token } });
      const state = await response.text();
      const text = await page.$eval('body', el => el.innerText);
      throw new Error(JSON.stringify({ state, text, errors }), { cause: e });
    }
    lobby.rooms.clear(); restart = true; complete();
    try { await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('即将重启')); }
    catch (e) {
      const response = await fetch(admin.url + '/api/update', { headers: { 'x-admin-token': admin.token } });
      const state = await response.text();
      const text = await page.$eval('#release-update', el => el.innerText);
      throw new Error(JSON.stringify({ state, text, errors }), { cause: e });
    }
    try { await page.waitForSelector('[data-tab="rooms"][aria-pressed="true"]', { timeout: 10000 }); }
    catch (e) {
      const debug = await page.evaluate(() => ({ url: location.href, text: document.body.innerText, tabs: [...document.querySelectorAll('[data-tab]')].map((b) => [b.dataset.tab, b.getAttribute('aria-pressed')]) }));
      throw new Error(JSON.stringify({ debug, actualToken: admin.token, versionExists: fs.existsSync(updatePaths(root).version) }), { cause: e });
    }
    await page.click('[data-tab="settings"]');
    await page.waitForFunction((tag) => document.querySelector('#release-update').textContent.includes(tag), {}, tag);
    assert.deepEqual(errors, []);
    assert.equal(JSON.parse(fs.readFileSync(updatePaths(root).version)).tag, tag);
  } finally {
    restart = false;
    if (browser) await browser.close();
    if (admin) await admin.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('console first-open update prompt, refresh deduplication, version choice, downgrade cancellation and saved proxy settings', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 30000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-update-open-ui-'));
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION }));
  let browser, admin, queries = 0, downloads = 0;
  try {
    admin = await startAdmin({ lobby: { rooms: new Map(), safeData: () => ({}), onMatchEnd() {},
      staticOptions: { publicDir: path.join(ROOT, 'public'), sharedDir: path.join(ROOT, 'shared') } }, port: 0, root,
      resultsDir: root, settingsFile: path.join(root, 'settings.json'), onUpdateReady() {}, updateOptions: {
        fetchImpl: async () => { queries++; return new Response(JSON.stringify([releaseFor(), releaseFor(undefined, 'v0.2.5'), releaseFor(undefined, RELEASE_TAG)])); },
        stageRelease: async () => { downloads++; throw new Error('test stops before install'); },
      } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), prompts = [], errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', async (dialog) => { prompts.push(dialog.message()); if (dialog.message().startsWith('发现新版本')) await dialog.accept(); else await dialog.dismiss(); });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('dialog.release-notes[open]');
    assert.match(await page.$eval('dialog.release-notes .release-notes__body', el => el.textContent), /发现新版本/);
    await page.click('dialog.release-notes .release-notes__button--primary');
    await page.waitForSelector('[data-tab="settings"][aria-pressed="true"]');
    await page.waitForSelector('#release-version-select');
    assert.equal(queries, 1); assert.equal(prompts.length, 0);
    const choices = await page.$$eval('#release-version-select option', (els) => els.map((el) => el.textContent));
    assert.ok(choices.some((s) => s.includes('新版本')));
    assert.ok(choices.some((s) => s.includes('当前版本')));
    assert.ok(choices.some((s) => s.includes('旧版本')));
    await page.select('#release-version-select', 'v0.2.5');
    assert.equal(await page.$eval('[data-update-install]', (el) => el.textContent), '回退并重启');
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('[data-update-install]').disabled === false);
    assert.equal(downloads, 0); assert.match(prompts[0], /回退到 v0.2.5/);
    await page.click('#release-update summary');
    await page.$eval('#update-proxy', (el) => { el.value = 'socks5://127.0.0.1:7890'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('[data-update-network-save]');
    await page.waitForFunction(() => document.querySelector('#update-network-feedback').textContent.includes('HTTP/HTTPS'));
    assert.equal(await page.$eval('#update-proxy', (el) => el.value), 'socks5://127.0.0.1:7890', 'failed save retains draft');
    await page.$eval('#update-proxy', (el) => { el.value = 'http://127.0.0.1:7890'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('[data-update-network-save]');
    await page.waitForFunction(() => document.querySelector('#update-network-feedback').textContent === '已保存');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="settings"]');
    await page.waitForFunction(() => document.querySelector('#update-proxy')?.value === 'http://127.0.0.1:7890/');
    assert.equal(queries, 1, 'page refresh does not query GitHub again');
    assert.equal(prompts.length, 1, 'page refresh does not repeat update reminder');
    assert.equal(await page.$('dialog.release-notes[open]'), null);
    assert.deepEqual(errors, []);
    assert.equal(JSON.parse(fs.readFileSync(updatePaths(root).network)).proxy, 'http://127.0.0.1:7890/');
    await page.select('#release-version-select', RELEASE_TAG);
    assert.equal(await page.$eval('[data-update-install]', el => el.textContent), '修复素材并重启');
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('test stops before install'));
    assert.equal(downloads, 1, 'current-version repair reaches the real authenticated install API');
  } finally {
    if (browser) await browser.close();
    if (admin) await admin.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
