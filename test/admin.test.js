// server/admin.js — the host's local console: localhost + token only, and its actions reach the running match.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server/index.js';
import { startAdmin, handleAction, roomsView } from '../server/admin.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch, checkInvariants } from './match/harness.js';

let srv = null;
let admin = null;
after(async () => { if (admin) await admin.close(); if (srv) await srv.close(); });

/** Raw request (fetch cannot forge a Host header). */
function req(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { s += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* html */ } resolve({ status: res.statusCode, json, text: s }); });
    });
    r.on('error', reject);
    if (body) r.end(JSON.stringify(body)); else r.end();
  });
}

test('console: localhost only, token required, actions change the running match', async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  admin = await startAdmin({ lobby: srv.lobby, port: 0, log: { info() {}, error() {} } });
  const P = admin.port;
  const auth = { 'x-admin-token': admin.token };

  // the page carries the token; the API refuses without it, and refuses a foreign Host (DNS rebinding)
  const page = await req(P, '/');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(admin.token) && !page.text.includes('__TOKEN__'));
  assert.equal((await req(P, '/api/rooms')).status, 403);
  assert.equal((await req(P, '/api/rooms', { headers: { ...auth, 'x-admin-token': 'f'.repeat(32) } })).status, 403);
  assert.equal((await req(P, '/api/rooms', { headers: { ...auth, host: 'evil.example' } })).status, 403);
  assert.equal((await req(P, '/', { headers: { host: `evil.example:${P}` } })).status, 403);
  assert.deepEqual((await req(P, '/api/rooms', { headers: auth })).json, { rooms: [] });

  // a solo match through the real protocol
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  await c.hello('Host');
  assert.equal((await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
  const { code } = await c.waitFor('room.state');
  assert.equal((await c.request({ t: 'room.start' })).t, 'ok');
  await c.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const rooms = (await req(P, '/api/rooms', { headers: auth })).json.rooms;
  assert.equal(rooms.length, 1);
  const pid = rooms[0].match.players[0].id;
  assert.deepEqual(rooms[0].match.rewindRounds, [], 'no prep yet');

  const post = (body) => req(P, '/api/action', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body }).then((r) => r.json);
  assert.match((await post({ room: code, action: 'rewind' })).error, /快照/);
  assert.deepEqual(await post({ room: code, action: 'funds', playerId: pid, value: 25 }), { ok: true });
  assert.deepEqual(await post({ room: code, action: 'lp', playerId: pid, value: 7 }), { ok: true });
  assert.match((await post({ room: code, action: 'lp', playerId: pid, value: -1 })).error, /≥ 0/);
  assert.match((await post({ room: code, action: 'nope' })).error, /未知/);
  assert.match((await post({ room: 'ZZZZ', action: 'funds' })).error, /房间/);
  const m = srv.lobby.rooms.get(code).match;
  assert.equal(m.players.get(pid).funds, 25);
  assert.equal(m.players.get(pid).lp, 7);
  const priv = await c.waitFor('m.private', (msg) => msg.funds === 25);
  assert.equal(priv.funds, 25, 'the player sees the change at once');

  // grants come from the catalog of the match's mode
  const cat = (await req(P, `/api/catalog?room=${code}`, { headers: auth })).json;
  assert.ok(cat.chess.length > 50 && cat.items.length > 10);
  assert.deepEqual(await post({ room: code, action: 'chess', playerId: pid, value: cat.chess[0].id }), { ok: true });
  assert.ok(m.players.get(pid).allChess().some((p) => p.id === cat.chess[0].id));
  assert.match((await post({ room: code, action: 'chess', playerId: pid, value: 'chess_nope' })).error, /没有/);

  assert.deepEqual(handleAction(srv.lobby, { room: code, action: 'endMatch' }), { ok: true });
  await c.waitFor('m.result');
  await c.close();
});

// ---- the second batch on harness matches (virtual clock), through the same handleAction / roomsView

