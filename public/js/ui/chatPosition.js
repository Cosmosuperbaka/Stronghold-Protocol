// Local, per-name HUD preference: names survive server-session expiry; coordinates never leave this browser.
import { useLayoutEffect, useRef } from '../../vendor/hooks.module.js';
import { loadPref, savePref } from '../store.js';

const EDGE = 12;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), n));
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export function useChatPosition({ name, playerId, active, open }) {
  const root = useRef(null), body = useRef(null), position = useRef(null), drag = useRef(null), suppress = useRef(false);
  const key = name ? `chatPosition.name.${encodeURIComponent(name)}` : playerId ? `chatPosition.player.${encodeURIComponent(playerId)}` : null;
  const layout = () => {
    const el = root.current;
    if (!el) return;
    const width = innerWidth, height = innerHeight;
    if (position.current) {
      el.style.left = `${EDGE + position.current.x * Math.max(0, width - el.offsetWidth - EDGE * 2)}px`;
      el.style.top = `${EDGE + position.current.y * Math.max(0, height - el.offsetHeight - EDGE * 2)}px`;
      el.style.right = 'auto';
    } else {
      el.style.removeProperty('left'); el.style.removeProperty('top'); el.style.removeProperty('right');
    }
    const panel = body.current;
    if (!panel) return;
    const r = el.getBoundingClientRect(), h = panel.offsetHeight, w = panel.offsetWidth;
    const top = r.bottom + 8 + h <= height - EDGE || r.top - 8 - h < EDGE ? r.bottom + 8 : r.top - 8 - h;
    panel.style.left = `${clamp(r.right - w, EDGE, width - w - EDGE)}px`;
    panel.style.top = `${clamp(top, EDGE, height - h - EDGE)}px`;
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
    observer.observe(root.current);
    if (body.current) observer.observe(body.current);
    window.addEventListener('resize', layout);
    return () => { observer.disconnect(); window.removeEventListener('resize', layout); drag.current = null; };
  }, [active, open, key]);
  useLayoutEffect(layout);

  const place = (left, top) => {
    const el = root.current;
    if (!el) return;
    const xRange = Math.max(0, innerWidth - el.offsetWidth - EDGE * 2);
    const yRange = Math.max(0, innerHeight - el.offsetHeight - EDGE * 2);
    position.current = { x: xRange ? clamp(left - EDGE, 0, xRange) / xRange : 0,
      y: yRange ? clamp(top - EDGE, 0, yRange) / yRange : 0 };
    layout();
  };
  const persist = () => { if (key) savePref(key, position.current); };
  const reset = () => { position.current = null; persist(); layout(); };
  const finish = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    root.current?.classList.remove('chat--dragging');
    if (e.type === 'pointercancel') { position.current = d.previous; layout(); }
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
