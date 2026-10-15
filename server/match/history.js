// server/match/history.js — the per-round record the local console charts (server/admin.js, server/admin.html): one entry
// per settled round with every player's LP, funds, shop level, running totals and this round's battle (LP lost, leaks,
// kills, damage, the units' damage) and the round's enemy composition.
// i18n-ignore-file: host-console data, no player-facing text (tools/i18n.mjs)
//
// recordRound(m) runs after normal or leader settlement before the next round resets results, and once more in
// finish() for an interrupted round. m.history is a MATCH_KEYS field (rewind.js): a rewind to round R's
// prep restores the record as it was then, rounds ≥ R gone.

/** Append m.round's entry to m.history (a no-op when the round is already recorded). */
export function recordRound(m, { includeBattleResults = true } = {}) {
  if (!Array.isArray(m.history)) m.history = [];
  if (m.history.some((h) => h.round === m.round)) return;
  const prev = m.history[m.history.length - 1];
  const before = new Map(prev ? prev.players.map((p) => [p.playerId, p]) : []);
  const players = m.order.map((ps) => {
    const s = ps.stats;
    const b = before.get(ps.playerId);
    const r = includeBattleResults && m.lastResults && m.lastResults.get(ps.playerId);
    // the own battle's units (a 联防's damage counts in the totals below, its units are not reported per unit)
    const units = (r && Array.isArray(r.unitStats) ? r.unitStats : [])
      .filter((u) => u && u.kind !== 'token' && u.dmg > 0)
      .sort((x, y) => y.dmg - x.dmg)
      .map((u) => ({ defId: u.defId, name: u.name, dmg: Math.round(u.dmg), kills: u.kills || 0 }));
    const dmg = Math.round(s.dmgDealt);
    return {
      playerId: ps.playerId,
      alive: ps.alive,
      lp: Math.max(0, ps.lp),
      funds: ps.funds,
      level: ps.shop.level,
      spent: s.gold,
      dmg,
      bossDmg: Math.round(s.bossDamage),
      loss: s.lpLost - (b ? b.lpLost : 0),
      lpLost: s.lpLost,
      leaks: s.leaks - (b ? b.leaksTotal : 0),
      leaksTotal: s.leaks,
      kills: s.kills - (b ? b.killsTotal : 0),
      killsTotal: s.kills,
      roundDmg: dmg - (b ? b.dmg : 0),
      perfect: !!r && s.leaks === (b ? b.leaksTotal : 0) && r.perfect !== false,
      economy: ps.economy ? { ...structuredClone(ps.economy), closing: ps.funds, refreshes: ps.round.refreshes, buys: ps.round.buys, sells: ps.round.sells } : null,
      income: ps.economy ? Object.values(ps.economy.income).reduce((n, v) => n + v, 0) : null,
      expense: ps.economy ? Object.values(ps.economy.expense).reduce((n, v) => n + v, 0) : null,
      bonds: Object.entries(ps.lastRoundBonds || ps.bonds || {}).map(([id,b]) => ({ id, name: ps.gd.bond(id)?.name || id, active: b.active, layers: b.layers, tier: b.tier })),
      leakDetails: includeBattleResults ? structuredClone(ps.leakHistory || []) : [],
      units,
    };
  });
  m.history.push({ round: m.round, enemy: enemyOf(m), players });
}

/** The round's composition (the shared pick of its wave; a leader round's escorts follow it), with names. */
function enemyOf(m) {
  const gd = m.gd;
  const boss = m.round === gd.bossRound || m.round === gd.hiddenRound;
  const pick = boss ? m.bossWaves && m.bossWaves[0] && m.bossWaves[0].wave.pick : m.wave && m.wave.pick;
  if (!pick) return null;
  const name = (k) => (k ? (gd.enemy(k) && gd.enemy(k).name) || k : null);
  const t = gd.factions.types && gd.factions.types[pick.type];
  return {
    type: pick.type, typeName: String((t && t.name) || pick.type).replace(/^特训敌人·/, ''), special: name(pick.key), normal: name(pick.normal),
    elite: name(pick.elite), fly: !!pick.fly, overridden: !!(m.adminPicks && m.adminPicks[m.round]),
  };
}
