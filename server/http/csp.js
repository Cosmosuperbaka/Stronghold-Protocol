// Site policy (DESIGN §32.11). Hash only import maps, never arbitrary inline script. Worker/UI policies are independent.
// worker-src 'self' is the asset service worker at /sw.js. blob: stays for workers the page already creates
// (the simulation worker). Do not add a remote worker origin. SIM_WORKER_CSP is that worker's own policy and
// must not gain the asset worker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// SES evaluates confined code. This relaxation belongs only to the simulation Worker, never its parent document.
export const SIM_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

// 素材镜像 (our-extended): the asset-mirror system (public/js/assetMirrors.js — preload, the strict fetch patch and the
// <img> fallback) and the static handler's mirror 302s send asset requests to hosts this origin never serves itself:
// cross-origin fetches, a mirrored /fonts/fonts.css stylesheet, its @font-face files and redirected /assets requests.
// Upstream has no mirrors, so the allowed origins ride on SP_ASSET_MIRROR_ORIGINS (space/comma separated, set in the
// systemd unit to the same hosts /data/asset-mirrors.json lists). Unset — the default — keeps the policy byte-for-byte
// upstream's. script-src never gains a mirror origin: mirrors serve data, never code.
export function mirrorOrigins(env = process.env) {
  const out = [];
  for (const part of String(env.SP_ASSET_MIRROR_ORIGINS || '').split(/[\s,]+/)) {
    if (!/^https?:\/\//i.test(part)) continue;
    const origin = part.replace(/\/+$/, '');
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

export function siteCsp(publicDir) {
  const hashes = new Set();
  for (const rel of ['index.html', 'studio/index.html', 'dev/game-mock.html', 'dev/render-demo.html', 'dev/battle-perf.html', 'dev/uikit.html']) {
    let html;
    try { html = fs.readFileSync(path.join(publicDir, rel), 'utf8'); } catch { continue; }
    for (const m of html.matchAll(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  const extra = mirrorOrigins().map((o) => ` ${o}`).join('');
  return `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${extra}; font-src 'self' https://fonts.gstatic.com${extra}; img-src 'self' data: blob:${extra}; connect-src 'self'${extra}; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'`;
}
