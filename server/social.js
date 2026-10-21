import { randomUUID } from 'node:crypto';
import { ERR } from '../shared/constants.js';
import { PRESENCE_STATUSES, SOCIAL_PAGE_SIZE, INVITE_TTL_MS, INVITE_COOLDOWN_MS } from '../shared/social.js';
import { getSocialSettings } from './match/hostSettings.js';
import { sendSession } from './net.js';

/** Server-side visibility is authoritative. IDs, names and invitations of invisible sessions never enter discovery. */
export class ServerSocial {
  constructor(lobby) {
    this.lobby = lobby;
    this.invites = new Map();
    this.lastSent = new WeakMap();
    this.sentAt = new WeakMap();
    this.revision = 0;
    this.rosterKey = '';
    this.timer = setInterval(() => this.sync(), 2000);
    this.timer.unref();
  }
  dispose() { clearInterval(this.timer); this.invites.clear(); }
  status(session) { return PRESENCE_STATUSES.includes(session.presenceStatus) ? session.presenceStatus : 'online'; }
  visible(session) { return session.connected && this.status(session) !== 'invisible'; }
  sessions() { return [...this.lobby.registry.all()]; }
  room(session) { return this.lobby.roomOf(session); }
  canInvite(session) {
    const policy = getSocialSettings(), room = this.room(session);
    return policy.invitations && this.visible(session) && !!room && room.mode === 'coop' && !room.match && !room.test
      && !!room.seatOf(session.playerId) && (!policy.hostOnly || room.hostId === session.playerId) && room.freeSeat() >= 0;
  }
  available(session) { return this.visible(session) && this.status(session) !== 'busy' && !this.room(session); }
  valid(invite) {
    const from = this.lobby.registry.byId(invite.from), to = this.lobby.registry.byId(invite.to);
    return invite.expiresAt > this.lobby.now() && from && to && this.canInvite(from) && this.available(to)
      && this.room(from) === invite.roomRef;
  }
  sync(force = false) {
    for (const [id, invite] of this.invites) if (!this.valid(invite)) this.invites.delete(id);
    const sessions = this.sessions(), policy = getSocialSettings();
    const visibleCount = sessions.filter(s => this.visible(s)).length;
    const byRecipient = new Map();
    for (const invite of this.invites.values()) {
      const from = this.lobby.registry.byId(invite.from), room = invite.roomRef;
      if (!byRecipient.has(invite.to)) byRecipient.set(invite.to, []);
      byRecipient.get(invite.to).push({ id: invite.id, fromName: from.name, roomCode: room.code, difficulty: room.difficulty, expiresAt: invite.expiresAt });
    }
    const rosterKey = JSON.stringify(sessions.filter(s => this.visible(s)).map(s => [s.playerId, s.name, this.status(s), s.roomCode, !!this.room(s)?.match, this.room(s)?.freeSeat()]));
    if (rosterKey !== this.rosterKey) { this.rosterKey = rosterKey; this.revision++; }
    for (const session of sessions) {
      if (!session.connected) continue;
      const invites = byRecipient.get(session.playerId) || [];
      const frame = { t: 'social.state', policy, self: this.status(session), visibleCount: policy.counts ? visibleCount : null, revision: this.revision, invites };
      const key = JSON.stringify(frame);
      if (force || this.lastSent.get(session) !== key) { sendSession(session, frame); this.lastSent.set(session, key); }
    }
  }
  list(session, { offset = 0 }) {
    const policy = getSocialSettings();
    if (!policy.directory) return { error: ERR.SOCIAL_DISABLED };
    const all = this.sessions().filter(s => this.visible(s)).sort((a, b) => a.playerId.localeCompare(b.playerId));
    const players = all.slice(offset, offset + SOCIAL_PAGE_SIZE).map(s => {
      const room = this.room(s);
      return { playerId: s.playerId, name: s.name, status: this.status(s), activity: room?.match ? 'match' : room ? 'room' : 'lobby', available: this.available(s) };
    });
    return { ok: true, players, total: all.length, nextOffset: offset + players.length < all.length ? offset + players.length : null, canInvite: this.canInvite(session) };
  }
  setStatus(session, { status }) {
    const policy = getSocialSettings();
    if (!PRESENCE_STATUSES.includes(status)) return { error: ERR.BAD_MSG };
    if (status !== 'online' && (!policy.statusSelection || status === 'invisible' && !policy.invisible)) return { error: ERR.SOCIAL_DISABLED };
    session.presenceStatus = status; this.sync();
    return { ok: true, status };
  }
  invite(session, { playerId }) {
    if (!getSocialSettings().invitations) return { error: ERR.SOCIAL_DISABLED };
    if (!this.canInvite(session)) return { error: ERR.INVITE_UNAVAILABLE };
    const to = this.lobby.registry.byId(playerId);
    // Hidden, busy, offline and nonexistent targets deliberately have the same response.
    if (!to || to === session || !this.available(to)) return { error: ERR.INVITE_UNAVAILABLE };
    const now = this.lobby.now();
    if (now - (this.sentAt.get(session) ?? -Infinity) < INVITE_COOLDOWN_MS) return { error: ERR.RATE };
    if ([...this.invites.values()].filter(i => i.to === playerId && this.valid(i)).length >= 5) return { error: ERR.INVITE_UNAVAILABLE };
    const invite = { id: randomUUID(), from: session.playerId, to: playerId, room: this.room(session).code, roomRef: this.room(session), expiresAt: now + INVITE_TTL_MS };
    this.invites.set(invite.id, invite); this.sentAt.set(session, now); this.sync();
    return { ok: true };
  }
  respond(session, { inviteId, accept }) {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.to !== session.playerId) return { error: ERR.INVITE_EXPIRED };
    if (!accept) { this.invites.delete(inviteId); this.sync(); return { ok: true }; }
    if (!this.valid(invite)) { this.invites.delete(inviteId); this.sync(); return { error: ERR.INVITE_EXPIRED }; }
    this.invites.delete(inviteId);
    // Existing join validation owns capacity, match-phase checks and membership. Never move a player out of a room.
    const result = this.lobby.join(session, { code: invite.room });
    this.sync(); return result;
  }
}
