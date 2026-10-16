// local-tools: the asset mirrors (public/js/assetMirrors.js) must stay reachable under the site CSP. The mirror
// origins from SP_ASSET_MIRROR_ORIGINS land in style-src (the mirrored fonts.css), font-src (its @font-face files),
// img-src (the image mirror fallback) and connect-src (preload, the strict fetch patch and the static handler's
// mirror 302s); script-src never gains one. Unset — the default — the policy stays byte-for-byte upstream's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteCsp, mirrorOrigins } from '../../server/http/csp.js';

test('without SP_ASSET_MIRROR_ORIGINS the policy matches upstream (no mirror origins anywhere)', () => {
  delete process.env.SP_ASSET_MIRROR_ORIGINS;
  const csp = siteCsp('/nonexistent');
  assert.equal(
    csp,
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
    + " font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self';"
    + " worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'",
  );
  assert.deepEqual(mirrorOrigins({}), []);
  assert.deepEqual(mirrorOrigins({ SP_ASSET_MIRROR_ORIGINS: 'not-a-url , ftp://x' }), []);
});

test('SP_ASSET_MIRROR_ORIGINS extends the four asset directives, never script-src', () => {
  process.env.SP_ASSET_MIRROR_ORIGINS = 'https://mirror.example.com , https://cdn.example.com/  junk';
  try {
    assert.deepEqual(mirrorOrigins(), ['https://mirror.example.com', 'https://cdn.example.com']);
    const csp = siteCsp('/nonexistent');
    const directive = (name) => csp.split('; ').find((d) => d.startsWith(`${name} `)) || '';
    for (const name of ['style-src', 'font-src', 'img-src', 'connect-src']) {
      const list = directive(name);
      assert.ok(list.includes('https://mirror.example.com'), `${name} gains the mirrors`);
      assert.ok(list.includes('https://cdn.example.com'), `${name} gains the mirrors`);
    }
    assert.equal(directive('img-src').includes('https://cdn.example.com/'), false, 'trailing slash stripped');
    assert.equal(/script-src[^;]*mirror\.example|script-src[^;]*cdn\.example/.test(csp), false, 'script-src never gains a mirror');
    assert.equal(directive('script-src'), "script-src 'self'", 'script-src stays self-only without import maps');
  } finally {
    delete process.env.SP_ASSET_MIRROR_ORIGINS;
  }
});
