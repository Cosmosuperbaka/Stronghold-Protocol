import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { makeMatch, DATA } from './harness.js';
import { createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { getReplayConfig, setReplayConfig, replayRecord } from '../../server/match/replay.js';
import { rewindToPrep } from '../../server/match/rewind.js';
import { handleAction } from '../../server/admin.js';

function record(t) {
  const config = getReplayConfig();
  setReplayConfig({ enabled: true, identity: 'test-identity' });
  t.after(() => setReplayConfig(config));
}
const entries = (m) => m.replay?.rounds.flatMap((r) => r.fields) || [];

test('replay: real full match records actual inputs and adopted client/server/unite results, without changing outcomes', (t) => {
  record(t);
  const play = (enabled) => {
    setReplayConfig({ enabled });
    const h = makeMatch({ mode: 'coop', humans: 2, bots: 2, seed: 4242, clientCombat: true, captureFrames: false }).start().autoHumans();
    t.after(() => h.m.dispose());
    assert.ok(h.drive(() => h.ended != null));
    assert.equal(h.m.errorCount, 0, JSON.stringify(h.logs));
    return h;
  };
  const a = play(true), b = play(false);
  assert.deepEqual(a.ended, b.ended, 'recording consumes no RNG and changes no match state');
  const all = entries(a.m);
  assert.ok(all.length >= 12);
  assert.ok(all.some((f) => f.source === 'client'));
  assert.ok(all.some((f) => f.source === 'server'));
  assert.ok(all.some((f) => f.kind === 'unite'));
  for (const f of all) {
    assert.ok(f.spec && f.result && f.digest);
    assert.deepEqual(f.spec, JSON.parse(JSON.stringify(f.spec)));
    if (!f.playable) continue;
    const result = createBattleFromSpec(f.spec, DATA, { recordEvents: false, quiet: true }).runToEnd(15000);
    assert.equal(resultDigest(result).json, f.digest.json, `${f.battleId}: replay matches adopted result`);
  }
  setReplayConfig({ enabled: true });
  const bytes = gzipSync(JSON.stringify(replayRecord(a.m, {}))).length;
  t.diagnostic(`Four-player full match: ${all.length} fields, ${bytes} gzip bytes`);
  assert.ok(bytes < 1024 * 1024, 'representative recording stays below 1 MiB gzip');
  assert.equal(b.m.replay, undefined);
});

test('replay: rewind R6 to R3 drops abandoned battle IDs and records only the replacement timeline', (t) => {
  record(t);
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 3, seed: 4242, clientCombat: true, fake: true }).start().autoHumans();
  t.after(() => h.m.dispose());
  h.toPrep(6);
  const old = entries(h.m).filter((f) => f.spec.round >= 3).map((f) => f.battleId);
  assert.ok(old.length);
  assert.deepEqual(rewindToPrep(h.m, 3), { ok: true, round: 3 });
  assert.ok(entries(h.m).every((f) => f.spec.round < 3));
  assert.ok(h.drive(() => h.ended != null));
  assert.ok(entries(h.m).some((f) => f.spec.round >= 3));
  assert.ok(entries(h.m).every((f) => !old.includes(f.battleId)));
  assert.equal(h.m.errorCount, 0);
});

test('replay: console forcing normal, unite and boss fields is synthetic; boss always remains view-only', (t) => {
  record(t);
  const h = makeMatch({ humans: 2, bots: 0, seed: 88, clientCombat: true, clients: false, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, room = { code: 'TEST', match: m }, lobby = { rooms: new Map([['TEST', room]]) };
  m.startCombat();
  const normal = [...m.fields];
  assert.ok(handleAction(lobby, { room: 'TEST', action: 'battleLose', value: { field: normal[0].fieldId, n: 1 } }).ok);
  assert.equal(entries(m).find((f) => f.battleId === normal[0].battleId).source, 'synthetic');
  assert.ok(handleAction(lobby, { room: 'TEST', action: 'battleWin', value: { field: normal[1].fieldId } }).ok);
  h.run(() => m.phase === 'UNITE');
  assert.equal(m.phase, 'UNITE');
  assert.ok(handleAction(lobby, { room: 'TEST', action: 'battleWin', value: { field: 'u' } }).ok);
  assert.equal(entries(m).find((f) => f.kind === 'unite').source, 'synthetic');
  h.toPrep(2);
  m.round = m.gd.bossRound;
  m.startFinalAssault();
  const bossIds = m.fields.map((f) => f.battleId);
  assert.ok(handleAction(lobby, { room: 'TEST', action: 'battleWin', value: { field: m.fields[0].fieldId } }).ok);
  h.run(() => bossIds.every((id) => entries(m).find((f) => f.battleId === id)?.result));
  assert.ok(entries(m).filter((f) => bossIds.includes(f.battleId)).every((f) => !f.playable && f.source === 'synthetic'), JSON.stringify(entries(m).filter((f) => bossIds.includes(f.battleId)).map((f) => ({ id: f.battleId, source: f.source, reason: f.reason }))));
  assert.ok(entries(m).filter((f) => f.source === 'synthetic').every((f) => !f.playable));
  assert.ok(m.replay.rounds.some((r) => r.admin.some((e) => e.action === 'battleWin')));
});

test('replay: legacy server mode is view-only; disabling mid-match cannot save an incomplete recording', (t) => {
  record(t);
  const h = makeMatch({ clientCombat: false, fake: true }).start().autoHumans();
  t.after(() => h.m.dispose());
  assert.ok(h.drive(() => h.ended != null));
  const r = replayRecord(h.m, {});
  assert.equal(r.clientCombat, false);
  assert.deepEqual(entries(h.m), []);
  const c = makeMatch({ clientCombat: true, fake: true }).start().toPrep();
  t.after(() => c.m.dispose());
  setReplayConfig({ enabled: false });
  c.m.startCombat();
  setReplayConfig({ enabled: true });
  assert.equal(replayRecord(c.m, {}), null);
});
