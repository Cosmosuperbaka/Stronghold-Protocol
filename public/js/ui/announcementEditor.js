// i18n-ignore-file: authenticated local console announcement authoring UI.
import { h, render } from '../../vendor/preact.module.js';
import { renderAnnouncementMarkdown } from './announcementMarkdown.js';
import { ANNOUNCEMENT_TEMPLATES } from './announcementTemplates.js';
import { announcementTextLimit, normalizeAnnouncementText } from '../../../shared/announcements.js';

export function initAnnouncementEditor({ api }) {
  const $ = selector => document.querySelector(selector);
  const text = $('#site-notice-text'), format = $('#site-notice-format');
  const title = $('#site-notice-draft-title'), picker = $('#site-notice-drafts');
  const status = $('#site-notice-draft-status'), preview = $('#site-notice-preview');
  const persist = $('#site-notice-persist'), persistSave = $('#site-notice-persist-save'), persistStatus = $('#site-notice-persist-status');
  const loadPersistence = async () => {
    const result = await api('/api/announcement-persistence');
    if (typeof result.enabled !== 'boolean') throw new Error(result.error || '读取失败');
    persist.checked = result.enabled; persist.disabled = false;
    persistStatus.textContent = result.enabled ? '已开启：重启后恢复未过期公告。' : '未开启：公告在重启后清空，草稿不受影响。';
  };
  persistSave.addEventListener('click', async () => {
    persist.disabled = persistSave.disabled = true;
    try {
      if (persistSave.dataset.retry === 'true') { await loadPersistence(); delete persistSave.dataset.retry; }
      else {
        const result = await api('/api/announcement-persistence', { enabled: persist.checked });
        if (!result.ok) throw new Error(result.error || '保存失败');
        persist.checked = result.enabled;
        persistStatus.textContent = result.enabled ? '已保存：当前和之后发布的有效公告将在重启后恢复。' : '已保存：重启后不恢复公告，当前公告保持不变。';
      }
    } catch (e) { persistStatus.textContent = `操作失败：${e.message}。可重试。`; }
    finally { persist.disabled = persistSave.dataset.retry === 'true'; persistSave.disabled = false; }
  });
  loadPersistence().catch(e => {
    persistStatus.textContent = `读取保留设置失败：${e.message}。点击保存保留设置重试读取。`;
    persistSave.dataset.retry = 'true';
  }).finally(() => { persistSave.disabled = false; });
  const fields = [text, format, $('#site-notice-level'), $('#site-notice-delay'), $('#site-notice-duration'), title];
  let drafts = [], loadedId, baseline = '', busy = false;
  const value = () => ({ title: title.value, text: text.value, format: format.value, level: $('#site-notice-level').value, delay: Number($('#site-notice-delay').value), duration: $('#site-notice-duration').value === 'untilRemoved' ? 'untilRemoved' : Number($('#site-notice-duration').value) });
  const signature = () => JSON.stringify(value());
  const message = (s, error = false) => { status.textContent = s; status.dataset.error = String(error); };
  const changed = () => signature() !== baseline;
  const allowReplace = () => !text.value.trim() || !changed() || confirm('当前编辑内容尚未保存，确定替换？请先保存草稿以免丢失。');
  function updatePreview() {
    const source = normalizeAnnouncementText(text.value), limit = announcementTextLimit(format.value);
    $('#site-notice-count').textContent = `${[...source].length} / ${limit} 字${[...source].length > limit ? '，超出发布上限' : ''}`;
    render(source ? format.value === 'markdown' ? renderAnnouncementMarkdown(source) : h('p', { class: 'notice-preview-plain' }, source) : h('p', { class: 'meta' }, '输入公告正文，或选择模板后在此预览。'), preview);
  }
  function options(selected = loadedId) {
    picker.replaceChildren(new Option('选择已保存草稿', ''));
    for (const draft of drafts) picker.add(new Option(`${draft.title} · ${new Date(draft.updatedAt).toLocaleString()}`, draft.id));
    picker.value = drafts.some(d => d.id === selected) ? selected : '';
  }
  async function reload(selected = loadedId) {
    const result = await api('/api/announcement-drafts');
    if (result.error || !Array.isArray(result.drafts)) throw new Error(result.error || '草稿列表无效');
    drafts = result.drafts; options(selected);
  }
  function apply(draft, id) {
    text.value = draft.text; format.value = draft.format; title.value = draft.title;
    $('#site-notice-level').value = draft.level;
    $('#site-notice-delay').value = String(draft.delay ?? 0);
    $('#site-notice-duration').value = String(draft.duration ?? 3600000);
    loadedId = id; baseline = id ? signature() : ''; options(id); updatePreview();
  }
  const templates = $('#site-notice-template');
  for (const template of ANNOUNCEMENT_TEMPLATES) templates.add(new Option(template.title, template.id));
  for (const field of fields) {
    field.addEventListener(field === text || field === title ? 'input' : 'change', () => {
      updatePreview(); message(changed() ? '有未保存修改；保存草稿不会发布公告。' : '当前草稿无未保存修改。');
    });
  }
  $('#site-announcement').addEventListener('click', async event => {
    const button = event.target.closest('button[data-notice-editor]');
    if (!button || busy) return;
    const action = button.dataset.noticeEditor;
    if (action === 'template') {
      const template = ANNOUNCEMENT_TEMPLATES.find(t => t.id === templates.value);
      if (!template) { message('请先选择公告模板。', true); return; }
      if (!allowReplace()) return;
      apply(template); message('模板已填入，请替换方括号中的示例内容。尚未保存或发布。'); return;
    }
    if (action === 'load') {
      const draft = drafts.find(d => d.id === picker.value);
      if (!draft) { message('请先选择草稿。', true); return; }
      if (!allowReplace()) return;
      apply(draft, draft.id); message('草稿已载入。开始和持续时间在发布时重新计算，尚未发布。'); return;
    }
    if (action === 'delete' && (!picker.value || !confirm('确定删除选中的公告草稿？不会撤下已发布公告。'))) return;
    busy = true;
    for (const b of document.querySelectorAll('[data-notice-editor]')) b.disabled = true;
    try {
      if (action === 'refresh') { await reload(); message('草稿列表已刷新，当前编辑内容保留。'); }
      else if (action === 'delete') {
        const id = picker.value, result = await api('/api/announcement-drafts', { action: 'delete', id });
        if (!result.ok) throw new Error(result.error || '删除失败');
        if (loadedId === id) { loadedId = undefined; baseline = ''; }
        await reload(); message('草稿已删除，编辑区和已发布公告保持不变。');
      } else if (action === 'save' || action === 'new') {
        const draft = value(), captured = signature();
        if (action === 'save' && loadedId) draft.id = loadedId;
        const result = await api('/api/announcement-drafts', { action: 'save', draft });
        if (!result.ok) throw new Error(result.error || '保存失败');
        loadedId = result.draft.id; baseline = captured;
        await reload(); message(changed() ? '草稿已保存到服务器；保存期间的新修改尚未保存。' : '草稿已保存到服务器，重启后保留；尚未发布。');
      }
    } catch (e) { message(`操作失败：${e.message}。当前编辑内容仍在，可重试。`, true); }
    finally { busy = false; for (const b of document.querySelectorAll('[data-notice-editor]')) b.disabled = false; }
  });
  baseline = signature(); updatePreview();
  globalThis.addEventListener('beforeunload', event => {
    if (changed()) { event.preventDefault(); event.returnValue = ''; }
  });
  reload().catch(e => message(`读取草稿失败：${e.message}。可点击刷新草稿重试。`, true));
}
