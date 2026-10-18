import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { getData } from '../../server/data.js';
import { DEV_PAGES, DEV_SCENES } from '../../shared/devtools.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('developer mode lists all tools, remembers its state and opens a Chinese mock on the console port', {
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
  const target = browser.waitForTarget(t => t.url().includes('/dev/game-mock.html'));
  await page.click('#devtools-scenes a');
  const mock = await (await target).page();
  mock.on('pageerror', e => errors.push(e.message));
  await mock.waitForSelector('#mockbar button');
  assert.equal(await mock.$eval('#mockbar button', e => e.textContent), '确认本局信息');
  await mock.close();
  await page.click('[data-tab="server"]');
  await page.click('[data-tab="devtools"]');
  await page.waitForSelector('[data-devtool] a', { visible: true });
  await page.click('#devmode-toggle');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#devtools', e => e.hidden), true);
  assert.equal(await page.$eval('[data-tab="devtools"]', e => e.hidden), true);
  assert.deepEqual(errors, []);
});
