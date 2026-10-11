// Real host-console stock confirmation: cancel, Escape, accept, and the authenticated retry payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { TestClient } from '../helpers/wsClient.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('host stock dialog: only Yes forces equipment, No and Escape leave stock unchanged', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-admin-stock-'));
  let srv, admin, client, browser;
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    await client.hello('StockHost');
    await client.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const { code } = await client.waitFor('room.state');
    await client.request({ t: 'room.start' });
    await client.waitFor('m.public', p => p.phase === 'INFO_CHECK');
    const m = srv.lobby.rooms.get(code).match, ps = [...m.players.values()][0];
    const id = 'chess_item_5_07_e_a';
    assert.ok(ps.acquireItem(id));
    assert.ok(ps.acquireItem(id));
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage();
    const actions = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.url().endsWith('/api/action')) actions.push(JSON.parse(req.postData())); });
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    const input = 'input[data-grant="item"]', dialog = 'dialog[data-stock-confirm]';
    const request = async () => {
      await page.waitForSelector(input);
      await page.click(input);
      await page.keyboard.type(id);
      await page.keyboard.press('Enter');
      await page.waitForSelector(`${dialog}[open]`);
      assert.equal(m.itemPool.held(id), 2);
      assert.match(await page.$eval(dialog, el => el.textContent), /商业包装方案.*库存不足/);
    };
    await request();
    await page.click(`${dialog} button[value="no"]`);
    await page.waitForSelector(dialog, { hidden: true });
    assert.equal(actions.length, 1, 'No sends no forced retry');
    await request();
    await page.keyboard.press('Escape');
    await page.waitForSelector(dialog, { hidden: true });
    assert.equal(actions.length, 2, 'Escape sends no forced retry');
    await page.setViewport({ width: 390, height: 844 });
    await request();
    assert.ok(await page.$eval(dialog, el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth; }));
    await page.click(`${dialog} button[value="yes"]`);
    await page.waitForFunction(() => document.querySelector('#msg')?.textContent.includes('发放道具：完成'));
    assert.equal(m.itemPool.held(id), 3);
    assert.equal(m.itemPool.left(id), 0);
    assert.deepEqual(actions.at(-1).value, { id, force: true });
    assert.equal(actions.length, 4, 'one confirmed retry');
    assert.equal(ps.acquireItem(id), null);
    const owner = ps.acquireChess(m.gd.visibleChess.find(id => m.gd.tierOf(id) === 1));
    assert.ok(owner);
    await page.setViewport({ width: 1280, height: 720 });
    await page.click('button[data-toggle]');
    const equipInput = `input[data-candidate-kind="equip"][data-equip="${owner.uid}"]`;
    await page.waitForSelector(equipInput);
    await page.click(equipInput);
    await page.keyboard.type(id);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${dialog}[open]`);
    assert.equal(m.itemPool.held(id), 3, 'direct equip also requires confirmation');
    await page.click(`${dialog} button[value="yes"]`);
    await page.waitForFunction(() => document.querySelector('#msg')?.textContent === '装备：完成');
    assert.equal(m.itemPool.held(id), 4);
    assert.deepEqual(actions.at(-1).value, { target: owner.uid, item: id, force: true });
    assert.equal(m.errorCount, 0);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (client) await client.close();
    if (admin) await admin.close();
    if (srv) await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
