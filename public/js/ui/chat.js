// Text-only adaptation of RyantArgnisan/Stronghold-Protocol a649d92 (GPL-3.0-or-later); see NOTICE.md.
import { html, Icon } from './components.js';
import { useLayoutEffect, useRef } from '../../vendor/hooks.module.js';
import { store, useStore, shallowEqual } from '../store.js';
import { net } from '../net.js';
import { t } from '../../../shared/i18n.js';
import { CHAT_MAX_CHARS, CHAT_HISTORY_LIMIT } from '../../../shared/constants.js';
import { chatMember } from './chatStore.js';
import { describeError } from './toasts.js';
import { GIcon } from './gameComponents.js';
import { useChatPosition } from './chatPosition.js';

export function chatFacts(state) {
  const member = state.chat?.code === state.room?.code && chatMember(state.room, state.me?.playerId);
  const seated = member && (state.room.seats || []).some((p) => p?.playerId === state.me.playerId && !p.isBot);
  const online = state.connection?.status === 'online';
  const reason = !online ? t('连接断开，聊天暂不可用') : !seated ? t('观战者只能阅读聊天') : null;
  return { member, canSend: !!seated && online && state.room?.textChat === true, reason };
}

let messageSeq = 0;
export async function sendChat({ store, net }) {
  const state = store.get(), code = state.chat?.code;
  if (!code || state.chat.sending || !chatFacts(state).canSend || net.status !== 'online') return false;
  const draft = state.chat.draft;
  const text = draft.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  if (!text) return false;
  if ([...text].length > CHAT_MAX_CHARS) {
    store.patch('chat', { error: { message: t('消息最多 {n} 字', { n: CHAT_MAX_CHARS }) } });
    return false;
  }
  const clientId = `chat-${Date.now().toString(36)}-${++messageSeq}`;
  const current = () => store.get().chat?.code === code && store.get().chat?.sendToken === clientId;
  store.patch('chat', { sending: true, sendToken: clientId, error: null });
  try {
    await net.request('room.chat', { text, clientId }, { queue: false });
    if (current() && store.get().chat.draft === draft) store.patch('chat', { draft: '' });
    return true;
  } catch (error) {
    if (current()) store.patch('chat', { error });
    return false;
  } finally {
    if (current()) store.patch('chat', { sending: false, sendToken: null });
  }
}

export function ChatPanel() {
  const state = useStore((s) => ({ chat: s.chat, room: s.room, me: s.me, connection: s.connection }), shallowEqual);
  const chat = state.chat, facts = chatFacts(state);
  const input = useRef(null), log = useRef(null), toggle = useRef(null), composing = useRef(false);
  const open = chat?.open, code = chat?.code;
  const placement = useChatPosition({ name: state.me?.name, playerId: state.me?.playerId, active: facts.member && state.room?.textChat, open });
  useLayoutEffect(() => { composing.current = false; }, [code]);
  useLayoutEffect(() => { if (open && facts.canSend) input.current?.focus(); }, [open, code]);
  useLayoutEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [open, code, chat?.lastId]);
  if (!facts.member || !state.room?.textChat) return null;
  const setOpen = (value) => {
    store.patch('chat', { open: value, ...(value ? { unread: 0 } : {}) });
    if (!value) toggle.current?.focus();
  };
  const count = [...chat.draft].length;
  return html`<aside ref=${placement.root} class=${state.room.inMatch ? 'chat chat--match' : 'chat'} aria-label=${t('同盟聊天')} onKeyDown=${(e) => {
    if (e.key === 'Escape' && !composing.current && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault(); e.stopPropagation(); setOpen(false);
    }
  }}>
    <button ref=${toggle} type="button" class="chat__toggle" aria-expanded=${!!open} aria-controls="room-chat-body"
      title=${t('移动聊天位置（拖动或按方向键）')} ...${placement.events} onClick=${e => { if (!placement.draggedClick(e)) setOpen(!open); }}>
      <${GIcon} name="emote" /><span>${t('文字聊天')}</span>
      ${chat.unread ? html`<span class="chat__unread">${t('{n} 条未读', { n: chat.unread })}</span>` : null}
    </button>
    ${open ? html`<section ref=${placement.body} id="room-chat-body" class="chat__body" aria-label=${t('同盟聊天')}>
      <header class="chat__head"><button type="button" class="chat__drag" title=${t('移动聊天位置（拖动或按方向键）')}
        aria-label=${t('移动聊天位置（拖动或按方向键）')} ...${placement.events} onClick=${placement.draggedClick}><strong>${t('同盟聊天')}</strong></button>
        <button type="button" class="chat__reset" title=${t('恢复默认位置')} aria-label=${t('恢复默认位置')} onClick=${placement.reset}><${Icon} name="refresh" size="20" /></button><button type="button" onClick=${() => setOpen(false)}>${t('收起聊天')}</button></header>
      <p class="chat__notice">${t('拖动按钮或标题调整位置，自动保存')}</p>
      <p class="chat__notice">${t('最近 {n} 条消息', { n: CHAT_HISTORY_LIMIT })}</p>
      <ol ref=${log} class="chat__log" role="log" aria-live="polite" aria-relevant="additions" aria-label=${t('聊天记录')}>
        ${chat.messages.length ? chat.messages.map((m) => html`<li key=${m.id} class=${m.role === 'system' ? 'chat__message chat__message--system' : 'chat__message'}>
          <span class="chat__name" title=${m.name}>${m.role === 'system' ? t('主机公告') : m.name}</span><span class="chat__text">${m.text}</span>
        </li>`) : html`<li class="chat__empty">${t('暂无消息')}</li>`}
      </ol>
      ${facts.reason ? html`<p class="chat__notice" role="status">${facts.reason}</p>` : null}
      ${chat.error ? html`<p class="chat__error" role="alert">${describeError(chat.error)}</p>` : null}
      <form class="chat__form" onSubmit=${(e) => { e.preventDefault(); if (!composing.current) sendChat({ store, net }); }}>
        <textarea ref=${input} class="chat__input" rows="2" value=${chat.draft} disabled=${!facts.canSend}
          aria-label=${t('聊天消息')} aria-describedby="room-chat-hint" placeholder=${t('输入消息，Enter 发送')}
          onInput=${(e) => store.patch('chat', { draft: e.currentTarget.value, error: null })}
          onCompositionStart=${() => { composing.current = true; }} onCompositionEnd=${() => { composing.current = false; }}
          onKeyDown=${(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.isComposing && e.keyCode !== 229) {
              e.preventDefault(); e.stopPropagation(); sendChat({ store, net });
            }
          }} />
        <button type="submit" disabled=${!facts.canSend || chat.sending || !chat.draft.trim() || count > CHAT_MAX_CHARS}>${chat.sending ? t('发送中…') : t('发送')}</button>
        <span id="room-chat-hint" class="chat__hint">${t('{n}/{max} 字 · Esc 收起', { n: count, max: CHAT_MAX_CHARS })}</span>
      </form>
    </section>` : null}
  </aside>`;
}
