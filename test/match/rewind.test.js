// server/match/rewind.js — 回到上个休整期开始. The check that catches forgotten state: a match rewound from later in a
// round and played on must end exactly like the same seed played straight through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { rewindToPrep } from '../../server/match/rewind.js';
import { makeMatch, checkInvariants } from './harness.js';

/** Everything that decides a match, without piece uids (rewind keeps uidSeq monotonic). */
function fingerprint(m) {
  const ids = (arr) => arr.map((p) => (p ? `${p.id}${p.items && p.items.length ? '+' + p.items.map((i) => i.id).join('+') : ''}` : '-'));
  return JSON.stringify({
    phase: m.phase, round: m.round, outcome: m.outcome, pool: [...m.pool.entries].map(([k, e]) => `${k}:${e.left}`),
    players: m.order.map((ps) => ({
      lp: ps.lp, alive: ps.alive, funds: ps.funds, level: ps.shop.level, shop: ps.shop.slots.map((s) => s && s.id),
      board: ids([...ps.board.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, p]) => ({ ...p, id: `${k}=${p.id}` }))),
      hand: ids(ps.hand), temp: ids(ps.temp), bonds: ps.bonds, layers: ps.layers, stats: ps.stats, effects: ps.effects.map((e) => e.key || e.name),
    })),
  });
}

const play = (seed) => makeMatch({ mode: 'coop', humans: 1, bots: 3, seed }).start().autoHumans();

test('rewound mid-round and replayed: the match ends exactly like the straight run', () => {
  const a = play(4242);
  assert.ok(a.drive(() => a.ended != null), "straight run ended");
  const straight = fingerprint(a.m);
  a.m.dispose();

  const b = play(4242);
  b.drive(() => b.m.phase === PHASE.PREP && b.m.round === 4);
  const atPrep = fingerprint(b.m);
  b.drive(() => b.m.phase === PHASE.SETTLE && b.m.round === 4);
  assert.notEqual(fingerprint(b.m), atPrep, 'the round moved on');
  assert.deepEqual(rewindToPrep(b.m), { ok: true, round: 4 });
  assert.equal(b.m.phase, PHASE.PREP);
  assert.equal(fingerprint(b.m), atPrep, 'state is back at the start of PREP R4');
  checkInvariants(b.m);
  assert.ok(b.drive(() => b.ended != null), "rewound run ended");
  assert.equal(fingerprint(b.m), straight);
  assert.equal(b.m.errorCount, 0, JSON.stringify(b.m.errors));
  b.m.dispose();
});

test('back from R6 to R3: later snapshots are dropped and the replay ends like the straight run', () => {
  const a = play(4242);
  assert.ok(a.drive(() => a.ended != null));
  const straight = fingerprint(a.m);
  a.m.dispose();

  const b = play(4242);
  b.drive(() => b.m.phase === PHASE.PREP && b.m.round === 3);
  const atPrep3 = fingerprint(b.m);
  b.drive(() => b.m.phase === PHASE.PREP && b.m.round === 6);
  assert.ok([3, 4, 5, 6].every((r) => b.m.prepSnapshots.has(r)), 'one snapshot per round');
  assert.match(rewindToPrep(b.m, 9).error, /第 9 回合/);
  assert.deepEqual(rewindToPrep(b.m, 3), { ok: true, round: 3 });
  assert.equal(fingerprint(b.m), atPrep3);
  assert.ok(b.m.prepSnapshots.has(3) && ![4, 5, 6].some((r) => b.m.prepSnapshots.has(r)), 'R4–R6 snapshots dropped');
  checkInvariants(b.m);
  assert.ok(b.drive(() => b.ended != null));
  assert.equal(fingerprint(b.m), straight);
  assert.equal(b.m.errorCount, 0, JSON.stringify(b.m.errors));
  b.m.dispose();
});

test('rewind twice in a row, mid-battle with client-side combat, and the human is told', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 77, clientCombat: true }).start().autoHumans();
  const m = h.m;
  assert.match(rewindToPrep(m).error, /快照/);
  h.drive(() => m.phase === PHASE.PREP && m.round === 3);
  const atPrep = fingerprint(m);
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 3);
  assert.ok(m.fields.some((f) => f.live), 'a battle is running');
  const before = h.sent.length;
  assert.deepEqual(rewindToPrep(m), { ok: true, round: 3 });
  assert.equal(fingerprint(m), atPrep);
  assert.ok(!m.fields.length && !m.runner, 'battles dropped');
  const resent = h.sent.slice(before).filter(([id, msg]) => id === 'p_0' && msg.t === 'm.private');
  assert.ok(resent.length >= 1, 'full m.private resent');
  assert.equal(h.lastBc('m.public').phase, PHASE.PREP);
  // a second rewind right away lands on the same state
  assert.deepEqual(rewindToPrep(m), { ok: true, round: 3 });
  assert.equal(fingerprint(m), atPrep);
  checkInvariants(m);
  h.runToEnd();
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  assert.match(rewindToPrep(m).error, /结束/);
  m.dispose();
});
