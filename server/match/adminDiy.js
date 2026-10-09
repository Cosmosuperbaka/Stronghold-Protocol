// server/match/adminDiy.js — the local console's 自选 grants (local-tools; docs/LOCAL-DEV.md §5): give any player any
// kitted 自选 operator, picks or not, bot or human. A 自选 piece is identified by its slot (the 4 DIY slots, 2 per tier:
// shared/diy.js), so a grant puts the operator in a slot of the asked tier first — the slot that already holds it, else
// an empty one, else one whose operator the player owns no piece of — then gains the slot's piece. Hence at most 2
// different 自选 operators per tier at a time; a slot with pieces on it is never re-assigned (they would change body).
// The skill and module may be given (an owned operator: any skill, any 自选 module or none; a prototype keeps its locked
// ones); for an operator already in a slot a new selection re-picks that slot, so every piece of it changes with it.
// The picks are rebuilt as PlayerState.setDiy does (without its bot check) and the new slot gets a full stock (no ban
// check: the console is unrestricted). Rewind keeps the picks (PS_SKIP); a stock added after the snapshot is dropped
// by the restore, and the slot then draws nothing until the next grant.
//
// i18n-ignore-file: a host-only tool in Chinese, not player UI (tools/i18n.mjs)

import { KITTED_CHARS } from '../sim/content/kits/index.js';
import { diyPool, diySlot, diySlotIds, diyRecord, checkDiyPick, isPrototypePick, isDiyModule, lockedSelection } from '../../shared/diy.js';
import { unitForm } from '../../shared/standIn.js';
import { diyGameData } from './player/diy.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The operators a 自选 grant can name, per tier (prototypes first, then the owned 6★): [{ charId, name, tier, skills:
 * [{ index, name }], modules: [{ id, name, type }] (the elite form's 自选 modules), locked: { skillIndex, uniEquipId } for a
 * prototype, def: the default selection }].
 */
export function diyCatalog(m) {
  const data = m.gd.raw;
  const units = data?.backups?.units || {};
  const out = [];
  for (const tier of [5, 6]) {
    const slotId = diySlotIds(data).find((id) => diySlot(id, data).tier === tier);
    if (!slotId) continue;
    const slot = diySlot(slotId, data);
    for (const charId of diyPool(tier, { data, kitted: KITTED_CHARS })) {
      const normal = unitForm(data.backups, charId, slot.normal.status);
      const elite = unitForm(data.backups, charId, slot.golden.status);
      out.push({
        charId, name: units[charId]?.name || charId, tier,
        skills: (normal?.skills || []).filter(Boolean).map((x) => ({ index: x.index, name: x.name })),
        modules: (elite?.modules || []).filter(isDiyModule).map((x) => ({ id: x.uniEquipId, name: x.name, type: x.typeName })),
        locked: isPrototypePick(data, tier, charId) ? lockedSelection(data, tier, charId) : null,
        def: defaultPick(charId, slotId, data),
      });
    }
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
 * The pick of `charId` in `slotId` with the asked selection: `skillIndex` (omitted = the default), `uniEquipId`
 * (omitted = the default, null / 'none' = no module); a prototype always takes its locked one.
 */
function pickFor(charId, slotId, data, sel) {
  const def = defaultPick(charId, slotId, data);
  if (!('skillIndex' in def)) return def;
  const skillIndex = Number.isInteger(sel.skillIndex) ? sel.skillIndex : def.skillIndex;
  const uniEquipId = sel.uniEquipId === undefined ? def.uniEquipId : sel.uniEquipId === 'none' ? null : sel.uniEquipId;
  return { charId, skillIndex, uniEquipId };
}

/**
 * Give player `ps` one piece of 自选 operator `charId` in a slot of `tier` (5 / 6), the elite form with `elite`, at
 * the selection `skillIndex` / `uniEquipId` (see pickFor). `grant: false` only sets the selection of the slot that
 * holds the operator (every piece of that slot changes with it).
 * @returns {{ ok: true } | { error: string }}
 */
export function grantDiy(m, ps, { charId, tier, elite = false, skillIndex, uniEquipId, grant = true } = {}) {
  const data = m.gd.raw;
  tier = Number(tier);
  if (typeof charId !== 'string' || !diyPool(tier, { data, kitted: KITTED_CHARS }).includes(charId)) return { error: `${tier} 阶没有这个自选干员：${charId}` };
  const slots = diySlotIds(data).map((id) => diySlot(id, data));
  const picks = { ...(isObj(ps.diy) ? ps.diy : {}) };
  const proto = isPrototypePick(data, tier, charId);
  const sel = { skillIndex: skillIndex == null || skillIndex === '' ? undefined : Number(skillIndex), uniEquipId: uniEquipId === '' ? undefined : uniEquipId };
  let slot = slots.find((s) => s.tier === tier && picks[s.baseId]?.charId === charId);
  if (slot) {
    if (!proto && (sel.skillIndex !== undefined || sel.uniEquipId !== undefined)) {
      const c = checkDiyPick(slot.baseId, pickFor(charId, slot.baseId, data, sel), data);
      if (!('ok' in c)) return { error: `自选设置无效：${c.error}` };
      const cur = picks[slot.baseId];
      if (c.pick.skillIndex !== cur.skillIndex || c.pick.uniEquipId !== (cur.uniEquipId ?? null)) {
        picks[slot.baseId] = c.pick;
        applyPicks(ps, picks);
      }
    }
  } else if (!grant) {
    return { error: `这名玩家的 ${tier} 阶自选位上没有这名干员` };
  } else {
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
    const c = checkDiyPick(slot.baseId, pickFor(charId, slot.baseId, data, sel), data);
    if (!('ok' in c)) return { error: `自选设置无效：${c.error}` };
    picks[slot.baseId] = c.pick;
    applyPicks(ps, picks);
    const cap = m.gd.poolCopies(slot.baseId);
    if (ps.diyStock && cap > 0) ps.diyStock.entries.set(slot.baseId, { cap, left: cap, tier, shopLevel: slot.shopLevel });
  }
  const piece = grant ? ps.acquireChess(elite ? slot.goldenId : slot.baseId, { source: 'admin' }) : true;
  ps.recompute();
  ps.dirty();
  return piece ? { ok: true } : { error: '手牌和整备区都满了' };
}
