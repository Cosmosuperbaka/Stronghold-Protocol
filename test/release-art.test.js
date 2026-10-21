import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadAndStage, pickReleaseAsset, createReleaseUpdater } from '../server/release-update.js';
import { applyReleaseStage } from '../server/release-install.js';
import { ART_STAGE_FILE } from '../server/release-art.js';
import { archive, releaseFor, files, put, read, until, signRelease, storedZip, manifest } from './helpers/release-fixture.js';
import { APP_VERSION } from '../shared/constants.js';
import { RELEASE_TAG } from '../server/release-version.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-release-art-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, 'package.json', files['package.json']); put(root, 'server/index.js', '// old server');
  return root;
}
const art = {
  'data/assets.json': JSON.stringify({ ui: { same: '/assets/same.png', changed: '/assets/changed.png', fresh: '/assets/new.png' } }),
  'data/local-assets.json': JSON.stringify({ groups: { scene: { file: { path: '/assets/local/scene.bin', version: 4 } } } }),
  'data/local-fx.json': JSON.stringify({ index: '/assets/local/fx/index.json' }),
  'public/assets/same.png': 'same image', 'public/assets/changed.png': 'new image', 'public/assets/new.png': 'new file',
  'public/assets/local/scene.bin': 'new scene', 'public/assets/local/fx/index.json': '{}', 'public/fonts/game.woff2': 'new font',
};
const zipFor = (entries = art) => archive(Object.entries(entries).map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body]));
const stage = (root, zip = zipFor()) => downloadAndStage({ root, release: releaseFor(zip), fetchImpl: async () => new Response(zip) });

test('complete signed archive is preferred over lite; lite-only releases are not silently installed', async t => {
  const root = fixture(t), zip = zipFor(), full = releaseFor(zip);
  const lite = { ...full.assets[0], name: full.assets[0].name.replace('-assets.zip', '-lite.zip') };
  full.assets.unshift(lite);
  assert.match(pickReleaseAsset(full).name, /-assets.zip$/);
  const release = releaseFor(zip), auth = signRelease(release, zip);
  release.assets.unshift(lite);
  const requests = [];
  const staged = await downloadAndStage({ root, release, keys: auth.keys, listing: 'mirror', fetchImpl: async url => {
    requests.push(url); return new Response(url.endsWith('.sig') ? auth.sig : url.endsWith('.txt') ? auth.sums : zip);
  } });
  assert.match(staged.asset, /-assets.zip$/);
  assert.ok(!requests.some(url => url.endsWith('-lite.zip')));
  const liteOnly = { ...release, assets: [lite] };
  await assert.rejects(downloadAndStage({ root, release: liteOnly }), /完整素材包/);
});

test('new, changed and extracted art plus manifests install together; matching and extra local files remain untouched', async t => {
  const root = fixture(t);
  put(root, 'public/assets/same.png', art['public/assets/same.png']);
  put(root, 'public/assets/changed.png', 'old image'); put(root, 'data/assets.json', '{}');
  put(root, 'public/assets/custom.png', 'custom art'); put(root, 'logs/admin-settings.json', 'settings');
  const staged = await stage(root);
  assert.equal(fs.existsSync(path.join(staged.stage, 'public/assets/same.png')), false, 'identical files need no staged copy');
  assert.equal(read(root, 'public/assets/changed.png'), 'old image', 'download does not mutate the running installation');
  const copied = [];
  const result = applyReleaseStage(root, staged.stage, { copyFile(from, to) { copied.push(path.relative(root, to).replaceAll('\\', '/')); fs.copyFileSync(from, to); } });
  for (const [rel, body] of Object.entries(art)) assert.equal(read(root, rel), body, rel);
  assert.ok(!copied.includes('public/assets/same.png'));
  assert.equal(read(result.backup, 'public/assets/changed.png'), 'old image');
  assert.equal(read(root, 'public/assets/custom.png'), 'custom art'); assert.equal(read(root, 'logs/admin-settings.json'), 'settings');
  assert.equal(fs.existsSync(path.join(root, ART_STAGE_FILE)), false, 'the staging journal is not a program file');
});

