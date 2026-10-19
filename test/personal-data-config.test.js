import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPersonalDataConfig } from '../server/http/personalDataConfig.js';
import { createRequestHandler } from '../server/http/routes.js';

test('optional deployment default only returns a validated source URL, rereads changes and hides unrelated fields', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-personal-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'personal-data.json');
  assert.deepEqual(readPersonalDataConfig(file), {});
  fs.writeFileSync(file, JSON.stringify({ migrationSource: 'https://old.example.test:3000', secret: 'never-serve' }));
  assert.deepEqual(readPersonalDataConfig(file), { migrationSource: 'https://old.example.test:3000/' });
  for (const migrationSource of ['', 'javascript:alert(1)', 'https://user:pass@example.test/',
    'https://example.test/path', 'https://example.test/?token=secret', 'https://example.test/#fragment', null]) {
    fs.writeFileSync(file, JSON.stringify({ migrationSource }));
    assert.deepEqual(readPersonalDataConfig(file), {});
  }
  fs.writeFileSync(file, 'bad'); assert.deepEqual(readPersonalDataConfig(file), {});
  fs.writeFileSync(file, ' '.repeat(4097)); assert.deepEqual(readPersonalDataConfig(file), {});
});
test('deployment endpoint is no-store JSON, supports HEAD and has no mutation methods', async () => {
  const handler = createRequestHandler({ serveStatic: async () => assert.fail('not static'), health: {}, log: { error: assert.fail } });
  async function request(method) {
    return new Promise((resolve) => {
      const headers = {};
      const response = { setHeader: (key, value) => { headers[key] = value; },
        writeHead: (status, values) => { response.status = status; Object.assign(headers, values); },
        end: (body) => resolve({ status: response.status, headers, body: body?.toString() }) };
      handler({ url: '/personal-data-config.json', method }, response);
    });
  }
  const get = await request('GET');
  assert.equal(get.status, 200);
  assert.equal(get.headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(get.body), readPersonalDataConfig());
  const head = await request('HEAD');
  assert.equal(head.status, 200); assert.equal(head.body, undefined);
  assert.equal((await request('POST')).status, 405);
});
