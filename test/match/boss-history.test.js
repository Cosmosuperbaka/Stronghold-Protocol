// Leader-round history must survive the transition from Final Assault to Hidden Core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { roomsView, resultRecord } from '../../server/admin.js';
import { recordRound } from '../../server/match/history.js';

for (const mode of ['solo', 'coop']) for (const outcome of ['terminal-win', 'terminal-loss', 'hidden-win', 'hidden-loss']) {
  const unlock = outcome.startsWith('hidden');
  test(`${mode}: leader history records final and hidden rounds once (${outcome})`, t => {
    const h = makeMatch({ mode, humans: mode === 'solo' ? 1 : 2, seed: 11, fake: true }).start().toPrep();
    const m = h.m;
    t.after(() => m.dispose());
    m.cancel(m._phaseTimer);
    m.cancel(m._turnTimer);
    m.round = m.gd.bossRound;
    m.phase = PHASE.FINAL_ASSAULT;
    m.hiddenBossId = unlock ? Object.keys(m.gd.raw.bosses)[0] : null;
    m.hiddenLayerSum = 100000;
    m.teamLp = 100;
    m.bossPool = { hp: outcome === 'terminal-loss' ? 10 : 0 };
    for (const ps of m.order) { ps.bandId = null; ps.lpAtFinal = 50; }
    const fields = () => [{ players: m.order.map(ps => ps.playerId), live: true }];
    const result = (damage, name) => ({ errors: 0, perPlayer: Object.fromEntries(m.order.map(ps => [ps.playerId, {
      damageDealt: damage, killed: 1, perfect: true, leaked: [], coins: 0,
      unitStats: [{ defId: 'operator', name, dmg: damage, kills: 1, kind: 'chess' },
        { defId: 'token', name: 'summon', dmg: 9, kind: 'token' }],
    }])) });
    m.fields = fields();
    m._finishFinal(false, () => result(1400, 'FinalOperator'));
    assert.deepEqual(m.history.map(r => r.round), [m.gd.bossRound], 'saved before any transition timer fires');
    assert.equal(m.history[0].players[0].roundDmg, 1400);
    assert.deepEqual(m.history[0].players[0].units.map(u => u.name), ['FinalOperator']);
    if (unlock) {
      // Exercise the real delayed transition; replace only startRound to avoid running a battle in this history test.
      m.startRound = round => { m.round = round; m.phase = PHASE.HIDDEN_CORE; m.lastResults = new Map(); };
      assert.ok(h.drive(() => m.round === m.gd.hiddenRound, { ready: false }));
      m.fields = fields();
      m.bossPool = { hp: outcome === 'hidden-loss' ? 10 : 0 };
      m._finishFinal(true, () => result(1500, 'HiddenOperator'));
      assert.ok(h.drive(() => m.ended, { ready: false }));
      assert.deepEqual(m.history.map(r => r.round), [m.gd.bossRound, m.gd.hiddenRound]);
      assert.equal(m.history[1].players[0].roundDmg, 1500, 'hidden delta excludes final-round damage');
      assert.equal(m.history[1].players[0].units[0].name, 'HiddenOperator');
    } else {
      assert.ok(h.drive(() => m.ended, { ready: false }));
      assert.equal(m.history.length, 1, 'finish does not duplicate the terminal boss round');
    }
    const room = { code: 'TEST', match: m, seats: [] };
    assert.deepEqual(roomsView({ rooms: new Map([['TEST', room]]) })[0].match.history, m.history);
    assert.deepEqual(resultRecord(room, m, { players: [] }).history, m.history, 'saved records retain all leader rounds');
    assert.equal(m.errorCount, 0);
  });
}

test('ending during an unplayed prep does not duplicate the previous battle units', t => {
  const h = makeMatch({ humans: 1, seed: 11, fake: true }).start().toPrep(), m = h.m;
  t.after(() => m.dispose());
  const ps = h.ps('p_0');
  m.round = 13;
  ps.stats.dmgDealt = 1300;
  m.lastResults.set(ps.playerId, { unitStats: [{ defId: 'operator', name: 'Previous', dmg: 1300, kind: 'chess' }], perfect: true });
  recordRound(m);
  m.startRound(14);
  m.finish({ victory: false, reason: 'admin' });
  assert.equal(m.history[0].players[0].units[0].dmg, 1300);
  assert.equal(m.history[1].players[0].roundDmg, 0);
  assert.deepEqual(m.history[1].players[0].units, []);
  assert.equal(m.history[1].players[0].perfect, false);
  assert.equal(m.errorCount, 0);
});
