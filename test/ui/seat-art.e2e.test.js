import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';
test('room poster: change, peer sync, reload and phone layout', { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000 }, async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling'] });
  t.after(async () => { await browser.close(); await srv.close(); });
  const pages = [], errors = [];
  for (const name of ['Poster Host', 'Poster Peer']) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(name => { localStorage.setItem('sp.name', name); sessionStorage.setItem('sp.entered', '1'); }, name);
    await page.goto(srv.url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => globalThis.__SP__?.net.status === 'online');
  }
  const [host, peer] = pages;
  const code = await host.evaluate(async () => { const { net, store } = globalThis.__SP__; store.patch('session', { entered: true }); await net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }); return store.get().room.code; });
  await peer.evaluate(async code => { globalThis.__SP__.store.patch('session', { entered: true }); await globalThis.__SP__.net.request('room.join', { code }); }, code);
  await host.bringToFront(); await host.waitForSelector('.rseat__pick'); await host.click('.rseat__pick'); await host.type('.cardpick__search input', '隐现');
  await host.$$eval('.cardpick__op', es => es.find(e => e.title === '隐现').click());
  await host.waitForSelector('.cardpick__grid--skins');
  await host.$$eval('.cardpick__op', es => es.find(e => e.title === '甜品大奖').click());
  await host.waitForFunction(() => document.querySelector('.rseat.is-me .rseat__art img')?.src.includes('kitchen_2'));
  await peer.waitForFunction(() => [...document.querySelectorAll('.rseat:not(.is-me) .rseat__art img')].some(e => e.src.includes('kitchen_2')));
  await host.waitForFunction(() => { const e = document.querySelector('.rseat.is-me .rseat__art img'); return e.complete && e.naturalWidth > 0; });
  await host.reload({ waitUntil: 'domcontentloaded' }); await host.waitForFunction(() => document.querySelector('.rseat.is-me .rseat__art img')?.src.includes('kitchen_2'));
  mkdirSync('.cache/console-ui', { recursive: true });
  for (const [width, height] of [[1440,900],[844,390],[640,360]]) {
    await host.setViewport({ width, height, hasTouch: width < 1000 });
    await host.waitForSelector('.rseat__pick');
    await host.waitForFunction(() => { const e = document.querySelector('.rseat.is-me .rseat__art img'); return e?.complete && e.naturalWidth > 0; });
    await host.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const finite = document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(finite.map(a => a.finished.catch(() => {})));
    });
    await host.screenshot({ path: '.cache/console-ui/room-poster-' + width + '.png' });
  }
  await host.click('.rseat__pick'); await host.waitForSelector('.cardpick__search input'); await host.type('.cardpick__search input', 'Lancet');
  assert.ok(await host.$$eval('.cardpick__op', es => es.some(e => e.title === 'Lancet-2')), 'operators outside the battle roster are selectable');
  assert.deepEqual(errors, []);
});
