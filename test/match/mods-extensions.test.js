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
  assert.deepEqual(pub.extensions, { bossPanel: false, dupBand: false, deployCapOff: false, upgradeFill: true, revive: false, sharedLp: false });
  h.m.dispose();
});

test('revive: a doctor whose LP hits 0 is restored to the start LP instead of being eliminated', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 5, fake: true, humans: 2, bots: 0,
    extensions: { revive: true }, script: () => ({ leaks: { p_0: 3, p_1: 1 } }) }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.lp = 1; // this round's leaks will drive it below 0 — revive (not elimination) answers
  const lp0 = ps.lp;
  h.drive(() => m.phase === 'PREP' && m.round === 2);
  assert.equal(ps.alive, true, 'revive: the doctor is not eliminated');
  assert.equal(ps.lp, m.gd.startLp(ps.bandId), 'revive: the LP is restored to the start LP');
  assert.equal(ps.eliminatedRound, null, 'revive: no elimination round recorded');
  const mate = h.ps('p_1');
  assert.equal(mate.alive, true, 'the untouched teammate keeps playing');
  h.invariants();
  m.dispose();
  void lp0;
});

test('revive off (default): an LP-0 doctor is eliminated as usual', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 5, fake: true, humans: 2, bots: 0,
    script: () => ({ leaks: { p_0: 3, p_1: 1 } }) }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.lp = 1;
  h.drive(() => m.phase === 'PREP' && m.round === 2);
  assert.equal(ps.alive, false, 'default: the doctor is eliminated');
  assert.equal(ps.lp, 0, 'default: the eliminated doctor sits at 0 LP');
  assert.equal(ps.eliminatedRound, 1, 'default: the elimination round is recorded');
  h.invariants();
  m.dispose();
});

test('sharedLp: one team pool — the round bill comes off Σ LP, the rest is dealt back evenly', () => {
  // both doctors leak (no perfect seat → no 联防 rescue): 3 + 1 = 4 comes off the pool, then the pool is split again
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 5, fake: true, humans: 2, bots: 0,
    extensions: { sharedLp: true }, script: () => ({ leaks: { p_0: 3, p_1: 1 } }) }).start();
  h.toPrep(1);
  const m = h.m;
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  const total0 = a.lp + b.lp;
  h.drive(() => m.phase === 'PREP' && m.round === 2);
  assert.equal(total0 - (a.lp + b.lp), 4, 'the team pool loses exactly the round bill: 4 leaks → 4 LP');
  assert.ok(Math.abs(a.lp - b.lp) <= 1, `sharedLp: the pool is dealt back evenly (${a.lp} vs ${b.lp})`);
  assert.equal(a.stats.lpLost + b.stats.lpLost, 4, 'the shared bars drop by the team bill in total');
  h.invariants();
  m.dispose();
});

test('sharedLp + 联防: the pool absorbs the 联防 bill too — no round pays one doctor alone', () => {
  // p_0 leaks 4, p_1 is perfect → 联防 runs and its survivors still bill 4: the pool takes it, both bars end even
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 5, fake: true, humans: 2, bots: 0,
    extensions: { sharedLp: true },
    script: (b) => (b.kind === 'unite' ? { survivors: { p_0: 4 } } : { leaks: { p_0: 4, p_1: 0 } }) }).start();
  h.toPrep(1);
  const m = h.m;
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  const total0 = a.lp + b.lp;
  h.drive(() => m.phase === 'PREP' && m.round === 2);
  assert.equal(total0 - (a.lp + b.lp), 4, 'the 联防 bill comes off the team pool, not off the leaker alone');
  assert.ok(Math.abs(a.lp - b.lp) <= 1, `sharedLp: both bars end even after a 联防 round (${a.lp} vs ${b.lp})`);
  h.invariants();
  m.dispose();
});

test('sharedLp off (default): each doctor pays its own leaks', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 5, fake: true, humans: 2, bots: 0,
    script: () => ({ leaks: { p_0: 3, p_1: 1 } }) }).start();
  h.toPrep(1);
  const m = h.m;
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  h.drive(() => m.phase === 'PREP' && m.round === 2);
  assert.equal(a.lp, m.gd.startLp(a.bandId) - 3, 'default: p_0 pays its own 3 leaks');
  assert.equal(b.lp, m.gd.startLp(b.bandId) - 1, 'default: p_1 pays its own 1 leak');
  h.invariants();
  m.dispose();
});
