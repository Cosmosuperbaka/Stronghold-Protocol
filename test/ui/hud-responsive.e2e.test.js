import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
test('responsive HUD: persistent manual pings, unobstructed docks, shared visible bounds and desktop geometry', {
  skip: !enabled, timeout: 300000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const out = '.cache/hud-responsive'; fs.mkdirSync(out, { recursive: true });
  try {
    for (const [width, height, touch, render, textSize = 'sm'] of [[1920,1080,false,'fallback'],[1366,768,false,'fallback'],[844,390,true,'fallback'],[640,360,true,'fallback'],[640,360,true,'fallback','xl'],[844,390,true,'engine']]) {
      await t.test(`${width}×${height} ${render} ${textSize}`, async () => {
        const context = await browser.createBrowserContext();
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        try {
          await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
          await page.evaluateOnNewDocument(textSize => localStorage.setItem('sp.pref.settings',JSON.stringify({textSize})),textSize);
          await page.goto(`${server.url}/dev/game-mock.html?shot=1&phase=PREP&render=${render}`, { waitUntil: 'domcontentloaded', timeout:60000 });
          await page.waitForSelector('.gm__ping-tools');
          await page.waitForFunction(render => globalThis.__SP_VIEW__?.kind === render
            && document.querySelector('.gm__ping-tools').offsetHeight > 0, { timeout:60000 },render);
          await page.evaluate(()=>document.fonts.ready);
          await page.waitForSelector('.pbanner--overlay', { hidden:true, timeout:10000 });
          await page.waitForFunction(()=>[...document.querySelectorAll('.shopbar')].every(e=>!e.getAnimations().some(a=>a.playState==='running')));
          await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
          const bounds = async selector => page.$eval(selector, e => {
            const r = e.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
          });
          const old = await page.evaluate(() => Object.fromEntries(['.gtop','.team','.shopbar','.gm__corner'].map(s => {
            const r = document.querySelector(s).getBoundingClientRect(); return [s,[r.x,r.y,r.width,r.height]];
          })));
          if (touch) {
            if(width<768) {
              const actions=await page.$eval('.gm__corner-actions', e=>({width:e.clientWidth,scroll:e.scrollWidth}));
              assert.ok(actions.scroll>actions.width,'all utility controls remain in a bounded scroll row');
              for(const selector of ['[data-testid="settings-btn"]','.gm__guide','.gm__metrics']) {
                await page.$eval(selector,e=>e.scrollIntoView({block:'nearest',inline:'center'}));
                assert.ok(await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),selector);
              }
            }
            assert.equal(await page.$eval('.gm__ping-tools', e => e.hasAttribute('data-compact')), true);
            assert.deepEqual(await page.evaluate(() => {
              const panel = document.querySelector('.gm__ping-tools').getBoundingClientRect();
              const overlaps = r => panel.left < r.right && panel.right > r.left && panel.top < r.bottom && panel.bottom > r.top;
              return [...document.querySelectorAll('.team__btn, .shopbar__row, .shopbar__tools button, .gm__corner-actions')]
                .filter(e => e.offsetWidth && overlaps(e.getBoundingClientRect())).map(e => e.className);
            }), []);
            const strip = await page.$eval('.gm__ping-buttons', e => {
              const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,scrolls:e.scrollWidth>e.clientWidth};
            });
            if(strip.scrolls) {
              const cdp=await page.createCDPSession();
              await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:strip.x+strip.w-8,y:strip.y+strip.h/2}]});
              for(let i=1;i<=6;i++) {
                await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:strip.x+strip.w-8-(strip.w-16)*i/6,y:strip.y+strip.h/2}]});
                await new Promise(r=>setTimeout(r,20));
              }
              await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
              await page.waitForFunction(()=>document.querySelector('.gm__ping-buttons').scrollLeft>0);
              assert.equal(await page.$('.gm__ping-target'),null,'swiping the palette does not arm or send a ping');
              await cdp.detach();
            }
          } else assert.equal(await page.$eval('.gm__ping-tools', e => e.hasAttribute('data-compact')), false);
          for (const kind of ['attention','attack','danger','retreat','question','heart']) {
            await page.$eval(`.gm__ping-btn--${kind}`, e => e.scrollIntoView({ block:'nearest', inline:'center' }));
            await page.waitForFunction(kind => {
              const e=document.querySelector(`.gm__ping-btn--${kind}`),r=e.getBoundingClientRect();
              return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
            },{},kind);
            assert.ok(await page.$eval(`.gm__ping-btn--${kind}`, e => {
              const r=e.getBoundingClientRect(), compact=e.closest('[data-compact]'); return r.width>=(compact?30:44) && r.height>=(compact?30:44)
                && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
            }), `${kind} is reachable`);
          }
          await page.click('.gm__ping-btn--heart');
          await page.waitForSelector('.gm__ping-target');
          await page.click('.gm__ping-toggle');
          await page.waitForSelector('.gm__ping-target', { hidden:true });
          assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.pingsCollapsed')), 'true');
          assert.equal(await page.$('.gm__ping-buttons'), null);
          const after = await page.evaluate(() => Object.fromEntries(['.gtop','.team','.shopbar','.gm__corner'].map(s => {
            const r=document.querySelector(s).getBoundingClientRect();return [s,[r.x,r.y,r.width,r.height]];
          })));
          assert.deepEqual(after, old, 'collapsing pings does not move the original HUD or change its camera bands');
          await page.reload({waitUntil:'domcontentloaded',timeout:60000});
          await page.waitForSelector('.gm__ping-tools.is-collapsed');
          await page.click('.gm__ping-toggle');
          await page.waitForSelector('.gm__ping-buttons');
          // A secondary panel temporarily suppresses pings but must not rewrite the manual choice.
          await page.click('button[aria-controls="combat-metrics-panel"]');
          await page.waitForSelector('.combat-metrics');
          assert.equal(await page.$('.gm__ping-tools'), null);
          const metrics=await bounds('.combat-metrics');
          assert.ok(metrics.top>=0 && metrics.bottom<=height && metrics.left>=0 && metrics.right<=width, JSON.stringify(metrics));
          await page.click('.combat-metrics__close');
          await page.waitForSelector('.gm__ping-buttons');
          assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.pingsCollapsed')), 'false');
          await page.click('.ewheel__btn'); await page.waitForSelector('.ewheel__dialog');
          if(touch) {
            const dialog=await bounds('.ewheel__dialog'), corner=await bounds('.gm__corner');
            assert.ok(dialog.bottom<=corner.top && dialog.top>=0, JSON.stringify({dialog,corner}));
          }
          await page.click('.ewheel__btn');
          await page.evaluate(async () => {
            const {applyFit}=await import('/js/ui/screenFit.js');
            applyFit({l:30,r:24,t:12,b:16});
            globalThis.__MOCK__.mutate(s=>{s.pub.roundCharts=true;});
          });
          await page.waitForSelector('button[aria-controls="round-history-panel"]');
          await page.click('button[aria-controls="round-history-panel"]');
          await page.waitForSelector('#round-history-panel');
          const history=await bounds('#round-history-panel');
          assert.ok(history.left>=30 && history.right<=width-24 && history.top>=12 && history.bottom<=height-16, JSON.stringify(history));
          await page.screenshot({path:`${out}/${width}-${render}-${textSize}.png`});
          if(width===640&&textSize==='sm') {
            await page.click('.round-history__head button');
            await page.waitForSelector('.gm__ping-tools');
            await page.evaluate(()=>new Promise(r=>setTimeout(r,2200)));
            const corner=await bounds('.gm__corner'), shop=await bounds('.shopbar__row');
            assert.ok(corner.right<=shop.left,'screen-fit also bounds the complete corner beside the shop');
            await page.screenshot({path:`${out}/phone-pings-expanded.png`});
            await page.click('.gm__ping-toggle');
            await page.screenshot({path:`${out}/phone-pings-collapsed.png`});
            await page.click('.gm__ping-toggle');
            await page.setViewport({width:844,height:390,hasTouch:true,isMobile:true});
            await page.waitForFunction(()=>document.querySelector('.gm__ping-tools')?.getBoundingClientRect().right<=844);
            assert.equal(await page.evaluate(()=>localStorage.getItem('sp.pref.pingsCollapsed')),'false','rotation preserves the manual preference');
          }
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});
