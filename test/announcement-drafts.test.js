import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AnnouncementDrafts, MAX_ANNOUNCEMENT_DRAFTS } from '../server/announcement-drafts.js';
import { startAdmin } from '../server/admin.js';
import { SiteAnnouncements } from '../server/announcements.js';
import { ANNOUNCEMENT_TEMPLATES } from '../public/js/ui/announcementTemplates.js';

const value = extra => ({ title: '维护草稿', text: '# 维护安排', format: 'markdown', level: 'warning', delay: 600000, duration: 'untilRemoved', ...extra });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notice-drafts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new AnnouncementDrafts(path.join(dir, 'announcement-drafts.json'));
}
test('drafts create/update/reload/delete without changing Unicode or relative publication times', t => {
  const store = fixture(t);
  assert.deepEqual(store.list(), []);
  const saved = store.save(value({ text: '🙂'.repeat(20000) }));
  assert.equal(saved.ok, true);
  const next = new AnnouncementDrafts(store.file);
  assert.deepEqual(next.list(), [saved.draft]);
  const edited = next.save(value({ id: saved.draft.id, text: '' }));
  assert.equal(edited.ok, true, 'incomplete empty drafts are allowed');
  assert.equal(edited.draft.createdAt, saved.draft.createdAt);
  assert.equal(next.list().length, 1);
  assert.equal(edited.draft.delay, 600000);
  assert.equal(next.remove(saved.draft.id).ok, true);
  assert.deepEqual(store.list(), []);
  assert.ok(store.remove(saved.draft.id).error);
});
test('invalid, over-limit and failed writes preserve the saved collection', t => {
  const store = fixture(t);
  const saved = store.save(value()).draft;
  for (const change of [{ title: '' }, { title: 'a'.repeat(81) }, { text: '字'.repeat(20001) }, { text: 'x'.repeat(501), format: 'plain' }, { level: '__proto__' }, { format: 'html' }, { delay: -1 }, { duration: 0 }, { id: '../other.json' }]) {
    assert.ok(store.save(value(change)).error, JSON.stringify(change).slice(0, 80));
  }
  assert.deepEqual(store.list(), [saved]);
  fs.mkdirSync(store.file + '.tmp');
  assert.throws(() => store.save(value({ id: saved.id, text: 'changed' })));
  assert.deepEqual(store.list(), [saved]);
  fs.rmdirSync(store.file + '.tmp');
  for (let i = 1; i < MAX_ANNOUNCEMENT_DRAFTS; i++) assert.equal(store.save(value({ title: '草稿' + i })).ok, true);
  assert.ok(store.save(value()).error);
  assert.equal(store.save(value({ id: saved.id })).ok, true, 'existing draft still editable at capacity');
  fs.writeFileSync(store.file, '{broken');
  assert.throws(() => store.save(value()));
  assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken');
});
test('templates are unique valid draft starters and do not imply real server configuration', t => {
  const store = fixture(t);
  assert.equal(new Set(ANNOUNCEMENT_TEMPLATES.map(v => v.id)).size, 4);
  for (const template of ANNOUNCEMENT_TEMPLATES) {
    const { id: _id, ...draft } = template;
    assert.equal(store.save(value(draft)).ok, true);
    assert.match(draft.text, /填写/);
  }
});
test('authenticated draft API survives console restart and never publishes an announcement', async t => {
  const store = fixture(t), announcements = new SiteAnnouncements();
  const lobby = { rooms: new Map(), safeData: () => ({}), onMatchEnd() {}, announcements };
  let admin;
  t.after(async () => { await admin?.close(); announcements.dispose(); });
  const start = () => startAdmin({ lobby, port: 0, settingsFile: path.join(path.dirname(store.file), 'settings.json'), resultsDir: path.dirname(store.file), log: { info() {}, error() {} } });
  admin = await start();
  const request = async (body, authorized = true) => {
    const response = await fetch(`http://127.0.0.1:${admin.port}/api/announcement-drafts`, { method: body ? 'POST' : 'GET', headers: { ...(authorized ? { 'X-Admin-Token': admin.token } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request(undefined, false)).status, 403);
  assert.equal((await request({ action: 'save', draft: value() }, false)).status, 403);
  const saved = (await request({ action: 'save', draft: value() })).body.draft;
  assert.equal(announcements.frame().announcement, null);
  assert.equal((await request()).body.drafts[0].id, saved.id);
  const cleanup = async body => {
    const response = await fetch(`http://127.0.0.1:${admin.port}/api/storage`, { method: 'POST', headers: { 'X-Admin-Token': admin.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await cleanup({ confirm: true, id: 'announcement-drafts.json' })).status, 400);
  assert.equal((await cleanup({ confirm: true, categories: ['results'] })).body.ok, true);
  assert.equal((await request()).body.drafts[0].id, saved.id, 'record cleanup cannot erase drafts');
  await admin.close(); admin = await start();
  assert.equal((await request()).body.drafts[0].id, saved.id);
  announcements.set({ text: '正在发布的公告', level: 'info', startAt: Date.now(), endAt: Date.now() + 60000 });
  const live = announcements.frame().announcement;
  assert.equal((await request({ action: 'delete', id: saved.id })).body.ok, true);
  assert.deepEqual((await request()).body.drafts, []);
  assert.deepEqual(announcements.frame().announcement, live, 'deleting a draft leaves the live notice unchanged');
});
