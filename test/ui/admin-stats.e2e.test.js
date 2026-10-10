// The console must keep different operators that reused one DIY slot separate in live and saved rankings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { TestClient } from '../helpers/wsClient.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

test('console statistics: reused DIY slot keeps separate operator names and damage in live and saved views', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-admin-stats-'));
  let srv, admin, client, browser;
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    await client.hello('Host');
    await client.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const { code } = await client.waitFor('room.state');
    await client.request({ t: 'room.start' });
    await client.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const m = srv.lobby.rooms.get(code).match;
    const playerId = m.order[0].playerId;
    m.round = 2;
    m.history = [
      { round: 1, enemy: null, players: [{ playerId, alive: true, lp: 28, funds: 10, level: 1, loss: 0, leaks: 0, kills: 1, roundDmg: 600, dmg: 600, spent: 0, perfect: true,
        units: [{ defId: 'chess_char_5_diy1_a', name: '推进之王', dmg: 600, kills: 1 }] }] },
      { round: 2, enemy: null, players: [{ playerId, alive: true, lp: 28, funds: 10, level: 1, loss: 0, leaks: 0, kills: 2, roundDmg: 400, dmg: 1000, spent: 0, perfect: true,
        units: [{ defId: 'chess_char_5_diy1_a', name: '灰烬', dmg: 400, kills: 2 }] }] },
    ];
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part="units"] li');
    const ranks = await page.$$eval('[data-part="units"] li', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(ranks, ['推进之王 600 伤害 · 1 击杀 · 1 场', '灰烬 400 伤害 · 2 击杀 · 1 场']);
    assert.equal(await page.$eval('[data-part="unitRounds"] tbody th', (el) => el.textContent), '灰烬');
    await page.select('[data-part="unitRounds"] select[data-k="round"]', '1');
    assert.equal(await page.$eval('[data-part="unitRounds"] tbody th', (el) => el.textContent), '推进之王');
    mkdirSync(OUT, { recursive: true });
    await page.$eval('[data-part="units"]', (el) => el.scrollIntoView());
    await page.screenshot({ path: path.join(OUT, 'admin-stat-names-desktop.png') });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(OUT, 'admin-stat-names-mobile.png') });
    m.finish({ victory: false, reason: 'admin' });
    await page.waitForSelector('button[data-open-record]');
    assert.deepEqual(await page.$$eval('[data-part="units"] li', (els) => els.map((e) => e.textContent.trim())), ranks);
    await page.click('button[data-open-record]');
    await page.waitForSelector('#record .units li');
    assert.deepEqual(await page.$$eval('#record .units li', (els) => els.map((e) => e.textContent.trim())), ranks);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (client) await client.close();
    if (admin) await admin.close();
    if (srv) await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
