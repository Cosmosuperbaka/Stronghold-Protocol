// HUD rectangles use client pixels, like tileScreen and the existing camera clearance.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), n));
export const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** The visible part of an inset HUD (screenFit, notches, browser chrome and the software keyboard). */
export function visibleHudFrame(hud, viewport, gap = 6) {
  return {
    left: Math.max(hud.left, viewport.left) + gap, top: Math.max(hud.top, viewport.top) + gap,
    right: Math.min(hud.right, viewport.right) - gap, bottom: Math.min(hud.bottom, viewport.bottom) - gap,
  };
}

/** Prefer the old dock; if occupied, find a bounded slot, shrinking the scroll viewport rather than the controls.
 * Obstacles are actual interactive rectangles; a left-corner widget never reserves a full-width camera band.
 */
export function fitHudPanel({ frame, anchor, width, height, minWidth = width, widths: preferredWidths = [], obstacles = [], board = null }) {
  const maxWidth = Math.max(1, frame.right - frame.left), maxHeight = Math.max(1, frame.bottom - frame.top);
  const h = Math.min(height, maxHeight);
  const widths = [...new Set([width, ...preferredWidths, minWidth].map(w => clamp(w, Math.min(minWidth, maxWidth), Math.min(width, maxWidth))))];
  let best = null, bestScore = Infinity;
  for (const w of widths) {
    const xs = [anchor.left, frame.left, frame.right - w];
    const ys = [anchor.top, frame.top, frame.bottom - h];
    for (const r of obstacles) { xs.push(r.right + 6, r.left - w - 6); ys.push(r.bottom + 6, r.top - h - 6); }
    for (const x of new Set(xs.map(x => clamp(x, frame.left, frame.right - w)))) {
      for (const y of new Set(ys.map(y => clamp(y, frame.top, frame.bottom - h)))) {
        const rect = { left: x, top: y, right: x + w, bottom: y + h };
        const blocked = obstacles.reduce((sum, r) => sum + overlapArea(rect, r), 0);
        const score = blocked * 1e6 + (board ? overlapArea(rect, board) * 100 : 0)
          + (width - w) * 2 + Math.abs(x - anchor.left) + Math.abs(y - anchor.top);
        if (score < bestScore) { bestScore = score; best = { ...rect, width: w, height: h }; }
      }
    }
  }
  return best;
}
