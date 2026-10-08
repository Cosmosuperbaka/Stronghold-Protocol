// server/admin.js — the host's local console (server/admin.html): rooms, matches and players at a glance, plus host
// actions — 回到第 N 回合休整期 (./match/rewind.js), funds, LP, shop level, free refreshes, operator / item grants, bond
// layers and count bonuses, 托管, effects and 机变 cards, board edits, rerolling the coming enemies, forcing a battle's
// result, the timer scale, ending the prep or the match, closing a room.
//
// Reachable from this computer only: it listens on 127.0.0.1 (the LAN and a cloudflared tunnel to the game port never
// reach it), every /api request carries the per-process token embedded in the page, and the Host header must be the
// console's own localhost address (another site open in the host's browser cannot drive it, no DNS rebinding).
//
//   SP_ADMIN_PORT  default PORT + 100 (3100); SP_ADMIN=0 turns the console off (server/http/boot.js runMain).
//
// (i18n-ignore-file: a Chinese-only tool for the host of this private branch, never shown to players)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PHASE, PHASE_NAMES, BOND_LAYER_CAP, GEO } from '../shared/constants.js';
import { rewindToPrep } from './match/rewind.js';
import { boardOrder } from './match/board.js';
import { applyCard, tacticCard } from './match/choices.js';
import { buildNormalWave, buildBossWave, pickRoundEntry } from './match/waves.js';
import { syntheticResult } from './match/fields.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OK = { ok: true };
const int = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
const obj = (v) => (v && typeof v === 'object' ? v : {});
const BEFORE_COMBAT = new Set([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]);

/** The 机变 cards a grant can name: tactic cards with an effect (terrain only for the match's stage), bounty cards. */
function cardList(m) {
  const gd = m.gd;
  const cards = gd.choices.cards || {};
  return [
    ...(cards.tactic || []).filter((c) => c && gd.effect(c.effectId) && (c.kind !== 'terrain' || c.stageId === m.stageId))
      .map((c) => ({ id: c.effectId, name: c.name, kind: 'tactic', team: !!c.team, src: c })),
    ...(cards.bounty || []).filter((c) => c && gd.enemy(c.enemyKey)).map((c) => ({ id: c.effectId, name: c.name, kind: 'bounty', team: false, src: c })),
  ];
}

/** Bonds, effects, board and coming enemies of one player (the console's 详情 panel). */
function playerDetail(m, ps) {
  const gd = m.gd;
  const nameOf = (p) => {
    const rec = p.kind === 'chess' ? gd.chess(p.id) : p.kind === 'item' ? gd.item(p.id) : gd.token(p.id);
    return rec ? rec.name : p.id;
  };
  const pieceView = (p, where) => ({
    uid: p.uid, kind: p.kind, where, name: nameOf(p), count: p.kind === 'token' ? p.count || 1 : null,
    golden: p.kind === 'chess' && gd.isGolden(p.id), canPromote: p.kind === 'chess' && !gd.isGolden(p.id) && !!gd.goldenIdOf(p.id),
    items: (p.items || []).map((it) => ({ uid: it.uid, name: nameOf(it) })),
  });
  const pieces = [];
  for (const { r, c, piece } of boardOrder(ps.board)) pieces.push(pieceView(piece, `作战区 ${r - GEO.FIELD.r0 + 1}-${c - GEO.FIELD.c0 + 1}`));
  ps.hand.forEach((p, i) => { if (p) pieces.push(pieceView(p, `手牌 ${i + 1}`)); });
  ps.temp.forEach((p, i) => { if (p) pieces.push(pieceView(p, `整备区 ${i + 1}`)); });
  let enemies = [];
  try {
    enemies = m.nextEnemiesFor(ps).map((e) => ({ name: gd.enemy(e.enemyKey)?.name || e.enemyKey, count: e.count, elite: !!e.elite, boss: !!e.boss, fly: !!e.fly, bounty: e.source === 'bounty' }));
  } catch { /* the preview is informational */ }
  return {
    bonds: gd.bondIds.filter((id) => !gd.modeInactiveBonds.has(id)).map((id) => {
      const b = ps.bonds[id] || {};
      return { id, name: gd.bond(id).name, count: b.count || 0, thresholds: gd.bond(id).thresholds || [], active: !!b.active, layers: ps.layers[id] || 0, bonus: ps.bondCountBonus[id] || 0 };
    }),
    effects: ps.effects.map((e) => ({ id: e.id, name: e.name || e.key || e.id, desc: e.desc || '', counter: e.counter ?? null })),
    bounties: ps.bounties.map((b) => ({ id: b.id, name: b.card.name, desc: b.card.desc, roundsLeft: b.roundsLeft })),
    pieces,
    enemies,
  };
}

