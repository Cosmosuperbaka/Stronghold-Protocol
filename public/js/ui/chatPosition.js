// Local, per-name HUD preference: names survive server-session expiry; coordinates never leave this browser.
import { useLayoutEffect, useRef } from '../../vendor/hooks.module.js';
import { loadPref, savePref } from '../store.js';
import { hudFrame } from './hudDock.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), n));
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export function useChatPosition({ name, playerId, active, open, floating = false }) {
  const key = name ? `chatPosition.name.${encodeURIComponent(name)}` : playerId ? `chatPosition.player.${encodeURIComponent(playerId)}` : null;
  return useHudPosition({ preferenceKey: key, active, open, floating });
}

// Shared pointer capture / persistence lifecycle: chat and the fork-only ping palette use the same mechanism.
export function useHudPosition({ preferenceKey: key, active, open, floating = false, anchorRef = null, automatic = false, onDrag = null }) {
  const ownRoot = useRef(null), body = useRef(null), position = useRef(null), drag = useRef(null), suppress = useRef(false);
  const root = anchorRef || ownRoot;
  const layout = () => {
    const el = root.current;
    if (!el) return;
    const frame = hudFrame(el);
    const left = frame.left + 6, topEdge = frame.top + (automatic ? 39 : 6);
    const right = frame.right - 6, bottom = frame.bottom - 6;
    if (position.current) {
      if (automatic) el.setAttribute('data-positioned', '');
      el.style.left = `${left + position.current.x * Math.max(0, right - left - el.offsetWidth)}px`;
      el.style.top = `${topEdge + position.current.y * Math.max(0, bottom - topEdge - el.offsetHeight)}px`;
      el.style.right = 'auto';
    } else {
      if (automatic) {
        if (el.hasAttribute('data-positioned')) {
          el.removeAttribute('data-positioned'); el.style.removeProperty('left'); el.style.removeProperty('top');
          el.style.removeProperty('right'); window.dispatchEvent(new Event('resize'));
        }
        return;
      }
      el.style.removeProperty('left'); el.style.removeProperty('top'); el.style.removeProperty('right');
      const initial = el.getBoundingClientRect();
      if (initial.left < left || initial.right > right) { el.style.left = `${clamp(initial.left, left, right - initial.width)}px`; el.style.right = 'auto'; }
      if (initial.top < topEdge || initial.bottom > bottom) el.style.top = `${clamp(initial.top, topEdge, bottom - initial.height)}px`;
    }
    const panel = body.current;
    if (!panel) return;
    panel.style.maxWidth = `${Math.max(0, right - left)}px`;
    panel.style.maxHeight = `${Math.max(0, bottom - topEdge)}px`;
    const r = el.getBoundingClientRect(), h = panel.offsetHeight, w = panel.offsetWidth;
    const top = r.bottom + 8 + h <= bottom || r.top - 8 - h < topEdge ? r.bottom + 8 : r.top - 8 - h;
    panel.style.left = `${clamp(r.right - w, left, right - w)}px`;
    panel.style.top = `${clamp(top, topEdge, bottom - h)}px`;
  };
  useLayoutEffect(() => {
    drag.current = null; suppress.current = false;
    const saved = key ? loadPref(key, null) : null;
    position.current = valid(saved) ? saved : null;
    layout();
  }, [key]);
  // Observe the expanded panel too: messages, translations and notices can change its height.
  useLayoutEffect(() => {
    if (!active || !root.current) return;
    layout();
    const observer = new ResizeObserver(layout);
    const viewport = globalThis.visualViewport;
    observer.observe(root.current);
    if (body.current) observer.observe(body.current);
    const host = root.current.closest('.app-root');
    if (host) observer.observe(host);
    window.addEventListener('resize', layout);
    viewport?.addEventListener('resize', layout);
    viewport?.addEventListener('scroll', layout);
    return () => { observer.disconnect(); window.removeEventListener('resize', layout); drag.current = null;
      viewport?.removeEventListener('resize', layout); viewport?.removeEventListener('scroll', layout); };
  }, [active, open, floating, key]);
  useLayoutEffect(layout);

  const place = (left, top) => {
    const el = root.current;
    if (!el) return;
    const frame = hudFrame(el), edgeLeft = frame.left + 6, edgeTop = frame.top + (automatic ? 39 : 6);
    const xRange = Math.max(0, frame.right - 6 - edgeLeft - el.offsetWidth);
    const yRange = Math.max(0, frame.bottom - 6 - edgeTop - el.offsetHeight);
    position.current = { x: xRange ? clamp(left - edgeLeft, 0, xRange) / xRange : 0,
      y: yRange ? clamp(top - edgeTop, 0, yRange) / yRange : 0 };
    layout();
  };
  const persist = () => { if (key) savePref(key, position.current); };
  const reset = () => { position.current = null; persist(); layout(); if (automatic) window.dispatchEvent(new Event('resize')); };
  const finish = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    root.current?.classList.remove('chat--dragging');
    if (e.type === 'pointercancel' || e.type === 'lostpointercapture') { position.current = d.previous; layout(); }
    else if (d.moved) { persist(); suppress.current = true; }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const events = {
    onPointerDown: e => {
      if (!e.isPrimary || e.button !== 0 || drag.current) return;
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.focus({ preventScroll: true });
      suppress.current = false;
      const r = root.current.getBoundingClientRect();
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, previous: position.current, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: e => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      if (!d.moved) onDrag?.();
      d.moved = true; root.current.classList.add('chat--dragging');
      place(d.left + dx, d.top + dy);
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onKeyDown: e => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!delta) return;
      e.preventDefault(); e.stopPropagation();
      const r = root.current.getBoundingClientRect(), step = e.shiftKey ? 10 : 1;
      place(r.left + delta[0] * step, r.top + delta[1] * step); persist();
    },
  };
  const draggedClick = e => {
    if (!suppress.current || e.detail === 0) return false;
    suppress.current = false; e.preventDefault(); e.stopPropagation(); return true;
  };
  return { root, body, events, draggedClick, reset };
}
