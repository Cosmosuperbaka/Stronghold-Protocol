import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';

const chrome = process.env.CHROME_PATH;
test('chat previews: recent messages, expiry, hover/focus pause, opening and responsive placement', {
  skip: !(process.env.SP_E2E === '1' && chrome && existsSync(chrome)), timeout: 60000,
}, async t => {
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  t.after(async () => { await browser?.close(); await srv.close(); });
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&render=fallback&shot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gm__corner');
  await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    const { emptyChat, mergeChat } = await import('/js/ui/chatStore.js');
    const { ChatPanel } = await import('/js/ui/chat.js');
    const { render } = await import('/vendor/preact.module.js');
    const { html } = await import('/js/ui/components.js');
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/chat.css'; document.head.append(css);
    store.set({ room: { code: 'AAAA', inMatch: true, textChat: true, seats: [{ playerId: 'p1', name: 'Host' }], spectators: [] },
      me: { playerId: 'p1' }, chat: emptyChat('AAAA') });
    const root = document.createElement('div'); document.body.append(root); render(html`<${ChatPanel} />`, root);
    globalThis.receiveChat = (id, text, playerId = 'p2', history = false) => store.set(s => ({ chat: mergeChat(s.chat,
      history ? { code: 'AAAA', messages: [{ id, text, playerId }], lastId: id }
        : { code: 'AAAA', id, text, playerId, name: '队友名字很长时也不能挤出屏幕的博士' }, history, 'p1') }));
  });
  await page.waitForSelector('.chat__toggle');
  await page.evaluate(() => { globalThis.receiveChat(1, '历史消息', 'p2', true); globalThis.receiveChat(2, '我自己的消息', 'p1'); });
  assert.equal(await page.$('.chat__preview'), null);
  await page.evaluate(() => {
    globalThis.receiveChat(3, '我守左路'); globalThis.receiveChat(4, '<img src=x onerror=alert(1)>');
    globalThis.receiveChat(5, '很长的聊天消息'.repeat(60));
  });
  await page.waitForSelector('.chat__preview-message');
  assert.equal(await page.$eval('.chat__preview', el => getComputedStyle(el).animationName), 'chat-preview-in');
  assert.equal(await page.$$eval('.chat__preview-message', els => els.length), 2);
  assert.equal(await page.$('.chat__preview img'), null, 'preview renders user text safely');
  assert.match(await page.$eval('.chat__preview-hint', el => el.textContent), /还有 1 条新消息/);
  assert.ok(await page.$eval('.chat__preview-text', el => getComputedStyle(el).webkitLineClamp === '3'));
  await page.hover('.chat__preview-open');
  mkdirSync('test/e2e/out', { recursive: true });
  await page.screenshot({ path: 'test/e2e/out/chat-preview-desktop.png' });
  // Hover and keyboard focus independently hold the preview beyond its normal lifetime.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 6400)));
  assert.ok(await page.$('.chat__preview'));
  await page.focus('.chat__preview-open'); await page.mouse.move(10, 10);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
  assert.ok(await page.$('.chat__preview'));
  await page.evaluate(() => { globalThis.receiveChat(6, '收到，我来支援'); document.activeElement.blur(); });
  await page.waitForFunction(() => !document.querySelector('.chat__preview'), { timeout: 7500 });
  assert.equal(await page.$eval('.chat__unread', el => el.textContent), '4 条未读', 'expiry never marks messages read');
  await page.evaluate(() => globalThis.receiveChat(7, '点击查看我'));
  await page.waitForSelector('.chat__preview-open'); await page.click('.chat__preview-open');
  await page.waitForSelector('.chat__body');
  assert.equal(await page.$('.chat__preview'), null);
  assert.equal(await page.$('.chat__unread'), null);
  await page.evaluate(() => globalThis.receiveChat(8, '已展开时不重复弹出'));
  await page.focus('.chat__input');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('.chat__preview'), null, 'closing never replays seen messages');
  await page.setViewport({ width: 844, height: 390 });
  const button = await page.$eval('.chat__toggle', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(button.x, button.y); await page.mouse.down();
  await page.mouse.move(760, 350, { steps: 10 }); await page.mouse.up();
  await page.evaluate(() => globalThis.receiveChat(9, '手机横屏也能直接看见消息。'.repeat(20)));
  await page.waitForSelector('.chat__preview');
  assert.ok(await page.$eval('.chat__preview', el => {
    const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  }), 'preview follows the dragged entry and stays inside a short viewport');
  await page.screenshot({ path: 'test/e2e/out/chat-preview-mobile.png' });
  await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    const { mergeChat } = await import('/js/ui/chatStore.js');
    store.set(s => ({ chat: mergeChat(s.chat, { code: 'AAAA', messages: [], clearedThrough: 9 }, true) }));
  });
  await page.waitForFunction(() => !document.querySelector('.chat__preview'));
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => globalThis.receiveChat(10, '关闭开关立即隐藏这条提示'));
  await page.waitForSelector('.chat__preview');
  await page.click('[data-testid="settings-btn"]');
  const setting = '[role="switch"][aria-label="显示消息提示气泡"]';
  await page.waitForSelector(setting);
  assert.equal(await page.$eval(setting, el => el.getAttribute('aria-checked')), 'true', 'enabled by default');
  await page.click(setting);
  await page.waitForFunction(() => !document.querySelector('.chat__preview'));
  await page.evaluate(() => globalThis.receiveChat(11, '关闭期间只保留未读数'));
  assert.equal(await page.$('.chat__preview'), null);
  assert.equal(await page.$eval('.chat__unread', el => el.textContent), '2 条未读');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).chatBubbles), false);
  const otherPage = await browser.newPage();
  await otherPage.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&render=fallback&shot=1`, { waitUntil: 'domcontentloaded' });
  assert.equal(await otherPage.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.get().chatBubbles), false, 'a new document restores the preference');
  await otherPage.close();
  await page.click(setting);
  assert.equal(await page.$('.chat__preview'), null, 'reenabling does not replay messages received while disabled');
  await page.screenshot({ path: 'test/e2e/out/chat-preview-settings.png' });
  await page.keyboard.press('Escape');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate(() => globalThis.receiveChat(12, '重新开启后收到的新消息'));
  await page.waitForSelector('.chat__preview');
  assert.ok(await page.$eval('.chat__preview', el => {
    const style = getComputedStyle(el);
    return style.animationName === 'none' && style.transitionProperty === 'none' && style.transform === 'none'
      && el.getAnimations().length === 0;
  }), 'reduced motion keeps the message readable without movement');
  assert.deepEqual(errors, []);
});