function matchView(m) {
  return {
    phase: m.phase, phaseName: PHASE_NAMES[m.phase] || m.phase, round: m.round, ended: m.ended, paused: m.paused, solo: m.isSolo,
    left: m.deadline ? Math.max(0, Math.round((m.deadline - m.sched.now()) / 1000)) : null,
    rewindRounds: [...m.prepSnapshots.keys()].sort((a, b) => a - b), errors: m.errorCount,
    timerScale: m.timerScale, canReroll: BEFORE_COMBAT.has(m.phase) && !!(m.wave || m.bossWaves),
    fields: m.fields.filter((f) => f.cc && !f.done).map((f) => ({ id: f.fieldId, kind: f.kind, players: f.players.map((pid) => m.players.get(pid)?.name || pid) })),
    players: m.order.map((ps) => ({
      id: ps.playerId, name: ps.name, bot: ps.isBot, connected: ps.connected && !ps.left, alive: ps.alive, ready: ps.ready,
      lp: ps.lp, funds: ps.funds, level: ps.shop.level, freeRefreshes: ps.shop.freeRefreshes || 0,
      board: ps.board.size, hand: ps.hand.filter(Boolean).length, autoplay: !!ps.autoplay,
      ...playerDetail(m, ps),
    })),
  };
}

/** GET /api/rooms */
export function roomsView(lobby) {
  return [...lobby.rooms.values()].map((r) => ({
    code: r.code, mode: r.mode, difficulty: r.difficulty,
    seats: r.seats.filter(Boolean).map((s) => ({ name: s.name, bot: s.isBot, connected: s.connected && !s.left })),
    match: r.match && r.match.order ? matchView(r.match) : null,
  }));
}

/** GET /api/catalog?room= — what a grant can name, for the running match's mode. */
export function catalogView(lobby, code) {
  const m = lobby.rooms.get(String(code))?.match;
  if (!m || !m.gd) return { chess: [], items: [] };
  const gd = m.gd;
  return {
    chess: gd.visibleChess.map((id) => {
      const c = gd.chess(id);
      return { id, name: c.name, tier: c.tier, goldenId: c.goldenId && gd.chess(c.goldenId) ? c.goldenId : null };
    }),
    items: Object.values(gd.shopItemsByTier).flat().map((id) => ({ id, name: gd.item(id).name, tier: gd.item(id).tier, equip: gd.item(id).itemType === 'EQUIP' })),
    cards: cardList(m).map(({ src, ...c }) => c),
  };
}

