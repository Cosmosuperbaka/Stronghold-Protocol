// GitHub #693: a submitted issue must carry the version the reporter is on. The shields.io badge
// is replaced in this extension by a link to its own main branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['BugReport.yml', 'FeatureRequest.yml'];

function versionBlock(src) {
  const parts = src.split(/\n  - type: /).slice(1);
  return parts.find((b) => b.startsWith('input\n') && b.includes('label: 版本号')) || '';
}

for (const file of FILES) {
  test(`${file}: required 版本号 and the extension source reference`, () => {
    const src = readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const field = versionBlock(src);
    assert.match(field, /^input\n/);
    assert.match(field, /\n    id: version\n/);
    assert.match(field, /\n      label: 版本号\n/);
    assert.match(field, /标题画面角落/);
    assert.match(field, /发布压缩包的文件名/);
    assert.match(field, /git rev-parse --short HEAD/);
    assert.match(field, /只作对照/);
    assert.match(field, /\n    validations:\n      required: true$/);
    assert.doesNotMatch(field, /shields\.io/);
    assert.match(src, /github\.com\/zhewang448\/Stronghold-Protocol\/commits\/main/);
  });
}
