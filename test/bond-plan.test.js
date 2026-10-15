import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch, DATA } from './match/harness.js';
import { buildBattleSpec } from '../server/sim/spec.js';
import { capturePrep, rewindToPrep } from '../server/match/rewind.js';

const core = Object.entries(DATA.bonds).filter(([, b]) => b.isCore).map(([id]) => id);

test('bond plan validates real core bonds, broadcasts, survives reconnect and enters the match', async () => {
  assert.equal(core.length, 8);
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  const connect = async (token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    c.welcome = await c.hello('Plan', token); return c;
  };
  try {
    const a = await connect(), b = await connect();
    assert.equal((await a.request({ t: 'room.bondPlan', bondId: core[0] })).t, 'ok');
    await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const room = await a.waitFor('room.state');
    assert.equal(room.seats[0].bondPlan, core[0]);
    await b.request({ t: 'room.join', code: room.code }); await b.waitFor('room.state');
    for (const bondId of [core[1], null]) {
      assert.equal((await a.request({ t: 'room.bondPlan', bondId })).t, 'ok');
      await b.waitFor('room.state', s => s.seats[0].bondPlan === bondId);
    }
    const nonCore = Object.keys(DATA.bonds).find(id => !DATA.bonds[id].isCore);
    for (const bondId of ['__proto__', nonCore, '', {}, 12]) {
      // The heavy bucket is deliberately bypassed here only for malformed requests: the validator rejects first.
      const reply = await a.request({ t: 'room.bondPlan', bondId });
      assert.equal(reply.t, 'error');
    }
    const resumedToken = a.welcome.token;
    await a.close();
    const resumed = await connect(resumedToken);
    const state = await resumed.waitFor('room.state'); assert.equal(state.seats[0].bondPlan, null);
    await b.request({ t: 'room.ready', ready: true });
    await resumed.request({ t: 'room.start' });
    const pub = await resumed.waitFor('m.public');
    assert.equal(pub.players.find(p => p.playerId === resumed.welcome.playerId).bondPlan, null);
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});

test('announcing a bond changes neither BattleSpec nor battle input; rewind keeps the latest plan', () => {
  const h = makeMatch({ mode: 'solo' }).start();
  try {
    h.toPrep(1); const ps = h.m.order[0];
    const before = buildBattleSpec(h.m._normalOpts(ps)), input = ps.battleInput();
    capturePrep(h.m);
    assert.deepEqual(h.m.setBondPlan(ps.playerId, core[2]), { ok: true });
    assert.deepEqual(buildBattleSpec(h.m._normalOpts(ps)), before);
    assert.deepEqual(ps.battleInput(), input);
    assert.equal(h.m.publicView().players[0].bondPlan, core[2]);
    rewindToPrep(h.m, 1);
    assert.equal(ps.bondPlan, core[2]);
    assert.ok(h.m.setBondPlan(ps.playerId, '__proto__').error);
  } finally { h.m.dispose(); }
});
