import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replayIdentity, saveReplay, readReplay, replayFiles, replayAdminLogs, deleteRecordFiles } from '../server/replay-store.js';

const fixture = () => ({ format: 1, made: { identity: 'same' }, players: [], rounds: [{ round: 1, admin: [{ action: 'funds' }], fields: [
  { players: ['p'], spec: { players: [], spawns: [] }, playable: true },
  { kind: 'boss', players: ['p'], spec: { players: [], spawns: [] }, playable: false, reason: 'shared-boss', source: 'boss-credited', result: { time: 12 } },
] }] });
const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-replay-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('replays: gzip, compatible/mismatched versions, malformed/unknown formats and traversal', (t) => {
  const dir = temp(t);
  saveReplay(dir, 'record.json', fixture());
  assert.equal(readReplay(dir, 'record.json', 'same').rounds[0].fields[0].playable, true);
  const old = readReplay(dir, 'record.json', 'different');
  assert.equal(old.compatible, false);
  assert.equal(old.rounds[0].fields[0].playable, false);
  assert.equal(old.rounds[0].fields[0].canAttempt, true);
  assert.equal(old.rounds[0].fields[1].canAttempt, true);
  assert.equal(readReplay(dir, 'record.json', 'same').rounds[0].fields[1].canAttempt, true);
  assert.equal(readReplay(dir, '../record.json', 'same'), null);
  assert.throws(() => saveReplay(dir, '../record.json', fixture()));
  saveReplay(dir, 'unknown.json', { format: 2, rounds: [] });
  assert.match(readReplay(dir, 'unknown.json', 'same').error, /格式/);
  saveReplay(dir, 'malformed.json', { ...fixture(), rounds: [{}] });
  assert.match(readReplay(dir, 'malformed.json', 'same').error, /损坏/);
  fs.writeFileSync(path.join(dir, 'corrupt.json.gz'), 'not gzip');
  assert.equal(readReplay(dir, 'corrupt.json', 'same'), null);
});

test('replays: old boss/hidden recordings allow attempts, but synthetic and unfinished fields stay view-only', (t) => {
  const dir = temp(t), replay = fixture();
  const boss = replay.rounds[0].fields[1];
  replay.rounds = [
    { round: 14, admin: [], fields: [boss] },
    { round: 15, admin: [], fields: [
      { ...boss, kind: 'hidden' },
      { ...boss, source: 'synthetic' },
      { ...boss, result: { time: 12, synthetic: true } },
      { ...boss, source: null, result: null },
      { ...boss, result: { time: -1 } },
      { ...boss, result: { time: null } },
    ] },
  ];
  saveReplay(dir, 'boss.json', replay);
  for (const identity of ['same', 'different']) {
    const loaded = readReplay(dir, 'boss.json', identity);
    const fields = loaded.rounds.flatMap((r) => r.fields);
    assert.deepEqual(fields.map((f) => f.canAttempt), [true, true, false, false, false, false, false]);
    assert.ok(fields.every((f) => !f.playable), 'boss attempts never become exact replays');
    assert.deepEqual(fields.map((f) => f.spec), replay.rounds.flatMap((r) => r.fields).map((f) => f.spec));
  }
});

test('replays: retain newest 50, preserve results, clear archived logs without changing specs or ordering', (t) => {
  const dir = temp(t), results = path.join(dir, 'results'), replays = path.join(dir, 'replays');
  fs.mkdirSync(results);
  for (let i = 0; i < 52; i++) {
    const id = `record-${i}.json`;
    fs.writeFileSync(path.join(results, id), '{}');
    saveReplay(replays, id, fixture());
    fs.utimesSync(path.join(replays, `${id}.gz`), new Date(1000 + i * 1000), new Date(1000 + i * 1000));
  }
  assert.equal(replayFiles(replays).length, 50);
  assert.equal(fs.readdirSync(results).length, 52);
  assert.equal(readReplay(replays, 'record-0.json', 'same'), null);
  const before = fs.statSync(path.join(replays, 'record-51.json.gz')).mtimeMs;
  assert.equal(replayAdminLogs(replays), 50);
  assert.equal(replayAdminLogs(replays, true), 50);
  assert.equal(replayAdminLogs(replays), 0);
  const r = readReplay(replays, 'record-51.json', 'same');
  assert.deepEqual(r.rounds[0].fields[0].spec, fixture().rounds[0].fields[0].spec);
  assert.equal(fs.statSync(path.join(replays, 'record-51.json.gz')).mtimeMs, before);
  assert.equal(deleteRecordFiles(results, replays, 'record-51.json'), 2);
  assert.equal(deleteRecordFiles(results, replays, 'record-51.json'), 0);
  assert.throws(() => deleteRecordFiles(results, replays, '../record-1.json'));
});

test('replay fingerprint: code/data content changes count; Node-only loader and timestamps do not', (t) => {
  const dir = temp(t);
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), data); };
  put('server/sim/core.js', 'export const x = 1;'); put('server/sim/nodeData.js', 'node only');
  put('shared/constants.js', 'constants'); put('public/js/battle/runner.js', 'runner');
  for (const name of ['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects', 'backups']) put(`data/${name}.json`, '{}');
  const a = replayIdentity(dir);
  put('server/sim/nodeData.js', 'changed');
  fs.utimesSync(path.join(dir, 'server/sim/core.js'), new Date(), new Date());
  assert.equal(replayIdentity(dir), a);
  put('data/items.json', '{"changed":true}'); assert.notEqual(replayIdentity(dir), a);
  const b = replayIdentity(dir);
  put('server/sim/core.js', 'export const x = 2;'); assert.notEqual(replayIdentity(dir), b);
});
