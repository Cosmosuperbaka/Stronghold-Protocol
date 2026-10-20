// Host's optional 联防 rule: field specs, latched settlement, helper attribution and the shared cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { setUniteLayerGains, resetHostSettings } from '../../server/match/hostSettings.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, legalTileFor, checkInvariants } from './harness.js';

for (const clientCombat of [false, true]) for (const enabled of [false, true]) for (const roomRule of [undefined, false, true]) {
  test(`联防 layers: ${clientCombat ? 'client' : 'server'} mode, host=${enabled}, room=${roomRule}`, () => {
    resetHostSettings();
    let h;
    try {
      setUniteLayerGains(enabled);
      h = makeMatch({
        uniteLayerGains: roomRule,
        mode: 'coop', humans: 3, seed: 97, fake: true, clientCombat,
        script: (b) => {
          if (b.kind === 'normal') return { leaks: { p_0: 2 }, layerGains: { p_1: { yanShip: 3 }, p_2: { yanShip: 3 } } };
          if (b.kind !== 'unite') return {};
          const layerGains = Object.fromEntries(b.opts.players.map((p) => [p.playerId, {
            yanShip: b.opts.flags.layerGainsEnabled ? Math.min(5, BOND_LAYER_CAP - p.bonds.yanShip.layers) : 0,
          }]));
          return { layerGains };
        },
      }).start();
      h.toPrep(1);
      const m = h.m;
      const id = Object.keys(DATA.chess).find((id) => DATA.chess[id].visible && !DATA.chess[id].isGolden && DATA.chess[id].bonds.includes('yanShip') && m.pool.has(id));
      const helpers = [h.ps('p_1'), h.ps('p_2')];
      for (const [i, ps] of helpers.entries()) {
        give(m, ps, id, 'board', legalTileFor(m, ps, id));
        ps.layers.yanShip = i === 0 ? 990 : 995;
        ps.recompute();
      }
      h.drive(() => m.phase === PHASE.UNITE);
      assert.equal(m.phase, PHASE.UNITE);
      const field = m.fields[0];
      const opts = clientCombat ? field.spec : field.battle.opts;
      const effective = roomRule ?? enabled;
      assert.equal(opts.flags.layerGainsEnabled, effective);
      assert.deepEqual(opts.players.map((p) => p.bonds.yanShip.layers).sort((a, b) => a - b), [993, 998], 'starts with the normal battle gains');
      setUniteLayerGains(!enabled);
      assert.equal(opts.flags.layerGainsEnabled, effective, 'the running spec stays fixed');
      h.drive(() => m.phase === PHASE.SETTLE);
      assert.deepEqual(helpers.map((p) => p.layers.yanShip), effective ? [998, 999] : [993, 998]);
      assert.equal(h.ps('p_0').layers.yanShip || 0, 0, 'leaker gets no helper layers');
      assert.ok(helpers.every((p) => p.pendingLayerGains === null));
      h.drive(() => m.phase === PHASE.UNITE && m.round === 2);
      const next = m.fields[0];
      assert.equal((clientCombat ? next.spec : next.battle.opts).flags.layerGainsEnabled, roomRule ?? !enabled);
      assert.equal(m.errorCount, 0, JSON.stringify(h.logs));
      checkInvariants(m);
    } finally {
      h?.m.dispose();
      resetHostSettings();
      FakeBattle.reset();
    }
  });
}

test('联防 layers: synthetic field results never grant layers', () => {
  setUniteLayerGains(true);
  const h = makeMatch({ mode: 'coop', humans: 2, fake: true, script: () => ({ leaks: { p_0: 2 } }) }).start();
  try {
    h.toPrep(1);
    h.drive(() => h.m.phase === PHASE.UNITE);
    h.m.settle(h.m.unitePlan, { synthetic: true, perPlayer: { p_1: { layerGains: { yanShip: 7 } } } });
    assert.equal(h.ps('p_1').layers.yanShip || 0, 0);
  } finally { h.m.dispose(); resetHostSettings(); }
});
