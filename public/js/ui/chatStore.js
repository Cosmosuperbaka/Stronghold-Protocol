// Adapted from RyantArgnisan/Stronghold-Protocol a649d92 (GPL-3.0-or-later); see NOTICE.md.
import { CHAT_HISTORY_LIMIT } from '../../../shared/constants.js';

// Room-scoped chat state. Transport subscriptions outlive route changes; never persisted to disk.
export const emptyChat = (code = null) => ({ code, messages: [], previewIds: [], lastId: 0, unread: 0, open: false, draft: '', error: null, sending: false });

export function chatMember(room, playerId) {
  return playerId != null && [...(Array.isArray(room?.seats) ? room.seats : []), ...(Array.isArray(room?.spectators) ? room.spectators : [])]
    .some((p) => p?.playerId === playerId);
}

export function mergeChat(chat, event, history = false, selfId = null) {
  if (!chat?.code || event?.code !== chat.code) return chat;
  const clearedThrough = Math.max(chat.clearedThrough || 0, Number.isSafeInteger(event.clearedThrough) ? event.clearedThrough : 0);
  const byId = new Map(chat.messages.filter((m) => m.id > clearedThrough).map((m) => [m.id, m]));
  let unread = chat.unread;
  const previewIds = new Set(chat.previewIds || []);
  const incoming = history ? (Array.isArray(event.messages) ? event.messages : []) : [event];
  for (const m of incoming) {
    if (!m || !Number.isSafeInteger(m.id) || m.id <= 0 || typeof m.text !== 'string' || (m.code && m.code !== chat.code)) continue;
    if (m.id <= clearedThrough || byId.has(m.id)) continue;
    if (!history && !chat.open && m.id > chat.lastId && (m.role === 'system' || !selfId || m.playerId !== selfId)) {
      unread++;
      previewIds.add(m.id);
    }
    byId.set(m.id, { code: chat.code, id: m.id, playerId: m.playerId, name: typeof m.name === 'string' ? m.name : '',
      seat: m.seat, role: m.role === 'system' ? 'system' : 'player', text: m.text, at: m.at, receivedAt: history ? null : Date.now() });
  }
  const messages = [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY_LIMIT);
  const lastId = Math.max(chat.lastId, messages.at(-1)?.id || 0, history && Number.isSafeInteger(event.lastId) ? event.lastId : 0);
  return { ...chat, messages, previewIds: messages.filter(m => previewIds.has(m.id)).map(m => m.id), lastId, clearedThrough, unread: messages.length ? unread : 0 };
}

// Transport subscriptions outlive routes; local membership transitions clear the slice synchronously.
export function installChatSync({ net, store }) {
  const syncRoom = () => {
    const s = store.get();
    const code = chatMember(s.room, s.me?.playerId) ? s.room.code : null;
    if (s.chat?.code !== code || !s.chat) store.set({ chat: emptyChat(code) });
  };
  syncRoom();
  const stops = [store.subscribe(syncRoom),
    net.on('chat.message', (event) => store.set((s) => ({ chat: mergeChat(s.chat, event, false, s.me?.playerId) }))),
    net.on('chat.history', (event) => store.set((s) => ({ chat: mergeChat(s.chat, event, true) })))];
  return () => stops.forEach((stop) => stop());
}
