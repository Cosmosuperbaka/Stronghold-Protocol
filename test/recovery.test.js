import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { createRecovery, restoreMatch, recoveryIdentity } from '../server/recovery.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { Lobby, Room } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { Match } from '../server/match/Match.js';
import { makeMatch, DATA } from './match/harness.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { FakeBattle } from './match/fakeBattle.js';
import { getReplayConfig, setReplayConfig } from '../server/match/replay.js';
import { capturePrep } from '../server/match/rewind.js';
import { resetHostSettings, setPrep } from '../server/match/hostSettings.js';

const log = { info() {}, warn() {}, error() {} };
function fixture(t, mode = 'coop', options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-recover-'));
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, getData: () => DATA, log });
  const host = registry.create('Host'); host.connected = true;
  const h = makeMatch({ mode, humans: 1, bots: mode === 'coop' ? 1 : 0, seed: 77, fake: true, clientCombat: true, clients: false, ...options }).start();
  if (options.reroll) assert.deepEqual(h.m.completeSetupReroll(), { ok: true });
  h.toPrep();
  host.playerId = h.m.order[0].playerId;
  registry.byPlayerId.clear(); registry.byPlayerId.set(host.playerId, host);
  const room = new Room('TEST', mode, 'NORMAL', Date.now());
  room.seats = Array(4).fill(null);
  for (const p of h.m.order) room.seats[p.seat] = { seat: p.seat, playerId: p.playerId, name: p.name, isBot: p.isBot, connected: true };
  room.hostId = host.playerId; room.match = h.m; room.matchCount = 1;
  host.roomCode = room.code; lobby.rooms.set(room.code, room);
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.join(dir, 'recovery'), identity: 'test', log });
  t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  recovery.save(room, h.m, h.m.prepSnapshots.get(1));
  return { dir, h, recovery, lobby, room, host, file: path.join(dir, 'recovery', 'TEST.bin') };
}

test('disk snapshot restores PREP identically and continues to the same final result and history', (t) => {
  const old = getReplayConfig(); setReplayConfig({ enabled: true, identity: 'test' });
  t.after(() => setReplayConfig(old));
  const f = fixture(t), record = deserialize(fs.readFileSync(f.file));
  // Save abandoned battle entries to verify rewind truncates them when loading.
  record.replay = { rounds: [{ round: 1, fields: [], admin: [] }] };
  const other = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 77, fake: true, clientCombat: true, clients: false });
  t.after(() => other.m.dispose());
  restoreMatch(other.m, deserialize(serialize(record)));
  assert.equal(other.m.phase, 'PREP'); assert.equal(other.m.round, 1);
  assert.deepEqual(other.m.replay.rounds, []);
  assert.equal(other.ps('p_0').connected, false);
  other.ps('p_0').connected = true;
  assert.deepEqual(other.m.pool.entries, f.h.m.pool.entries);
  assert.deepEqual(other.ps('p_0').privateView(), f.h.ps('p_0').privateView());
  // Server-driven fake combat avoids browser timing in the deterministic continuation comparison.
  f.h.m.clientCombat = false; other.m.clientCombat = false;
  assert.ok(f.h.drive(() => !!f.h.ended)); assert.ok(other.drive(() => !!other.ended));
  const normalize = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(normalize(other.ended), normalize(f.h.ended));
  assert.deepEqual(normalize(other.m.history), normalize(f.h.m.history));
});

test('room prep recovery restores the saved override or follows current host settings', t => {
  resetHostSettings(); t.after(resetHostSettings);
  const f = fixture(t, 'coop', { humans: 2, bots: 0 });
  const restored = makeMatch({ humans: 2, bots: 0, seed: 77, fake: true });
  t.after(() => restored.m.dispose());
  f.h.m.prepOverride = { mode: 'fixed', seconds: 45 };
  const snapshot = capturePrep(f.h.m);
  f.recovery.save(f.room, f.h.m, snapshot);
  const record = deserialize(fs.readFileSync(f.file));
  setPrep({ mode: 'fixed', seconds: 90 });
  f.h.m.prepOverride = { mode: 'untimed' };
  restoreMatch(restored.m, record);
  assert.deepEqual(restored.m.prepOverride, { mode: 'fixed', seconds: 45 });
  assert.equal(restored.m.deadline - restored.m.sched.now(), 45000);
  record.snapshot.match.prepOverride = null;
  restoreMatch(restored.m, record);
  assert.equal(restored.m.prepOverride, null);
  assert.equal(restored.m.deadline - restored.m.sched.now(), 90000);
  assert.equal(restored.m.timerScale, 1);
  assert.equal(restored.m.errorCount, 0, JSON.stringify(restored.m.errors));
});

