import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { recordRound } from '../../server/match/history.js';
import { resetHostSettings, setRoundCharts } from '../../server/match/hostSettings.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { pointsOf } from '../../public/js/ui/roundChart.js';

test('public round charts use settled records, exclude noStack bonds and host-only details, follow rewind and the host gate', (t) => {
  const h = makeMatch({ humans: 2, fake: true }).start().toPrep();
  t.after(() => { h.m.dispose(); resetHostSettings(); });
  const m = h.m, ps = m.order[0];
  assert.equal(m.publicView().roundCharts, true);
  assert.deepEqual(m.publicView().roundHistory, []);
  const bonds = {
    yanShip: { active: true, layers: 15, tier: 1 },
    soloShip: { active: true, layers: 9, tier: 1 },
    maniShip: { active: true, layers: 5, tier: 1 },
  };
  ps.lastRoundBonds = bonds;
  recordRound(m);
  recordRound(m);
  m.history[0].players[0].units = [{ defId: 'test-op', name: 'Test', dmg: 123, kills: 2, internal: 'private' }];
  const pub = m.publicView();
  assert.equal(pub.roundHistory.length, 1, 'one record per round');
  const p = pub.roundHistory[0].players[0];
  assert.deepEqual(p.bonds, [{ id: 'yanShip', name: m.gd.bond('yanShip').name, active: true, layers: 15 }]);
  assert.equal(p.lp, m.history[0].players[0].lp);
  assert.equal(p.spent, m.history[0].players[0].spent);
  assert.deepEqual(p.units, [{ defId: 'test-op', name: 'Test', dmg: 123, kills: 2 }]);
  assert.equal(p.economy, undefined);
  assert.equal(pub.roundHistory[0].enemy, undefined);
  assert.equal(m.history[0].players[0].bonds.find((b) => b.id === 'soloShip').noStack, true);
  m.round = 2; m.prepSnapshots.set(2, capturePrep(m));
  recordRound(m);
  assert.equal(m.publicView().roundHistory.length, 2);
  assert.equal(rewindToPrep(m, 2).ok, true);
  assert.deepEqual(m.publicView().roundHistory.map((h) => h.round), [1]);
  setRoundCharts(false);
  assert.equal(m.publicView().roundCharts, false);
  assert.deepEqual(m.publicView().roundHistory, []);
  setRoundCharts(true);
  assert.equal(m.publicView().roundHistory.length, 1, 'history survives a hidden panel');
});

test('chart points stop after elimination and distinguish missing legacy economy from zero', () => {
  const history = [
    { round: 1, players: [{ playerId: 'a', alive: true, income: null }] },
    { round: 2, players: [{ playerId: 'a', alive: false, income: 0 }] },
    { round: 3, players: [{ playerId: 'a', alive: false, income: 7 }] },
  ];
  assert.deepEqual(pointsOf(history, 'a', 'income'), [{ round: 2, v: 0 }]);
});
