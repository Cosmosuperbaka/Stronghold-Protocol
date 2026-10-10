// Result names must follow the battle's server-owned operator selection, including shared DIY slots and stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { validateClientResult } from '../../server/match/fields.js';
import { buildBattleSpec, compactResult } from '../../server/sim/spec.js';
import { diyRecordOf } from '../../shared/diy.js';
import { recordRound } from '../../server/match/history.js';
import { resultRecord, roomsView } from '../../server/admin.js';
import { DATA, makeMatch } from './harness.js';

const gd = new GameData(DATA, 'mode_multi_hard');
const slot = 'chess_char_5_diy1_a';
const siege = { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
const ash = { charId: 'char_456_ash', skillIndex: 2, uniEquipId: null };
const unit = (uid, chessId, extra = {}) => ({ uid, kind: 'chess', chessId, row: 10, col: 3, items: [], ...extra });
const makeSpec = (players, kind = 'normal') => buildBattleSpec({
  battleId: 'names', fieldId: 'names', kind, seed: 1, round: 2, timeLimit: 60, players, spawns: [],
});
const rawResult = (spec) => compactResult({ reason: 'forced', time: 1, killed: 0, total: 0, errors: 0,
  perPlayer: Object.fromEntries(spec.players.map((p) => [p.playerId, {
    killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, unitsEnd: [],
    damageDealt: 1000000, unitStats: p.units.map((u) => ({ uid: u.uid, defId: 'forged', name: 'forged',
      kind: 'op', dmg: 1000000, kills: 1, heal: 0, taken: 0, attacks: 1 })),
  }])),
});

test('client result: normal/elite DIY names follow each seat and battle snapshot, never client names', () => {
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
    const spec = makeSpec([
      { playerId: 'a', units: [unit(1, slot, { diy: { ...siege } }), unit(2, slot.replace('_a', '_b'), { diy: { ...siege } })], bonds: {} },
      { playerId: 'b', units: [unit(3, slot, { diy: { ...ash } })], bonds: {} },
    ], kind);
    const raw = rawResult(spec);
    for (const p of Object.values(raw.perPlayer)) for (const u of p.unitStats) u.name = 'forged';
    const validated = validateClientResult(spec, raw, { gd });
    assert.ok(validated.ok, validated.reason);
    assert.deepEqual(validated.result.perPlayer.a.unitStats.map((u) => u.name), ['推进之王', '推进之王']);
    assert.equal(validated.result.perPlayer.b.unitStats[0].name, '灰烬');
    assert.equal(validated.result.perPlayer.a.unitStats[0].defId, slot, 'slot identity stays unchanged');
    assert.deepEqual(validateClientResult(spec, raw, { gd }).result, validated.result, 'does not mutate input');
    assert.equal(raw.perPlayer.a.unitStats[0].defId, 'forged');
    assert.equal(validateClientResult(spec, raw).result.perPlayer.a.unitStats[0].name, slot, 'no data: safe ID fallback');
  }
});

test('client result: prototypes and stand-ins use their actual names; ordinary operators keep theirs', () => {
  const protoId = DATA.backups.diy.prototypes[5][0];
  const proto = { charId: protoId };
  const ordinary = Object.keys(DATA.chess).find((id) => gd.standIn(id));
  assert.ok(ordinary);
  const spec = makeSpec([{ playerId: 'p', bonds: {}, units: [
    unit(1, slot, { diy: proto }), unit(2, ordinary, { standIn: true }), unit(3, ordinary),
  ] }]);
  const v = validateClientResult(spec, rawResult(spec), { gd });
  assert.ok(v.ok, v.reason);
  assert.deepEqual(v.result.perPlayer.p.unitStats.map((u) => u.name), [
    diyRecordOf(gd.chess(slot), proto, DATA).name, gd.standIn(ordinary).name, gd.chess(ordinary).name,
  ]);
});

test('validated DIY names reach round history, damage tickers and saved console records', () => {
  const h = makeMatch({ seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [slot]: siege } }], seed: 11, fake: true });
  const m = h.m;
  const ps = h.ps('p_0');
  const piece = ps.acquireChess(slot);
  ps.hand[ps.hand.indexOf(piece)] = null;
  ps.board.set('10,3', piece);
  const spec = makeSpec([{ playerId: ps.playerId, bonds: {}, units: [unit(piece.uid, slot, { diy: siege })] }]);
  const v = validateClientResult(spec, rawResult(spec), { gd: m.gd });
  assert.ok(v.ok, v.reason);
  m.round = 2;
  m.lastResults.set(ps.playerId, v.result.perPlayer[ps.playerId]);
  ps.stats.dmgDealt = 1000000;
  recordRound(m);
  assert.equal(m.history[0].players[0].units[0].name, '推进之王');
  const tickers = [];
  m.tickerFor = (...args) => tickers.push(args);
  m._charDamageTickers(ps, v.result.perPlayer[ps.playerId]);
  assert.ok(tickers.length > 0);
  assert.ok(tickers.every((t) => t[1][1] === '推进之王'));
  const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL' };
  const saved = resultRecord(room, m, { players: [{ playerId: ps.playerId, lineup: [{ id: slot, diy: siege }], bonds: [] }] });
  assert.equal(saved.history[0].players[0].units[0].name, '推进之王');
  assert.equal(saved.result.players[0].lineup[0].name, '推进之王');
  m.dispose();
});

test('console: stand-in names in player details and saved lineup agree with battle results', () => {
  const id = Object.keys(DATA.chess).find((key) => gd.standIn(key));
  const charId = gd.chess(id).charId;
  const h = makeMatch({ seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true,
    notOwned: [id] }], fake: true });
  const m = h.m;
  const ps = h.ps('p_0');
  assert.equal(ps.fieldsStandIn(id), true);
  const piece = ps.acquireChess(id);
  const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', seats: [], match: m };
  const detail = roomsView({ rooms: new Map([['TEST', room]]) })[0].match.players[0];
  assert.equal(detail.pieces.find((p) => p.uid === piece.uid).name, gd.standIn(id).name);
  const saved = resultRecord(room, m, { players: [{ playerId: ps.playerId, lineup: [{ id, standInFor: charId }], bonds: [] }] });
  assert.equal(saved.result.players[0].lineup[0].name, gd.standIn(id).name);
  m.dispose();
});