// Player actions: (m, ps, value) → OK | { error }. They change the state directly (no shop price, no onLevelUp effects).
const PLAYER_ACTIONS = {
  funds: (m, ps, v) => {
    const n = int(v);
    if (n == null) return { error: '请输入整数' };
    ps.addFunds(n, { reason: 'admin' });
    return OK;
  },
  lp: (m, ps, v) => {
    const n = int(v);
    if (n == null || n < 0) return { error: '请输入 ≥ 0 的整数' };
    ps.lp = n;
    ps.dirty();
    return OK;
  },
  level: (m, ps, v) => {
    const n = int(v);
    if (n == null || n < 1 || n > m.gd.maxShopLevel) return { error: `商店等级范围 1–${m.gd.maxShopLevel}` };
    ps.shop.level = n;
    ps.shop.upgradePrice = m.gd.upgradeBase(n) ?? 0;
    ps.recompute();
    ps.dirty();
    return OK;
  },
  refresh: (m, ps) => {
    ps.shop.freeRefreshes = (ps.shop.freeRefreshes || 0) + 1;
    ps.dirty();
    return OK;
  },
  chess: (m, ps, v) => {
    if (!m.gd.chess(String(v))) return { error: `没有这个干员：${v}` };
    return ps.acquireChess(String(v)) ? OK : { error: '手牌和整备区都满了' };
  },
  item: (m, ps, v) => {
    if (!m.gd.item(String(v))) return { error: `没有这个道具：${v}` };
    return ps.acquireItem(String(v)) ? OK : { error: '手牌和整备区都满了' };
  },

  // ---- bonds: value { bond, n }
  bondAdd: (m, ps, v) => {
    const { bond } = obj(v);
    const n = int(obj(v).n);
    if (!bondOk(m, bond)) return { error: `本模式没有这个盟约：${bond}` };
    if (n == null || n < 1) return { error: '请输入 ≥ 1 的整数' };
    // the game's own gain: recompute + onLayers, like any layer gain
    return ps.addLayers(bond, n, { reason: 'admin' }) > 0 ? OK : { error: `已到上限 ${BOND_LAYER_CAP}` };
  },
  bondSet: (m, ps, v) => {
    const { bond } = obj(v);
    const n = int(obj(v).n);
    if (!bondOk(m, bond)) return { error: `本模式没有这个盟约：${bond}` };
    if (n == null || n < 0 || n > BOND_LAYER_CAP) return { error: `层数范围 0–${BOND_LAYER_CAP}` };
    ps.layers[bond] = n;
    ps.recompute();
    return OK;
  },
  bondBonus: (m, ps, v) => {
    const { bond } = obj(v);
    const n = int(obj(v).n);
    if (!bondOk(m, bond)) return { error: `本模式没有这个盟约：${bond}` };
    if (n == null || Math.abs(n) > 99) return { error: '人数加成范围 −99–99' };
    // as effectsMeta setBondCountBonus
    if (n === 0) delete ps.bondCountBonus[bond];
    else ps.bondCountBonus[bond] = n;
    ps.recompute();
    return OK;
  },

  autoplay: (m, ps, v) => {
    if (ps.isBot) return { error: 'AI 座位不需要托管' };
    return m.setAutoplay(ps, v === true || v === '1' || v === 1);
  },

  // ---- effects and 机变 cards
  effectRemove: (m, ps, v) => {
    const i = ps.effects.findIndex((e) => e.id === String(v));
    if (i < 0) return { error: '效果不存在' };
    ps.effects.splice(i, 1); // as effectsMeta removeEffect
    ps.dirty();
    return OK;
  },
  bountyRemove: (m, ps, v) => {
    const n = ps.bounties.length;
    ps.bounties = ps.bounties.filter((b) => b.id !== String(v));
    if (ps.bounties.length === n) return { error: '悬赏不存在' };
    ps.dirty();
    return OK;
  },
  card: (m, ps, v) => {
    const c = cardList(m).find((x) => x.id === String(v));
    if (!c) return { error: `没有这张机变卡：${v}` };
    if (c.kind === 'bounty') return m.addBounty(ps, c.src) ? OK : { error: '悬赏的敌人不存在' };
    // a team card reaches every alive teammate too (applyCard)
    applyCard(m, ps, { ...tacticCard(c.src), family: 'tactic' });
    return OK;
  },

  // ---- board (any phase; no funds, no onSold)
  pieceRemove: (m, ps, v) => {
    const loc = ps.find(int(v));
    if (!loc) return { error: '棋子不存在' };
    const piece = loc.piece;
    if (piece.kind !== 'chess') {
      ps._detach(loc);
      ps.recompute();
      return OK;
    }
    // sell() without the gain: its equipment back to the hand / temp, its summons and pool copies gone
    const room = ps.hand.filter((x) => x == null).length + ps.temp.filter((x) => x == null).length + (loc.area === 'hand' || loc.area === 'temp' ? 1 : 0);
    if ((piece.items || []).length > room) return { error: '手牌和整备区放不下它的装备' };
    ps._detach(loc);
    ps.removeTokensOf(piece.uid);
    for (const it of piece.items || []) ps.stow(it, { allowTemp: true });
    piece.items = [];
    ps.returnCopies(piece);
    ps.checkItemMerges();
    ps.recompute();
    return OK;
  },
  piecePromote: (m, ps, v) => {
    const loc = ps.find(int(v));
    if (!loc || loc.piece.kind !== 'chess') return { error: '不是干员' };
    if (m.gd.isGolden(loc.piece.id)) return { error: '已经是精锐' };
    return ps.promote(loc.piece) ? OK : { error: '这个干员没有精锐形态' };
  },
  // value { target: uid, item: itemId }: a new copy of the item, equipped whatever the phase (equip()'s non-consumable branch)
  pieceEquip: (m, ps, v) => {
    const tloc = ps.find(int(obj(v).target));
    if (!tloc || tloc.piece.kind !== 'chess' || tloc.area === 'equipped') return { error: '目标不是干员' };
    const id = String(obj(v).item);
    const rec = m.gd.item(id);
    if (!rec || rec.itemType !== 'EQUIP') return { error: `不是装备：${id}` };
    if (typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip')) return { error: '消耗型装备请用「发放道具」，再在游戏里使用' };
    const item = ps.newPiece('item', id);
    // an owned twin completes a merge: the elite item goes to the hand, as equip() does
    if (ps.completesItemMerge(id) && ps._mergeItem(id, item)) { ps.recompute(); return OK; }
    ps._attach(tloc.piece, item);
    m.dispatchItem(ps, item, tloc.piece, 'onEquip', { item, target: tloc.piece, golden: !!rec.isGolden, consumed: false });
    ps.checkItemMerges();
    ps.recompute();
    return OK;
  },
};

function bondOk(m, id) {
  return typeof id === 'string' && !!m.gd.bond(id) && !m.gd.modeInactiveBonds.has(id);
}

/**
 * Force a client-combat field's result (value { field, n? }). Normal field: win = perfect, lose = `n` counted leaks of
 * the field's own enemy (settle charges min(lpCapPerRound, n); in co-op they re-enter 联防 like real leaks). 联防: win =
 * every leaked enemy killed (a non-synthetic empty result), lose = nobody helped (synthetic: settle charges the leakers'
 * own leaks). Boss: win empties the shared pool, lose sets the team LP to 0; either ends every boss field.
 */
function forceField(m, v, win) {
  const f = m.fields.find((x) => x.fieldId === String(obj(v).field));
  if (!f) return { error: '战场不存在（可能已经结束）' };
  if (!f.cc) return { error: '只支持客户端战斗模式' };
  if (f.done) return { error: '这场已经结束' };
  if (f.kind === 'boss' || f.kind === 'hidden') {
    if (!m.bossPool) return { error: '没有领袖战' };
    if (win) m.bossPool.hp = 0;
    else { m.teamLp = 0; m._syncTeamLp(); }
    m.markPublic();
    m._checkFinalEnd();
    return OK;
  }
  const res = syntheticResult(f.players);
  if (f.kind === 'unite') {
    if (win) res.synthetic = false;
  } else if (!win) {
    const n = int(obj(v).n);
    if (n == null || n < 1) return { error: '请输入 ≥ 1 的漏怪数' };
    const spawn = ((f.spec && f.spec.spawns) || []).find((s) => s && m.gd.enemy(s.enemyKey));
    for (const pid of f.players) Object.assign(res.perPlayer[pid], { perfect: false, leaked: Array.from({ length: n }, () => ({ enemyKey: spawn ? spawn.enemyKey : null, counted: true })) });
  }
  m._clearFieldTimers(f);
  f.result = res;
  // as _endFinal: the browsers showing it drop the battle (a late b.result names a done field and is ignored)
  for (const pid of m._humansShowing(f)) m.sendTo(pid, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'forced' });
  m._fieldDone(f);
  return OK;
}

