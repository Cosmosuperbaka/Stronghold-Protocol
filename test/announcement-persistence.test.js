import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SiteAnnouncements } from '../server/announcements.js';
import { startServer } from '../server/index.js';
import { startAdmin } from '../server/admin.js';
import { TestClient } from './helpers/wsClient.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notice-persist-')), services = [];
  let now = 1000;
  const file = path.join(dir, 'announcement-state.json');
  const service = () => { const s = new SiteAnnouncements({ now: () => now }); services.push(s); s.loadPersistence(file); return s; };
  t.after(() => { for (const s of services) s.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, file, service, setNow: value => { now = value; } };
}
const notice = (extra = {}) => ({ text: '# Notice', format: 'markdown', level: 'warning', startAt: 1000, endAt: 10000, ...extra });

test('persistence defaults on; re-enabling saves the current notice and restores ID, format and absolute dates', t => {
  const f = fixture(t), first = f.service();
  assert.equal(first.persistEnabled, true);
  first.setPersistence(false);
  first.set(notice()); const original = first.frame().announcement;
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).notice, null, 'disabled never saves the notice');
  assert.deepEqual(first.setPersistence(true), { ok: true, enabled: true });
  f.setNow(4000); const restored = f.service();
  assert.equal(restored.persistEnabled, true);
  assert.deepEqual(restored.frame().announcement, original);
  restored.set(notice({ text: 'replacement' }));
  assert.notEqual(restored.frame().announcement.id, original.id);
  assert.equal(f.service().frame().announcement.text, 'replacement');
});
test('scheduled and until-removed notices survive, expired notices do not return', t => {
  const f = fixture(t), first = f.service(); first.setPersistence(true);
  first.set(notice({ startAt: 5000, endAt: 10000 }));
  f.setNow(3000); const scheduled = f.service().frame().announcement;
  assert.equal(scheduled.startAt, 5000);
  assert.equal(scheduled.endAt, 10000);
  f.setNow(10000); assert.equal(f.service().frame().announcement, null);
  first.set(notice({ endAt: 8640000000000000, untilRemoved: true }));
  const indefinite = f.service().frame().announcement;
  assert.equal(indefinite.untilRemoved, true);
  assert.equal(indefinite.endAt, 8640000000000000);
});
test('withdrawal and disabling remove future recovery without changing the current notice when disabled', t => {
  const f = fixture(t), first = f.service(); first.setPersistence(true); first.set(notice());
  first.set(null); assert.equal(f.service().frame().announcement, null);
  first.set(notice()); const current = first.frame().announcement;
  assert.deepEqual(first.setPersistence(false), { ok: true, enabled: false });
  assert.deepEqual(first.frame().announcement, current);
  assert.equal(f.service().frame().announcement, null);
  first.set(notice({ text: 'memory-only' }));
  assert.equal(f.service().frame().announcement, null);
  assert.ok(first.setPersistence('true').error);
});
test('failed writes and corrupted recovery data do not replace the live notice or last saved state', t => {
  const f = fixture(t), first = f.service(); first.set(notice());
  first.setPersistence(true); const current = first.frame().announcement, bytes = fs.readFileSync(f.file, 'utf8');
  fs.mkdirSync(f.file + '.tmp');
  assert.ok(first.set(notice({ text: 'failed edit' })).error);
  assert.ok(first.set(null).error);
  assert.ok(first.setPersistence(false).error);
  assert.equal(first.persistEnabled, true);
  assert.deepEqual(first.frame().announcement, current);
  assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  fs.rmdirSync(f.file + '.tmp');
  fs.writeFileSync(f.file, '{broken');
  const other = new SiteAnnouncements(); t.after(() => other.dispose());
  assert.throws(() => other.loadPersistence(f.file));
  assert.equal(other.frame().announcement, null);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{broken');
});
test('authenticated console config survives a real server restart and record cleanup cannot erase it', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notice-reboot-'));
  let server, admin, client;
  const close = async () => { await client?.terminate(); client = null; await admin?.close(); admin = null; await server?.close(); server = null; };
  t.after(async () => { await close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const start = async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, studio: false });
    admin = await startAdmin({ lobby: server.lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
  };
  const request = async (route, body, auth = true) => {
    const response = await fetch(`http://127.0.0.1:${admin.port}${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Admin-Token': admin.token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  await start();
  assert.equal((await request('/api/announcement-persistence', { enabled: true }, false)).status, 403);
  assert.equal((await request('/api/announcement-persistence', { enabled: 'yes' })).status, 400);
  assert.equal((await request('/api/announcement-persistence')).body.enabled, true);
  const now = Date.now(), value = notice({ startAt: now, endAt: now + 60000 });
  server.lobby.announcements.set(value);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'announcement-state.json'), 'utf8')).notice.text, value.text, 'default-on saves published notices without opting in');
  assert.equal((await request('/api/announcement-persistence', { enabled: true })).body.ok, true);
  const original = server.lobby.announcements.frame().announcement;
  assert.equal((await request('/api/storage', { confirm: true, id: 'announcement-state.json' })).status, 400);
  assert.equal((await request('/api/storage', { confirm: true, categories: ['results'] })).body.ok, true);
  await close(); await start();
  assert.equal((await request('/api/announcement-persistence')).body.enabled, true);
  client = await TestClient.connect(server.url.replace('http', 'ws') + '/ws'); await client.hello('Notice');
  assert.deepEqual((await client.waitFor('site.announcement')).announcement, original);
  server.lobby.announcements.set(null); await close(); await start();
  assert.equal(server.lobby.announcements.frame().announcement, null, 'withdrawn notice stays withdrawn');
});
