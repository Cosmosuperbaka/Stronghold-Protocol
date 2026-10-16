import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SiteAnnouncements } from '../server/announcements.js';
import { announcementFromMessage, announcementLive } from '../shared/announcements.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

test('absolute start/end, invalid edits and withdrawal are independent of room time', () => {
  let now = 1000; const frames = [];
  const service = new SiteAnnouncements({ now: () => now, broadcast: m => frames.push(m) });
  try {
    assert.deepEqual(service.set({ text: 'Notice\n<script>', level: 'warning', startAt: 2000, endAt: 3000 }), { ok: true });
    const notice = announcementFromMessage(frames.at(-1));
    assert.equal(announcementLive(notice, 1999), false);
    assert.equal(announcementLive(notice, 2000), true);
    assert.equal(announcementLive(notice, 2999), true);
    assert.equal(announcementLive(notice, 3000), false);
    for (const value of [{ ...notice, level: '__proto__' }, { ...notice, startAt: NaN }, { ...notice, endAt: 1000 }, { ...notice, text: 'x'.repeat(501) }]) assert.ok(service.set(value).error);
    assert.equal(service.frame().announcement.id, notice.id, 'a bad edit preserves the active schedule');
    now = 3000; service.publish(); assert.equal(frames.at(-1).announcement, null);
    service.set({ text: 'next', level: 'urgent', startAt: 3000, endAt: 6000 });
    service.set(null); assert.equal(service.frame().announcement, null);
  } finally { service.dispose(); }
});

test('a notice reaches the lobby, every room and reconnect, then expires without player action', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  const connect = async token => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    c.welcome = await c.hello('Notice', token); return c;
  };
  try {
    const a = await connect(); assert.equal((await a.waitFor('site.announcement')).announcement, null);
    const startAt = Date.now(), endAt = startAt + 1500;
    srv.lobby.announcements.set({ text: 'Global', level: 'info', startAt, endAt });
    await a.waitFor('site.announcement', m => m.announcement?.text === 'Global');
    await a.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const b = await connect(); const msg = await b.waitFor('site.announcement');
    assert.equal(msg.announcement.endAt, endAt); assert.ok(msg.serverNow >= startAt);
    const token = a.welcome.token; await a.close();
    const resumed = await connect(token);
    assert.equal((await resumed.waitFor('site.announcement')).announcement.text, 'Global');
    for (const c of [b, resumed]) await c.waitFor('site.announcement', m => m.announcement === null);
    assert.equal(srv.lobby.announcements.frame().announcement, null);
    assert.equal((await b.request({ t: 'site.announcement', announcement: null })).t, 'error');
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});
