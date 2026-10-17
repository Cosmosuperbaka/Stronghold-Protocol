// i18n-ignore-file: validation errors belong to the authenticated local host console.
import { ANNOUNCEMENT_LEVELS, announcementTextLimit, normalizeAnnouncementText } from '../shared/announcements.js';

/** One global in-memory notice. Only the local host console edits it; no C2S action exists. */
export class SiteAnnouncements {
  constructor({ now = Date.now, broadcast = () => {} } = {}) { this.now = now; this.broadcast = broadcast; this.notice = null; this.timer = null; this.seq = 0; }
  frame() {
    const serverNow = this.now();
    return { t: 'site.announcement', serverNow, announcement: this.notice && serverNow < this.notice.endAt ? { ...this.notice } : null };
  }
  set(value) {
    if (value === null) { this.notice = null; this.publish(); return { ok: true }; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '公告格式无效' };
    const text = normalizeAnnouncementText(value.text), { level, startAt, endAt } = value;
    if (value.format != null && !['plain', 'markdown'].includes(value.format)) return { error: '公告正文格式无效' };
    const limit = announcementTextLimit(value.format);
    if (!text || [...text].length > limit || Buffer.byteLength(text, 'utf8') > limit * 4) return { error: `公告须为 1–${limit} 字` };
    if (!Object.hasOwn(ANNOUNCEMENT_LEVELS, level) || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt || endAt <= this.now()) return { error: '公告级别或起止时间无效' };
    this.notice = { id: `${this.now()}-${++this.seq}`, text, level, startAt, endAt,
      ...(value.format === 'markdown' ? { format: 'markdown' } : {}), ...(value.untilRemoved === true ? { untilRemoved: true } : {}) };
    this.publish(); return { ok: true };
  }
  publish() {
    clearTimeout(this.timer); this.timer = null;
    const frame = this.frame();
    if (!frame.announcement) this.notice = null;
    this.broadcast(frame);
    if (this.notice) {
      const next = this.notice.startAt > frame.serverNow ? this.notice.startAt : this.notice.endAt;
      this.timer = setTimeout(() => this.publish(), Math.max(1, Math.min(2147483647, next - this.now())));
      this.timer.unref?.();
    }
  }
  dispose() { clearTimeout(this.timer); this.timer = null; }
}
