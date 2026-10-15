import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';

const chrome = process.env.CHROME_PATH;
test('chat position: mouse/title/touch drag, per-name persistence, viewport bounds and reset', {
  skip: !(process.env.SP_E2E === '1' && chrome && existsSync(chrome)), timeout: 60000,
}, async (t) => {
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await srv.close(); });
  let page = await browser.newPage();
  const errors = [];
  const ready = async () => {
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${srv.port}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__SP__);
  };
  const login = async name => {
    await page.evaluate(async name => {
      const { identity } = await import('/js/net.js');
      identity.setEntered(true);
      globalThis.__SP__.store.patch('session', { entered: true });
      globalThis.__SP__.net.setName(name);
    }, name);
    await page.waitForFunction(name => globalThis.__SP__.net.status === 'online' && globalThis.__SP__.store.get().me.name === name, {}, name);
  };
  const rect = selector => page.$eval(selector, el => {
    const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
  const near = (a, b) => { assert.ok(Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`); };
  const drag = async (selector, dx, dy) => {
    const r = await rect(selector);
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, { steps: 12 }); await page.mouse.up();
  };
  const inBounds = async (selector, width, height) => {
    const r = await rect(selector);
    assert.ok(r.x >= 0 && r.y >= 0 && r.right <= width && r.bottom <= height, JSON.stringify(r));
  };
  await ready(); await login('PositionA');
  mkdirSync('test/e2e/out', { recursive: true });
  await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  await page.waitForSelector('.chat__toggle');
  const original = await rect('.chat__toggle');
  await page.click('.chat__toggle'); await page.type('.chat__input', 'keep this draft');
  await drag('.chat__drag', -470, 180);
  const moved = await rect('.chat__toggle');
  near(moved, { x: original.x - 470, y: original.y + 180 });
  assert.equal(await page.$eval('.chat__input', e => e.value), 'keep this draft');
  await page.screenshot({ path: 'test/e2e/out/chat-position-desktop.png' });
  await page.focus('.chat__drag'); await page.keyboard.press('Escape');
  await drag('.chat__toggle', -400, 520);
  assert.equal(await page.$('.chat__body'), null, 'dragging the collapsed button does not open chat');
  const saved = await rect('.chat__toggle');
  await page.click('.chat__toggle'); await page.waitForSelector('.chat__body');
  await inBounds('.chat__body', 1440, 900);
  assert.ok((await rect('.chat__body')).bottom < saved.y, 'the panel opens above a button near the bottom');
  // Reload and a new document restore placement, while chat contents and drafts are not persisted.
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.chat__toggle');
  near(await rect('.chat__toggle'), saved);
  const oldPlayer = await page.evaluate(() => globalThis.__SP__.store.get().me.playerId);
  await page.close(); page = await browser.newPage(); await ready(); await login('PositionA');
  await page.waitForSelector('.chat__toggle'); near(await rect('.chat__toggle'), saved);
  // A new player/session using the same name also retains the local preference.
  await page.evaluate(() => { const { net } = globalThis.__SP__; net.close(); sessionStorage.clear(); localStorage.removeItem('sp.tokens'); });
  await page.close(); page = await browser.newPage(); await ready(); await login('PositionA');
  assert.notEqual(await page.evaluate(() => globalThis.__SP__.store.get().me.playerId), oldPlayer);
  await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  await page.waitForSelector('.chat__toggle'); near(await rect('.chat__toggle'), saved);
  await login('PositionB'); near(await rect('.chat__toggle'), original);
  await drag('.chat__toggle', -200, 80);
  const other = await rect('.chat__toggle');
  await login('PositionA'); near(await rect('.chat__toggle'), saved);
  await login('PositionB'); near(await rect('.chat__toggle'), other);
  // Leaving/recreating a room keeps placement. Keyboard changes are saved too.
  await page.evaluate(async () => { await globalThis.__SP__.net.request('room.leave'); await globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }); });
  await page.waitForSelector('.chat__toggle'); near(await rect('.chat__toggle'), other);
  await page.focus('.chat__toggle'); await page.keyboard.press('ArrowLeft');
  near(await rect('.chat__toggle'), { x: other.x - 1, y: other.y });
  // Touch interaction uses the game's supported landscape orientation (portrait has a rotate overlay).
  await page.setViewport({ width: 844, height: 390 });
  await inBounds('.chat__toggle', 844, 390);
  const touch = await page.createCDPSession(), r = await rect('.chat__toggle');
  const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 290 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const touched = await rect('.chat__toggle');
  assert.ok(Math.abs(touched.x - r.x) > 10 || Math.abs(touched.y - r.y) > 10, 'touch drag changes position');
  await inBounds('.chat__toggle', 844, 390);
  assert.equal(await page.$('.chat__body'), null);
  await page.click('.chat__toggle'); await page.waitForSelector('.chat__body');
  await inBounds('.chat__body', 844, 390);
  await page.screenshot({ path: 'test/e2e/out/chat-position-touch.png' });
  await page.setViewport({ width: 390, height: 844 }); await inBounds('.chat__body', 390, 844);
  await page.setViewport({ width: 1440, height: 900 });
  await page.click('.chat__reset'); near(await rect('.chat__toggle'), original);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.chat__toggle');
  near(await rect('.chat__toggle'), original);
  await login('PositionA'); near(await rect('.chat__toggle'), saved);
  // Damaged or unavailable storage falls back to a usable default without breaking dragging.
  await page.evaluate(() => localStorage.setItem('sp.pref.chatPosition.name.Damaged', '{bad json'));
  await login('Damaged'); near(await rect('.chat__toggle'), original);
  await page.evaluate(() => { Storage.prototype.getItem = () => { throw Error('blocked'); }; Storage.prototype.setItem = () => { throw Error('blocked'); }; });
  await login('Blocked'); await drag('.chat__toggle', -100, 100);
  near(await rect('.chat__toggle'), { x: original.x - 100, y: original.y + 100 });
  assert.deepEqual(errors, []);
});

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
  for (const [phase, width, height] of [['PREP', 1440, 900], ['COMBAT', 1440, 900], ['PREP', 844, 390], ['PREP', 390, 844]]) {
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
      return [...document.querySelectorAll('.shopbar, .gm__corner, .readywrap, .gtop__right, .gm__effects')].some((other) => {
        const b = other.getBoundingClientRect(); return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      });
    });
    assert.equal(overlap, false, `${phase} ${width}: chat button leaves HUD controls and side effects visible`);
    await page.click('.chat__toggle');
    const panel = await page.$eval('.chat__body', (el) => {
      const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    assert.ok(panel.left >= 0 && panel.right <= width && panel.top >= 0 && panel.bottom <= height, JSON.stringify(panel));
    await page.screenshot({ path: `test/e2e/out/chat-game-${phase}-${width}.png` });
  }
  assert.deepEqual(errors, []);
});
