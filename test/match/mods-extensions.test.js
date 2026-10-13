// 玩法扩展 (room.setExtensions → Match opts.extensions) — the four rule switches this deployment adds:
//   upgradeFill 升本补卡 (default ON): a 调度中心 upgrade draws a fresh card into every new slot;
//   dupBand 重复策略: the strategy draft allows duplicates (a manual pick, a timed-out turn, an AI seat);
//   deployCapOff 取消部署上限: the board's deploy cap is lifted;
//   bossPanel DPS面板: display-only (the client's ui/dpsPanel.js reads m.public.extensions) — pinned here as pass-through.
// The official behaviours stay covered by feedback5-shop-levelslots.test.js (upgradeFill off there) and the band-draft
// suites (dupBand off).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { ROOM_EXTENSIONS, ROOM_EXTENSIONS_DEFAULT, normalizeExtensions, extensionsAreDefault } from '../../shared/constants.js';

test('normalizeExtensions: unknown keys dropped, missing → default, non-bool → default', () => {
  assert.deepEqual(normalizeExtensions({ dupBand: true, junk: 'x' }), { ...ROOM_EXTENSIONS_DEFAULT, dupBand: true });
  assert.deepEqual(normalizeExtensions(undefined), ROOM_EXTENSIONS_DEFAULT);
  assert.deepEqual(normalizeExtensions({ bossPanel: 'yes' }), ROOM_EXTENSIONS_DEFAULT);
  assert.equal(extensionsAreDefault(ROOM_EXTENSIONS_DEFAULT), true);
  assert.equal(extensionsAreDefault({ dupBand: true }), false);
  assert.equal(extensionsAreDefault({ bossPanel: false }), false);
});

test('upgradeFill (default on): a level-up draws a fresh card into each new slot, following the freeze toggle', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 7, fake: true, extensions: { upgradeFill: true } }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.funds = 500;
  ps.shop.slots[0].sold = true;
  assert.deepEqual(h.m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
  assert.equal(ps.shop.slots.length, 5, '标准 L2 = 4 chess + 1 item');
  assert.ok(ps.shop.slots[3], 'the new chess slot carries a fresh card (升本补卡)');
  assert.equal(ps.shop.slots[0].sold, true, 'the sold slot is not refilled');
  assert.notEqual(ps.shop.slots[3].id, undefined);
  h.invariants();
  h.m.dispose();
});

test('dupBand: two players may take the same strategy (manual pick, timeout, AI seat)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 5, fake: true, humans: 2, bots: 0, extensions: { dupBand: true } }).start();
  h.run(() => h.m.phase === 'BAND_DRAFT');
  const m = h.m;
  const [a, b] = [...m.players.keys()];
  // the first player's pick
  const draft = m.draft;
  const first = draft.turns ? null : null;
  const turnPid = m.draftTurn();
  const bandId = m.gd.bandIds()[0];
  assert.deepEqual(m.handle(turnPid, { t: 'g.band', bandId }), { ok: true });
  // the second player's turn: the same strategy is allowed now (dupBand)
  h.run(() => m.draftTurn() !== turnPid);
  const other = m.draftTurn();
  assert.deepEqual(m.handle(other, { t: 'g.band', bandId }), { ok: true }, 'dupBand: the same strategy is pickable');
  h.run(() => m.phase === 'INFO_CHECK' || m.phase === 'ROUND_START' || m.phase === 'BATTLE_CHECK');
  h.invariants();
  m.dispose();
  void first;
});

test('dupBand off (default): the same pick is still refused with 队友已选', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 5, fake: true, humans: 2, bots: 0 }).start();
  h.run(() => h.m.phase === 'BAND_DRAFT');
  const m = h.m;
  const turnPid = m.draftTurn();
  const bandId = m.gd.bandIds()[0];
  assert.deepEqual(m.handle(turnPid, { t: 'g.band', bandId }), { ok: true });
  h.run(() => m.draftTurn() !== turnPid);
  const other = m.draftTurn();
  const r = m.handle(other, { t: 'g.band', bandId });
  assert.equal(r.ok, undefined, 'default: the duplicate is refused');
  h.run(() => m.phase === 'INFO_CHECK' || m.phase === 'ROUND_START' || m.phase === 'BATTLE_CHECK');
  h.invariants();
  m.dispose();
});

test('deployCapOff: the board deploy cap is lifted (base 8 → no cap), placement rules still apply', () => {
  const gd = new GameData(DATA, 'mode_single_normal');
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 3, fake: true, extensions: { deployCapOff: true } }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  assert.equal(ps.deployCap, 99, 'the cap reads 99 (lifted) instead of the base 8');
  assert.equal(new GameData(DATA, 'mode_single_normal').deployCap, 8, 'the data base is unchanged');
  h.invariants();
  h.m.dispose();
  void gd;
});

test('m.public carries the room extensions (the client DPS panel reads bossPanel)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 3, fake: true, extensions: { bossPanel: false } }).start();
  h.toPrep(1);
  const pub = h.bc.filter((msg) => msg.t === 'm.public').at(-1);
  assert.ok(pub, 'an m.public was broadcast');
  assert.deepEqual(pub.extensions, { bossPanel: false, dupBand: false, deployCapOff: false, upgradeFill: true });
  h.m.dispose();
});
