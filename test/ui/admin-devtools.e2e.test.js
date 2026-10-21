import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { getData } from '../../server/data.js';
import { DEV_PAGES, DEV_SCENES } from '../../shared/devtools.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('developer tools reuse previews, preserve explicit new tabs and recover closed or blocked previews', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-devtools-'));
  const admin = await startAdmin({ lobby: { rooms: new Map(), safeData: getData, onMatchEnd() {} }, port: 0,
    resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} },
    updateOptions: { fetchImpl: async () => new Response('[]') } });
  let browser;
  t.after(async () => { await browser?.close(); await admin.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--mute-audio'] });
  assert.equal((await fetch(admin.url + '/api/devtools')).status, 403);
  assert.equal((await fetch(admin.url + '/dev/game-mock.html')).status, 404);
  const catalogue = await fetch(admin.url + '/api/devtools', { headers: { 'X-Admin-Token': admin.token } }).then(r => r.json());
  assert.equal(catalogue.pages.length, fs.readdirSync('public/dev').filter(f => f.endsWith('.html')).length);
  assert.ok(catalogue.pages.every(p => p.available));
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(admin.url, { waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#devtools', e => e.hidden), true);
  await page.click('#devmode-toggle');
  await page.waitForSelector('[data-devtool] a', { visible: true });
  assert.equal(await page.$$eval('[data-devtool]', es => es.length), DEV_PAGES.length);
  assert.equal(await page.$$eval('#devtools-scenes a', es => es.length), DEV_SCENES.length);
  assert.ok(await page.$$eval('#devtools a', es => es.every(e => new URL(e.href).origin === location.origin)));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-devtool] a', { visible: true });
  const out = path.resolve('.cache/console-ui'); fs.mkdirSync(out, { recursive: true });
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.screenshot({ path: path.join(out, `admin-devtools-${width}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `layout at ${width}px`);
  }
  const previewPages = async () => (await browser.pages()).filter(p => p.url().startsWith(admin.url + '/dev/'));
  const openPreview = async (selector, options) => {
    await page.bringToFront();
    const known = new Set(browser.targets());
    const target = browser.waitForTarget(t => !known.has(t) && t.url().startsWith(admin.url + '/dev/'));
    await page.click(selector, options);
    return (await target).page();
  };
  const mock = await openPreview('#devtools-scenes a');
  mock.on('pageerror', e => errors.push(e.message));
  await mock.waitForSelector('#mockbar button');
  assert.equal(await mock.$eval('#mockbar button', e => e.textContent), '确认本局信息');
  assert.equal(await mock.evaluate(() => window.opener === null), true);
  await mock.evaluate(() => { globalThis.__previewReuseMarker = true; });
  await page.bringToFront();
  await page.click('#devtools-scenes a');
  assert.equal((await previewPages()).length, 1, 'repeated clicks reuse the mock');
  assert.equal(await mock.evaluate(() => globalThis.__previewReuseMarker), true, 'the same scene keeps its state');
  await page.bringToFront();
  await page.click('#devtools-scenes a:nth-child(2)');
  await mock.waitForFunction(() => new URLSearchParams(location.search).get('phase') === 'BAND_DRAFT');
  assert.equal((await previewPages()).length, 1, 'another scene navigates the existing mock');
  const uikitLink = '[data-devtool="uikit.html"] a';
  const uikit = await openPreview(uikitLink);
  await uikit.waitForFunction(() => document.title.startsWith('UI Kit'));
  assert.equal(await uikit.evaluate(() => window.opener === null), true);
  await page.bringToFront();
  await page.click(uikitLink);
  assert.equal((await previewPages()).length, 2, 'different tools keep separate reusable previews');
  const extra = await openPreview(uikitLink, { button: 'middle' });
  assert.equal((await previewPages()).length, 3, 'middle click deliberately opens another preview');
  await extra.close();
  await page.keyboard.down('Control');
  let modified;
  try { modified = await openPreview(uikitLink); }
  finally { await page.keyboard.up('Control'); }
  assert.equal((await previewPages()).length, 3, 'Ctrl click deliberately opens another preview');
  await modified.close();
  await page.bringToFront();
  await page.click('[data-tab="server"]');
  await page.click('[data-tab="devtools"]');
  await page.waitForSelector('[data-devtool] a', { visible: true });
  await page.click('#devtools-scenes a:nth-child(2)');
  assert.equal((await previewPages()).length, 2, 'redrawing the tool list keeps its preview references');
  await mock.close();
  const reopened = await openPreview('#devtools-scenes a');
  await reopened.waitForSelector('#mockbar button');
  assert.equal((await previewPages()).length, 2, 'a closed preview can be reopened');
  await reopened.close();
  await uikit.goto('data:text/html,<title>Unrelated page</title>');
  const isolated = await openPreview(uikitLink);
  assert.ok(uikit.url().startsWith('data:'), 'a preview navigated to another origin is left alone');
  assert.equal(await isolated.evaluate(() => window.opener === null), true);
  await isolated.close();
  await uikit.close();
  await page.evaluate(() => { globalThis.__originalOpen = window.open; window.open = () => null; });
  const fallback = await openPreview(uikitLink);
  await page.evaluate(() => { window.open = globalThis.__originalOpen; delete globalThis.__originalOpen; });
  assert.equal(await fallback.evaluate(() => window.opener === null), true, 'native fallback retains opener isolation');
  await fallback.close();
  await page.bringToFront();
  await page.click('#devmode-toggle');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#devtools', e => e.hidden), true);
  assert.equal(await page.$eval('[data-tab="devtools"]', e => e.hidden), true);
  assert.deepEqual(errors, []);
});