test('rerolled opening and locked DIY settings survive disk recovery through the hidden core', (t) => {
  const diy = { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' } };
  const ops = { char_112_siege: { potential: 2, cultivate: 1 } };
  const f = fixture(t, 'coop', { seed: 52, reroll: true, clientCombat: false,
    seats: [{ seat: 0, playerId: 'p_0', name: 'Host', isBot: false, connected: true, diy, ops },
      { seat: 1, playerId: 'p_1', name: 'Peer', isBot: false, connected: true }],
    script: b => b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {} });
  const m = f.h.m;
  assert.ok(f.h.drive(() => m.phase === 'PREP' && m.round === m.gd.bossRound));
  for (const p of m.order) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 601; p.recompute(); }
  assert.ok(f.h.drive(() => m.phase === 'PREP' && m.round === m.gd.hiddenRound));
  f.recovery.save(f.room, m, m.prepSnapshots.get(m.round));
  const record = deserialize(fs.readFileSync(f.file));
  // A restarted process reconstructs constructor-only player views from the stored seats.
  const restored = makeMatch({ mode: 'coop', seats: record.seats, seed: record.seed, fake: true,
    script: b => b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {} });
  t.after(() => restored.m.dispose());
  restoreMatch(restored.m, record);
  for (const p of restored.m.order) p.connected = true;
  assert.equal(restored.m.setupRevision, 1);
  assert.equal(restored.m.stageId, m.stageId);
  assert.deepEqual(restored.m.factions.schedule, m.factions.schedule);
  assert.deepEqual(restored.m.disabledBonds, m.disabledBonds);
  assert.deepEqual(restored.ps('p_0').diy, diy);
  assert.deepEqual(restored.ps('p_0').ops, ops);
  assert.deepEqual(restored.ps('p_0').diyStock.snapshot(), f.h.ps('p_0').diyStock.snapshot());
  assert.deepEqual(restored.ps('p_0').privateView(), f.h.ps('p_0').privateView());
  assert.ok(f.h.drive(() => !!f.h.ended)); assert.ok(restored.drive(() => !!restored.ended));
  assert.equal(restored.ended.hiddenCleared, true);
  const normalize = x => JSON.parse(JSON.stringify(x));
  assert.deepEqual(normalize(restored.ended), normalize(f.h.ended));
  assert.deepEqual(normalize(restored.m.history), normalize(m.history));
  assert.equal(restored.m.errorCount, 0, JSON.stringify(restored.m.errors));
});

test('startup reconstructs sessions with original tokens and seats; incompatible and corrupt files are isolated', (t) => {
  const f = fixture(t, 'solo');
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const registry = new SessionRegistry(), lobby = new Lobby({ registry, MatchClass: RestoredMatch, getData: () => DATA, log });
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
  t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
  const bad = deserialize(fs.readFileSync(f.file)); bad.identity = 'old'; bad.room.code = 'OLDD';
  fs.writeFileSync(path.join(path.dirname(f.file), 'OLDD.bin'), serialize(bad));
  fs.writeFileSync(path.join(path.dirname(f.file), 'BADD.bin'), 'corrupt');
  recovery.restore();
  assert.equal(lobby.rooms.size, 1); assert.equal(lobby.rooms.get('TEST').match.phase, 'PREP');
  const session = registry.byToken(f.host.token);
  assert.equal(session.playerId, f.host.playerId); assert.equal(session.roomCode, 'TEST');
  assert.equal(session.connected, false); assert.equal(session.resumeWindowMs, lobby.soloResumeWindowMs());
  assert.equal(recovery.status().issues.length, 2);
  assert.ok(recovery.status().issues.some((x) => x.error.includes('版本')));
  assert.ok(recovery.delete('../TEST.bin').error);
});

test('disabled persistence writes no snapshots and survives restart', (t) => {
  const f = fixture(t);
  assert.equal(f.recovery.configure(false).ok, true);
  assert.equal(fs.existsSync(f.file), false);
  f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
  assert.equal(fs.existsSync(f.file), false);
  const next = createRecovery({ lobby: f.lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
  assert.equal(next.status().enabled, false);
});

test('source checkout has a version fingerprint; original browser token reconnects after two real server restarts', async (t) => {
  assert.match(recoveryIdentity(process.cwd()), /^v[\w.-]+:[a-f0-9]{64}$/);
  const f = fixture(t, 'solo');
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0 }); }
  }
  for (let restart = 0; restart < 2; restart++) {
    const srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: RestoredMatch,
      assetIndex: false, recovery: { dir: path.dirname(f.file), identity: 'test' } });
    let client;
    try {
      client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      const welcome = await client.hello('Host', f.host.token);
      assert.equal(welcome.playerId, f.host.playerId); assert.equal(welcome.token, f.host.token);
      const state = await client.waitFor('room.state'); assert.equal(state.code, 'TEST');
      const pub = await client.waitFor('m.public', p => p.phase === 'PREP'); assert.equal(pub.round, 1);
      assert.equal(srv.lobby.rooms.get('TEST').match.players.get(f.host.playerId).connected, true);
    } finally { await client?.terminate(); await srv.close(); }
    assert.equal(fs.existsSync(f.file), true, 'normal shutdown retains the snapshot');
  }
});