const MATCH_ACTIONS = {
  rewind: (m, v) => {
    const r = rewindToPrep(m, v === '' ? null : v);
    if (r.ok) for (const ps of m.order) m.toast(ps, 'warn', `主机已回档到第 ${r.round} 回合休整期开始`);
    return r;
  },
  endPrep: (m) => {
    if (m.phase !== PHASE.PREP) return { error: '当前不在休整期' };
    m.prepDeadline();
    return OK;
  },
  pause: (m, v) => m.setPause(null, v === true || v === '1' || v === 1),
  // ROUND_START / 机变 / PREP: a new enemy entry of the round's faction type (the match's schedule fixed the round's
  // pick at setup, so rebuilding alone would repeat it). Draws from rngWaves; a rewind restores the old composition.
  reroll: (m) => {
    if (!BEFORE_COMBAT.has(m.phase)) return { error: '只能在战斗开始前重新随机' };
    const r = m.round;
    const old = m.wave ? m.wave.pick : m.bossWaves && m.bossWaves[0] ? m.bossWaves[0].wave.pick : null;
    if (!old) return { error: '本回合没有可随机的敌人' };
    const pick = pickRoundEntry(m.gd, m.rngWaves, old.type, r);
    if (!pick) return { error: '没有可选的敌人' };
    const picks = [];
    picks[r] = pick; // roundPick reads { picks } (waves.js)
    if (m.wave) m.wave = buildNormalWave(m.gd, m.rngWaves, { picks }, r);
    else {
      // as _planBossWaves, with the new pick
      const bossId = r === m.gd.hiddenRound && r !== m.gd.bossRound ? m.hiddenBossId : m.bossId;
      m.bossWaves = m.bossWaves.map((w) => ({ ...w, wave: buildBossWave(m.gd, m.rngWaves, { picks }, r, { bossId, solo: m.isSolo || w.players.length === 1 }) }));
    }
    for (const ps of m.order) ps.dirty(); // m.private.nextEnemies
    m.markPublic();
    return OK;
  },
  battleWin: (m, v) => forceField(m, v, true),
  battleLose: (m, v) => forceField(m, v, false),
  // phase / turn timers set from now on (a running countdown keeps its deadline)
  timerScale: (m, v) => {
    const n = Number(v);
    if (!(n >= 0.1 && n <= 10)) return { error: '倍率范围 0.1–10' };
    m.timerScale = n;
    return OK;
  },
  endMatch: (m) => {
    m.finish({ victory: false, reason: 'admin' });
    return OK;
  },
};

