// Adapted from the reference site's public source; notices use absolute server time, independent of a match.
export const ANNOUNCEMENT_LEVELS = Object.freeze({ info: 0, warning: 1, urgent: 2 });
export const ANNOUNCEMENT_MAX_TEXT = 500;
export const ANNOUNCEMENT_MAX_MARKDOWN = 20000;
export const announcementTextLimit = format => format === 'markdown' ? ANNOUNCEMENT_MAX_MARKDOWN : ANNOUNCEMENT_MAX_TEXT;
export function validAnnouncementUrl(value) {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try { const url = new globalThis.URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
export function announcementLive(notice, now) {
  return !!notice && Number.isFinite(now) && notice.startAt <= now && now < notice.endAt;
}
export function normalizeAnnouncementText(text) {
  return typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '').replace(/\r\n?/g, '\n').trim() : '';
}
/** Accept display fields only, including a scheduled notice that is not active yet. */
export function announcementFromMessage(msg) {
  const n = msg?.announcement;
  if (!n || typeof n.id !== 'string' || !n.id || (n.format != null && !['plain', 'markdown'].includes(n.format))
      || typeof n.text !== 'string' || !n.text || [...n.text].length > announcementTextLimit(n.format)
      || !Object.hasOwn(ANNOUNCEMENT_LEVELS, n.level) || !Number.isFinite(n.startAt) || !Number.isFinite(n.endAt) || n.endAt <= n.startAt) return null;
  return { id: n.id, text: n.text, level: n.level, startAt: n.startAt, endAt: n.endAt,
    ...(n.format === 'markdown' ? { format: 'markdown' } : {}) };
}
