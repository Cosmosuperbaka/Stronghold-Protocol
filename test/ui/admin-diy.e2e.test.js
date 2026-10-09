// The local console's autocomplete: real catalog, input events and grant API (no game assets needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { TestClient } from '../helpers/wsClient.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

test('console candidates: immediate DIY options and consistent grants without changing action payloads', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-admin-diy-'));
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
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let releaseCatalog;
    const catalogGate = new Promise((resolve) => { releaseCatalog = resolve; });
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      if (req.url().includes('/api/catalog')) await catalogGate;
      await req.continue();
    });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    const input = 'input[data-grant="diy"]';
    const selectAll = async () => {
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
    };
    await page.waitForSelector(input);
    await page.click(input);
    await page.keyboard.type('灰烬');
    releaseCatalog();
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'admin-diy-before.png') });
    await page.waitForSelector('[data-diy-options]:not([hidden]) [role="option"]', { timeout: 4000 });
    const labels = await page.$$eval('[data-diy-options] [role="option"]', (els) => els.map((el) => el.textContent));
    assert.equal(labels.length, 4, 'both tiers and normal/elite are available');
    assert.ok(labels.every((label) => label.includes('灰烬')));
    await page.screenshot({ path: path.join(OUT, 'admin-diy-desktop.png') });
    await page.click('[data-diy-options] [role="option"]');
    assert.equal(await page.$eval('[data-diy-options]', (el) => el.hidden), true, 'selection closes the candidates');
    assert.equal(await page.$eval(input, (el) => el.value), labels[0]);
    assert.equal(await page.$eval('[data-diy-skill]', (el) => el.disabled), false);
    const m = srv.lobby.rooms.get(code).match;
    const ps = [...m.players.values()][0];
    assert.equal(Object.keys(ps.diy).length, 0, 'selection alone grants nothing');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#msg')?.textContent.includes('发放自选：完成'));
    assert.equal(Object.keys(ps.diy).length, 1);

    // Keyboard navigation and Chinese IME confirmation must select without accidentally granting.
    await page.click(input);
    await selectAll();
    await page.keyboard.type('艾拉');
    await page.evaluate((sel) => document.querySelector(sel).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, isComposing: true,
    })), input);
    assert.equal(Object.keys(ps.diy).length, 1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.match(await page.$eval(input, (el) => el.value), /^艾拉/);
    assert.equal(Object.keys(ps.diy).length, 1);
    await selectAll();
    await page.keyboard.type('no-such-operator');
    assert.equal(await page.$eval('[data-diy-options]', (el) => el.textContent), '没有符合条件的干员');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('[data-diy-options]', (el) => el.hidden), true);

    await page.setViewport({ width: 390, height: 844 });
    await page.click(input);
    await selectAll();
    await page.keyboard.type('丰川');
    await page.screenshot({ path: path.join(OUT, 'admin-diy-mobile.png') });
    const fits = await page.$eval('[data-diy-options]', (el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth;
    });
    assert.ok(fits, 'the candidate list fits the mobile viewport');

    // The other grants keep their catalogs, payloads and raw-id input; picking never submits.
    await page.setViewport({ width: 1440, height: 1000 });
    await page.click('button[data-toggle]');
    await page.waitForSelector('input[data-grant="card"]');
    const catalog = await fetch(`${admin.url}/api/catalog?room=${code}`, {
      headers: { 'X-Admin-Token': admin.token },
    }).then((r) => r.json());
    const actions = [];
    page.on('request', (req) => {
      if (req.url().endsWith('/api/action')) actions.push(JSON.parse(req.postData()));
    });
    for (const kind of ['chess', 'item', 'card', 'equip']) {
      const entry = kind === 'chess' ? catalog.chess[0] : kind === 'card' ? catalog.cards[0]
        : catalog.items.find((x) => kind !== 'equip' || x.equip);
      const selector = `input[data-candidate-kind="${kind}"]`;
      await page.waitForSelector(selector);
      await page.click(selector);
      await page.keyboard.type(entry.name);
      const box = `${selector} + [data-candidates]`;
      await page.waitForSelector(`${box}:not([hidden]) [role="option"]`);
      const before = actions.length;
      const label = await page.$eval(`${box} [role="option"]`, (el) => el.textContent);
      assert.ok(label.includes(entry.name));
      const sameCatalog = await page.$eval(selector, (el, k) => {
        const q = el.value.trim().toLocaleLowerCase();
        const expected = [...document.querySelector(`#${k}-list`).options].map((o) => o.value)
          .filter((value) => value.toLocaleLowerCase().includes(q));
        const actual = [...el.parentElement.querySelectorAll('[role="option"]')].map((o) => o.textContent);
        return JSON.stringify(actual) === JSON.stringify(expected);
      }, kind);
      assert.ok(sameCatalog, `${kind}: the original catalog and labels are preserved`);
      await page.screenshot({ path: path.join(OUT, `admin-candidates-${kind}.png`) });
      await page.setViewport({ width: 390, height: 844 });
      await page.click(selector);
      await page.waitForSelector(`${box}:not([hidden]) [role="option"]`);
      const mobileFits = await page.$eval(box, (el) => {
        const r = el.getBoundingClientRect();
        return !el.hidden && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
          && el.scrollWidth <= el.clientWidth;
      });
      assert.ok(mobileFits, `${kind}: candidates fit the mobile viewport`);
      await page.screenshot({ path: path.join(OUT, `admin-candidates-${kind}-mobile.png`) });
      await page.setViewport({ width: 1440, height: 1000 });
      await page.click(selector);
      await page.waitForSelector(`${box}:not([hidden]) [role="option"]`);
      await page.click(`${box} [role="option"]`);
      assert.equal(await page.$eval(selector, (el) => el.value), label);
      assert.equal(actions.length, before, `${kind}: clicking a candidate only fills the input`);
      const result = page.waitForResponse((r) => r.url().endsWith('/api/action'));
      await page.keyboard.press('Enter');
      assert.equal((await (await result).json()).ok, true);
      assert.equal(actions.length, before + 1);
      const action = actions.at(-1);
      assert.equal(action.action, kind === 'equip' ? 'pieceEquip' : kind);
      if (kind === 'equip') {
        assert.equal(action.value.item, entry.id);
        assert.equal(typeof action.value.target, 'number');
      } else assert.equal(action.value, entry.id);
      assert.equal(await page.$eval(selector, (el) => el.value), '', 'the grant input still clears');
    }
    const rawInput = 'input[data-grant="chess"]';
    await page.click(rawInput);
    await page.keyboard.type(catalog.chess[0].id);
    const rawResult = page.waitForResponse((r) => r.url().endsWith('/api/action'));
    await page.keyboard.press('Enter');
    assert.equal((await (await rawResult).json()).ok, true, 'raw ids still go through the original grant handler');
    assert.equal(actions.at(-1).value, catalog.chess[0].id);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (client) await client.close();
    if (admin) await admin.close();
    if (srv) await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
