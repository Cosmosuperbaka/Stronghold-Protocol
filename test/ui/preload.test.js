// ui/preload.js now hosts the preloader UI (PreloadWidget / PreloadModal / installPreload — ported from a community
// build); its plan/run logic moved to preload/manifest.js + preload/service.js (driven with an injectable store here).
// Pin the ported core: collectAssets walks the manifest and tags categories; the preloader downloads through the
// store, skips what it already holds, retries failures and reports progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAssets, categoryOf } from '../../public/js/preload/manifest.js';
import { createPreloader } from '../../public/js/preload/service.js';
import { createMemoryStore } from '../../public/js/preload/store.js';

test('collectAssets walks the manifest: keeps only /assets and /fonts, tags categories', () => {
  const m = {
    avatar: '/assets/chars/char_1/a.png',
    model: { spine: { front: { skel: '/assets/chars/char_1/spine/a.skel' } } },
    audio: { bgm: '/assets/audio/bgm/x.mp3', voice: '/assets/audio/voice/char_1/x.mp3' },
    fonts: '/fonts/fonts.css',
    remote: 'https://x/a.png',
    ignored: '/data/other.json',
  };
  const c = collectAssets(m);
  const urls = c.files.map((f) => f.url);
  assert.ok(urls.includes('/assets/chars/char_1/a.png'));
  assert.ok(urls.includes('/assets/chars/char_1/spine/a.skel'));
  assert.ok(urls.includes('/assets/audio/bgm/x.mp3'));
  assert.ok(urls.includes('/fonts/fonts.css'));
  assert.ok(!urls.some((u) => /^https|\/data\//.test(u)));
  assert.equal(categoryOf(['chars', 'char_1', 'spine']), 'spine');
  assert.equal(categoryOf(['audio', 'voice', 'char_1']), 'voice');
  assert.equal(categoryOf(['audio', 'bgm', 'x']), 'bgm');
});

test('collectAssets dedupes and folds the local-client manifest into map', () => {
  const m = { a: '/assets/x/a.png', b: '/assets/x/a.png' };
  const local = { groups: { map: { board: { path: '/assets/local/map/board.png' } } } };
  const c = collectAssets(m, { extra: [local] });
  assert.equal(c.files.filter((f) => f.url === '/assets/x/a.png').length, 1);
  const loc = c.files.find((f) => f.url === '/assets/local/map/board.png');
  assert.equal(loc.category, 'map');
});

test('the preloader downloads through the store, skips what it holds and reports progress', async () => {
  const store = createMemoryStore();
  const urls = ['/assets/1.png', '/assets/2.png', '/assets/3.png'];
  let calls = 0;
  const service = createPreloader({
    store,
    fetch: async () => { calls++; return { ok: true, status: 200, blob: async () => ({ size: 10 }) }; },
    concurrency: 2,
    collect: () => ({ files: urls.map((url) => ({ url, category: 'icon' })), counts: {}, total: 3, bytes: 0 }),
  });
  await service.refresh({ manifest: {}, manifestVersion: 'v1' });
  service.start();
  for (let i = 0; i < 50 && service.state().status !== 'done'; i++) await new Promise((r) => setTimeout(r, 10));
  const s = service.state();
  assert.equal(s.done, 3);
  assert.equal(s.status, 'done');
  assert.equal(calls, 3);
  // re-start: everything is stored → no new fetch (a reload continues where the last session stopped)
  service.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 3);
  assert.ok(await service.blobFor('/assets/1.png'));
});

test('a failing file retries then counts as failed without failing the run', async () => {
  const store = createMemoryStore();
  let calls = 0;
  const service = createPreloader({
    store,
    fetch: async () => { calls++; return { ok: false, status: 404 }; },
    retries: 1,
    retryMs: 1,
    collect: () => ({ files: [{ url: '/assets/x.png', category: 'icon' }], counts: {}, total: 1, bytes: 0 }),
  });
  await service.refresh({ manifest: {} });
  service.start();
  for (let i = 0; i < 50 && service.state().status !== 'done'; i++) await new Promise((r) => setTimeout(r, 10));
  const s = service.state();
  assert.equal(s.failed, 1);
  assert.equal(calls, 2); // initial + 1 retry
});
