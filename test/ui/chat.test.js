import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../public/js/store.js';
import { emptyChat, mergeChat, installChatSync } from '../../public/js/ui/chatStore.js';
import { sendChat } from '../../public/js/ui/chat.js';

const room = (code = 'AAAA') => ({ code, textChat: true, seats: [{ playerId: 'p1', name: 'Player' }], spectators: [] });
const state = () => ({ room: room(), me: { playerId: 'p1' }, connection: { status: 'online' }, chat: { ...emptyChat('AAAA'), draft: '你好' } });

test('chat merges history with live messages, dedupes and ignores other rooms', () => {
  const msg = { code: 'AAAA', id: 2, playerId: 'p1', text: 'new' };
  let chat = mergeChat(emptyChat('AAAA'), msg);
  assert.equal(chat.unread, 1);
  chat = mergeChat(chat, msg); assert.equal(chat.unread, 1);
  chat = mergeChat(chat, { code: 'AAAA', lastId: 2, messages: [{ ...msg, id: 1, text: 'old' }, msg] }, true);
  assert.deepEqual(chat.messages.map((m) => m.text), ['old', 'new']);
  assert.equal(chat.unread, 1);
  assert.equal(mergeChat(chat, { ...msg, code: 'BBBB' }), chat);
  const visible = mergeChat({ ...chat, open: true, unread: 0 }, { ...msg, id: 3 });
  assert.equal(visible.unread, 0);
});

test('sync clears room history, drafts and pending state on leave, kick, room change or identity reset', () => {
  const store = createStore(state()), listeners = new Map();
  const stop = installChatSync({ store, net: { on: (type, fn) => { listeners.set(type, fn); return () => listeners.delete(type); } } });
  listeners.get('chat.message')({ code: 'AAAA', id: 1, text: 'private' });
  store.set({ room: room('BBBB') });
  assert.equal(store.get().chat.code, 'BBBB'); assert.equal(store.get().chat.draft, ''); assert.deepEqual(store.get().chat.messages, []);
  listeners.get('chat.message')({ code: 'AAAA', id: 2, text: 'late' }); assert.deepEqual(store.get().chat.messages, []);
  store.set({ room: null }); assert.equal(store.get().chat.code, null);
  store.set({ room: room(), me: { playerId: 'outsider' } }); assert.equal(store.get().chat.code, null);
  stop(); assert.equal(listeners.size, 0);
});

test('previews only queue new incoming messages and follow history clearing', () => {
  const store = createStore(state()), listeners = new Map();
  const stop = installChatSync({ store, net: { on: (type, fn) => { listeners.set(type, fn); return () => listeners.delete(type); } } });
  const receive = (id, playerId = 'p2', role = 'player') => listeners.get('chat.message')({ code: 'AAAA', id, playerId, role, text: `message ${id}` });
  receive(1, 'p1');
  assert.equal(store.get().chat.unread, 0, 'own echo is not unread');
  assert.deepEqual(store.get().chat.previewIds, []);
  receive(2); receive(2); receive(3, null, 'system');
  assert.deepEqual(store.get().chat.previewIds, [2, 3], 'peers and host messages queue once');
  assert.equal(store.get().chat.unread, 2);
  listeners.get('chat.history')({ code: 'AAAA', messages: [{ id: 4, playerId: 'p2', text: 'history' }], lastId: 4 });
  assert.deepEqual(store.get().chat.previewIds, [2, 3], 'history sync never generates a preview');
  store.patch('chat', { open: true, unread: 0, previewIds: [] }); receive(5);
  assert.deepEqual(store.get().chat.previewIds, [], 'expanded chat never queues previews');
  store.patch('chat', { open: false }); receive(6);
  listeners.get('chat.history')({ code: 'AAAA', messages: [], clearedThrough: 6, lastId: 6 });
  assert.deepEqual(store.get().chat.previewIds, [], 'moderator clearing removes pending previews');
  assert.equal(store.get().chat.unread, 0);
  receive(6); assert.deepEqual(store.get().chat.previewIds, [], 'late cleared messages stay discarded');
  stop();
});

test('sending keeps failed/edited drafts, forbids offline queuing and ignores completion after room switch', async () => {
  const store = createStore(state());
  const failed = { status: 'online', request: async () => { throw Error('failed'); } };
  assert.equal(await sendChat({ store, net: failed }), false);
  assert.equal(store.get().chat.draft, '你好'); assert.equal(store.get().chat.sending, false);
  let resolve, calls = 0;
  const net = { status: 'online', request: (type, payload, opts) => {
    calls++; assert.equal(type, 'room.chat'); assert.equal(payload.text, '你好'); assert.equal(opts.queue, false);
    return new Promise((r) => { resolve = r; });
  } };
  const pending = sendChat({ store, net });
  assert.equal(await sendChat({ store, net }), false); assert.equal(calls, 1);
  store.patch('chat', { draft: 'new draft' }); resolve(); await pending;
  assert.equal(store.get().chat.draft, 'new draft');
  store.patch('chat', { draft: '你好' });
  const switched = sendChat({ store, net }); store.set({ room: room('BBBB'), chat: emptyChat('BBBB') }); resolve(); await switched;
  assert.deepEqual(store.get().chat, emptyChat('BBBB'));
  store.set(state()); net.status = 'offline';
  assert.equal(await sendChat({ store, net }), false); assert.equal(calls, 2);
});
