import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseNotes } from '../server/release-notes.js';
import { shouldShowReleaseNotes } from '../public/js/ui/releaseNotes.js';

test('release notes select only current player content and never testing results', () => {
  const notes = parseReleaseNotes('## date — v1：title\n- 玩家功能\n- 发布全量验证：123\n- golden 与工具链：298\n\n## date — v0：old\n- old', 'v1');
  assert.deepEqual(notes.entries, ['玩家功能']);
  assert.deepEqual(parseReleaseNotes('', 'v1').entries, []);
  assert.equal(shouldShowReleaseNotes(null, 'v1'), false);
  assert.equal(shouldShowReleaseNotes('v1', 'v1'), false);
  assert.equal(shouldShowReleaseNotes('v0', 'v1'), true);
});
