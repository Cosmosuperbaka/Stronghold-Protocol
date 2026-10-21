import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleHudFrame, fitHudPanel, overlapArea } from '../../public/js/ui/hudLayout.js';

test('HUD frame intersects screen-fit bounds with the visible keyboard viewport', () => {
  assert.deepEqual(visibleHudFrame({ left: 30, top: 20, right: 820, bottom: 370 },
    { left: 0, top: 40, right: 844, bottom: 230 }), { left: 36, top: 46, right: 814, bottom: 224 });
});

test('a constrained ping dock avoids teammates, shop, corner and the board including the bench', () => {
  const frame = { left: 6, top: 6, right: 634, bottom: 354 };
  const obstacles = [
    { left: 8, top: 94, right: 86, bottom: 240 },
    { left: 9, top: 240, right: 120, bottom: 351 },
    { left: 122, top: 252, right: 630, bottom: 352 },
    { left: 490, top: 199, right: 630, bottom: 248 },
    { left: 530, top: 48, right: 630, bottom: 82 },
    { left: 602, top: 92, right: 630, bottom: 172 },
    { left: 0, top: 0, right: 640, bottom: 86 },
  ];
  const board = { left: 198, top: 86, right: 420, bottom: 216 };
  const dock = fitHudPanel({ frame, anchor: { left: 9, top: 170 }, width: 346, height: 58, minWidth: 110, obstacles, board });
  assert.equal(obstacles.reduce((s, r) => s + overlapArea(dock, r), 0), 0);
  assert.equal(overlapArea(dock, board), 0);
  assert.ok(dock.width < 346, 'the scroll viewport shrinks instead of covering a control or bench');
  assert.ok(dock.left >= frame.left && dock.right <= frame.right && dock.top >= frame.top && dock.bottom <= frame.bottom);
});

test('unobstructed docks preserve their requested size and anchor', () => {
  const dock = fitHudPanel({ frame: { left: 0, top: 0, right: 1920, bottom: 1080 },
    anchor: { left: 24, top: 900 }, width: 346, height: 79, minWidth: 110 });
  assert.deepEqual(dock, { left: 24, top: 900, right: 370, bottom: 979, width: 346, height: 79 });
});
