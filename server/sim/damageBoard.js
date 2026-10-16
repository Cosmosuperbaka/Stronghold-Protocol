// server/sim/damageBoard.js — 输出统计（伤害统计）的只读采集器。
//
// 移植自 Stardust-minus/Stronghold-Protocol 的 server/sim/damageBoard.js（GPL-3.0-or-later），
// 适配本仓库（zhewang448 v0.2.5-extended.1，基线官方 v0.2.5）——字段逐一核对过：
//   battle.players / battle.units / unit{kind,ownerId,uid,id,defId,ownerUnit,side,stats.dmg} /
//   ps.units / ps.input.units / battle._perPlayer[playerId].damageDealt  全部存在，逻辑未改。
//
// 读取模拟自身的「实际扣血」计数，不新增任何计分路径：
//   * battle._perPlayer[playerId].damageDealt —— 本场该玩家造成的总伤害（sim/damage.js 累加）
//   * unit.stats.dmg —— 每个模型单位累计的伤害（召唤物归其 root 干员）
// 只统计「实际扣除的生命值」：护盾吸收、过量伤害、闪避、取消、友方伤害都不计（与 damage.js 口径一致）。
//
// 本文件同时被浏览器加载：server/http/static.js 把 server/sim/ 以只读 /sim/ 暴露，
// 客户端的 Battle（/sim/spec.js createBattleFromSpec）通过 /sim/battle/events.js 的 damageRows() 方法使用本模块，
// 由 public/js/battle/damageLedger.js 汇总成快照（客户端版伤害统计）。
//
// Read the simulation's existing actual-HP-loss counters, never damage event amounts.
// Kept outside Battle.result(): trials call result() repeatedly but never need this view.
const histories = new WeakMap();
const damage = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
export const operatorDamageKey = (playerId, uid, fallback = null) => JSON.stringify([playerId, uid ?? `unit:${fallback}`]);

/** A root operator, not a guessed owner from a token's definition or playerId. */
function rootOperator(source, operators) {
  const seen = new Set();
  let root = source;
  while (root?.ownerUnit) { // loop-cap: the seen set returns on a cycle; the ownership chain is finite
    if (seen.has(root)) return null;
    seen.add(root);
    root = root.ownerUnit;
  }
  return root?.kind === 'op' && root.ownerId === source.ownerId && operators.has(root) ? root : null;
}

/**
 * Detached public rows for every field owner, dead/removed/undeployed sources included.
 * Metadata is captured independently of alive units; transformations/redeployment cannot rename a row.
 * Distinct pieces with the same defId stay distinct. Missing UIDs get a field-stable Unit id key.
 */
export function damageRows(battle) {
  let history = histories.get(battle);
  if (!history) { history = new Map(); histories.set(battle, history); }
  const operators = new Set();
  const rows = new Map();
  for (const ps of battle.players || []) {
    if (typeof ps.playerId !== 'string') continue;
    if (!history.has(ps.playerId)) history.set(ps.playerId, new Map());
    const metadata = history.get(ps.playerId);
    for (const u of ps.units || []) {
      if (u.kind !== 'op' || u.ownerId !== ps.playerId) continue;
      operators.add(u);
      const key = operatorDamageKey(ps.playerId, u.uid, u.id);
      if (!metadata.has(key)) {
        const input = u.uid == null ? null : ps.input?.units?.find((p) => p.uid === u.uid && p.kind !== 'token');
        metadata.set(key, { key, uid: u.uid ?? null, defId: input?.chessId ?? u.defId ?? null });
      }
    }
    rows.set(ps.playerId, { playerId: ps.playerId, total: damage(battle._perPlayer?.[ps.playerId]?.damageDealt),
      operators: new Map([...metadata].map(([key, meta]) => [key, { ...meta, damage: 0 }])), otherDamage: 0 });
  }
  // this.units is the full history (devices included). A reused Unit reference must never count twice.
  const seen = new Set();
  for (const u of battle.units || []) {
    if (!u || seen.has(u) || u.side !== 'ally') continue;
    seen.add(u);
    const row = rows.get(u.ownerId);
    if (!row) continue;
    const dealt = damage(u.stats?.dmg);
    const root = rootOperator(u, operators);
    const op = root && row.operators.get(operatorDamageKey(row.playerId, root.uid, root.id));
    if (op) op.damage += dealt;
    else row.otherDamage += dealt;
  }
  return { owners: [...rows.values()].map((row) => ({ ...row, operators: [...row.operators.values()] })) };
}

/** Clean failed fields still carry their captured initial operator metadata; no result-stat truncation. */
export function emptyDamageRows(spec) {
  return { owners: (spec.players || []).map((p) => ({ playerId: p.playerId, total: 0,
    operators: (p.units || []).filter((u) => u.kind !== 'token').map((u, i) => ({
      key: operatorDamageKey(p.playerId, u.uid, `input:${i}`), uid: u.uid ?? null, defId: u.chessId ?? null, damage: 0,
    })), otherDamage: 0 })) };
}

export function damageFrame(field, rows) {
  return { t: 'b.damage', fieldId: field.fieldId, kind: field.kind, round: field.round ?? field.battle?.round ?? 0,
    gt: Number(field.battle?.time) || 0, ...rows };
}
