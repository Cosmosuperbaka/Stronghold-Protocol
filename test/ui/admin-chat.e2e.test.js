import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console chat buttons reach players, retain drafts, and save automatic update and recovery settings', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-admin-chat-'));
  let srv, admin, browser, peer;
  t.after(async () => {
    await peer?.terminate(); await browser?.close(); await admin?.close(); await srv?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch,
    recovery: { dir: path.join(dir, 'recovery'), identity: 'test' } });
  t.diagnostic('game server ready');
  admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir: path.join(dir, 'results'),
    settingsFile: path.join(dir, 'settings.json'), updateOptions: { fetchImpl: async () => new Response('[]') },
    log: { info() {}, error() {} } });
  t.diagnostic('console ready');
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, protocolTimeout: 12000,
    args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const game = await browser.newPage(), consolePage = await browser.newPage(), errors = [];
  game.setDefaultTimeout(10000); consolePage.setDefaultTimeout(10000);
  for (const page of [game, consolePage]) page.on('pageerror', e => errors.push(e.message));
  await game.setViewport({ width: 1440, height: 900 });
  await game.bringToFront();
  await game.goto(`http://127.0.0.1:${srv.port}`, { waitUntil: 'domcontentloaded' });
  await game.waitForFunction(() => !!globalThis.__SP__);
  await game.evaluate(() => globalThis.__SP__.net.setName('BrowserHost'));
  await game.waitForFunction(() => globalThis.__SP__.net.status === 'online');
  t.diagnostic('player online');
  const { code, host } = await game.evaluate(async () => {
    globalThis.__SP__.store.patch('session', { entered: true });
    await globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    return { code: globalThis.__SP__.store.get().room.code, host: globalThis.__SP__.store.get().me.playerId };
  });
  peer = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  const welcome = await peer.hello('Peer'); await peer.request({ t: 'room.join', code });
  t.diagnostic('room joined');
  await game.waitForSelector('.chat__toggle'); await game.click('.chat__toggle');
  await consolePage.bringToFront();
  await consolePage.goto(admin.url, { waitUntil: 'domcontentloaded' });
  await consolePage.waitForSelector('[data-open-room]'); await consolePage.click('[data-open-room]');
  await consolePage.waitForSelector(`[data-chat-panel="${code}"] summary`);
  await consolePage.click(`[data-chat-panel="${code}"] summary`);
  await consolePage.click('[data-tab="server"]');
  await consolePage.type('#site-notice-text', '<img src=x> 主机测试公告');
  await consolePage.click('[data-site-notice="save"]');
  await game.bringToFront();
  await game.waitForSelector('.site-notice');
  t.diagnostic('announcement received');
  assert.ok((await game.$eval('.site-notice', e => e.textContent)).includes('主机测试公告'));
  assert.equal(await game.$('.site-notice img'), null);
  assert.equal(await game.$('.chat__message--system'), null);
  await consolePage.bringToFront();
  await consolePage.type('#site-notice-text', '未发送草稿');
  await peer.request({ t: 'room.chat', clientId: 'poll', text: '刷新聊天面板' });
  await consolePage.waitForFunction(() => document.querySelector('.chat-log').textContent.includes('刷新聊天面板'));
  assert.equal(await consolePage.$eval('#site-notice-text', e => e.value), '<img src=x> 主机测试公告未发送草稿');
  await consolePage.click('[data-tab="rooms"]');
  consolePage.on('dialog', d => d.accept());
  await consolePage.click('[data-click="chatClear"]');
  await game.waitForFunction(() => globalThis.__SP__.store.get().chat.messages.length === 0, { polling: 100 });
  await consolePage.click(`[data-click="chatMute"][data-player="${host}"]`);
  await consolePage.waitForFunction(id => document.querySelector(`[data-click="chatMute"][data-player="${id}"]`).textContent === '解除禁言', {}, host);
  await game.bringToFront();
  await game.type('.chat__input', '禁言时尝试发送'); await game.keyboard.press('Enter');
  await game.waitForSelector('.chat__error');
  t.diagnostic('mute received');
  assert.ok((await game.$eval('.chat__error', e => e.textContent)).includes('禁言'));
  fs.mkdirSync('.impeccable/review', { recursive: true });
  await game.screenshot({ path: '.impeccable/review/chat-muted.png' });
  await consolePage.bringToFront();
  await consolePage.screenshot({ path: '.impeccable/review/admin-chat.png', fullPage: true });
  await consolePage.click(`[data-click="chatKick"][data-player="${welcome.playerId}"]`);
  await peer.waitFor('room.closed', m => m.reason === 'kicked');
  t.diagnostic('peer kicked');
  await consolePage.click('[data-tab="settings"]');
  await consolePage.waitForSelector('#auto-update');
  await consolePage.click('#auto-update'); await consolePage.click('[data-auto-update-save]');
  await consolePage.waitForFunction(() => !document.querySelector('[data-auto-update-save]').disabled);
  await consolePage.waitForFunction(() => document.querySelector('#recovery-enabled') && !document.querySelector('#recovery-enabled').disabled);
  await consolePage.click('#recovery-enabled'); await consolePage.click('[data-recovery-save]');
  await consolePage.waitForFunction(() => !document.querySelector('#recovery-enabled').checked);
  await consolePage.reload({ waitUntil: 'domcontentloaded' }); await consolePage.click('[data-tab="settings"]');
  await consolePage.waitForFunction(() => document.querySelector('#auto-update')?.checked === true && document.querySelector('#recovery-enabled')?.checked === false);
  assert.deepEqual(errors, []);
});
