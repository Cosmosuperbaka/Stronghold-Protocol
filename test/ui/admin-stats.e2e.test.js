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

test('console statistics: live and saved DIY names, leak details, economy, bond layers and summary filters', {
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
        units: [{ defId: 'chess_char_5_diy1_a', name: '灰烬', dmg: 400, kills: 2 }],
        income: 9, expense: 3,
        economy: { opening: 4, closing: 10, income: { income: 6, sell: 3 }, expense: { buy: 2, refresh: 1 }, refreshes: 1, buys: 1, sells: 1 },
        bonds: [{ id: 'test-bond', name: '测试盟约', active: true, layers: 4, tier: 2 }],
        leakDetails: [
          { kind: 'normal', loss: 1, enemies: [{ name: '<虫>', count: 2, counted: 1, leakLp: 1 }] },
          { kind: 'unite', loss: 2, enemies: [{ name: '源石虫', count: 2, counted: 2, leakLp: 2 }] },
          { kind: 'boss', loss: null, teamLoss: 5, enemies: [{ name: '领袖召唤物', count: 1, counted: 1, leakLp: 3 }] },
        ] }] },
    ];
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(10000);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-open-room]'); await page.click('[data-open-room]');
    await page.click('[data-room-tab="data"]');
    await page.waitForSelector('[data-part="units"] li');
    const ranks = await page.$$eval('[data-part="units"] li', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(ranks, ['推进之王 600 伤害 · 1 击杀 · 1 场', '灰烬 400 伤害 · 2 击杀 · 1 场']);
    assert.equal(await page.$eval('[data-part="unitRounds"] tbody th', (el) => el.textContent), '灰烬');
    await page.select('[data-part="unitRounds"] select[data-k="round"]', '1');
    assert.equal(await page.$eval('[data-part="unitRounds"] tbody th', (el) => el.textContent), '推进之王');
    const checkDetails = async (root = '') => {
      const part = (name) => `${root} [data-part="${name}"]`.trim();
      const leaks = await page.$eval(part('leaks'), (el) => el.textContent);
      assert.match(leaks, /旧记录无漏怪明细/);
      assert.match(leaks, /<虫> ×2（计入 1）/);
      assert.match(leaks, /全队损失 5；本玩家漏怪 LP 3/);
      assert.match(leaks, /源石虫 · 联防 · 2 只 · 回合 2/);
      assert.equal(await page.$(`${part('leaks')} 虫`), null, 'enemy names render as text');
      const rounds = part('rounds');
      assert.match(await page.$eval(rounds, (el) => el.textContent), /期初 4 → 结余 10；收入 基础收入 6、出售 3；支出 购买 2、刷新 1；刷新 1 \/ 购买 1 \/ 出售 1/);
      assert.match(await page.$eval(rounds, (el) => el.textContent), /测试盟约 4 层 \/ 档位 2/);
      await page.select(`${rounds} select`, '1');
      assert.match(await page.$eval(rounds, (el) => el.textContent), /旧记录无经济明细/);
      await page.select(`${rounds} select`, '2');
      const chart = part('chart');
      await page.select(`${chart} select`, 'income');
      await page.click(`${chart} button`);
      assert.deepEqual(await page.$$eval(`${chart} tbody td`, (els) => els.map((el) => el.textContent)), ['—', '9']);
      await page.select(`${chart} select`, 'expense');
      assert.deepEqual(await page.$$eval(`${chart} tbody td`, (els) => els.map((el) => el.textContent)), ['—', '3']);
      await page.select(`${chart} select`, 'bond:test-bond');
      assert.deepEqual(await page.$$eval(`${chart} tbody td`, (els) => els.map((el) => el.textContent)), ['—', '4']);
      await page.click(`${root} details:has(> [data-part="leaks"]) > summary`.trim());
    };
    await checkDetails();
    mkdirSync(OUT, { recursive: true });
    await page.$eval('[data-part="units"]', (el) => el.scrollIntoView());
    await page.screenshot({ path: path.join(OUT, 'admin-stat-names-desktop.png') });
    await page.setViewport({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'live statistics fit mobile width');
    await page.screenshot({ path: path.join(OUT, 'admin-stat-names-mobile.png') });
    m.finish({ victory: false, reason: 'admin' });
    await page.waitForSelector('button[data-open-record]');
    assert.deepEqual(await page.$$eval('[data-part="units"] li', (els) => els.map((e) => e.textContent.trim())), ranks);
    await page.click('button[data-open-record]');
    await page.waitForSelector('#record .units li');
    assert.deepEqual(await page.$$eval('#record .units li', (els) => els.map((e) => e.textContent.trim())), ranks);
    await page.setViewport({ width: 1440, height: 1000 });
    await checkDetails('#record');
    await page.$eval('#record [data-part="leaks"]', (el) => el.scrollIntoView());
    await page.screenshot({ path: path.join(OUT, 'admin-stat-details-desktop.png') });
    await page.setViewport({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'saved statistics fit mobile width');
    await page.screenshot({ path: path.join(OUT, 'admin-stat-details-mobile.png') });
    await page.click('[data-tab="records"]');
    await page.waitForFunction(() => document.querySelector('#summary-data')?.textContent.includes('1 局 · 0 胜'));
    assert.match(await page.$eval('#summary-data', (el) => el.textContent), /测试盟约 · 1 局/);
    assert.match(await page.$eval('#summary-data', (el) => el.textContent), /推进之王 · 600/);
    await page.select('#summary-mode', 'coop');
    await page.click('[data-summary-filter]');
    await page.waitForFunction(() => document.querySelector('#summary-data').textContent.includes('0 局 · 0 胜'));
    await page.select('#summary-mode', 'solo');
    await page.click('[data-summary-filter]');
    await page.waitForFunction(() => document.querySelector('#summary-data').textContent.includes('1 局 · 0 胜'));
    await page.type('#summary-difficulty', 'IMPOSSIBLE');
    await page.click('[data-summary-filter]');
    await page.waitForFunction(() => document.querySelector('#summary-data').textContent.includes('0 局 · 0 胜'));
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (client) await client.close();
    if (admin) await admin.close();
    if (srv) await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
