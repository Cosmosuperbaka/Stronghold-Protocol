// Optional custom alliance keys: real form input, protocol, collision feedback and responsive layout.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('custom alliance key form', { skip: !ENABLED }, () => {
  let server, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${server.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true }]) {
    test(`create, join and reject occupied keys at ${viewport.width}px`, async () => {
      const contexts = [];
      const pageIn = async () => {
        const ctx = await browser.createBrowserContext();
        contexts.push(ctx);
        const page = await ctx.newPage();
        await page.setViewport(viewport);
        await page.evaluateOnNewDocument(() => {
          localStorage.setItem('sp.name', 'Key Test');
          sessionStorage.setItem('sp.entered', '1');
        });
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
        return page;
      };
      const input = '[name="custom-room-code"]';
      const create = '.create-box .btn--primary';
      try {
        const host = await pageIn();
        await host.type(input, 'AB-C');
        assert.equal(await host.$eval(input, (e) => e.value), 'AB-C');
        assert.equal(await host.$eval(create, (e) => e.disabled), true);
        await host.$eval(input, (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
        const key = viewport.width === 1280 ? 'D1i0' : 'M1i0';
        await host.type(input, key);
        assert.equal(await host.$eval(input, (e) => e.value), key.toUpperCase());
        assert.equal(await host.$eval(create, (e) => e.disabled), false);
        const overflow = await host.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 1, `horizontal overflow ${overflow}`);
        const field = await host.$eval(input, (e) => e.getBoundingClientRect().toJSON());
        assert.ok(field.width > 100 && field.left >= 0 && field.right <= viewport.width);
        if (viewport.width === 1280) {
          const button = await host.$eval(create, (e) => e.getBoundingClientRect().toJSON());
          assert.ok(button.bottom <= viewport.height, `create button clipped at ${button.bottom}px`);
        }
        mkdirSync('.cache/custom-room-code', { recursive: true });
        await host.screenshot({ path: `.cache/custom-room-code/${viewport.width}.png`, fullPage: true });
        await host.focus(input);
        await host.keyboard.press('Enter');
        await host.waitForFunction((code) => globalThis.__SP__.store.get().room?.code === code, {}, key.toUpperCase());

        const guest = await pageIn();
        await guest.type(input, key);
        await guest.click(create);
        await guest.waitForFunction(() => document.body.textContent.includes('该同盟密钥已被使用'));
        assert.equal(await guest.evaluate(() => globalThis.__SP__.store.get().room), null);
        assert.equal(await guest.$eval(input, (e) => e.value), key.toUpperCase());
        await guest.type('.join-panel input', key.toLowerCase());
        await guest.click('.join-panel .btn--amber');
        await guest.waitForFunction((code) => globalThis.__SP__.store.get().room?.code === code, {}, key.toUpperCase());

        const random = await pageIn();
        await random.click(create);
        await random.waitForFunction(() => !!globalThis.__SP__.store.get().room?.code);
        assert.match(await random.evaluate(() => globalThis.__SP__.store.get().room.code), /^[A-Z]{4}$/);
      } finally { await Promise.all(contexts.map((ctx) => ctx.close())); }
    });
  }
});
