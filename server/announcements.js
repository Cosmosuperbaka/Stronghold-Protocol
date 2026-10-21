// i18n-ignore-file: validation errors belong to the authenticated local host console.
import fs from 'node:fs';
import path from 'node:path';
import { ANNOUNCEMENT_LEVELS, announcementTextLimit, normalizeAnnouncementText, announcementFromMessage } from '../shared/announcements.js';

/** One global notice, optionally persisted by the local host console; no C2S action exists. */
export class SiteAnnouncements {
  constructor({ now = Date.now, broadcast = () => {} } = {}) {
    this.now = now; this.broadcast = broadcast; this.notice = null; this.timer = null; this.seq = 0;
    this.persistenceFile = null; this.persistEnabled = false;
  }
  /** Load once per service instance. Absolute dates and ID survive; expired notices are never republished. */
  loadPersistence(file) {
    if (this.persistenceFile === file) return;
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (saved && (saved.format !== 1 || typeof saved.enabled !== 'boolean')) throw new Error('公告恢复文件格式无效');
    const notice = saved?.enabled && saved.notice ? announcementFromMessage({ announcement: saved.notice }) : null;
    if (saved?.enabled && saved.notice && !notice) throw new Error('公告恢复内容无效');
    this.persistenceFile = file;
    this.persistEnabled = saved ? saved.enabled : true;
    this.seq = Math.max(this.seq, Number.isSafeInteger(saved?.seq) && saved.seq >= 0 ? saved.seq : 0);
    if (notice && notice.endAt > this.now()) {
      this.notice = { ...notice, ...(saved.notice.untilRemoved === true ? { untilRemoved: true } : {}) };
      this.publish();
    }
  }
  writePersistence(enabled, notice, seq = this.seq) {
    if (!this.persistenceFile) throw new Error('公告恢复存储未初始化');
    fs.mkdirSync(path.dirname(this.persistenceFile), { recursive: true });
    const tmp = this.persistenceFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ format: 1, enabled, notice: enabled ? notice : null, seq }, null, 2), 'utf8');
    fs.renameSync(tmp, this.persistenceFile);
  }
  setPersistence(enabled) {
    if (typeof enabled !== 'boolean') return { error: '公告重启保留设置必须为开或关' };
    try { this.writePersistence(enabled, this.frame().announcement); }
    catch { return { error: '保存公告重启保留设置失败，请检查磁盘空间或文件权限后重试' }; }
    this.persistEnabled = enabled;
    return { ok: true, enabled };
  }
  persistNotice(notice, seq = this.seq) {
    if (this.persistEnabled) this.writePersistence(true, notice, seq);
  }
  frame() {
    const serverNow = this.now();
    return { t: 'site.announcement', serverNow, announcement: this.notice && serverNow < this.notice.endAt ? { ...this.notice } : null };
  }
  set(value) {
    if (value === null) {
      try { this.persistNotice(null); } catch { return { error: '保存公告撤下状态失败，原公告保持不变，请重试' }; }
      this.notice = null; this.publish(); return { ok: true };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '公告格式无效' };
    const text = normalizeAnnouncementText(value.text), { level, startAt, endAt } = value;
    if (value.format != null && !['plain', 'markdown'].includes(value.format)) return { error: '公告正文格式无效' };
    const limit = announcementTextLimit(value.format);
    if (!text || [...text].length > limit || Buffer.byteLength(text, 'utf8') > limit * 4) return { error: `公告须为 1–${limit} 字` };
    if (!Object.hasOwn(ANNOUNCEMENT_LEVELS, level) || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt || endAt <= this.now()) return { error: '公告级别或起止时间无效' };
    const notice = { id: `${this.now()}-${this.seq + 1}`, text, level, startAt, endAt,
      ...(value.format === 'markdown' ? { format: 'markdown' } : {}), ...(value.untilRemoved === true ? { untilRemoved: true } : {}) };
    try { this.persistNotice(notice, this.seq + 1); } catch { return { error: '保存公告失败，原公告保持不变，请检查磁盘空间或文件权限后重试' }; }
    this.seq++; this.notice = notice;
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
