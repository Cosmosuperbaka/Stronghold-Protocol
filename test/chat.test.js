import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { TestClient } from './helpers/wsClient.js';
import { cleanChatText, setChatSettings, DEFAULT_CHAT_SETTINGS } from '../server/chat.js';
import { validateC2S, S2C } from '../shared/protocol.js';

function fixture(t) {
  let time = 0;
  const registry = new SessionRegistry({ now: () => time });
  const lobby = new Lobby({ registry, now: () => time, getData: () => ({}), MatchClass: StubMatch, log: { info() {}, warn() {}, error() {} } });
  t.after(() => lobby.shutdown());
  const player = (name) => {
    const s = registry.create(name);
    s.connected = true; s.frames = [];
    s.ws = { readyState: 1, bufferedAmount: 0, send: (raw) => s.frames.push(JSON.parse(raw)) };
    return s;
  };
  const host = player('Host');
  assert.deepEqual(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  const room = lobby.roomOf(host);
  const send = (s, clientId, text = 'hello') => lobby.onMessage(s, { t: 'room.chat', clientId, text });
  return { lobby, host, room, player, send, tick: () => { time += 1000; } };
}

test('chat validates frames, Unicode lengths and control-only messages', () => {
  assert.equal(validateC2S({ t: 'room.chat', clientId: 'a', text: 'hello' }), null);
  for (const msg of [{ text: 1, clientId: 'a' }, { text: 'hello' }, { text: 'x'.repeat(1025), clientId: 'a' }]) {
    assert.ok(validateC2S({ t: 'room.chat', ...msg }));
  }
  assert.ok(S2C.includes('chat.message') && S2C.includes('chat.history'));
  assert.equal(cleanChatText(' \u0000你\u001b好\u0085 '), '你好');
  assert.equal(cleanChatText('😀'.repeat(200)), '😀'.repeat(200));
  for (const text of ['😀'.repeat(201), '中'.repeat(201), ' \t\n\u0000', null]) assert.equal(cleanChatText(text), null);
});

test('chat enforces membership, spectator read-only, server identity, rate limits and retry dedupe', (t) => {
  const f = fixture(t), other = f.player('Other'), spectator = f.player('Viewer'), outsider = f.player('Outside');
  f.lobby.join(other, { code: f.room.code });
  f.lobby.spectate(spectator, { code: f.room.code });
  assert.equal(f.send(outsider, 'a').error, 'NOT_IN_ROOM');
  assert.equal(f.send(spectator, 'a').error, 'SPECTATOR');
  const first = f.lobby.onMessage(f.host, { t: 'room.chat', clientId: 'a', text: '<img src=x onerror=alert(1)>', name: 'spoof', playerId: outsider.playerId });
  assert.deepEqual(first, { ok: true });
  const msg = f.room.chat.messages[0];
  assert.equal(msg.name, 'Host'); assert.equal(msg.playerId, f.host.playerId); assert.equal(msg.at, 0);
  assert.ok(other.frames.some((m) => m.t === 'chat.message'));
  assert.ok(spectator.frames.some((m) => m.t === 'chat.message'));
  assert.ok(!outsider.frames.some((m) => m.t === 'chat.message'));
  assert.deepEqual(f.send(f.host, 'a'), { ok: true });
  assert.equal(f.room.chat.messages.length, 1);
  assert.equal(f.send(f.host, 'b').error, 'RATE');
  f.tick(); assert.deepEqual(f.send(f.host, 'b'), { ok: true });
  f.lobby.create(outsider, { mode: 'coop', difficulty: 'NORMAL' });
  assert.ok(!f.lobby.roomOf(outsider).chat.messages.length);
  f.tick(); f.send(f.host, 'c');
  assert.ok(!outsider.frames.some((m) => m.t === 'chat.message'));
});

test('history is bounded, sent only to the joining/resyncing member and survives match phases', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 55; i++) { assert.deepEqual(f.send(f.host, `m${i}`), { ok: true }); f.tick(); }
  assert.equal(f.room.chat.messages.length, 50);
  assert.equal(f.room.chat.messages[0].id, 6);
  const peer = f.player('Peer');
  f.host.frames = [];
  f.lobby.join(peer, { code: f.room.code });
  assert.equal(peer.frames.findLast((m) => m.t === 'chat.history').messages.length, 50);
  assert.ok(!f.host.frames.some((m) => m.t === 'chat.history'));
  peer.frames = []; f.lobby.onHello(peer, { resumed: true, repeat: false });
  assert.equal(peer.frames.filter((m) => m.t === 'chat.history').length, 1);
  f.room.match = { phase: 'COMBAT' };
  assert.deepEqual(f.send(peer, 'battle'), { ok: true });
  f.room.match = null;
});

test('host chat policy disables player sends and applies the configured per-person cooldown', (t) => {
  const f = fixture(t);
  t.after(() => setChatSettings(DEFAULT_CHAT_SETTINGS));
  setChatSettings({ enabled: false });
  assert.equal(f.send(f.host, 'disabled').error, 'CHAT_DISABLED');
  assert.equal(f.room.chat.messages.length, 0);
  setChatSettings({ enabled: true, cooldownMs: 3000 });
  assert.deepEqual(f.send(f.host, 'one'), { ok: true });
  f.tick(); assert.equal(f.send(f.host, 'two').error, 'RATE');
  f.tick(); f.tick(); assert.deepEqual(f.send(f.host, 'two'), { ok: true });
});

test('real WebSocket transport broadcasts chat and restores history after reconnect', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); });
  const connect = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    const welcome = await c.hello(name, token); return { c, welcome };
  };
  const { c: host } = await connect('Host');
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
  const { code, textChat } = await host.waitFor('room.state'); assert.equal(textChat, true);
  const { c: peer, welcome } = await connect('Peer');
  await peer.request({ t: 'room.join', code });
  assert.equal((await host.request({ t: 'room.chat', clientId: 'wire1', text: '你好' })).t, 'ok');
  assert.equal((await peer.waitFor('chat.message')).text, '你好');
  await peer.close();
  const { c: resumed } = await connect('Peer', welcome.token);
  const history = await resumed.waitFor('chat.history');
  assert.equal(history.code, code); assert.equal(history.messages[0].text, '你好');
});
