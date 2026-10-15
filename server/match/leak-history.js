// i18n-ignore-file: host-only diagnostics; never changes settlement.
export function groupLeaks(gd, leaks) {
  const groups = new Map();
  for (const l of leaks || []) {
    if (!l) continue;
    const key = l.enemyKey;
    const row = groups.get(key) || { name: gd.enemy(key)?.name || '未知敌人', count: 0, counted: 0, leakLp: 0 };
    row.count++;
    if (l.counted !== false) row.counted++;
    row.leakLp += Number.isFinite(l.lpr) && l.lpr >= 0 ? l.lpr : 1;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function normalLeakHistory(m, ps, own, { plan, uniteResult, uniteRan, loss }) {
  const normal = { kind: 'normal', enemies: groupLeaks(m.gd, own.leaked), loss: uniteRan ? 0 : loss };
  if (!uniteRan || !plan.leakers.includes(ps)) return [normal];
  const leaked = Object.values(uniteResult.perPlayer || {}).flatMap((p) => p?.leaked || [])
    .filter((l) => l?.sourcePlayerId === ps.playerId && l.counted !== false);
  leaked.push(...(uniteResult.unspawned || []).filter((l) => l?.sourcePlayerId === ps.playerId));
  // Entries unable to re-enter are charged by settle() too; retain their original identity.
  leaked.push(...(own.leaked || []).filter((l) => l && l.counted !== false && !m.gd.enemy(l.enemyKey)));
  return [normal, { kind: 'unite', enemies: groupLeaks(m.gd, leaked), loss }];
}
