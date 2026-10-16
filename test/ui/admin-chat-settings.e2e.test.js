import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { setBlockedWords, getBlockedWords } from '../../server/chat.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

test('console chat send, blocked phrases, stable drafts and grouped responsive settings', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-chat-settings-ui-'));
  let server, admin, browser, peer;
  setBlockedWords([]);
  t.after(async () => {
    await browser?.close(); await peer?.terminate(); await admin?.close(); await server?.close(); setBlockedWords([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  admin = await startAdmin({ lobby: server.lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'),
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } });
  peer = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
  await peer.hello('Peer'); await peer.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await peer.waitFor('room.state');
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--disable-background-timer-throttling'] });
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
  await page.click('[data-tab="settings"]'); await page.waitForSelector('#blocked-words');
  assert.deepEqual(await page.$$eval('.settings-group', (es) => es.map((e) => e.getAttribute('aria-label'))),
    ['对局设置', '交流管理', '记录与恢复', '维护与扩展', '数据清理']);
  await page.type('#blocked-words', '秘密\nBaD\na.b');
  await page.click('[data-blocked-save]');
  await page.waitForFunction(() => document.querySelector('#blocked-saved').textContent.includes('已保存'));
  assert.deepEqual(getBlockedWords(), ['秘密', 'BaD', 'a.b']);
  await page.type('#blocked-words', '\n草稿'); await page.click('[data-blocked-reset]');
  assert.equal(await page.$eval('#blocked-words', (e) => e.value), '秘密\nBaD\na.b');
  await page.$eval('#blocked-words', (e) => { e.value = 'x'.repeat(41); });
  await page.click('[data-blocked-save]');
  await page.waitForFunction(() => document.querySelector('#blocked-saved').textContent.includes('保存失败'));
  assert.deepEqual(getBlockedWords(), ['秘密', 'BaD', 'a.b'], 'failed save preserves the server setting');
  assert.equal(await page.$eval('#blocked-words', (e) => e.value.length), 41, 'failed save retains edited words');
  await page.click('[data-blocked-reset]');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.click('[data-tab="settings"]');
  await page.waitForSelector('#blocked-words');
  assert.equal(await page.$eval('#blocked-words', (e) => e.value), '秘密\nBaD\na.b');
  fs.mkdirSync(OUT, { recursive: true });
  for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewport({ width, height }); await page.evaluate(() => scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label);
    assert.ok(await page.$eval('#blocked-words', (e) => e.scrollWidth <= e.clientWidth), label + ' textarea fits');
    await page.screenshot({ path: path.join(OUT, `admin-settings-grouped-${label}.png`), fullPage: true });
  }
  await page.click('[data-tab="rooms"]');
  await page.locator('[data-open-room]').click();
  await page.locator(`[data-chat-panel="${room.code}"] summary`).click();
  const form = `[data-chat-compose="${room.code}"]`, input = `${form} [data-chat-text]`;
  await page.type(input, '<img src=x> 秘密 BAD a.b');
  await peer.request({ t: 'room.chat', clientId: 'draft-refresh', text: '刷新聊天管理，秘密 bad' });
  await page.waitForFunction(() => document.querySelector('.chat-log').textContent.includes('刷新聊天管理'));
  assert.equal(await page.$eval(input, (e) => e.value), '<img src=x> 秘密 BAD a.b', 'poll retains the host draft');
  assert.equal(await page.$eval(input, (e) => e === document.activeElement), true, 'chat polling preserves input focus');
  assert.equal(server.lobby.rooms.get(room.code).chat.messages[0].text, '刷新聊天管理，*** ***', 'player messages are filtered before storage');
  await page.$eval(input, (e) => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(server.lobby.rooms.get(room.code).chat.messages.length, 1, 'IME confirmation does not send');
  await page.focus(input); await page.keyboard.press('Enter');
  const message = await peer.waitFor('chat.message', (m) => m.role === 'system');
  assert.equal(message.text, '<img src=x> *** *** ***');
  await page.waitForFunction(() => document.querySelector('[data-chat-text]').value === '');
  await page.waitForFunction(() => document.querySelector('.chat-log').textContent.includes('主机消息'));
  assert.equal(await page.$('.chat-log img'), null, 'message is escaped');
  await page.$eval(input, (e) => { e.value = 'x'.repeat(201); });
  await page.click(`${form} button[type="submit"]`);
  await page.waitForFunction(() => document.querySelector('[data-chat-status]').textContent.includes('发送失败'));
  assert.equal(await page.$eval(input, (e) => e.value.length), 201, 'failed sends retain the draft');
  assert.equal(await page.$eval(`${form} button`, (e) => e.disabled), false, 'can retry');
  await page.$eval(input, (e) => { e.value = '主机消息'; });
  await page.click(`${form} button[type="submit"]`);
  await peer.waitFor('chat.message', (m) => m.text === '主机消息');
  await page.waitForFunction(() => document.querySelector('[data-chat-text]').value === '');
  await page.screenshot({ path: path.join(OUT, 'admin-chat-compose-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
