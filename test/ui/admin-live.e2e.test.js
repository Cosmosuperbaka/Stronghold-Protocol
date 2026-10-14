import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('host live game: real UI, read-only gate, paid shopping, player switching, battle replica and layouts', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-live-ui-'));
  let browser, admin, h;
  try {
    h = makeMatch({ humans: 2, bots: 0, seed: 4242, clientCombat: true, clients: false, captureFrames: false }).start().toPrep();
    const m = h.m, ps = h.ps('p_0'); ps.funds = 100;
    const lobby = { rooms: new Map([['TEST', { code: 'TEST', match: m }]]), safeData: () => ({}), onMatchEnd() {} };
    admin = await startAdmin({ lobby, port: 0, resultsDir: path.join(dir, 'results'), replaysDir: path.join(dir, 'replays'),
      settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--no-first-run', '--disable-background-timer-throttling'] });
    const page = await browser.newPage(), errors = [], requests = [], sockets = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/live')) requests.push(JSON.parse(r.postData())); });
    const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', (e) => sockets.push(e.url));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.goto(admin.url + '/live?room=TEST&playerId=p_0', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.shopbar');
    await page.waitForSelector('#live-control:not([disabled])');
    // Exercise the transport used by the real controls and verify read-only blocks before HTTP.
    const module = '/js/ui/gameActions.js';
    assert.equal(await page.evaluate(async (url) => (await import(url)).actions.refresh(), module), false);
    assert.equal(requests.length, 0);
    await page.click('#live-control');
    const funds = ps.funds, price = ps.shop.freeRefreshes > 0 ? 0 : m.gd.refreshPrice;
    await page.click('.toolbtn--amber');
    await page.waitForFunction((funds) => document.querySelector('.funds__num')?.textContent === String(funds), {}, funds - price);
    assert.equal(ps.funds, funds - price);
    const slot = ps.shop.slots.findIndex((s) => s && s.kind === 'chess' && !s.sold);
    assert.ok(slot >= 0);
    await page.click(`.shopbar__cards .scard:nth-child(${slot + 1})`);
    await page.click(`.shopbar__cards .scard:nth-child(${slot + 1})`);
    await page.waitForFunction(() => document.querySelector('.shopbar__cards .scard--sold'));
    assert.ok(ps.hand.some(Boolean) || ps.board.size > 0);
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 4500)));
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' fits');
      await page.screenshot({ path: path.join(shots, `live-${name}.png`), fullPage: true });
    }
    await page.select('#live-player', 'p_1');
    await page.waitForFunction(() => document.querySelector('#live-status').textContent.includes('P1'));
    assert.equal(await page.$eval('#live-control', (el) => el.checked), false);
    await page.setViewport({ width: 1440, height: 900 });
    m.startCombat();
    await page.waitForFunction(() => globalThis.__SP_RUNNER__?.state()?.battleId, { timeout: 30000 });
    assert.equal(await page.evaluate(() => globalThis.__SP_RUNNER__.state().authoritative), false);
    assert.deepEqual(sockets, [], 'console creates no game WebSocket');
    assert.ok(requests.every((r) => r.intent.t.startsWith('g.')));
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2400)));
    await page.screenshot({ path: path.join(shots, 'live-battle.png'), fullPage: true });
    m.ended = true;
    await page.waitForFunction(() => !document.querySelector('#live-message').hidden);
    assert.equal(await page.$eval('#live-game', (el) => el.hidden), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await admin?.close(); h?.m.dispose(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
