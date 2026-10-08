// server/match/enemyPicks.js — the host console's enemy schedule (server/admin.js): every enemy composition a round can
// have, which of them this match can actually draw, and host overrides of any round from the current one on.
// i18n-ignore-file: host-console data, no player-facing text (tools/i18n.mjs)
//
// The official generator (waves.js setupMatchWaves) fixes the whole match at setup: 3 of the involveRandom types, a
// shuffled 15-slot type schedule (each chosen type 3 slots, SPECIAL the rest) and one pick per round — a weighted entry
// of the round's type and half (r ≤ firstHalfMaxRound) whose special key the mode allows, plus one of the entry's
// normal / elite keys. A composition here = (entry, normal key, elite key); the data has one N and one E per entry.
//
// Overrides live in m.adminPicks { [round]: pick } (a MATCH_KEYS field, rewind.js: a rewind restores them as they were).
// The wave builders read the schedule through waveSource(m) (match/phases.js startRound / _planBossWaves,
// match/bossRounds.js), so an override of a later round applies when that round starts; the current round's is rebuilt
// at once (before combat only).

import { isFlyKey, buildNormalWave, buildBossWave } from './waves.js';

const ACLOON = 'enemy_9012_acloon';

const gen = (gd) => (gd.factions.generation && typeof gd.factions.generation === 'object' ? gd.factions.generation : {});
const firstHalfMax = (gd) => (Number.isInteger(gen(gd).firstHalfMaxRound) && gen(gd).firstHalfMaxRound > 0 ? gen(gd).firstHalfMaxRound : 7);
const keysOf = (gd, list) => (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x && x.key)).filter((k) => typeof k === 'string' && k !== ACLOON && gd.enemy(k));

/** The schedule the wave builders read: the match's own (m.factions carries it), or a copy with the host's overrides. */
export function waveSource(m) {
  const o = m.adminPicks;
  const picks = m.factions && m.factions.schedule && m.factions.schedule.picks;
  if (!o || !picks || !Object.keys(o).length) return m.factions;
  const out = picks.slice();
  for (const [r, p] of Object.entries(o)) out[Number(r)] = p;
  return { picks: out };
}