/** A lobby stand-in holding one harness match as room TEST. */
function harness(o) {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, ...o }).start().autoHumans();
  const lobby = { rooms: new Map([['TEST', { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', seats: [], match: h.m }]]) };
  h.act = (action, value, playerId = 'p_0') => handleAction(lobby, { room: 'TEST', action, playerId, value });
  h.view = (pid = 'p_0') => roomsView(lobby)[0].match.players.find((p) => p.id === pid);
  h.matchView = () => roomsView(lobby)[0].match;
  return h;
}

test('console: bond layers (add / set) and count bonus', () => {
  const h = harness({ seed: 11 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');
  const bond = m.gd.bondIds.find((id) => !m.gd.modeInactiveBonds.has(id));
  let fired = 0;
  const dispatch = m.dispatch.bind(m);
  m.dispatch = (p, hook, ...rest) => { if (hook === 'onLayers') fired++; return dispatch(p, hook, ...rest); };

  const before = ps.layers[bond] || 0;
  assert.deepEqual(h.act('bondAdd', { bond, n: 3 }), { ok: true });
  assert.equal(ps.layers[bond], before + 3);
  assert.equal(fired, 1, 'add goes through addLayers (onLayers)');
  assert.deepEqual(h.act('bondSet', { bond, n: 999 }), { ok: true });
  assert.equal(fired, 1, 'set dispatches nothing');
  assert.match(h.act('bondAdd', { bond, n: 1 }).error, /上限/);
  assert.match(h.act('bondSet', { bond, n: 1000 }).error, /0–999/);
  assert.deepEqual(h.act('bondSet', { bond, n: 0 }), { ok: true });
  assert.equal(ps.layers[bond], 0);

  assert.ok(!ps.bonds[bond].active);
  assert.deepEqual(h.act('bondBonus', { bond, n: m.gd.bond(bond).thresholds[0] }), { ok: true });
  assert.ok(ps.bonds[bond].active, 'the bonus alone activates it');
  const row = h.view().bonds.find((b) => b.id === bond);
  assert.equal(row.bonus, m.gd.bond(bond).thresholds[0]);
  assert.equal(row.active, true);
  assert.deepEqual(h.act('bondBonus', { bond, n: 0 }), { ok: true });
  assert.ok(!(bond in ps.bondCountBonus));
  assert.match(h.act('bondAdd', { bond: 'nope', n: 1 }).error, /盟约/);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console: 托管, 机变 cards, effects and bounties', () => {
  const h = harness({ seed: 12 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');
  const bot = m.players.get('ai_0');

  ps.autoplay = false;
  assert.deepEqual(h.act('autoplay', 1), { ok: true });
  assert.equal(m.publicView().players.find((p) => p.playerId === 'p_0').autoplay, true, 'the player sees it');
  assert.deepEqual(h.act('autoplay', 0), { ok: true });
  assert.equal(ps.autoplay, false);
  assert.match(h.act('autoplay', 1, 'ai_0').error, /AI/);

  // a team tactic card (全队 +资金) reaches the teammate too
  const funds = [ps.funds, bot.funds];
  assert.deepEqual(h.act('card', 'allybuff_select_3'), { ok: true });
  assert.ok(ps.funds > funds[0] && bot.funds > funds[1], 'applied to both');
  // a battle tactic card leaves an effect, which can be removed
  const n0 = ps.effects.length;
  assert.deepEqual(h.act('card', 'enemydebuff_select_1'), { ok: true });
  assert.equal(ps.effects.length, n0 + 1);
  const eff = ps.effects[ps.effects.length - 1];
  assert.ok(h.view().effects.some((e) => e.id === eff.id));
  assert.deepEqual(h.act('effectRemove', eff.id), { ok: true });
  assert.ok(!ps.effects.some((e) => e.id === eff.id));
  assert.match(h.act('effectRemove', eff.id).error, /不存在/);
  // a bounty card adds its enemies to the preview; removing it takes them out
  const bounty = m.gd.choices.cards.bounty.find((c) => m.gd.enemy(c.enemyKey));
  assert.deepEqual(h.act('card', bounty.effectId), { ok: true });
  assert.ok(h.view().enemies.some((e) => e.bounty), 'bounty enemies previewed');
  assert.deepEqual(h.act('bountyRemove', ps.bounties[ps.bounties.length - 1].id), { ok: true });
  assert.ok(!h.view().enemies.some((e) => e.bounty));
  assert.match(h.act('card', 'nope').error, /机变卡/);
  checkInvariants(m);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console: board edits whatever the phase, and the enemy reroll before combat only', () => {
  const h = harness({ seed: 13 });
  const m = h.m;
  const gd = m.gd;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');

  const cid = gd.visibleChess.find((id) => !gd.isGolden(id) && gd.goldenIdOf(id) && m.pool.left(gd.baseIdOf(id)) >= gd.goldenCopies + 1);
  const piece = ps.acquireChess(cid);
  assert.ok(piece && h.view().pieces.some((p) => p.uid === piece.uid && p.canPromote));
  const base = gd.baseIdOf(cid);
  const left0 = m.pool.left(base);
  assert.deepEqual(h.act('piecePromote', piece.uid), { ok: true });
  assert.ok(gd.isGolden(piece.id));
  assert.match(h.act('piecePromote', piece.uid).error, /精锐/);

  const equipId = Object.values(gd.shopItemsByTier).flat().find((id) => gd.item(id).itemType === 'EQUIP'
    && !String(gd.item(id).kind || '').startsWith('consume_on_equip') && !ps._itemLocations(id).length);
  m.phase = 'COMBAT'; // equip() refuses outside the prep; the console does not
  assert.deepEqual(h.act('pieceEquip', { target: piece.uid, item: equipId }), { ok: true });
  m.phase = 'PREP';
  assert.ok(piece.items.some((it) => it.id === equipId));
  assert.match(h.act('pieceEquip', { target: piece.uid, item: 'nope' }).error, /装备/);

  const funds = ps.funds;
  assert.deepEqual(h.act('pieceRemove', piece.uid), { ok: true });
  assert.equal(ps.find(piece.uid), null);
  assert.equal(ps.funds, funds, 'no sell price');
  assert.ok(m.pool.left(base) > left0 - gd.goldenCopies, 'its copies are back in the pool');
  assert.ok([...ps.hand, ...ps.temp].some((p) => p && p.id === equipId), 'its item went to the hand');
  assert.match(h.act('pieceRemove', 999999).error, /不存在/);

  const rng = m.rngWaves.state();
  assert.equal(h.matchView().canReroll, true);
  assert.deepEqual(h.act('reroll'), { ok: true });
  assert.notEqual(m.rngWaves.state(), rng, 'a new draw');
  assert.ok(m.wave && m.wave.spawns.length > 0);
  checkInvariants(m);
  h.drive(() => m.phase === 'COMBAT');
  assert.equal(h.matchView().canReroll, false);
  assert.match(h.act('reroll').error, /战斗开始前/);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console: forcing a client-side battle — a win keeps the LP, a loss costs min(10, n)', () => {
  for (const [win, n, loss] of [[true, 0, 0], [false, 3, 3], [false, 25, 10]]) {
    const h = harness({ mode: 'solo', bots: 0, seed: 21, clientCombat: true, clients: false });
    const m = h.m;
    h.drive(() => m.phase === 'COMBAT' && m.round === 2);
    const ps = m.players.get('p_0');
    const lp = ps.lp;
    const f = h.matchView().fields[0];
    assert.ok(f && f.kind === 'normal', 'a running field is listed');
    const before = h.sent.length;
    assert.deepEqual(h.act(win ? 'battleWin' : 'battleLose', { field: f.id, n }), { ok: true });
    assert.ok(h.sent.slice(before).some(([pid, msg]) => pid === 'p_0' && msg.t === 'b.end' && msg.reason === 'forced'), 'the browser is told');
    assert.match(h.act('battleWin', { field: f.id }).error, /战场不存在|已经结束/);
    h.run(() => m.phase === 'SETTLE');
    assert.equal(m.phase, 'SETTLE');
    assert.equal(ps.lp, lp - loss);
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    m.dispose();
  }
  const h = harness({ mode: 'solo', bots: 0, seed: 21, clientCombat: true, clients: false });
  h.drive(() => h.m.phase === 'COMBAT');
  assert.match(h.act('battleLose', { field: h.matchView().fields[0].id, n: 0 }).error, /漏怪数/);
  assert.deepEqual(h.act('timerScale', 0.5), { ok: true });
  assert.equal(h.m.timerScale, 0.5);
  assert.match(h.act('timerScale', 0).error, /0.1–10/);
  h.m.dispose();
});


test('console (0.2.0): a 自选编队 piece is listed under its picked operator', () => {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true,
    diy: { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' } } },
  { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true }];
  const h = harness({ seats, seed: 11 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');
  const piece = ps.acquireChess('chess_char_5_diy1_a');
  assert.ok(piece);
  assert.equal(h.view().pieces.find((p) => p.uid === piece.uid).name, ps.gd.chess('chess_char_5_diy1_a').name);
  assert.notEqual(ps.gd.chess('chess_char_5_diy1_a').name, m.gd.chess('chess_char_5_diy1_a').name);
  assert.deepEqual(h.act('pieceRemove', piece.uid), { ok: true });
  assert.deepEqual(ps.diyStock.snapshot(), { chess_char_5_diy1_a: 8 }, 'its copy went back to the player\'s own stock');
  checkInvariants(m);
  m.dispose();
});
