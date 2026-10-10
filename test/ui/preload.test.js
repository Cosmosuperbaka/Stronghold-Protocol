import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preloadPlan, runPreload } from '../../public/js/ui/preload.js';

test('preload plan deduplicates installed media, uses actual local URLs and excludes remote/unsafe URLs', () => {
  const m = { avatar: '/assets/a.png', model: { skel: '/assets/a.skel', textures: ['/assets/a.png'] }, audio: '/assets/a.mp3', remote: 'https://x/a.png', bad: '/assets/../secret', bad2: '/assets/a\\b' };
  const local = { groups: { map: { board: { path: '/assets/local/map/board.png' } } } };
  const visual = preloadPlan(m, local);
  assert.ok(visual.includes('/assets/local/map/board.png'));
  assert.ok(visual.includes('/vendor/pixi-spine.js'));
  assert.equal(visual.filter((u) => u === '/assets/a.png').length, 1);
  assert.ok(!visual.some((u) => /https|\.\.|\\|mp3/.test(u)));
  assert.ok(preloadPlan(m, local, 'all').includes('/assets/a.mp3'));
});

test('preloader caps concurrency, drains bodies and counts HTTP failures', async () => {
  let active = 0, peak = 0, drained = 0;
  const r = await runPreload(['/assets/1.png', '/assets/2.png', '/assets/3.png'], { concurrency: 2,
    fetchImpl: async (u, o) => {
      assert.equal(o.cache, 'force-cache'); active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5)); active--;
      return { ok: !u.includes('2'), status: 404, arrayBuffer: async () => { drained++; } };
    } });
  assert.deepEqual(r, { done: 3, total: 3, failed: 1, cancelled: false });
  assert.equal(peak, 2); assert.equal(drained, 2);
});

test('cancel stops queued fetches and releases running requests; timeout counts a failure', async () => {
  const c = new AbortController(); let started = 0;
  const hanging = (_u, { signal }) => new Promise((_resolve, reject) => {
    started++; signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const p = runPreload(['a', 'b', 'c'], { signal: c.signal, fetchImpl: hanging, concurrency: 1 });
  c.abort();
  assert.equal((await p).cancelled, true); assert.equal(started, 1);
  const r = await runPreload(['a'], { fetchImpl: hanging, timeoutMs: 5 });
  assert.equal(r.failed, 1); assert.equal(r.done, 1);
});
