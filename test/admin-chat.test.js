import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { handleAction, roomsView } from '../server/admin.js';
import { validateC2S } from '../shared/protocol.js';
import { mergeChat, emptyChat } from '../public/js/ui/chatStore.js';

function fixture(t) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, getData: () => ({}), MatchClass: StubMatch, log: { info() {}, warn() {}, error() {} } });
  t.after(() => lobby.shutdown());
  const player = (name) => {
    const s = registry.create(name); s.connected = true; s.frames = [];
    s.ws = { readyState: 1, bufferedAmount: 0, send: (raw) => s.frames.push(JSON.parse(raw)) }; return s;
  };
  const host = player('Host'); lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  const room = lobby.roomOf(host);
  const peer = player('Peer'); lobby.join(peer, { code: room.code });
  const viewer = player('Viewer'); lobby.spectate(viewer, { code: room.code });
  const act = (action, playerId, value) => handleAction(lobby, { room: room.code, action, playerId, value });
  return { lobby, room, host, peer, viewer, act, player };
}
test('host announcements bypass player throttles, reach every room and remain server-only', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++) assert.deepEqual(f.act('announce', null, 'notice'), { ok: true });
  assert.equal(f.room.chat.messages.length, 12);
  assert.equal(f.room.chat.messages[0].role, 'system');
  assert.ok(f.viewer.frames.some((m) => m.role === 'system'));
  assert.ok(f.act('announce', null, 'x'.repeat(201)).error);
  const otherHost = f.player('Other'); f.lobby.create(otherHost, { mode: 'solo', difficulty: 'NORMAL' });
  const otherRoom = f.lobby.roomOf(otherHost);
  assert.deepEqual(handleAction(f.lobby, { room: '*', action: 'announce', value: 'all' }), { ok: true });
  assert.equal(f.room.chat.messages.at(-1).text, 'all');
  assert.equal(otherRoom.chat.messages.at(-1).text, 'all');
  assert.ok(otherHost.frames.some((m) => m.role === 'system' && m.text === 'all'));
  for (const type of ['room.announce', 'room.chatClear', 'room.chatMute', 'room.chatKick']) assert.ok(validateC2S({ t: type }));
  assert.equal(roomsView(f.lobby)[0].chat.messages.length, 13);
  assert.equal(f.room.adminLog.filter((e) => e.action === 'announce' && e.ok).length, 13);
});

test('kicking during a match follows the existing permanent departure hook', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.lobby.startMatch(f.room), { ok: true });
  const match = f.room.match;
  assert.deepEqual(f.act('chatKick', f.peer.playerId), { ok: true });
  assert.equal(match.players.get(f.peer.playerId).left, true);
  assert.equal(f.peer.roomCode, null);
  assert.equal(f.room.match, match);
});
test('clear synchronizes clients and rejects stale messages without reusing IDs', (t) => {
  const f = fixture(t); f.act('announce', null, 'old');
  const old = f.room.chat.messages[0];
  let state = mergeChat(emptyChat(f.room.code), old);
  f.act('chatClear'); state = mergeChat(state, f.peer.frames.at(-1), true);
  assert.deepEqual(state.messages, []);
  state = mergeChat(state, old); assert.deepEqual(state.messages, []);
  f.act('announce', null, 'new'); state = mergeChat(state, f.room.chat.messages[0]);
  assert.equal(state.messages[0].id, 2); assert.equal(state.messages[0].role, 'system');
});
test('mute persists through reconnect until explicitly unmuted; kicking uses normal departure', (t) => {
  const f = fixture(t), pid = f.peer.playerId;
  assert.deepEqual(f.act('chatMute', pid, true), { ok: true });
  f.lobby.onHello(f.peer, { resumed: true, repeat: false });
  assert.equal(f.lobby.chat(f.peer, { clientId: 'a', text: 'no' }).error, 'CHAT_MUTED');
  assert.deepEqual(f.act('chatMute', pid, false), { ok: true });
  assert.deepEqual(f.lobby.chat(f.peer, { clientId: 'a', text: 'yes' }), { ok: true });
  f.act('chatKick', f.viewer.playerId); assert.equal(f.room.spectators.length, 0);
  f.act('chatKick', pid); assert.equal(f.lobby.roomOf(f.peer), null);
  assert.ok(f.peer.frames.some((m) => m.t === 'room.closed' && m.reason === 'kicked'));
  assert.equal(f.room.adminLog.at(-1).player, 'Peer');
});
