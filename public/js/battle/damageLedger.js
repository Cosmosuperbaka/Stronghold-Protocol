// public/js/battle/damageLedger.js — 本地输出统计账本（客户端版伤害统计）。
//
// 浏览器自己模拟战斗（battle/runner.js，DESIGN §14 client-side combat）。这个模块按 1 Hz 采样每场本地战斗的
// Battle.damageRows()（server/sim/damageBoard.js，经 /sim/ 只读共享），把「当前回合」各场合并成与服务器版
// m.damage 相同形状的快照，写进 store.match.damage，供输出统计面板（ui/damageBoard.js）显示。
//
// 范围：只统计本浏览器模拟到的场 —— 自己的战斗（authoritative）、观战 / 联防 / Boss 搭档的显示复本
// （display replicas）。没有本地 battle 的场没有数据，面板显示「暂无此视角的战斗记录」。
// 口径与模拟一致：只计实际扣除的生命值；召唤物归其根干员；装置与无归属伤害单列（「装置 / 其他」）。
//
// 轮次语义：pub.round 变化时冻存上一轮的最终合并；新回合尚未开战（PREP）时继续显示上一轮的冻结值
// （status 'frozen'），一旦本轮有战斗就叫「实时累计」（status 'live'，全部场次结束后转 'frozen'）。

import { store } from '../store.js';
import { battleRunner } from './runner.js';

/** 采样周期（与服务器版 m.damage 的 DAMAGE_PUBLIC_MS 一致）。 */
const SAMPLE_MS = 1000;

/** @type {Map<number, Map<string, { rows: object[], done: boolean }>>} round → fieldId → 该场最新行与结束态 */
const rounds = new Map();
let currentRound = null;
let matchKey = null;
let lastFrozen = null;
let lastWire = '';
let timer = null;

const clamp = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);

/** 合并一个回合各场的 owners 行：同 key 的干员跨场累加（对齐服务器版 DamageBoard._packet 的合并口径）。 */
function packetFor(round, names) {
  const byPlayer = new Map();
  const fields = rounds.get(round);
  if (fields) for (const field of fields.values()) for (const owner of field.rows) {
    if (!owner || typeof owner.playerId !== 'string') continue;
    let row = byPlayer.get(owner.playerId);
    if (!row) { row = { playerId: owner.playerId, total: 0, otherDamage: 0, operators: new Map() }; byPlayer.set(owner.playerId, row); }
    row.total += clamp(owner.total);
    row.otherDamage += clamp(owner.otherDamage);
    for (const op of Array.isArray(owner.operators) ? owner.operators : []) {
      if (!op || typeof op.key !== 'string') continue;
      const dealt = clamp(op.damage);
      const existing = row.operators.get(op.key);
      if (existing) existing.damage += dealt;
      else row.operators.set(op.key, { key: op.key, uid: op.uid ?? null, defId: op.defId ?? null, damage: dealt });
    }
  }
  return [...byPlayer.values()].map((row) => ({
    playerId: row.playerId,
    ...(names.get(row.playerId) ? { name: names.get(row.playerId) } : {}),
    total: row.total,
    otherDamage: row.otherDamage,
    operators: [...row.operators.values()],
  }));
}

function sample() {
  if (!battleRunner) return;
  const pub = store.get().match?.public || null;
  const pubRound = Number.isInteger(pub?.round) ? pub.round : null;
  for (const s of battleRunner.damageSources?.() || []) {
    const round = Number.isInteger(s.round) && s.round > 0 ? s.round : pubRound;
    if (!Number.isInteger(round) || round < 1) continue;
    let rows = null;
    try { rows = s.battle?.damageRows?.(); } catch { rows = null; }   // 只读快照；战斗中途与结束后都可用
    if (!rows || !Array.isArray(rows.owners)) continue;
    let fields = rounds.get(round);
    if (!fields) { fields = new Map(); rounds.set(round, fields); }
    fields.set(s.fieldId, { rows: rows.owners, done: !!s.done || !!s.battle?.finished });
  }
  publish(pub);
}

function publish(pub) {
  if (!pub) return;
  // 换了一局：清空全部累计
  const key = pub.matchId ?? null;
  if (key !== matchKey) {
    matchKey = key;
    rounds.clear();
    currentRound = null;
    lastFrozen = null;
  }
  const round = Number.isInteger(pub.round) ? pub.round : currentRound;
  if (!Number.isInteger(round) || round < 1) return;
  const names = new Map();
  for (const p of Array.isArray(pub.players) ? pub.players : []) if (p && typeof p.playerId === 'string' && p.name) names.set(p.playerId, p.name);
  // 轮次推进：冻存上一轮的最终合并（新回合尚未开战时继续显示它）
  if (currentRound !== round) {
    if (currentRound != null) {
      const prev = packetFor(currentRound, names);
      if (prev.length) lastFrozen = { matchId: key, round: currentRound, phase: 'round', status: 'frozen', owners: prev };
    }
    currentRound = round;
    for (const r of [...rounds.keys()]) if (r < round - 1) rounds.delete(r);   // 只保留当前与上一轮
  }
  let packet = null;
  const owners = packetFor(round, names);
  if (owners.length) {
    const fields = rounds.get(round);
    const allDone = !!fields?.size && [...fields.values()].every((f) => f.done);
    packet = { matchId: key, round, phase: 'round', status: allDone ? 'frozen' : 'live', owners };
  } else if (lastFrozen) {
    packet = lastFrozen;
  }
  if (!packet) return;
  const wire = JSON.stringify(packet);
  if (wire === lastWire) return;
  lastWire = wire;
  store.patch('match', { damage: packet });
}

/** 开始采样（幂等；boot 里调用一次；页面不在前台时由 visibilitychange 补采样）。 */
export function startDamageLedger() {
  if (timer || !battleRunner) return;
  const tick = () => { try { sample(); } catch { /* 采样失败绝不影响游戏 */ } };
  timer = setInterval(tick, SAMPLE_MS);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }
  tick();
}
