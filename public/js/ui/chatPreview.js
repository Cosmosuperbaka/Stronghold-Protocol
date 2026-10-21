// Collapsed room chat previews; transient UI only, never marks messages read.
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { store } from '../store.js';

export const CHAT_PREVIEW_MS = 6000;
const FADE_MS = 180;

export function ChatPreview({ messages, body, onOpen }) {
  const latest = messages.at(-1);
  const clock = useRef({ remaining: 0 });
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const paused = hovered || focused;
  useLayoutEffect(() => {
    clock.current = { remaining: Math.max(0, CHAT_PREVIEW_MS - (Date.now() - latest.receivedAt)) };
    setLeaving(false);
  }, [latest.id]);
  useEffect(() => {
    if (paused) { setLeaving(false); return; }
    const timerClock = clock.current;
    const started = performance.now();
    const fade = setTimeout(() => setLeaving(true), timerClock.remaining);
    const finish = setTimeout(() => {
      store.set(s => s.chat?.code === latest.code
        ? { chat: { ...s.chat, previewIds: s.chat.previewIds.filter(id => id > latest.id) } } : {});
    }, timerClock.remaining + FADE_MS);
    return () => {
      clearTimeout(fade); clearTimeout(finish);
      timerClock.remaining = Math.max(0, timerClock.remaining - (performance.now() - started));
    };
  }, [latest.id, paused]);
  return html`<section ref=${body} class=${`chat__preview${leaving ? ' chat__preview--leaving' : ''}`}
    aria-label=${t('新聊天消息')} onPointerEnter=${() => setHovered(true)} onPointerLeave=${() => setHovered(false)}
    onFocusIn=${() => setFocused(true)} onFocusOut=${e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
    <button type="button" class="chat__preview-open" onClick=${onOpen} aria-label=${t('展开聊天查看消息')}>
      <span class="chat__preview-messages" role="log" aria-live="polite" aria-relevant="additions text">
        ${messages.slice(-2).map(m => html`<span key=${m.id} class="chat__preview-message">
          <span class="chat__name">${m.role === 'system' ? t('主机消息') : m.name}</span>
          <span class="chat__preview-text">${m.text}</span>
        </span>`)}
      </span>
      <span class="chat__preview-hint">${messages.length > 2 ? t('还有 {n} 条新消息', { n: messages.length - 2 }) : t('展开聊天查看消息')}</span>
    </button>
  </section>`;
}
