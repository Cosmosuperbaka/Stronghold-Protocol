import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('round history: compact chrome, readable curves, touch tooltip and scrollable ranking', {
  skip:process.env.SP_E2E!=='1'||!hasChrome(),timeout:120000,
},async t=>{
  const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,assetIndex:false});
  const browser=await(await import('puppeteer-core')).default.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  fs.mkdirSync('.cache/round-history-mobile',{recursive:true});
  try{
    for(const [width,height,touch,textSize]of[[1920,1080,false,'sm'],[1366,768,true,'sm'],[844,390,true,'sm'],[640,360,true,'sm'],[640,360,true,'xl'],[560,320,true,'sm'],[390,844,true,'sm']]){
      await t.test(width+'x'+height+' '+textSize,async()=>{
        const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        try{
          await page.setViewport({width,height,hasTouch:touch,isMobile:width<1000});
          await page.evaluateOnNewDocument(textSize=>localStorage.setItem('sp.pref.settings',JSON.stringify({textSize})),textSize);
          await page.goto(srv.url+'/dev/game-mock.html?phase=PREP&render=fallback&shot=1',{waitUntil:'domcontentloaded'});
          await page.waitForFunction(()=>!!globalThis.__SP_VIEW__);
          await page.evaluate(async()=>{
            const [{render,h},{RoundHistoryPanel}]=await Promise.all([import('/vendor/preact.module.js'),import('/js/ui/roundHistory.js')]);
            const players=Array.from({length:4},(_,i)=>({playerId:'p'+i,name:'博士'+i+'·很长的玩家名称'}));
            let history=Array.from({length:40},(_,r)=>({round:r+1,live:r===39,players:players.map((p,i)=>({...p,alive:true,lp:40-r/(i+1),funds:10+r,spent:r*3,dmg:(r+1)*(i+1)*1000,
              units:Array.from({length:6},(_,u)=>({defId:'op'+u,name:'干员'+i+'-'+u,dmg:(u+1)*(i+1)*100,kills:u})),bonds:[]}))}));
            const show=()=>render(h(RoundHistoryPanel,{history,players,onClose:()=>{globalThis.__closed=true;render(null,document.getElementById('app'));}}),document.getElementById('app'));
            globalThis.__updateHistory=()=>{history=history.map((x,i)=>i===39?{...x,players:x.players.map(p=>({...p,funds:99}))}:x);show();};
            show(); await document.fonts.ready;
          });
          await page.waitForSelector('.round-history .chart-wrap svg');
          await page.waitForFunction(()=>{
            const p=document.querySelector('.round-history'),svg=p.querySelector('.chart-wrap svg');
            return innerWidth>1000||Math.abs(svg?.viewBox.baseVal.width-svg?.getBoundingClientRect().width)<1;
          });
          const geo=await page.evaluate(()=>{
            const p=document.querySelector('.round-history'),body=p.querySelector('.round-history__body'),svg=p.querySelector('.chart-wrap svg'),head=p.querySelector('.round-history__head'),text=svg.querySelector('text');
            const r=p.getBoundingClientRect(),b=body.getBoundingClientRect(),s=svg.getBoundingClientRect();
            return{panel:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},bodyHeight:b.height,headHeight:head.getBoundingClientRect().height,
              width:s.width,viewWidth:svg.viewBox.baseVal.width,font:parseFloat(getComputedStyle(text).fontSize)*s.width/svg.viewBox.baseVal.width,
              axisLabels:[...svg.querySelectorAll('text[text-anchor=middle]')].map(e=>e.textContent),overflow:svg.parentElement.scrollWidth-svg.parentElement.clientWidth,
              buttonHeight:p.querySelector('.round-history__head button').getBoundingClientRect().height};
          });
          assert.ok(geo.panel.left>=0&&geo.panel.right<=width&&geo.panel.bottom<=height,JSON.stringify(geo));
          if(width<1000){
            assert.ok(geo.headHeight<56,JSON.stringify(geo));assert.equal(geo.buttonHeight,32);
            assert.ok(geo.font>=11.9,JSON.stringify(geo));assert.ok(geo.overflow<=1,JSON.stringify(geo));
            assert.ok(geo.axisLabels.length<15);assert.equal(geo.axisLabels[0],'1');assert.equal(geo.axisLabels.at(-1),'40');
            assert.ok(Math.abs(geo.width-geo.viewWidth)<=1);
          }else{assert.equal(geo.viewWidth,720);assert.equal(geo.buttonHeight,touch?44:36);}
          await page.$eval('.round-history .chart-wrap',e=>e.scrollIntoView({block:'center'}));
          if(touch){const hit=await page.$('.round-history .hit');await hit.tap();}
          else await page.hover('.round-history .hit');
          await page.waitForFunction(()=>document.querySelector('.round-history .tip').style.display==='block');
          assert.ok(await page.$eval('.round-history .tip',e=>{const r=e.getBoundingClientRect(),p=e.closest('.round-history').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;}));
          const select=await page.$('.round-history select');await select.focus();
          await page.evaluate(()=>globalThis.__updateHistory());
          assert.equal(await select.evaluate(e=>e.isConnected&&e===document.activeElement),true);
          await page.select('.round-history select','funds');
          await page.screenshot({path:'.cache/round-history-mobile/curve-'+width+'-'+textSize+'.png'});
          if(width===640&&textSize==='sm'){
            await page.setViewport({width:844,height:390,hasTouch:true,isMobile:true});
            await page.waitForFunction(()=>{const s=document.querySelector('.round-history .chart-wrap svg');return s.viewBox.baseVal.width>650&&Math.abs(s.viewBox.baseVal.width-s.getBoundingClientRect().width)<1;});
            assert.equal(await page.$eval('.round-history select',e=>e.value),'funds','rotation keeps the metric choice');
            await page.setViewport({width,height,hasTouch:touch,isMobile:true});
            await page.waitForFunction(()=>document.querySelector('.round-history .chart-wrap svg').viewBox.baseVal.width<640);
          }
          await page.click('.round-history__tabs button:nth-child(2)');await page.waitForSelector('.round-history table');
          assert.equal(await page.$$eval('.round-history tbody tr',es=>es.length),10);
          await page.click('.round-history button[data-k=all]');
          assert.equal(await page.$$eval('.round-history tbody tr',es=>es.length),24);
          await page.$eval('.round-history__body',e=>{e.scrollTop=e.scrollHeight;});
          const closeInfo=await page.$eval('.round-history__head button',e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return{clickable:e.contains(hit),rect:r.toJSON(),hit:hit?.outerHTML.slice(0,160),panel:e.closest('.round-history').getBoundingClientRect().toJSON(),
              viewport:{top:visualViewport?.offsetTop,height:visualViewport?.height},scroll:document.scrollingElement.scrollTop};});
          assert.ok(closeInfo.clickable,JSON.stringify(closeInfo));
          if(width<640){
            const r=await page.$eval('.round-history .xscroll',e=>{
              e.scrollIntoView({block:'center'});e.scrollLeft=0;
              const r=e.getBoundingClientRect(),body=e.closest('.round-history__body').getBoundingClientRect();
              return{x:r.x,w:r.width,y:(Math.max(r.top,body.top)+Math.min(r.bottom,body.bottom))/2,scrolls:e.scrollWidth>e.clientWidth};
            });
            if(r.scrolls){
              const cdp=await page.createCDPSession(),y=r.y;
              await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.w-15,y}]});
              for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.w-15-(r.w-30)*i/8,y}]});await new Promise(r=>setTimeout(r,20));}
              await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
              await page.waitForFunction(()=>document.querySelector('.round-history .xscroll').scrollLeft>0);
              await cdp.detach();
            }
          }
          await page.$eval('.round-history .xscroll',e=>{e.scrollLeft=e.scrollWidth;});
          assert.ok(await page.$eval('.round-history .xscroll',e=>{
            const last=e.querySelector('tbody tr td:last-child').getBoundingClientRect(),r=e.getBoundingClientRect();
            return getComputedStyle(e).overflowX==='auto'&&last.right<=r.right+1;
          }),'all ranking columns are reachable, scrolling only when needed');
          await page.screenshot({path:'.cache/round-history-mobile/rank-'+width+'-'+textSize+'.png'});
          await page.click('.round-history__head button');assert.equal(await page.evaluate(()=>globalThis.__closed),true);
          assert.deepEqual(errors,[]);
        }finally{await context.close();}
      });
    }
  }finally{await browser.close();await srv.close();}
});
