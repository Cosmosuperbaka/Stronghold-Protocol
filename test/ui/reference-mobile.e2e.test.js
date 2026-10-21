import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('reference-source mobile inheritance: intact room portraits, scrolling, scaled pings and remembered touch drag', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout:180000,
}, async t => {
  const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,assetIndex:false,recovery:false});
  const browser=await (await import('puppeteer-core')).default.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  fs.mkdirSync('.cache/reference-mobile',{recursive:true});
  try {
    for(const [width,height,textSize] of [[1920,1080,'sm'],[844,390,'sm'],[640,360,'xl']]) {
      await t.test(`room ${width} ${textSize}`,async()=>{
        const context=await browser.createBrowserContext(),page=await context.newPage();
        try {
          await page.setViewport({width,height,isMobile:width<900,hasTouch:width<900,isLandscape:true});
          await page.evaluateOnNewDocument(textSize=>{localStorage.setItem('sp.name','Reference Audit');sessionStorage.setItem('sp.entered','1');
            localStorage.setItem('sp.pref.settings',JSON.stringify({textSize}));},textSize);
          await page.goto(srv.url,{waitUntil:'domcontentloaded'});
          await page.waitForFunction(()=>globalThis.__SP__?.store.get().connection.status==='online'&&document.querySelector('.lobby-screen'));
          await page.evaluate(async()=>{await globalThis.__SP__.net.request('room.create',{mode:'coop',difficulty:'NORMAL'});
            for(let i=0;i<3;i++)await globalThis.__SP__.net.request('room.addBot',{});});
          await page.waitForFunction(()=>document.querySelectorAll('.rseat').length===4);
          await page.evaluate(()=>document.fonts.ready);
          await new Promise(r=>setTimeout(r,1000));
          const info=await page.evaluate(()=>{const a=document.querySelector('.rseat__art'),s=document.querySelector('.rs-seats');
            return {ratio:a.clientWidth/a.clientHeight,fit:getComputedStyle(a.querySelector('img')).objectFit,
              scroll:s.scrollHeight>s.clientHeight,cols:getComputedStyle(s).display};});
          if(width<900){assert.equal(info.fit,'contain');assert.ok(Math.abs(info.ratio-.5)<.02,JSON.stringify(info));assert.equal(info.cols,'grid');
            await page.$eval('.rseat__plate',e=>e.scrollIntoView({block:'end'}));
            assert.ok(await page.$eval('.rseat__plate',e=>{const r=e.getBoundingClientRect(),s=e.closest('.rs-seats').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom+1;}));
          }else{assert.equal(info.fit,'cover');assert.equal(info.cols,'flex');}
          await page.screenshot({path:`.cache/reference-mobile/room-${width}-${textSize}.png`});
        }finally{await context.close();}
      });
    }
    for(const [width,height]of[[1920,1080],[844,390],[640,360]]) {
      await t.test(`ping drag and scale ${width}`,async()=>{
        const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        try {
          await page.setViewport({width,height,isMobile:width<900,hasTouch:width<900});
          await page.goto(`${srv.url}/dev/game-mock.html?phase=PREP&render=fallback&shot=1`,{waitUntil:'domcontentloaded'});
          await page.waitForFunction(()=>globalThis.__SP_VIEW__?.kind==='fallback');
          await page.waitForSelector('.pbanner--overlay',{hidden:true});
          const button=await page.$eval('.gm__ping-btn',e=>e.getBoundingClientRect().width);
          assert.equal(button,width<900?30:44);
          if(width<900){
            assert.ok(await page.$eval('.gm__ping-btn',e=>{
              const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
              return [[x-21,y],[x+21,y],[x,y-21],[x,y+21]].every(([x,y])=>e.contains(document.elementFromPoint(x,y)));
            }),'the 30px visual button retains a separate 44px touch target');
          }
          const before=await page.$eval('.gm__ping-tools',e=>e.getBoundingClientRect().toJSON());
          const handle=await page.$eval('.gm__ping-toggle',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
          const x=Math.min(width-100,handle.x+100),y=Math.max(70,handle.y-100);
          if(width<900) {
            const cdp=await page.createCDPSession();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[handle]});
            for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:handle.x+(x-handle.x)*i/8,y:handle.y+(y-handle.y)*i/8}]});}
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
          } else {await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(x,y,{steps:8});await page.mouse.up();}
          await page.waitForFunction(()=>!!localStorage.getItem('sp.pref.pingPosition'));
          assert.equal(await page.$('.gm__ping-tools.is-collapsed'),null,'drag release does not collapse');
          assert.equal(await page.$('.gm__ping-target'),null,'drag does not arm field placement');
          const moved=await page.$eval('.gm__ping-tools',e=>e.getBoundingClientRect().toJSON());
          assert.ok(Math.abs(before.y-moved.y)>20||Math.abs(before.x-moved.x)>20);
          const saved=await page.evaluate(()=>localStorage.getItem('sp.pref.pingPosition'));
          await page.click('.gm__ping-toggle');await page.waitForSelector('.gm__ping-tools.is-collapsed');
          const small=await page.$eval('.gm__ping-tools',e=>e.getBoundingClientRect().width);assert.ok(small<80,`collapsed width ${small}`);
          await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.gm__ping-tools[data-positioned].is-collapsed');
          assert.equal(await page.evaluate(()=>localStorage.getItem('sp.pref.pingPosition')),saved);
          await page.click('.gm__ping-toggle');await page.waitForSelector('.gm__ping-buttons');
          await page.setViewport({width:640,height:360,isMobile:true,hasTouch:true});
          await page.waitForFunction(()=>{const r=document.querySelector('.gm__ping-tools').getBoundingClientRect();return r.left>=0&&r.right<=640&&r.top>=0&&r.bottom<=360;});
          await page.screenshot({path:`.cache/reference-mobile/ping-drag-${width}.png`});
          await page.click('.gm__ping-reset');await page.waitForFunction(()=>localStorage.getItem('sp.pref.pingPosition')==='null');
          assert.equal(await page.$('.gm__ping-tools[data-positioned]'),null);
          assert.deepEqual(errors,[]);
        }finally{await context.close();}
      });
    }
  }finally{await browser.close();await srv.close();}
});
