// Real local console -> WebSocket -> safe Markdown; responsive utility surfaces, no online room or game art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

test('reference utilities: long announcements, plain compatibility and staged resource progress at desktop/phone sizes', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-reference-ui-'));
  let server, admin, browser;
  try {
    mkdirSync(OUT, { recursive: true });
    console.log('starting server');
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    console.log('starting console');
    admin = await startAdmin({ lobby: server.lobby, port: 0, resultsDir: dir,
      settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    console.log('launching browser');
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    const page = await browser.newPage(), consolePage = await browser.newPage(), errors = [];
    page.setDefaultTimeout(10000); consolePage.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900, isMobile: true, hasTouch: true });
    await page.goto(server.url, { waitUntil: 'networkidle0' });
    await page.waitForSelector('input');
    await page.type('input', '公告测试');
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /开始/.test(b.textContent))?.click());
    await page.waitForSelector('.lobby-screen');
    console.log('game client ready');
    await consolePage.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await consolePage.waitForFunction(() => !document.querySelector('#host-overview')?.textContent.includes('正在读取'));
    await consolePage.click('[data-tab="server"]');
    await consolePage.waitForSelector('#site-notice-text', { visible: true });
    console.log('console announcement editor ready');
    const source = '# 更新说明\n\n## 交流和资源\n\n- **快捷键**：独立编辑，冲突键自动交换。\n- 资源包：下载、校验、导入。\n\n> 本次保留原有界面比例。\n\n| 阶段 | 显示内容 |\n| --- | --- |\n| 下载 | 字节与速度 |\n| 导入 | 文件数 |\n\n[查看文档](https://example.com/docs)\n\n```text\n' + 'long-line-'.repeat(80) + '\n```\n\n<script>globalThis.__NOTICE_XSS__=true</script>\n\n![tracking](https://example.com/track.png)\n\n' + '长公告正文。'.repeat(1500);
    await consolePage.select('#site-notice-format', 'markdown');
    await consolePage.$eval('#site-notice-text', (el, value) => { el.value = value; }, source);
    const [response] = await Promise.all([
      consolePage.waitForResponse(r => r.url().endsWith('/api/action') && r.request().method() === 'POST'),
      consolePage.click('[data-site-notice="save"]'),
    ]);
    assert.equal((await response.json()).ok, true, 'long Markdown is accepted by the actual console HTTP endpoint');
    console.log('long announcement published');
    await page.bringToFront();
    await page.waitForSelector('.site-notice__label');
    console.log('notice banner received');
    await page.click('.site-notice__label');
    await page.waitForSelector('.announcement-markdown h1');
    console.log('Markdown popup rendered');
    await page.waitForFunction(() => !document.querySelector('.announcement-modal')?.getAnimations().some(a => a.playState === 'running'));
    assert.equal(await page.$('.announcement-markdown img'), null);
    assert.equal(await page.evaluate(() => globalThis.__NOTICE_XSS__), undefined);
    assert.equal(await page.$eval('.announcement-markdown a', e => e.rel), 'noopener noreferrer');
    for (const [width, height] of [[1440, 900], [844, 390], [640, 360]]) {
      await page.setViewport({ width, height, isMobile: true, hasTouch: true });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const bounds = await page.$eval('.announcement-modal', el => {
        const b = el.getBoundingClientRect(), body = el.querySelector('.modal__body');
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, scroll: body.scrollWidth, client: body.clientWidth };
      });
      assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && bounds.top >= -1 && bounds.bottom <= height + 1, JSON.stringify(bounds));
      const expectedWidth = await page.evaluate(() => Math.min(10.8 * parseFloat(getComputedStyle(document.documentElement).fontSize), innerWidth - 32));
      assert.ok(Math.abs(bounds.right - bounds.left - expectedWidth) < 1, 'announcement uses the wider reference layout within viewport margins');
      assert.ok(bounds.scroll <= bounds.client + 1, 'only code/table areas may scroll horizontally');
      await page.screenshot({ path: path.join(OUT, `reference-announcement-${width}.png`) });
    }
    await page.keyboard.press('Escape');
    const plain = '**原样显示** <b>纯文本</b>';
    await consolePage.bringToFront();
    await consolePage.select('#site-notice-format', 'plain');
    await consolePage.$eval('#site-notice-text', (el, value) => { el.value = value; }, plain);
    await consolePage.click('[data-site-notice="save"]');
    await page.bringToFront();
    await page.waitForFunction(text => document.querySelector('.site-notice__text')?.textContent === text, {}, plain);
    await page.click('.site-notice__label');
    await page.waitForSelector('.notice__body');
    assert.equal(await page.$eval('.notice__body', el => el.textContent), plain);
    assert.equal(await page.$('.notice__body b'), null);
    await page.keyboard.press('Escape');
    await page.evaluate(async () => (await import('/js/ui/resourcePanel.js')).openResources());
    await page.waitForSelector('.resource-modal');
    for (const [phase, expected] of [['download', '正在下载资源包'], ['verify', '正在校验资源包'], ['import', '正在导入资源包']]) {
      await page.evaluate(async phase => {
        const { h, render } = await import('/vendor/preact.module.js');
        const { ResourcePackProgress } = await import('/js/ui/resourcePanel.js');
        let fixture = document.querySelector('#progress-fixture');
        if (!fixture) { fixture = document.createElement('div'); fixture.id = 'progress-fixture'; document.querySelector('.resource-manager').prepend(fixture); }
        render(h(ResourcePackProgress, { progress: { phase, loaded: 512, totalBytes: 1024, speedBytesPerSecond: 256, done: 2, totalFiles: 4 } }), fixture);
      }, phase);
      await page.waitForFunction(label => document.querySelector('#progress-fixture')?.textContent.includes(label), {}, expected);
      if (phase === 'verify') assert.equal(await page.$('#progress-fixture [role="progressbar"]'), null);
      else assert.equal(await page.$eval('#progress-fixture [role="progressbar"]', el => el.getAttribute('aria-valuenow')), '50');
      await page.screenshot({ path: path.join(OUT, `reference-resource-${phase}-640.png`) });
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error('reference utility browser check failed:', error);
    throw error;
  } finally {
    await browser?.close(); await admin?.close(); await server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