/** Every composition of one half (firstHalf true / false), in data order: { id, entry, pick } with pick as roundPick's. */
function combos(gd, firstHalf) {
  const entries = gd.factions.entries && typeof gd.factions.entries === 'object' ? Object.values(gd.factions.entries) : [];
  const out = [];
  for (const e of entries.filter((x) => x && typeof x.key === 'string' && !!x.firstHalf === firstHalf && x.key !== ACLOON && gd.enemy(x.key)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const ns = keysOf(gd, e.N);
    const es = keysOf(gd, e.E);
    for (const normal of ns.length ? ns : [null]) {
      for (const elite of es.length ? es : [null]) {
        out.push({ id: `${e.key}|${normal || ''}|${elite || ''}`, entry: e, ns: ns.length || 1, es: es.length || 1, normal, elite });
      }
    }
  }
  return out;
}

const pickOf = (c, round, half, gd) => ({ round, type: c.entry.type, key: c.entry.key, normal: c.normal, elite: c.elite, fly: typeof c.entry.fly === 'boolean' ? c.entry.fly : isFlyKey(gd, c.entry.key), firstHalf: half });
const idOf = (p) => (p ? `${p.key}|${p.normal || ''}|${p.elite || ''}` : null);

/**
 * What round r actually spawns with `pick` (its template decides: R1–R3 have no special slot, a ground pick drops the
 * flying slots and a flying one the ground slots; leader rounds keep only the elite escorts), enemies merged by key.
 * A scheduled pick draws nothing from the rng (roundPick), so this never touches the match. Cached per pick.
 */
const rosterCache = new WeakMap();
function rosterOf(m, r, pick) {
  const gd = m.gd;
  let cache = rosterCache.get(gd);
  if (!cache) rosterCache.set(gd, (cache = new Map()));
  const boss = r === gd.bossRound || r === gd.hiddenRound;
  const bossId = boss ? (r === gd.hiddenRound && r !== gd.bossRound ? m.hiddenBossId : m.bossId) : null;
  const key = `${r}|${idOf(pick)}|${bossId}|${!!m.isSolo}`;
  if (cache.has(key)) return cache.get(key);
  const picks = [];
  picks[r] = pick;
  const noRng = () => 0;
  const wave = boss ? buildBossWave(gd, noRng, { picks }, r, { bossId, solo: !!m.isSolo }) : buildNormalWave(gd, noRng, { picks }, r);
  const by = new Map();
  for (const s of wave.spawns || []) {
    if (s.countInTotal === false && s.tag !== 'boss') continue;
    const e = by.get(s.enemyKey) || { name: gd.enemy(s.enemyKey)?.name || s.enemyKey, count: 0, boss: s.tag === 'boss' };
    e.count += s.count || 1;
    by.set(s.enemyKey, e);
  }
  const out = [...by.values()];
  cache.set(key, out);
  return out;
}

/** The rounds the match generates enemies for: 1 … the leader round (and the Hidden Core round). */
function roundList(m) {
  const gd = m.gd;
  const last = Math.max(gd.bossRound || 0, gd.hiddenRound || 0);
  return Array.from({ length: last }, (_, i) => i + 1);
}

/**
 * The console's view: every composition per half (with names, whether the mode allows it, whether this match's types
 * include it) and per round the scheduled type, the original and the current pick, the official chance of each
 * composition this round, and whether the host can still change it.
 */
export function planView(m, beforeCombat) {
  const gd = m.gd;
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const typeName = (t) => String(types[t]?.name || t).replace(/^特训敌人·/, '');
  const inMatch = new Set([...(m.factions || []), 'SPECIAL']);
  const name = (k) => (k ? gd.enemy(k)?.name || k : null);
  const sched = (m.factions && m.factions.schedule) || { typeSlots: [], picks: [] };
  const lists = {};
  for (const half of [true, false]) {
    lists[half ? 'first' : 'second'] = combos(gd, half).map((c) => ({
      id: c.id, key: c.entry.key, type: c.entry.type, typeName: typeName(c.entry.type), weight: c.entry.weight ?? 1,
      special: name(c.entry.key), normalName: name(c.normal), eliteName: name(c.elite), fly: typeof c.entry.fly === 'boolean' ? c.entry.fly : isFlyKey(gd, c.entry.key),
      allowed: !gd.inactiveEnemies.has(c.entry.key), inMatch: inMatch.has(c.entry.type) && !gd.inactiveEnemies.has(c.entry.key),
      share: 1 / (c.ns * c.es),
    }));
  }
  const rounds = roundList(m).map((r) => {
    const half = r <= firstHalfMax(gd);
    const list = lists[half ? 'first' : 'second'];
    // the official chance this round, given the match's type schedule (pickRoundEntry: an empty type falls back to SPECIAL)
    let type = sched.typeSlots[r - 1] || null;
    if (type && !list.some((c) => c.type === type && c.allowed)) type = 'SPECIAL';
    const pool = list.filter((c) => c.type === type && c.allowed);
    const total = pool.reduce((s, c) => s + Math.max(0, c.weight) * c.share, 0);
    const chance = {};
    for (const c of pool) chance[c.id] = total > 0 ? (Math.max(0, c.weight) * c.share) / total : 0;
    const original = idOf(sched.picks[r]);
    const over = m.adminPicks && m.adminPicks[r];
    const curPick = over || sched.picks[r];
    return {
      round: r, half: half ? 'first' : 'second', kind: r === gd.hiddenRound && r !== gd.bossRound ? 'hidden' : r === gd.bossRound ? 'boss' : 'normal',
      type: sched.typeSlots[r - 1] || null, typeName: typeName(sched.typeSlots[r - 1]), original, current: over ? idOf(over) : original, overridden: !!over, chance,
      roster: curPick ? rosterOf(m, r, curPick) : [],
      editable: !m.ended && (r > m.round || (r === m.round && beforeCombat)),
    };
  });
  return { lists, rounds };
}

/**
 * Set round `round`'s composition (`id` a combos id; '' / null clears the override → the original pick).
 * @returns {{ ok: true, current: boolean } | { error: string }} current: the round is the one being played (rebuild now)
 */
export function setPick(m, round, id, beforeCombat) {
  const gd = m.gd;
  const r = Number(round);
  if (!roundList(m).includes(r)) return { error: `没有第 ${round} 回合` };
  if (r < m.round || (r === m.round && !beforeCombat)) return { error: r === m.round ? '本回合的战斗已经开始，只能改之后的回合' : '这个回合已经过去了' };
  if (!m.adminPicks || typeof m.adminPicks !== 'object') m.adminPicks = {};
  if (id == null || id === '') {
    delete m.adminPicks[r];
    return { ok: true, current: r === m.round };
  }
  const half = r <= firstHalfMax(gd);
  const c = combos(gd, half).find((x) => x.id === String(id));
  if (!c) return { error: `第 ${r} 回合（${half ? '前半' : '后半'}）没有这个组合` };
  m.adminPicks[r] = pickOf(c, r, half, gd);
  return { ok: true, current: r === m.round };
}
