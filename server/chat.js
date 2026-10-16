// Adapted from RyantArgnisan/Stronghold-Protocol a649d92 (GPL-3.0-or-later); see NOTICE.md.
// Room-scoped, in-memory text chat. Identity and timestamps are exclusively server-authored.
import { CHAT_MAX_CHARS, CHAT_HISTORY_LIMIT, CHAT_COOLDOWN_MS } from '../shared/constants.js';

export const DEFAULT_CHAT_SETTINGS = Object.freeze({ enabled: true, cooldownMs: CHAT_COOLDOWN_MS, historyLimit: CHAT_HISTORY_LIMIT });
let chatSettings = DEFAULT_CHAT_SETTINGS;
export function getChatSettings() { return { ...chatSettings }; }
export function normalizeChatSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '聊天设置无效' }; // i18n-ignore
  const settings = { ...chatSettings, ...value };
  if (typeof settings.enabled !== 'boolean' || !Number.isInteger(settings.cooldownMs) || settings.cooldownMs < 500 || settings.cooldownMs > 10000
    || !Number.isInteger(settings.historyLimit) || settings.historyLimit < 10 || settings.historyLimit > CHAT_HISTORY_LIMIT) return { error: '聊天间隔须为 0.5–10 秒，历史条数须为 10–50 的整数' }; // i18n-ignore
  return { settings: { enabled: settings.enabled, cooldownMs: settings.cooldownMs, historyLimit: settings.historyLimit } };
}
export function setChatSettings(value) {
  const r = normalizeChatSettings(value);
  if (r.error) return r;
  chatSettings = Object.freeze(r.settings);
  return { ok: true };
}

let blockedWords = Object.freeze([]);
let blockedPattern = null;
export function getBlockedWords() { return blockedWords.slice(); }

/** Literal phrases, case-insensitive; longest alternatives win, never evaluate user regex. */
export function normalizeBlockedWords(value) {
  if (!Array.isArray(value) || value.length > 100 || value.some((w) => typeof w !== 'string')) return { error: '屏蔽词须为文本列表，最多 100 条' }; // i18n-ignore
  const words = [...new Map(value.map((w) => w.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim())
    .filter(Boolean).map((w) => [w.toLocaleLowerCase('en-US'), w])).values()];
  if (words.some((w) => [...w].length > 40) || Buffer.byteLength(JSON.stringify(words), 'utf8') > 4096) return { error: '屏蔽词每条最多 40 字，总大小最多 4096 字节' }; // i18n-ignore
  return { words };
}
export function setBlockedWords(value) {
  const r = normalizeBlockedWords(value);
  if (r.error) return r;
  blockedWords = Object.freeze(r.words);
  const escaped = r.words.slice().sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  blockedPattern = escaped.length ? new RegExp(escaped.join('|'), 'giu') : null;
  return { ok: true };
}
export function filterChatText(text) { return blockedPattern ? text.replace(blockedPattern, '***') : text; }

/** Strip C0/C1 controls, trim, then enforce both character and UTF-8 byte limits. Never truncate. */
export function cleanChatText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  if (!text || [...text].length > CHAT_MAX_CHARS || Buffer.byteLength(text, 'utf8') > 1024) return null;
  return text;
}

export class RoomChat {
  constructor() { this.lastId = 0; this.clearedThrough = 0; this.muted = new Set(); this.messages = []; this.sentIds = new WeakMap(); this.sendTimes = []; }

  /** Rolling room-wide window; at most ten entries are retained, even under member churn. */
  admit(at) {
    this.sendTimes = this.sendTimes.filter((time) => at - time < 1000);
    if (this.sendTimes.length >= 10) return false;
    this.sendTimes.push(at);
    return true;
  }

  seen(session, clientId) { return this.sentIds.get(session)?.has(clientId) === true; }

  remember(session, clientId) {
    let ids = this.sentIds.get(session);
    if (!ids) { ids = new Set(); this.sentIds.set(session, ids); }
    ids.add(clientId);
    if (ids.size > CHAT_HISTORY_LIMIT) ids.delete(ids.values().next().value);
  }

  message(room, seat, text, at) {
    const message = { t: 'chat.message', code: room.code, id: ++this.lastId, playerId: seat.playerId,
      name: seat.name, seat: seat.seat, role: 'player', text: filterChatText(text), at };
    this.messages.push(message);
    this.trimHistory();
    if (this.clearedThrough) message.clearedThrough = this.clearedThrough;
    return message;
  }

  trimHistory() {
    const removed = this.messages.splice(0, Math.max(0, this.messages.length - chatSettings.historyLimit));
    if (removed.length) this.clearedThrough = Math.max(this.clearedThrough, removed.at(-1).id);
  }

  history(code) { this.trimHistory(); return { t: 'chat.history', code, messages: this.messages.slice(), lastId: this.lastId, clearedThrough: this.clearedThrough }; }

  clearMessages() { this.messages = []; this.clearedThrough = this.lastId; }

  clear() { this.lastId = 0; this.clearedThrough = 0; this.messages = []; this.sentIds = new WeakMap(); this.sendTimes = []; }
}
