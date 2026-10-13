import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin, resultRecord } from '../../server/admin.js';
import { replayIdentity, saveReplay } from '../../server/replay-store.js';
import { getReplayConfig, setReplayConfig, replayRecord } from '../../server/match/replay.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console replay: recorded battle, pause/speed/restart, consistency, version warning, deletion confirmation, desktop/mobile', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-replay-ui-'));
  const old = getReplayConfig(), id = '20261013-TEST.json', resultsDir = path.join(dir, 'results'), replaysDir = path.join(dir, 'replays');
  let browser, admin, h;
  try {
    fs.mkdirSync(resultsDir);
    setReplayConfig({ enabled: true, identity: replayIdentity(path.resolve('.')) });
    h = makeMatch({ humans: 1, bots: 1, seed: 4242, clientCombat: true, captureFrames: false }).start().autoHumans();
    assert.ok(h.drive(() => h.ended != null));
    const replay = replayRecord(h.m, { room: 'TEST', savedAt: Date.now(), resultId: id });
    saveReplay(replaysDir, id, replay);
    fs.writeFileSync(path.join(resultsDir, id), JSON.stringify(resultRecord({ code: 'TEST', mode: 'coop', difficulty: 'NORMAL' }, h.m, h.ended)));
    admin = await startAdmin({ lobby: { rooms: new Map(), safeData: () => ({}), onMatchEnd() {} }, port: 0, resultsDir, replaysDir,
      settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="records"]');
    await page.waitForSelector('.replay-link');
    const href = await page.$eval('.replay-link', (el) => el.getAttribute('href'));
    await page.goto(`${admin.url}${href}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-field]');
    await page.select('#speed', '8'); await page.click('#play');
    await page.waitForSelector('#pause:not([disabled])');
    await page.click('#pause');
    assert.equal(await page.$eval('#pause', (el) => el.textContent), '继续播放');
    assert.match(await page.$eval('#digest', (el) => el.textContent), /已暂停/);
    await page.select('#speed', '4'); await page.click('#pause');
    await page.select('#speed', '8');
    await page.waitForFunction(() => document.querySelector('#digest').textContent === '与记录一致', { timeout: 45000 });
    const canvases = await page.$$eval('#field canvas', (els) => els.length);
    assert.ok(canvases >= 1);
    await page.click('#restart'); await page.waitForSelector('#pause:not([disabled])'); await page.click('#pause');
    assert.equal(await page.$$eval('#field canvas', (els) => els.length), canvases, 'restart disposes old renderer');
    const fieldIndex = replay.rounds.flatMap((r) => r.fields).findIndex((f) => f.playable && f.spec.round >= 2 && f.lineup.some((p) => p.units.length));
    assert.ok(fieldIndex >= 0, 'capture a recorded formation');
    await page.click(`[data-field="${fieldIndex}"]`); await page.click('#play');
    await page.waitForSelector('#pause:not([disabled])');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    await page.click('#pause');
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} viewer fits`);
      await page.screenshot({ path: path.join(shots, `replay-${name}.png`), fullPage: true });
    }
    saveReplay(replaysDir, id, { ...replay, made: { ...replay.made, identity: 'previous-version' } });
    await page.reload({ waitUntil: 'networkidle0' });
    assert.match(await page.$eval('#notice', (el) => el.textContent), /版本已变/);
    page.once('dialog', (d) => d.dismiss()); await page.click('#play');
    assert.equal(await page.$eval('#field', (el) => el.hidden), true);
    page.once('dialog', (d) => d.accept()); await page.click('#play');
    await page.waitForFunction(() => document.querySelector('#digest').textContent.includes('版本不一致'), { timeout: 30000 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#storage-form');
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} console fits`);
      await page.screenshot({ path: path.join(shots, `replay-storage-${name}.png`), fullPage: true });
    }
    await page.click('input[name="storage"][value="adminLogs"]');
    page.once('dialog', (d) => d.dismiss()); await page.click('[data-storage-clear]');
    assert.ok(fs.existsSync(path.join(resultsDir, id)));
    page.once('dialog', (d) => d.accept()); await page.click('[data-storage-clear]');
    await page.waitForFunction(() => document.querySelector('#storage-saved').textContent === '已完成清理');
    await page.click('[data-tab="records"]'); await page.waitForSelector('[data-record-delete]');
    page.once('dialog', (d) => d.dismiss()); await page.click('[data-record-delete]');
    assert.ok(fs.existsSync(path.join(replaysDir, `${id}.gz`)));
    page.once('dialog', (d) => d.accept()); await page.click('[data-record-delete]');
    await page.waitForFunction(() => document.querySelector('#records').textContent.includes('还没有记录'));
    assert.equal(fs.existsSync(path.join(resultsDir, id)), false);
    assert.equal(fs.existsSync(path.join(replaysDir, `${id}.gz`)), false);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close(); if (admin) await admin.close(); h?.m.dispose();
    setReplayConfig(old); fs.rmSync(dir, { recursive: true, force: true });
  }
});
