// 名片干员: the portrait a doctor shows on the room's seat card (screens/room.js) and on the strategy draft's name-card rows
// (screens/bandDraft.js) — the operator the player picked (room.card; room.state seats[].card), else one of the 5★/6★
// operators chosen by the player id, the same on every client.
import { chessPortraitUrl } from './assetUrls.js';

/** FNV-1a of a string (the portrait pick: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** 名片干员: the player's own pick (localStorage; sent as room.card where the server knows it). */
export const CARD_PREF = 'room.card';
export const CARD_SKIN_PREF = 'room.cardSkin';

/**
 * The operators a seat card can show: one record per charId (the elite form for its E2 art), 6★ first.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList, catalogue = null) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  for (const c of Object.values(catalogue?.chars || {})) {
    const prev = by.get(c.charId);
    by.set(c.charId, { ...c, ...prev, choices: c.choices });
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * The seat card's portrait: the operator the player picked (room.state seats[].card, or one's own pick), else one of
 * the 5★/6★ operators chosen by the player id — the same on every client (null before the data loads).
 * @param {any} seat room.state seat @param {{ pool: any[], byChar: Map<string, any>, m: any, myId: any, myCard: string, mySkin?: string }} ctx
 */
export function seatPortrait(seat, { pool, byChar, m, myId, myCard, mySkin = '' }) {
  if (!seat || seat.playerId == null) return null;
  const pick = (seat.playerId === myId && myCard) || seat.card;
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) {
    const skin = seat.playerId === myId ? mySkin : seat.cardSkin;
    return rec.choices?.find(s => s.id === skin)?.portrait || chessPortraitUrl(m, rec) || rec.choices?.[0]?.portrait || null;
  }
  if (!Array.isArray(pool) || !pool.length) return null;
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length]);
}

/** A profile image is independent of equipping a battle model. Only installed manifest URLs are returned. */
export function cardAvatarUrl(charId, skinId, manifest) {
  const rec = manifest?.chars?.[charId];
  return rec?.skins?.[skinId]?.avatar || rec?.avatar || null;
}
export function chosenPortrait(charId, skinId, manifest, catalogue, chess = []) {
  const rec = catalogue?.chars?.[charId];
  const choice = rec?.choices?.find((row) => row.id === skinId);
  return choice?.portrait || manifest?.chars?.[charId]?.skins?.[skinId]?.portrait
    || chessPortraitUrl(manifest, chess.find((row) => row.charId === charId && row.isGolden) || chess.find((row) => row.charId === charId))
    || rec?.choices?.[0]?.portrait || null;
}
