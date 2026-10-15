import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch, give } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { RELEASE_TAG } from '../../server/release-version.js';

test('next features: console, release dialog, responsive wall, phase changes and resource page', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: process.env.SP_WALL_SOAK === '1' ? 1900000 : 90000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-next-ui-'));
  const h = makeMatch({ humans: 4, seed: 4242, clientCombat: true, clients: false, captureFrames: false }).start().toPrep();
  let browser, admin;
  try {
    const m = h.m;
    for (const ps of m.order) give(m, ps, [...m.pool.entries.keys()][0], 'board', [9, 2]);
    const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', seats: m.order.map(p => ({ seat: p.seat, playerId: p.playerId, name: p.name, connected: true })), spectators: [], match: m };
    const lobby = { rooms: new Map([['TEST', room]]), safeData: () => m.data, onMatchEnd() {} };
    admin = await startAdmin({ lobby, port: 0, resultsDir: path.join(dir, 'results'), replaysDir: path.join(dir, 'replays'), settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    const page = await browser.newPage(), errors = [], sockets = [], writes = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/live')) writes.push(r.url()); });
    const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', e => sockets.push(e.url));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate(() => localStorage.getItem('sp.admin.release-notes')), RELEASE_TAG);
    // Use the same module the game and console load; first install, upgrade, Esc and repeat visits.
    const show = () => page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).showReleaseNotes({ version: 'test-new', title: '更新记录', entries: Array(15).fill('公告、重启恢复和主机监控功能说明。') }, { storageKey: 'test.notes', chineseOnly: true }));
    await show(); assert.equal(await page.$('dialog'), null);
    await page.evaluate(() => localStorage.setItem('test.notes', 'test-old'));
    await show(); await page.waitForSelector('dialog[open]');
    assert.equal(await page.$eval('dialog', d => getComputedStyle(d).backgroundColor), 'rgb(20, 24, 22)');
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['landscape', 844, 390]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.$eval('dialog', d => d.getBoundingClientRect().width <= innerWidth && d.getBoundingClientRect().height <= innerHeight), name);
      if (height < 500) assert.ok(await page.$eval('.release-notes__body', d => d.scrollHeight > d.clientHeight), 'landscape dialog body scrolls');
      await page.screenshot({ path: path.join(shots, 'notes-' + name + '.png') });
    }
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog'));
    await show(); assert.equal(await page.$('dialog'), null);
    await page.evaluate(async () => {
      const { showReleaseUpdatePrompt } = await import('/js/ui/releaseNotes.js');
      window.updatePromptResult = null;
      showReleaseUpdatePrompt({ title: '版本更新', message: '发现新版本 v0.2.7（当前 v0.2.6）。是否打开更新设置？',
        confirmLabel: '打开更新设置', cancelLabel: '稍后' }).then(result => { window.updatePromptResult = result; });
    });
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.$eval('dialog', d => getComputedStyle(d).backgroundColor), 'rgb(20, 24, 22)');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.updatePromptResult === false);
    await page.goto(admin.url + '/wall?room=TEST', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.viewport iframe');
    assert.equal(await page.$$eval('.seat', s => s.length), 4);
    assert.equal(await page.$$('iframe').then(f => f.length), 4);
    const frames = await Promise.all((await page.$$('iframe')).map(f => f.contentFrame()));
    await Promise.all(frames.map(f => f.waitForSelector('.shopbar')));
    assert.deepEqual(await Promise.all(frames.map(f => f.evaluate(async () => (await import('/js/store.js')).store.get().me.playerId))), m.order.map(p => p.playerId));
    for (const f of frames) {
      assert.equal(await f.$eval('#live-control', el => el.disabled), true);
      // Even programmatically checking the hidden control cannot enable mutations in wall mode.
      await f.$eval('#live-control', el => { el.checked = true; });
      assert.equal(await f.evaluate(async () => (await import('/js/ui/gameActions.js')).actions.refresh()), false);
    }
    assert.deepEqual(writes, []);
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => !!f.style.transform));
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(shots, 'wall-' + name + '.png'), fullPage: true });
    }
    m.startCombat();
    await Promise.all(frames.map(f => f.waitForFunction(() => globalThis.__SP_RUNNER__?.state()?.battleId)));
    assert.deepEqual(await Promise.all(frames.map(f => f.evaluate(() => globalThis.__SP_RUNNER__.state().authoritative))), [false, false, false, false]);
    await page.setViewport({ width: 1920, height: 1200 });
    await page.screenshot({ path: path.join(shots, 'wall-battle.png'), fullPage: true });
    m.order[0].alive = false;
    await page.waitForFunction(() => document.querySelector('.seat').textContent.includes('已淘汰') && document.querySelector('#status').textContent.includes('作战'));
    room.match = null;
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已结束'));
    assert.equal((await page.$$('iframe')).length, 0);
    room.match = m; m.phase = 'PREP'; m.order[0].alive = true;
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('休整'));
    await page.waitForSelector('iframe');
    await Promise.all((await page.$$('iframe')).map(async f => (await f.contentFrame()).waitForSelector('.shopbar')));
    const stableFrames = await page.$$('iframe');
    m.order[1].funds += 10;
    await page.waitForFunction(() => document.querySelectorAll('.seat-summary')[1].textContent.includes('金币 '));
    assert.equal(await stableFrames[0].evaluate(el => el.isConnected), true, 'polls retain the running observers');
    if (process.env.SP_WALL_SOAK === '1') {
      await page.setViewport({ width: 1440, height: 900 });
      await cdp.send('HeapProfiler.collectGarbage');
      const before = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const started = Date.now();
      for (let minute = 0; minute < 30; minute++) {
        await new Promise(resolve => setTimeout(resolve, 60000));
        await cdp.send('HeapProfiler.collectGarbage');
        const used = (await cdp.send('Runtime.getHeapUsage')).usedSize;
        console.log(`wall soak ${minute + 1}/30 min: ${used} bytes (baseline ${before})`);
        assert.ok(used < before + 8 * 1024 * 1024, 'post-GC heap stays within 8 MiB');
      }
      assert.ok(Date.now() - started >= 1800000);
    }
    await page.goto(admin.url + '/resources');
    await page.waitForFunction(() => document.querySelector('#content').textContent.includes('RSS'));
    await page.screenshot({ path: path.join(shots, 'resources.png'), fullPage: true });
    assert.deepEqual(sockets, []); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await admin?.close(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});