test('a copy failure after asset replacement restores old program, old art and manifests and removes newly created art', async t => {
  const root = fixture(t); put(root, 'public/assets/changed.png', 'old image'); put(root, 'data/assets.json', '{}');
  const staged = await stage(root);
  assert.throws(() => applyReleaseStage(root, staged.stage, { copyFile(from, to) {
    fs.copyFileSync(from, to);
    if (to.endsWith(`${path.sep}scene.bin`)) throw new Error('disk full');
  } }), /已恢复/);
  assert.equal(read(root, 'server/index.js'), '// old server'); assert.equal(read(root, 'public/assets/changed.png'), 'old image');
  assert.equal(read(root, 'data/assets.json'), '{}'); assert.equal(fs.existsSync(path.join(root, 'public/assets/new.png')), false);
  assert.equal(fs.existsSync(path.join(root, 'data/local-assets.json')), false);
});

test('missing referenced art and tampering with staged or retained art fail before any program replacement', async t => {
  const root = fixture(t);
  const missing = { ...art }; delete missing['public/assets/new.png'];
  await assert.rejects(stage(root, zipFor(missing)), /素材缺失/);
  for (const retained of [false, true]) {
    if (retained) put(root, 'public/assets/same.png', art['public/assets/same.png']);
    const staged = await stage(root);
    put(retained ? root : staged.stage, 'public/assets/same.png', 'tampered');
    assert.throws(() => applyReleaseStage(root, staged.stage), /素材校验失败/);
    assert.equal(read(root, 'server/index.js'), '// old server');
  }
  const noManifest = storedZip(Object.entries({ ...files, 'MANIFEST.json': manifest(files) }).map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body]));
  await assert.rejects(stage(root, noManifest), /缺少素材清单/);
});

test('linked asset directories are rejected without writing outside the installation', async t => {
  const root = fixture(t), outside = fixture(t);
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'public/assets'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stage(root), /符号链接/);
  assert.equal(fs.existsSync(path.join(outside, 'new.png')), false);
});

test('silently corrupted writes roll back assets and program; forged staging paths and versions are rejected', async t => {
  const root = fixture(t); put(root, 'public/assets/changed.png', 'old image');
  const staged = await stage(root);
  assert.throws(() => applyReleaseStage(root, staged.stage, { copyFile(from, to) {
    fs.copyFileSync(from, to);
    if (to.endsWith(`${path.sep}changed.png`)) fs.writeFileSync(to, 'corrupted');
  } }), /已恢复/);
  assert.equal(read(root, 'public/assets/changed.png'), 'old image'); assert.equal(read(root, 'server/index.js'), '// old server');
  for (const doc of [
    { format: 1, app: '0.0.0', files: {} },
    JSON.parse(manifest({ 'server/evil.js': 'bad' })),
    JSON.parse(manifest({ '../escape.png': 'bad' })),
  ]) {
    put(staged.stage, ART_STAGE_FILE, JSON.stringify(doc));
    assert.throws(() => applyReleaseStage(root, staged.stage));
    assert.equal(read(root, 'server/index.js'), '// old server');
  }
});

test('current release repair is explicit and still honors active-match protection', async t => {
  const root = fixture(t); let active = true, downloads = 0;
  const updater = createReleaseUpdater({ root, onReady() {}, hasActive: () => active,
    fetchImpl: async () => new Response(JSON.stringify([releaseFor(undefined, RELEASE_TAG)])),
    stageRelease: async () => { downloads++; throw new Error('test stops before install'); }, log: { warn() {} } });
  const status = await updater.check();
  assert.equal(status.versions.find(r => r.tag === RELEASE_TAG).installable, true);
  assert.match(updater.install({ tag: RELEASE_TAG }).error, /当前版本/);
  assert.equal(updater.install({ tag: RELEASE_TAG, repairAssets: true }).state, 'active-matches'); assert.equal(downloads, 0);
  active = false;
  updater.install({ tag: RELEASE_TAG, repairAssets: true });
  await until(() => updater.status().state === 'error'); assert.equal(downloads, 1);
  assert.equal(JSON.parse(read(root, 'package.json')).version, APP_VERSION);
});
