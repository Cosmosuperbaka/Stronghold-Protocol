// i18n-ignore-file: authenticated local host-console messages.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ANNOUNCEMENT_LEVELS, announcementTextLimit } from '../shared/announcements.js';

export const MAX_ANNOUNCEMENT_DRAFTS = 30;
const delays = new Set([0, 600000, 3600000]);
const durations = new Set([600000, 3600000, 'untilRemoved']);

/** Drafts never reach SiteAnnouncements. Failed writes preserve the last saved collection. */
export class AnnouncementDrafts {
  constructor(file) { this.file = file; }
  list() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const data = JSON.parse(raw);
    if (data.format !== 1 || !Array.isArray(data.drafts) || data.drafts.length > MAX_ANNOUNCEMENT_DRAFTS) throw new Error('公告草稿文件格式无效');
    return data.drafts;
  }
  write(drafts) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ format: 1, drafts }, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
  save(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '草稿格式无效' };
    const { id, text, format, level, delay, duration } = value;
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (!title || [...title].length > 80 || /[\r\n\u0000-\u001f\u007f]/u.test(title)) return { error: '草稿名称须为 1–80 字，不能包含换行或控制字符' };
    if (!['plain', 'markdown'].includes(format) || typeof text !== 'string' || [...text].length > announcementTextLimit(format)) return { error: '草稿正文格式或长度无效（纯文本最多 500 字，Markdown 最多 20000 字）' };
    if (!Object.hasOwn(ANNOUNCEMENT_LEVELS, level) || !delays.has(delay) || !durations.has(duration)) return { error: '草稿级别或发布时间设置无效' };
    const drafts = this.list();
    const index = id === undefined ? -1 : drafts.findIndex(d => d.id === id);
    if (id !== undefined && (typeof id !== 'string' || index < 0)) return { error: '草稿不存在，请重新读取草稿列表' };
    if (index < 0 && drafts.length >= MAX_ANNOUNCEMENT_DRAFTS) return { error: '最多保存 30 份公告草稿，请先删除不再使用的草稿' };
    const now = Date.now();
    const draft = { id: index < 0 ? randomUUID() : id, title, text, format, level, delay, duration, createdAt: index < 0 ? now : drafts[index].createdAt, updatedAt: now };
    if (index < 0) drafts.unshift(draft);
    else { drafts.splice(index, 1); drafts.unshift(draft); }
    this.write(drafts);
    return { ok: true, draft };
  }
  remove(id) {
    const drafts = this.list();
    if (typeof id !== 'string' || !drafts.some(d => d.id === id)) return { error: '草稿不存在，请重新读取草稿列表' };
    this.write(drafts.filter(d => d.id !== id));
    return { ok: true };
  }
}
