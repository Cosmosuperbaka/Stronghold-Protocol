// Real hub keyboard boundaries, nested dialogs and transition lifecycle.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('hub dialog transitions and keyboard', { skip: !ENABLED }, () => {
  let server, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync('.cache/ui-audit', { recursive: true });
  });
  after(async () => {
    const timer = setTimeout(() => browser?.process()?.kill(), 5000);
    try { await browser?.close(); } finally { clearTimeout(timer); await server?.close(); }
  });

  async function open(width, motion = 'no-preference') {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.setViewport({ width, height: width === 1280 ? 720 : 360 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', 'Hub Audit');
      sessionStorage.setItem('sp.entered', '1');
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
    return { context, page };
  }

  for (const width of [1280, 640]) {
    test(`focus stays in alliance and key dialogs at ${width}px`, async () => {
      const { context, page } = await open(width, 'reduce');
      try {
        for (const kind of ['alliance', 'key', 'backdrop']) {
          const selector = kind === 'alliance' ? '.ally' : '.hub-dialog__box';
          await page.evaluate((kind) => {
            const trigger = kind === 'alliance' ? document.querySelector('.hub-entry[aria-label="ALLIANCE"]')
              : kind === 'backdrop' ? document.querySelector('.hub-bg-btn')
                : [...document.querySelectorAll('.hub-tile')].find(e => e.textContent.includes('密钥加入'));
            trigger.focus();
            trigger.click();
          }, kind);
          await page.waitForSelector(selector);
          await page.waitForFunction((s) => document.querySelector(s)?.contains(document.activeElement), {}, selector);
          await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })));
          assert.ok(await page.$(selector), 'IME Escape keeps the dialog open');
          await page.evaluate(() => {
            const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
            e.preventDefault();
            window.dispatchEvent(e);
          });
          assert.ok(await page.$(selector), 'a consumed Escape keeps the dialog open');
          if (kind === 'alliance') {
            const requested = await page.evaluate(async () => {
              const { net } = await import('/js/net.js');
              const original = net.request;
              let called = false;
              net.request = () => { called = true; return Promise.resolve({}); };
              try {
                const field = document.querySelector('.ally-key input');
                field.value = 'AB12';
                field.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(resolve => requestAnimationFrame(resolve));
                field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
                return called;
              } finally { net.request = original; }
            });
            assert.equal(requested, false, 'IME Enter never submits an alliance key');
          }
          for (const reverse of [false, true]) {
            for (let i = 0; i < 9; i++) {
              if (reverse) await page.keyboard.down('Shift');
              await page.keyboard.press('Tab');
              if (reverse) await page.keyboard.up('Shift');
              assert.equal(await page.$eval(selector, e => e.contains(document.activeElement)), true);
            }
          }
          await page.evaluate(async () => {
            const { confirmDialog } = await import('/js/ui/components.js');
            void confirmDialog({ text: 'Nested audit dialog' });
          });
          await page.waitForSelector('.modal:not(.hub-dialog)');
          await page.keyboard.press('Escape');
          await page.waitForSelector('.modal:not(.hub-dialog)', { hidden: true });
          assert.ok(await page.$(selector), 'only the nested dialog closes');
          await page.keyboard.press('Escape');
          await page.waitForSelector(selector, { hidden: true });
          assert.equal(await page.evaluate(() => document.activeElement.matches('.hub-entry, .hub-tile, .hub-bg-btn')), true, 'focus returns to the opener');
        }
      } finally { await context.close(); }
    });

    for (const motion of ['no-preference', 'reduce']) {
      test(`entrance and report exit at ${width}px, ${motion}`, async () => {
        const { context, page } = await open(width, motion);
        try {
          await page.evaluate(() => document.querySelector('.hub-entry[aria-label="ALLIANCE"]').click());
          await page.waitForSelector('.ally-create');
          const group = await page.$eval('.ally-create', e => {
            const s = getComputedStyle(e);
            return { animation: s.animationName, duration: s.animationDuration, delay: s.animationDelay, button: getComputedStyle(e.querySelector('.ally-card--create')).animationName };
          });
          assert.equal(group.animation, 'tr-right');
          assert.equal(group.button, 'none', 'input and button move once as a group');
          assert.equal(group.duration, motion === 'reduce' ? '0.001s' : '0.42s');
          assert.equal(group.delay, motion === 'reduce' ? '0s' : '0.24s');
          await page.waitForFunction(() => !document.querySelector('.ally-create').getAnimations().some(a => a.playState === 'running'));
          await page.screenshot({ path: `.cache/ui-audit/alliance-${width}-${motion}.png` });
          await page.keyboard.press('Escape');
          await page.waitForSelector('.ally', { hidden: true });
          await page.evaluate(() => { const e = document.querySelector('.hub-plate--sweep'); e.focus(); e.click(); });
          await page.waitForSelector('.sw');
          await page.waitForFunction(() => !document.querySelector('.sw').getAnimations().some(a => a.playState === 'running'));
          await page.screenshot({ path: `.cache/ui-audit/report-${width}-${motion}.png` });
          if (motion === 'no-preference') {
            const leaving = await page.evaluate(() => {
              document.querySelector('.sw-back').click();
              return new Promise(resolve => requestAnimationFrame(() => resolve(!!document.querySelector('.sw.is-leaving') && !!document.querySelector('.sw-veil.is-leaving'))));
            });
            assert.equal(leaving, true, 'report remains mounted for its exit');
          } else await page.keyboard.press('Escape');
          await page.waitForSelector('.sw', { hidden: true });
          assert.equal(await page.evaluate(() => document.activeElement.matches('.hub-plate--sweep')), true);
          await page.evaluate(() => document.querySelector('.hub-plate--sweep').click());
          await page.waitForSelector('.sw');
          assert.equal(await page.$eval('.sw', e => e.classList.contains('is-leaving')), false, 'reopening starts fresh');
          await page.keyboard.press('Escape');
          await page.waitForSelector('.sw', { hidden: true });
        } finally { await context.close(); }
      });
    }
  }
});
