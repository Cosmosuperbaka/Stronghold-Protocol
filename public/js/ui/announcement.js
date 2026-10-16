// Site notice presentation adapted from the reference site's public source, without sponsorship or player tools.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal, useTicker } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { net } from '../net.js';
import { announcementLive } from '../../../shared/announcements.js';
import { t } from '../../../shared/i18n.js';

const ui = createStore({ open: false });
export const openAnnouncement = () => ui.set({ open: true });
export const closeAnnouncement = () => ui.set({ open: false });
export function AnnouncementButton({ class: cls } = {}) {
  return html`<${Button} size="sm" icon="info" class=${cls} onClick=${openAnnouncement} aria-haspopup="dialog">${t('公告')}<//>`;
}
export function announcementScroll(viewport, textWidth) {
  const distance = Math.max(0, viewport) + Math.max(0, textWidth);
  return { from: Math.max(0, viewport), to: -Math.max(0, textWidth), duration: Math.max(8, distance / 70) };
}
function useNotice() {
  const notice = useStore(s => s.announcement);
  useStore(s => s.clock.offset);
  useTicker(notice && net.serverNow() < notice.endAt ? 250 : 0);
  return announcementLive(notice, net.serverNow()) ? notice : null;
}
export function AnnouncementHost() {
  const notice = useNotice(), open = useStore(s => s.open, Object.is, ui);
  return html`<${Modal} open=${open} title=${t('公告')} class="announcement-modal" onClose=${closeAnnouncement}
    actions=${html`<${Button} onClick=${closeAnnouncement}>${t('关闭')}<//>`}>
    ${notice ? html`<div class="notice__body">${notice.text.split('\n').map((line,i) => html`<p key=${i} class="notice__line">${line}</p>`)}</div>`
      : html`<p>${t('暂无公告')}</p>`}
  <//>`;
}
export function AnnouncementBanner() {
  const notice = useNotice();
  const [dismissed, setDismissed] = useState(() => loadPref('announcementDismissed', ''));
  const viewport = useRef(null), line = useRef(null);
  const [scroll, setScroll] = useState({ from: 0, to: 0, duration: 8 });
  const live = !!notice && dismissed !== notice.id;
  useEffect(() => {
    if (!live) return undefined;
    const measure = () => { if (viewport.current && line.current) setScroll(announcementScroll(viewport.current.clientWidth, line.current.scrollWidth)); };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (viewport.current) observer?.observe(viewport.current);
    if (line.current) observer?.observe(line.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [live, notice]);
  if (!live) return null;
  const label = notice.level === 'urgent' ? t('紧急通知') : notice.level === 'warning' ? t('提醒') : t('通知');
  return html`<aside class=${`site-notice site-notice--${notice.level}`} role="status" aria-live="polite" aria-atomic="true">
    <span class="site-notice__label">${label}</span><span class="site-notice__accessible">${notice.text}</span>
    <div ref=${viewport} class="site-notice__viewport" aria-hidden="true"><span ref=${line} class="site-notice__text"
      style=${{ '--notice-from': `${scroll.from}px`, '--notice-to': `${scroll.to}px`, '--notice-duration': `${scroll.duration}s` }}>${notice.text}</span></div>
    <button type="button" class="site-notice__close" aria-label=${t('关闭通知')} onClick=${() => { savePref('announcementDismissed', notice.id); setDismissed(notice.id); }}><${Icon} name="close" /></button>
  </aside>`;
}
