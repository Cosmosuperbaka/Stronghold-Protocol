import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarMessage } from '../../public/js/ui/matchCommunication.js';

test('avatar messages only include fresh player events, excluding history, host messages and future timestamps', () => {
  const messages = [
    { id: 1, playerId: 'p1', receivedAt: 1000, text: 'old' },
    { id: 2, playerId: 'p1', receivedAt: 2000, text: 'latest' },
    { id: 3, playerId: 'p1', receivedAt: null, text: 'history' },
    { id: 4, playerId: 'p1', receivedAt: 2500, role: 'system', text: 'host' },
    { id: 5, playerId: 'p2', receivedAt: 2900, text: 'peer' },
  ];
  assert.equal(avatarMessage(messages, 'p1', 3000).text, 'latest');
  assert.equal(avatarMessage(messages, 'p1', 5000), null);
  assert.equal(avatarMessage(messages, 'p1', 3000, false), null);
  assert.equal(avatarMessage([], 'p1', 3000), null);
  assert.equal(avatarMessage([{ playerId: 'p1', receivedAt: 4000 }], 'p1', 3000), null);
});