/** POST /api/action { room, action, playerId?, value? } → { ok } | { error, detail? } */
export function handleAction(lobby, body) {
  const { room: code, action, playerId, value } = body || {};
  const room = lobby.rooms.get(String(code));
  if (!room) return { error: '房间不存在' };
  if (action === 'closeRoom') {
    lobby.disposeRoom(room, '控制台关闭');
    return OK;
  }
  const m = room.match;
  if (!m || !m.order) return { error: '房间还没开局' };
  if (m.ended || m.disposed) return { error: '对局已结束' };
  let run;
  if (Object.hasOwn(MATCH_ACTIONS, action)) run = () => MATCH_ACTIONS[action](m, value);
  else if (Object.hasOwn(PLAYER_ACTIONS, action)) {
    const ps = m.players.get(String(playerId));
    if (!ps) return { error: '玩家不存在' };
    run = () => PLAYER_ACTIONS[action](m, ps, value);
  } else return { error: `未知操作：${action}` };
  let res = null;
  // guard: errors are isolated and logged like any intent, and the views go out right after
  m.guard(() => { res = run(); });
  return res || { error: '执行出错（见服务器日志）' };
}

function readJson(req, limit = 8192) {
  return new Promise((resolve) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { s += d; if (s.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
    req.on('close', () => resolve(null));
  });
}

/** @returns {Promise<{ url: string, port: number, token: string, close: () => Promise<void> }>} */
export async function startAdmin({ lobby, port = 3100, host = '127.0.0.1', log = console }) {
  const token = randomBytes(16).toString('hex');
  const page = fs.readFileSync(path.join(DIR, 'admin.html'), 'utf8').replace('__TOKEN__', token);
  const tokenBuf = Buffer.from(token);
  const authed = (req) => {
    const t = Buffer.from(String(req.headers['x-admin-token'] || ''));
    return t.length === tokenBuf.length && timingSafeEqual(t, tokenBuf);
  };

  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      const p = server.address().port;
      if (req.headers.host !== `127.0.0.1:${p}` && req.headers.host !== `localhost:${p}`) return send(403, { error: 'forbidden host' });
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') return send(200, page, 'text/html; charset=utf-8');
      if (!url.pathname.startsWith('/api/')) return send(404, { error: 'not found' });
      if (!authed(req)) return send(403, { error: 'bad token' });
      if (req.method === 'GET' && url.pathname === '/api/rooms') return send(200, { rooms: roomsView(lobby) });
      if (req.method === 'GET' && url.pathname === '/api/catalog') return send(200, catalogView(lobby, url.searchParams.get('room')));
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const body = await readJson(req);
        if (!body) return send(400, { error: '请求格式错误' });
        const r = handleAction(lobby, body);
        log.info(`[admin] ${body.room} ${body.action}${body.playerId ? ' ' + body.playerId : ''}${body.value != null ? ' ' + JSON.stringify(body.value) : ''} → ${r.ok ? 'ok' : r.error}`);
        return send(200, r);
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      log.error('[admin] request failed', e);
      return send(500, { error: '控制台内部错误' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const actual = server.address().port;
  return { url: `http://${host}:${actual}`, port: actual, token, close: () => new Promise((r) => server.close(() => r())) };
}
