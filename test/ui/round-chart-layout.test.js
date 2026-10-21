import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundChartLayout } from '../../public/js/ui/roundChart.js';

test('desktop and console retain the original plot unless compact width is requested', () => {
  assert.deepEqual(roundChartLayout(), {width:720,height:260,left:52,right:96,top:12,bottom:30,fontSize:11,names:true,tickIndices:null});
});
test('compact plots keep readable labels and sparse ticks including both endpoints', () => {
  for (const width of [320,520,610,720]) for (const rounds of [1,2,40,100]) {
    const layout=roundChartLayout(width,rounds,14);
    assert.equal(layout.width,width); assert.equal(layout.fontSize,14);
    assert.equal(layout.tickIndices[0],0); assert.equal(layout.tickIndices.at(-1),rounds-1);
    assert.equal(new Set(layout.tickIndices).size,layout.tickIndices.length);
    assert.ok(layout.height-layout.top-layout.bottom>=100);
    if(rounds>=40) assert.ok(layout.tickIndices.length<=Math.floor((width-layout.left-layout.right)/56)+1);
  }
});
