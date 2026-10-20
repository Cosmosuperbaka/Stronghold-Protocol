import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, Icon } from './components.js';
import { store, useStore, createStore, loadPref, savePref } from '../store.js';
import { net } from '../net.js';
import { toast, toastError } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { PRESENCE_STATUSES } from '../../../shared/social.js';

const ui = createStore({ open: false });
export const openOnlinePlayers = () => ui.set({ open: true });
const statusLabel = value => ({ online: t('在线'), away: t('暂离'), busy: t('忙碌'), invisible: t('隐身') })[value] || t('在线');
const activityLabel = value => value === 'match' ? t('对局中') : value === 'room' ? t('房间中') : t('大厅中');

export function installSocial() {
  const saved = loadPref('presenceStatus', 'online');
  net.presenceStatus = PRESENCE_STATUSES.includes(saved) ? saved : 'online';
  net.on('social.state', message => {
    store.set({ social: message });
    if (PRESENCE_STATUSES.includes(message.self)) {
      net.presenceStatus = message.self; savePref('presenceStatus', message.self);
    }
  });
  net.on('status', snap => { if (snap.status !== 'online') store.set({ social: null }); });
}
export function OnlinePlayersButton() {
  const social = useStore(s => s.social);
  if (!social) return null;
  if (!social.policy.counts && !social.policy.directory) return null;
  return html`<button type="button" class="hub-online social-online" disabled=${!social.policy.directory} onClick=${openOnlinePlayers} aria-haspopup="dialog" aria-label=${t('查看在线玩家')}>
    <span class="online-pill__dot"></span>${social.policy.counts ? html`<span class="num">${social.visibleCount}</span><span>${t('名博士在线')}</span>` : html`<span>${t('在线玩家')}</span>`}
    ${social.policy.directory ? html`<${Icon} name="chevronRight" class="social-expand" />` : null}</button>`;
}
export function PresenceSelector() {
  const social = useStore(s => s.social), [busy, setBusy] = useState(false);
  if (!social) return null;
  const set = async event => {
    const value = event.currentTarget.value;
    setBusy(true);
    try { await net.request('social.status', { status: value }); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const options = PRESENCE_STATUSES.filter(s => s === social.self || s === 'online' || social.policy.statusSelection && (s !== 'invisible' || social.policy.invisible));
  return html`<label class="social-presence"><span>${t('在线状态')}</span><select name="presence-status" aria-label=${t('在线状态')} value=${social.self} disabled=${busy || !social.policy.statusSelection && social.self === 'online'} onChange=${set}>
    ${options.map(s => html`<option key=${s} value=${s} selected=${s === social.self}>${statusLabel(s)}</option>`)}
  </select></label>`;
}
export function RoomInviteButton() {
  const social = useStore(s => s.social), room = useStore(s => s.room);
  if (!social?.policy.directory || !social?.policy.invitations || room?.mode !== 'coop') return null;
  return html`<button type="button" class="rs-key__friends" onClick=${openOnlinePlayers} disabled=${room.inMatch || social.self === 'invisible'}><${Icon} name="users" /><span>${t('邀请玩家')}</span></button>`;
}

export function SocialHost() {
  const open = useStore(s => s.open, Object.is, ui), social = useStore(s => s.social), room = useStore(s => s.room), me = useStore(s => s.me.playerId);
  const [players, setPlayers] = useState([]), [next, setNext] = useState(null), [canInvite, setCanInvite] = useState(false);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(null), [query, setQuery] = useState('');
  const generation = useRef(0);
  const load = async (offset = 0) => {
    const gen = ++generation.current; setLoading(true); setError('');
    try {
      const result = await net.request('social.list', { offset });
      if (gen !== generation.current) return;
      setPlayers(old => offset ? [...old, ...result.players] : result.players); setNext(result.nextOffset); setCanInvite(result.canInvite);
    } catch (_e) { if (gen === generation.current) setError(t('读取在线玩家失败，请重试')); }
    finally { if (gen === generation.current) setLoading(false); }
  };
  useEffect(() => {
    generation.current++; setPlayers([]); setNext(null);
    if (!open || !social?.policy.directory) return undefined;
    load(); const id = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => { clearInterval(id); generation.current++; };
  }, [open, social?.policy.directory, social?.policy.invitations, social?.policy.hostOnly, social?.revision, social?.self, room?.code, room?.inMatch]);
  const invite = async player => {
    setBusy(player.playerId);
    try { await net.request('social.invite', { playerId: player.playerId }); toast(t('邀请已发送，等待对方确认')); }
    catch (e) { toastError(e); } finally { setBusy(null); load(); }
  };
  const respond = async (inviteId, accept) => {
    setBusy(inviteId); try { await net.request('social.respond', { inviteId, accept }); } catch (e) { toastError(e); } finally { setBusy(null); }
  };
  const filtered = players.filter(p => !query || p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return html`<${Modal} open=${open} title=${t('在线玩家')} class="social-modal" onClose=${() => ui.set({ open: false })}
    actions=${html`<${Button} onClick=${() => ui.set({ open: false })}>${t('关闭')}<//>`}>
    ${!social?.policy.directory ? html`<p>${t('主机未开启此在线玩家功能')}</p>` : html`
      <p class="social-note">${t('隐身玩家不会出现在名单中，也不能被邀请。名单每 5 秒刷新。')}</p>
      <div class="social-toolbar"><input aria-label=${t('搜索玩家')} placeholder=${t('搜索玩家')} value=${query} onInput=${e => setQuery(e.currentTarget.value)} /><${Button} disabled=${loading} onClick=${() => load()}>${t('刷新')}<//></div>
      ${error ? html`<p role="status">${error}</p>` : null}
      <div class="social-players">${filtered.map(player => html`<div key=${player.playerId} class="social-player"><div><strong>${player.name}${player.playerId === me ? t('（你）') : ''}</strong><small>${statusLabel(player.status)} · ${activityLabel(player.activity)}</small></div>
        ${player.playerId !== me && social.policy.invitations && room ? html`<${Button} disabled=${!!busy || !canInvite || !player.available} onClick=${() => invite(player)}>${t('邀请加入')}<//>` : null}</div>`)}
        ${!loading && !filtered.length ? html`<p>${t('暂无可见玩家')}</p>` : null}</div>
      ${next !== null ? html`<${Button} disabled=${loading} onClick=${() => load(next)}>${t('加载更多')}<//>` : null}
      ${loading ? html`<p role="status">${t('正在读取在线玩家…')}</p>` : null}
      ${social.self === 'invisible' ? html`<p>${t('你当前处于隐身状态，不能发送或接收邀请。')}</p>` : null}` }
  <//>
  ${social?.invites?.length ? html`<aside class="social-invites" aria-label=${t('房间邀请')}>${social.invites.map(invite => html`<section key=${invite.id}><strong>${t('房间邀请')}</strong><p>${t('{name} 邀请你加入房间 {code}', { name: invite.fromName, code: invite.roomCode })}</p><small>${t('邀请将在 60 秒内失效，加入前会重新检查房间状态。')}</small><div>
    <${Button} disabled=${!!busy} onClick=${() => respond(invite.id, false)}>${t('拒绝')}<//><${Button} variant="primary" disabled=${!!busy || !!room} onClick=${() => respond(invite.id, true)}>${t('加入房间')}<//>
  </div></section>`)}</aside>` : null}`;
}
