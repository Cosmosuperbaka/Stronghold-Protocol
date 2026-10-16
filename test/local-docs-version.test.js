// local-tools: the extension docs name the current release in several places; keep them on RELEASE_TAG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RELEASE_TAG } from '../server/release-version.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const DOCS = ['README.md', 'docs/HANDOFF.md', 'docs/LOCAL-DEV.md', 'docs/DEPLOY.md', 'docs/LOCAL-CHANGELOG.md', 'scripts/README.md'];

test('README, HANDOFF, LOCAL-DEV and LOCAL-CHANGELOG name RELEASE_TAG as the current release', () => {
  const readme = read('README.md');
  assert.ok(readme.includes(`badge/version-${RELEASE_TAG.slice(1).replace(/-/g, '--')}-`), 'README badge');
  assert.ok(readme.includes(`当前版本为 **\`${RELEASE_TAG}\`**`), 'README 当前版本');
  assert.ok(read('docs/HANDOFF.md').includes(`当前版本为 \`${RELEASE_TAG}\``), 'HANDOFF §2 当前版本');
  assert.ok(read('docs/LOCAL-DEV.md').includes(`当前版本为 \`${RELEASE_TAG}\``), 'LOCAL-DEV §1 当前版本');
  // Source integrations can precede the latest release without inventing a published extension tag.
  const newest = read('docs/LOCAL-CHANGELOG.md').split('\n').find((line) => /^## .* — v\d+\.\d+\.\d+-extended\.\d+：/.test(line));
  assert.ok(newest?.includes(` ${RELEASE_TAG}：`), `LOCAL-CHANGELOG newest entry: ${newest}`);
});

test('every extension revision in the docs carries its base version (v0.2.4-extended.4, not extended.4)', () => {
  const bare = [];
  for (const rel of DOCS) {
    read(rel).split('\n').forEach((line, i) => {
      const rest = line.replace(/v?\d+\.\d+\.\d+-{1,2}extended\.\d+/g, '');
      if (/\bextended\.\d/.test(rest)) bare.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, []);
});
