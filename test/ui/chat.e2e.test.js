import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';

const chrome = process.env.CHROME_PATH;
test('room chat in browser: IME, escaped text, unread, drafts and responsive layout', {
  skip: !(process.env.SP_E2E === '1' && chrome && existsSync(chrome)),
}, async (t) => {
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  let peer, browser;
  t.after(async () => { await peer?.terminate(); await browser?.close(); await srv.close(); });
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${srv.port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP__);
  await page.evaluate(() => globalThis.__SP__.net.setName('BrowserHost'));
  await page.waitForFunction(() => globalThis.__SP__.net.status === 'online');
  const code = await page.evaluate(async () => {
    globalThis.__SP__.store.patch('session', { entered: true });
    await globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    return globalThis.__SP__.store.get().room.code;
  });
  await page.waitForSelector('.chat__toggle');
  peer = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  await peer.hello('Peer'); await peer.request({ t: 'room.join', code });
  await peer.request({ t: 'room.chat', clientId: 'peer1', text: '<img src=x onerror=alert(1)> 你好' });
  await page.waitForSelector('.chat__unread');
  await page.click('.chat__toggle');
  await page.waitForSelector('.chat__input');
  assert.equal(await page.$('.chat__text img'), null);
  assert.ok((await page.$eval('.chat__log', (el) => el.textContent)).includes('<img src=x'));
  assert.equal(await page.$('.chat__unread'), null);
  await page.type('.chat__input', '我守左边');
  await page.$eval('.chat__input', (el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
  });
  assert.equal(await page.evaluate(() => globalThis.__SP__.store.get().chat.messages.length), 1);
  await page.$eval('.chat__input', (el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.__SP__.store.get().chat.messages.length === 2 && !globalThis.__SP__.store.get().chat.sending);
  assert.equal((await peer.waitFor('chat.message', (m) => m.text === '我守左边')).name, 'BrowserHost');
  assert.equal(await page.$eval('.chat__input', (el) => el.value), '');
  await page.type('.chat__input', 'draft');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('.chat__body'), null);
  await page.click('.chat__toggle');
  assert.equal(await page.$eval('.chat__input', (el) => el.value), 'draft');
  mkdirSync('test/e2e/out', { recursive: true });
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['landscape', 844, 390]]) {
    await page.setViewport({ width, height });
    const rect = await page.$eval('.chat__body', (el) => {
      const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    assert.ok(rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= height, JSON.stringify(rect));
    await page.screenshot({ path: `test/e2e/out/chat-${name}.png` });
  }
  await page.evaluate(() => globalThis.__SP__.store.set({ room: null }));
  await page.waitForFunction(() => !document.querySelector('.chat'));
  assert.equal(await page.evaluate(() => globalThis.__SP__.store.get().chat.code), null);
  for (const [phase, width, height] of [['PREP', 1440, 900], ['COMBAT', 1440, 900], ['PREP', 844, 390]]) {
    await page.setViewport({ width, height });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=${phase}&render=fallback&shot=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.gm__corner');
    await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { emptyChat } = await import('/js/ui/chatStore.js');
      const { ChatPanel } = await import('/js/ui/chat.js');
      const { render } = await import('/vendor/preact.module.js');
      const { html } = await import('/js/ui/components.js');
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/chat.css'; document.head.append(css);
      store.set({ room: { code: 'AAAA', inMatch: true, textChat: true, seats: [{ playerId: 'p1', name: 'Host' }], spectators: [] },
        me: { playerId: 'p1' }, chat: emptyChat('AAAA') });
      const root = document.createElement('div'); document.body.append(root); render(html`<${ChatPanel} />`, root);
    });
    await page.waitForSelector('.chat__toggle');
    assert.equal(await page.$('.gm__ended'), null);
    const overlap = await page.$eval('.chat__toggle', (el) => {
      const r = el.getBoundingClientRect();
      return [...document.querySelectorAll('.shopbar, .gm__corner, .readywrap, .gtop__right')].some((other) => {
        const b = other.getBoundingClientRect(); return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      });
    });
    assert.equal(overlap, false, 'chat entry must leave ready, timer, shop and emote controls unobscured');
    await page.click('.chat__toggle');
    const panel = await page.$eval('.chat__body', (el) => {
      const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    assert.ok(panel.left >= 0 && panel.right <= width && panel.top >= 0 && panel.bottom <= height, JSON.stringify(panel));
    await page.screenshot({ path: `test/e2e/out/chat-game-${phase}-${width}.png` });
  }
  assert.deepEqual(errors, []);
});
