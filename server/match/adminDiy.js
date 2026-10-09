// server/match/adminDiy.js — the local console's 自选 grants (local-tools; docs/LOCAL-DEV.md §5): give any player any
// kitted 自选 operator, picks or not, bot or human. A 自选 piece is identified by its slot (the 4 DIY slots, 2 per tier:
// shared/diy.js), so a grant puts the operator in a slot of the asked tier first — the slot that already holds it, else
// an empty one, else one whose operator the player owns no piece of — then gains the slot's piece. Hence at most 2
// different 自选 operators per tier at a time; a slot with pieces on it is never re-assigned (they would change body).
// The picks are rebuilt as PlayerState.setDiy does (without its bot check) and the new slot gets a full stock (no ban
// check: the console is unrestricted). Rewind keeps the picks (PS_SKIP); a stock added after the snapshot is dropped
// by the restore, and the slot then draws nothing until the next grant.

import { KITTED_CHARS } from '../sim/content/kits/index.js';
import { diyPool, diySlot, diySlotIds, diyRecord, checkDiyPick, isPrototypePick, isDiyModule } from '../../shared/diy.js';
import { unitForm } from '../../shared/standIn.js';
import { diyGameData } from './player/diy.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The operators a 自选 grant can name, per tier: [{ charId, name, tier }] (prototypes first, then the owned 6★). */
export function diyCatalog(m) {
  const data = m.gd.raw;
  const units = data?.backups?.units || {};
  const out = [];
  for (const tier of [5, 6]) {
    for (const charId of diyPool(tier, { data, kitted: KITTED_CHARS })) out.push({ charId, name: units[charId]?.name || charId, tier });
  }
  return out;
}

/** The default pick of `charId` in `slotId`: a prototype's locked one, else its last skill and first 自选 module. */
function defaultPick(charId, slotId, data) {
  const slot = diySlot(slotId, data);
  if (isPrototypePick(data, slot.tier, charId)) return { charId };
  const normal = unitForm(data.backups, charId, slot.normal.status);
  const elite = unitForm(data.backups, charId, slot.golden.status);
  const skills = (normal?.skills || []).filter(Boolean).map((s) => s.index);
  const mod = (elite?.modules || []).find(isDiyModule);
  return { charId, skillIndex: skills.length ? skills[skills.length - 1] : 0, uniEquipId: mod?.uniEquipId ?? null };
}

/** Whether the player owns any piece (normal or elite) of 自选 slot `baseId`. */
function ownsSlot(ps, slot) {
  for (const loc of ps._chessLocations()) if (loc.piece.id === slot.baseId || loc.piece.id === slot.goldenId) return true;
  return false;
}

/** Rebuild the player's picks and data view (PlayerState.setDiy without its bot check). */
function applyPicks(ps, picks) {
  const data = ps.m.gd.raw;
  const kept = {};
  const records = new Map();
  for (const [slotId, pick] of Object.entries(picks)) {
    const slot = diySlot(slotId, data);
    records.set(slot.baseId, Object.freeze(diyRecord(slotId, pick, { elite: false, data })));
    records.set(slot.goldenId, Object.freeze(diyRecord(slotId, pick, { elite: true, data })));
    kept[slot.baseId] = Object.freeze({ charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId ?? null });
  }
  ps.diy = Object.freeze(kept);
  ps._diyRecords = records;
  ps.gd = records.size ? diyGameData(ps.m.gd, records) : ps.m.gd;
}

/**
 * Give player `ps` one piece of 自选 operator `charId` in a slot of `tier` (5 / 6), the elite form with `elite`.
 * @returns {{ ok: true } | { error: string }}
 */
export function grantDiy(m, ps, { charId, tier, elite = false } = {}) {
  const data = m.gd.raw;
  tier = Number(tier);
  if (typeof charId !== 'string' || !diyPool(tier, { data, kitted: KITTED_CHARS }).includes(charId)) return { error: `${tier} 阶没有这个自选干员：${charId}` };
  const slots = diySlotIds(data).map((id) => diySlot(id, data));
  const picks = { ...(isObj(ps.diy) ? ps.diy : {}) };
  const proto = isPrototypePick(data, tier, charId);
  let slot = slots.find((s) => s.tier === tier && picks[s.baseId]?.charId === charId);
  if (!slot) {
    const inTier = slots.filter((s) => s.tier === tier);
    slot = inTier.find((s) => !picks[s.baseId]) || inTier.find((s) => !ownsSlot(ps, s));
    if (!slot) return { error: `${tier} 阶的两个自选位都已有干员在场，先移除其中一个的全部棋子` };
    // an owned operator fills one slot (shared/diy.js validateDiyPicks): it leaves its other-tier slot if that is free
    if (!proto) {
      const other = slots.find((s) => s.tier !== tier && picks[s.baseId]?.charId === charId);
      if (other) {
        if (ownsSlot(ps, other)) return { error: `这名干员已在 ${other.tier} 阶自选位上场，不能同时放进 ${tier} 阶` };
        delete picks[other.baseId];
        ps.diyStock?.entries.delete(other.baseId);
      }
    }
    const c = checkDiyPick(slot.baseId, defaultPick(charId, slot.baseId, data), data);
    if (!('ok' in c)) return { error: `自选设置无效：${c.error}` };
    picks[slot.baseId] = c.pick;
    applyPicks(ps, picks);
    const cap = m.gd.poolCopies(slot.baseId);
    if (ps.diyStock && cap > 0) ps.diyStock.entries.set(slot.baseId, { cap, left: cap, tier, shopLevel: slot.shopLevel });
  }
  const piece = ps.acquireChess(elite ? slot.goldenId : slot.baseId, { source: 'admin' });
  ps.recompute();
  ps.dirty();
  return piece ? { ok: true } : { error: '手牌和整备区都满了' };
}
