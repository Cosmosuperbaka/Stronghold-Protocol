import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResultSummary } from '../server/result-summary.js';

test('summary filters, old records, nested damage, corruption and cache invalidation', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-summary-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const record = { savedAt: 100, mode: 'solo', difficulty: 'NORMAL', result: { victory: true, roundsPassed: 3, players: [{ lineup: [{ name: '甲' }], bonds: [{ name: '盟约', active: true }] }] }, history: [{ round: 4, players: [{ units: [{ name: '甲', dmg: 25 }], bonds: [] }] }] };
  const put = (name, r) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(r));
  put('a', record); put('old', { ...record, savedAt: 200, history: undefined, result: { ...record.result, victory: false } });
  put('broken', { ...record, history: {} }); fs.writeFileSync(path.join(dir, 'invalid.json'), '{');
  const summary = createResultSummary(dir);
  assert.equal(summary().games, 2); assert.equal(summary().skipped, 2); assert.equal(summary().winRate, 0.5);
  assert.equal(summary().groups[0].averageRound, 3.5);
  assert.deepEqual(summary().operators[0], { name: '甲', games: 2, damage: 25, maxDamage: 25 });
  assert.deepEqual(summary().bonds, [{ name: '盟约', games: 2 }]);
  assert.equal(summary({ from: 150 }).wins, 0); assert.equal(summary({ mode: 'coop' }).games, 0);
  fs.unlinkSync(path.join(dir, 'a.json')); assert.equal(summary().operators[0].damage, 0);
  for (let i = 0; i < 1000; i++) put('many-' + i, record);
  assert.equal(summary().games, 1001); assert.equal(summary().games, 1001);
});
