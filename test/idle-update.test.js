import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdleUpdater } from '../server/idle-update.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-idle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = { time: 0, active: true, checks: 0, installs: [], notices: [],
    view: { canInstall: true, state: 'available', versions: [{ tag: 'v9', relation: 'new', signed: true, installable: true }] } };
  const options = { file: path.join(dir, 'config.json'), hasActive: () => f.active, now: () => f.time,
    announce: (s) => f.notices.push(s), updater: { status: () => f.view,
      check: async () => { f.checks++; return f.view; }, install: (v) => { f.installs.push(v); return f.view; } } };
  f.auto = createIdleUpdater(options); f.options = options; return f;
}
test('idle update is opt-in, persists, checks hourly, waits, announces and never forces matches', async (t) => {
  const f = fixture(t); await f.auto.tick(); assert.equal(f.checks, 0);
  f.auto.configure(true); assert.equal(createIdleUpdater(f.options).status().enabled, true);
  await f.auto.tick(); assert.equal(f.auto.status().state, 'waiting');
  f.active = false; await f.auto.tick(); assert.equal(f.notices.length, 1);
  f.time = 59999; await f.auto.tick(); assert.equal(f.installs.length, 0);
  f.time = 60000; await f.auto.tick(); assert.deepEqual(f.installs, [{ tag: 'v9' }]);
  assert.equal(f.checks, 1);
});
test('a new match during announcement cancels even if it ends before the next tick', async (t) => {
  const f = fixture(t); f.active = false; f.auto.configure(true); await f.auto.tick();
  f.time = 50000; f.auto.matchStarted(); f.time = 60000; await f.auto.tick();
  assert.equal(f.installs.length, 0); assert.equal(f.notices.length, 2);
  f.time = 120000; await f.auto.tick(); assert.equal(f.installs.length, 1);
});
test('old, unsigned and failed signed releases are never automatically installed again', async (t) => {
  const f = fixture(t); f.active = false; f.auto.configure(true);
  f.view.versions[0].relation = 'old'; await f.auto.tick(); assert.equal(f.notices.length, 0);
  f.time += 3600000; f.view.versions[0].relation = 'new'; f.view.versions[0].signed = false;
  await f.auto.tick(); assert.equal(f.auto.status().state, 'error'); assert.equal(f.installs.length, 0);
  f.auto.configure(true); f.time += 3600000; f.view.versions[0].signed = true; await f.auto.tick();
  f.time += 60000; await f.auto.tick(); f.view = { ...f.view, state: 'error', error: 'signature invalid' };
  await f.auto.tick(); assert.equal(f.auto.status().error, 'signature invalid');
  f.time += 3600000; await f.auto.tick(); assert.equal(f.installs.length, 1);
});

test('disabling during an awaited check prevents announcements and discards late success or failure', async (t) => {
  for (const fail of [false, true]) {
    const f = fixture(t); f.active = false;
    let finish;
    f.options.updater.check = () => new Promise((resolve, reject) => { finish = () => fail ? reject(new Error('late')) : resolve(f.view); });
    f.auto.configure(true);
    const pending = f.auto.tick();
    f.auto.configure(false); finish(); await pending;
    assert.equal(f.auto.status().state, 'disabled');
    assert.equal(f.auto.status().target, null);
    assert.deepEqual(f.notices, []); assert.deepEqual(f.installs, []);
  }
});
