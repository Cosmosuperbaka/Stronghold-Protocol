import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBlockedWords, setBlockedWords, filterChatText, RoomChat } from '../server/chat.js';
import { startAdmin, loadSettings } from '../server/admin.js';

test('blocked phrases match literal text case-insensitively, longest first, with bounded validated settings', (t) => {
  t.after(() => setBlockedWords([]));
  assert.deepEqual(setBlockedWords([' bad ', 'BAD', 'badword', 'a.b', '[x]', '中文', '😀']), { ok: true });
  assert.equal(getBlockedWords().length, 6);
  assert.equal(filterChatText('BadWord BAD bad a.b axb [x] 中文😀'), '*** *** *** *** axb *** ******');
  assert.equal(filterChatText('BAD'), '***', 'repeated replacement does not retain regex state');
  const before = getBlockedWords();
  for (const value of [null, 'bad', [3], Array(101).fill('x'), ['x'.repeat(41)]]) {
    assert.ok(setBlockedWords(value).error);
    assert.deepEqual(getBlockedWords(), before);
  }
  const copy = getBlockedWords(); copy.push('changed');
  assert.deepEqual(getBlockedWords(), before, 'caller cannot mutate settings');
  const chat = new RoomChat(), room = { code: 'TEST' }, seat = { playerId: 'p', name: 'P', seat: 0 };
  chat.message(room, seat, 'BAD', 1);
  setBlockedWords([]);
  assert.equal(chat.history('TEST').messages[0].text, '***', 'history retains the stored masked text');
  assert.equal(chat.message(room, seat, 'BAD', 2).text, 'BAD');
});

test('console persists words atomically, rejects invalid settings and preserves unrelated saves', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-chat-settings-'));
  const file = path.join(dir, 'settings.json');
  const admin = await startAdmin({ lobby: { rooms: new Map(), onMatchEnd() {}, safeData: () => ({}) },
    port: 0, settingsFile: file, resultsDir: dir, log: { info() {}, error() {} } });
  t.after(async () => { await admin.close(); setBlockedWords([]); fs.rmSync(dir, { recursive: true, force: true }); });
  const api = async (body) => (await fetch(admin.url + '/api/settings', { method: body ? 'POST' : 'GET',
    headers: { 'x-admin-token': admin.token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  assert.deepEqual((await api()).blockedWords, []);
  assert.deepEqual((await api({ blockedWords: ['blocked'] })).blockedWords, ['blocked']);
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok((await api({ blockedWords: 'bad' })).error);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  await api({ roundCharts: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).blockedWords, ['blocked']);
  setBlockedWords([]); loadSettings(file, { error() {} });
  assert.equal(filterChatText('BLOCKED'), '***');
  fs.writeFileSync(file, JSON.stringify({ prep: { mode: 'default' } }));
  loadSettings(file, { error() {} });
  assert.deepEqual(getBlockedWords(), [], 'old settings default to no blocked words');
});
