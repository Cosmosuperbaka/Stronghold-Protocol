import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { resetHostSettings } from '../../server/match/hostSettings.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

test('shared round chart: live game, console, noStack filtering, settings persistence and desktop/mobile layouts', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 180000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-round-chart-'));
  let admin, browser;
  resetHostSettings();
  const h = makeMatch({ humans: 2, fake: true, seed: 4242 }).start().toPrep();
  try {
    const m = h.m;
    const lobby = { rooms: new Map([['TEST', { code: 'TEST', mode: 'coop', seats: [], spectators: [], match: m }]]),
      safeData: () => m.data, onMatchEnd() {} };
    const settingsFile = path.join(dir, 'settings.json');
    admin = await startAdmin({ lobby, port: 0, resultsDir: dir, settingsFile, log: { info() {}, error() {} } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.goto(admin.url + '/live?room=TEST&playerId=p_0', { waitUntil: 'domcontentloaded' });
    const button = 'button[aria-controls="round-history-panel"]', panel = '#round-history-panel';
    await page.waitForSelector(button); await page.click(button);
    await page.waitForFunction(() => document.querySelector('#round-history-panel')?.textContent.includes('第一回合结算后'));
    m.history = [1, 2].map((round) => ({ round, players: m.order.map((ps, i) => ({
      playerId: ps.playerId, alive: true, lp: 30 - round * i, funds: 10, spent: round * 5, dmg: 100 * round,
      roundDmg: 100, level: 2, income: 9, expense: 5,
      units: Array.from({ length: 6 }, (_, u) => ({ defId: `op-${u}`, name: `干员${i}-${u}`, dmg: (u + 1) * round * (i + 1) * 100, kills: u })),
      bonds: [{ id: 'yanShip', name: '炎', active: true, layers: 10 * round },
        { id: 'soloShip', name: '独行', active: true, layers: 9 },
        { id: 'plugin-bond', name: '不可叠层插件盟约', active: true, noStack: true, layers: 9 }],
    })) }));
    await page.waitForSelector(`${panel} .chart-wrap svg`);
    await page.waitForSelector('.gm__loading', { hidden: true, timeout: 30000 });
    const options = await page.$$eval(`${panel} option`, (es) => es.map((e) => e.value));
    assert.ok(options.includes('bond:yanShip'));
    assert.ok(!options.includes('bond:soloShip') && !options.includes('bond:plugin-bond'));
    await page.focus(`${panel} select`);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval(`${panel} select`, (e) => e === document.activeElement), true, 'metric redraw preserves keyboard focus');
    await page.select(`${panel} select`, 'bond:yanShip');
    await page.focus(`${panel} .row button`); await page.keyboard.press('Enter');
    assert.equal(await page.$eval(`${panel} .row button`, (e) => e === document.activeElement), true, 'table redraw preserves keyboard focus');
    assert.deepEqual(await page.$$eval(`${panel} tbody td`, (es) => es.map((e) => e.textContent)), ['10', '10', '20', '20']);
    await page.click(`${panel} .row button`);
    await page.select(`${panel} select`, 'income');
    // Repeated public views must not replace a focused control or lose the selected metric.
    await page.focus(`${panel} select`);
    const metricControl = await page.$(`${panel} select`), metricOption = await page.$(`${panel} option[value="income"]`);
    m.history[1].players[0].income = 19;
    m.history[1].players[0].bonds.push({ id: 'metric-refresh-bond', name: '刷新盟约', active: true, layers: 7 });
    await page.waitForFunction(() => [...document.querySelectorAll('#round-history-panel svg text')].some((e) => e.textContent === '20'));
    assert.equal(await metricControl.evaluate((el) => el.isConnected && el === document.activeElement && el.value === 'income'), true,
      'history updates retain the same focused metric select');
    assert.equal(await metricOption.evaluate((el) => el.isConnected), true, 'history updates retain native options while choosing');
    assert.equal(await page.$(`${panel} option[value="bond:metric-refresh-bond"]`), null, 'new metric options wait until choosing finishes');
    await page.focus(`${panel} .row button`); await page.keyboard.press('Enter');
    await page.waitForSelector(`${panel} option[value="bond:metric-refresh-bond"]`);
    assert.deepEqual(await page.$$eval(`${panel} tbody td`, (es) => es.map((e) => e.textContent)), ['9', '9', '19', '9'],
      'table toggle uses the latest history after a live update');
    await page.click(`${panel} .row button`);
    await metricControl.dispose(); await metricOption.dispose();
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['landscape', 844, 390]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.$eval(panel, (e) => { const r = e.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      }), name);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' has no page overflow');
      await page.screenshot({ path: path.join(OUT, `round-history-${name}.png`) });
    }
    await page.click(`${panel} .round-history__tabs button:nth-child(2)`);
    await page.waitForSelector(`${panel} select[data-k="round"]`);
    assert.equal(await page.$$eval(`${panel} tbody tr`, (es) => es.length), 10);
    assert.equal(await page.$eval(`${panel} tbody th`, (e) => e.textContent), '干员1-5');
    await page.click(`${panel} .row button`);
    assert.equal(await page.$$eval(`${panel} tbody tr`, (es) => es.length), 12);
    await page.select(`${panel} select[data-k="round"]`, '1');
    await page.select(`${panel} select[data-k="player"]`, 'p_0');
    assert.equal(await page.$$eval(`${panel} tbody tr`, (es) => es.length), 6);
    assert.equal(await page.$eval(`${panel} tbody tr td:nth-child(4)`, (e) => e.textContent), '600');
    await page.select(`${panel} select[data-k="round"]`, '2');
    await page.click(`${panel} button[data-k="cumulative"]`);
    assert.equal(await page.$eval(`${panel} tbody tr td:nth-child(4)`, (e) => e.textContent), '1,800');
    assert.match(await page.$eval(`${panel} caption`, (e) => e.textContent), /累计至第 2 回合/);
    await page.click(`${panel} button[data-k="cumulative"]`);
    await page.select(`${panel} select[data-k="round"]`, '1');
    await page.click(`${panel} .round-history__tabs button:first-child`);
    await page.waitForSelector(`${panel} .chart-wrap`);
    assert.equal(await page.$eval(`${panel} select`, (e) => e.value), 'income', 'curve selection survives switching tabs');
    await page.click(`${panel} .round-history__tabs button:nth-child(2)`);
    await page.waitForSelector(`${panel} select[data-k="round"]`);
    assert.equal(await page.$eval(`${panel} select[data-k="round"]`, (e) => e.value), '1');
    assert.equal(await page.$eval(`${panel} select[data-k="player"]`, (e) => e.value), 'p_0');
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['landscape', 844, 390]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.$eval(panel, (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
      await page.screenshot({ path: path.join(OUT, `round-ranking-${name}.png`) });
    }
    const chessId = Object.keys(m.data.chess)[0];
    m.phase = 'COMBAT'; m.round = 3;
    m.fields = [{ cc: true, mode: 'client', kind: 'normal', players: ['p_0'],
      progress: { killed: 0, total: 1, damage: [{ playerId: 'p_0', damageDealt: 4321, units: [{ uid: 7, dmg: 4321, kills: 1 }] }] },
      spec: { players: [{ playerId: 'p_0', units: [{ uid: 7, chessId }] }] } }];
    await page.waitForFunction(() => !!document.querySelector('#round-history-panel option[value="3"]'));
    await page.select(`${panel} select[data-k="round"]`, '3');
    await page.waitForFunction(() => document.querySelector('#round-history-panel tbody tr td:nth-child(4)')?.textContent === '4,321');
    assert.match(await page.$eval(`${panel} .round-history__live`, (e) => e.textContent), /实时更新/);
    await page.focus(`${panel} button[data-k="cumulative"]`);
    m.fields[0].progress.damage[0].units[0].dmg = 5432;
    m.fields[0].progress.damage[0].damageDealt = 5432;
    await page.waitForFunction(() => document.querySelector('#round-history-panel tbody tr td:nth-child(4)')?.textContent === '5,432');
    assert.equal(await page.$eval(`${panel} button[data-k="cumulative"]`, (e) => e === document.activeElement), true, 'live updates preserve the focused toggle');
    await page.focus(`${panel} select[data-k="round"]`);
    const roundControl = await page.$(`${panel} select[data-k="round"]`);
    m.fields[0].progress.damage[0].units[0].dmg = 6543;
    await page.waitForFunction(() => document.querySelector('#round-history-panel tbody tr td:nth-child(4)')?.textContent === '6,543');
    assert.equal(await roundControl.evaluate((el) => el.isConnected && el === document.activeElement), true, 'live updates retain the same native select node');
    await page.select(`${panel} select[data-k="round"]`, '1');
    assert.equal(await page.$eval(`${panel} tbody tr td:nth-child(4)`, (e) => e.textContent), '600');
    await roundControl.dispose();
    m.fields = []; m.phase = 'PREP'; m.round = 2;
    const settings = page;
    settings.setDefaultTimeout(10000);
    settings.on('pageerror', (e) => errors.push(e.message));
    await settings.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await settings.waitForSelector('[data-open-room]'); await settings.click('[data-open-room]');
    await settings.click('[data-room-tab="data"]');
    await settings.waitForSelector('[data-part="chart"] svg');
    assert.ok(!await settings.$('[data-part="chart"] option[value="bond:soloShip"]'));
    assert.ok(!await settings.$('[data-part="chart"] option[value="bond:plugin-bond"]'));
    await settings.select('[data-part="chart"] select', 'bond:yanShip');
    await settings.click('[data-part="chart"] button');
    assert.deepEqual(await settings.$$eval('[data-part="chart"] tbody td', (es) => es.map((e) => e.textContent)), ['10', '10', '20', '20']);
    await settings.click('[data-tab="settings"]');
    await settings.waitForSelector('#round-charts-enabled');
    await settings.click('#live-round-damage');
    await settings.click('[data-round-charts-save]');
    await settings.waitForFunction(() => document.querySelector('#round-charts-saved').textContent.includes('已保存'));
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).liveRoundDamage, false);
    await settings.click('#live-round-damage');
    assert.equal(await settings.$eval('#round-charts-enabled', (e) => e.checked), true);
    await settings.click('#round-charts-enabled');
    await settings.click('[data-round-charts-reset]');
    assert.equal(await settings.$eval('#round-charts-enabled', (e) => e.checked), true);
    await settings.click('#round-charts-enabled'); await settings.click('[data-round-charts-save]');
    await settings.waitForFunction(() => document.querySelector('#round-charts-saved').textContent.includes('已保存'));
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).roundCharts, false);
    await settings.reload({ waitUntil: 'domcontentloaded' }); await settings.click('[data-tab="settings"]');
    await settings.waitForSelector('#round-charts-enabled');
    assert.equal(await settings.$eval('#round-charts-enabled', (e) => e.checked), false);
    await settings.click('#round-charts-enabled'); await settings.click('[data-round-charts-save]');
    await settings.waitForFunction(() => document.querySelector('#round-charts-saved').textContent.includes('已保存'));
    await page.goto(admin.url + '/live?room=TEST&playerId=p_0', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(button); await page.click(button);
    await page.waitForSelector(`${panel} .chart-wrap svg`);
    const save = async (roundCharts) => page.evaluate(async (value) => (await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': document.querySelector('meta[name="admin-token"]').content },
      body: JSON.stringify({ roundCharts: value }),
    })).json(), roundCharts);
    assert.equal((await save(false)).ok, true);
    await page.waitForFunction(() => !document.querySelector('[aria-controls="round-history-panel"]') && !document.querySelector('#round-history-panel'));
    assert.equal((await save(true)).ok, true);
    await page.waitForSelector(button); await page.click(button);
    await page.waitForSelector(`${panel} .chart-wrap svg`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#round-history-panel'));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await admin?.close(); h.m.dispose(); resetHostSettings();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
