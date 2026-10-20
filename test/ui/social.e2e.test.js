import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { resetHostSettings } from '../../server/match/hostSettings.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('online roster, private status, accepted invitation and console policy at desktop and phone sizes', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-social-ui-'));
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, recovery: false, studio: false });
  const admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir: path.join(dir,'results'), settingsFile: path.join(dir,'settings.json'), log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const contexts = [], errors = []; fs.mkdirSync('.cache/social', { recursive: true });
  try {
    const player = async (name, width = 1280, height = 720) => {
      const context = await browser.createBrowserContext(); contexts.push(context);
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width, height, isMobile: width < 1000, hasTouch: width < 1000 });
      await page.evaluateOnNewDocument(name => { localStorage.setItem('sp.name',name); sessionStorage.setItem('sp.entered','1'); }, name);
      await page.goto(srv.url, { waitUntil:'domcontentloaded' });
      await page.waitForSelector('.social-online'); return page;
    };
    const host = await player('RosterHost'), guest = await player('RosterGuest',844,390), hidden = await player('HiddenDoctor');
    await hidden.select('[name="presence-status"]','invisible');
    await hidden.waitForFunction(() => globalThis.__SP__.store.get().social.self === 'invisible');
    await host.click('.social-online'); await host.waitForSelector('.social-player');
    assert.ok(!(await host.$eval('.social-players', e => e.textContent)).includes('HiddenDoctor'));
    assert.ok((await host.$eval('.social-players', e => e.textContent)).includes('RosterGuest'));
    await host.screenshot({ path:'.cache/social/roster-desktop.png' });
    await host.evaluate(() => [...document.querySelectorAll('.social-modal button')].find(e => e.textContent.includes('关闭')).click());
    await host.waitForFunction(() => !document.querySelector('.social-modal'));
    await host.evaluate(async () => (await import('/js/net.js')).net.request('room.create',{mode:'coop',difficulty:'NORMAL'}));
    await host.waitForSelector('.rs-key__friends');
    await host.click('.rs-key__friends');
    await host.waitForFunction(() => [...document.querySelectorAll('.social-player')].some(e => e.textContent.includes('RosterGuest') && !e.querySelector('button').disabled));
    await host.evaluate(() => [...document.querySelectorAll('.social-player')].find(e => e.textContent.includes('RosterGuest')).querySelector('button').click());
    await guest.waitForSelector('.social-invites');
    await guest.waitForFunction(() => document.fonts.status === 'loaded');
    assert.ok(await guest.$eval('.social-invites',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
    await guest.screenshot({ path:'.cache/social/invite-mobile.png' });
    assert.equal(await guest.evaluate(() => globalThis.__SP__.store.get().room),null);
    await guest.evaluate(() => [...document.querySelectorAll('.social-invites button')].find(e => e.textContent.includes('加入房间')).click());
    await guest.waitForSelector('.room-screen');
    const roomCode = await guest.evaluate(() => globalThis.__SP__.store.get().room.code);
    assert.equal(await host.evaluate(() => globalThis.__SP__.store.get().room.code),roomCode);
    await host.setViewport({width:640,height:360,isMobile:true,hasTouch:true});
    await host.evaluate(async () => (await import('/js/ui/social.js')).openOnlinePlayers());
    await host.waitForSelector('.social-modal');
    await host.waitForFunction(() => !document.querySelector('.social-modal')?.getAnimations().some(a=>a.playState==='running'));
    assert.ok(await host.$eval('.social-modal',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
    await host.screenshot({path:'.cache/social/roster-mobile.png'});
    await hidden.reload({waitUntil:'domcontentloaded'});
    await hidden.waitForFunction(() => globalThis.__SP__?.store.get().social?.self === 'invisible');
    assert.equal(srv.lobby.social.sessions().find(s => s.name === 'HiddenDoctor').presenceStatus,'invisible');
    const consolePage = await browser.newPage(); consolePage.on('pageerror',e=>errors.push(e.message));
    await consolePage.goto(admin.url,{waitUntil:'domcontentloaded'}); await consolePage.click('[data-tab="settings"]');
    await consolePage.waitForSelector('[data-social-option="directory"]');
    await consolePage.click('[data-social-option="directory"]');
    await consolePage.click('[data-social-option="invitations"]');
    await consolePage.click('[data-social-save]');
    await consolePage.waitForFunction(() => document.querySelector('#social-saved').textContent.includes('已保存'));
    await host.waitForFunction(() => !globalThis.__SP__.store.get().social.policy.directory);
    await hidden.waitForFunction(() => document.querySelector('.social-online').disabled);
    await consolePage.setViewport({width:390,height:844});
    await consolePage.$eval('#social-settings',e=>e.scrollIntoView());
    assert.ok(await consolePage.$eval('#social-settings',e=>e.scrollWidth<=e.clientWidth));
    await consolePage.screenshot({path:'.cache/social/console-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
  } finally {
    await Promise.all(contexts.map(c=>c.close())); await browser.close(); await admin.close(); srv.server.closeAllConnections(); await srv.close();
    resetHostSettings(); fs.rmSync(dir,{recursive:true,force:true});
  }
});
