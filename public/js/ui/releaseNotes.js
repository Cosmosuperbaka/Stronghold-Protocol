import { t } from '../../../shared/i18n.js';

/** First installs only establish a baseline. A changed version is acknowledged on close. */
export function shouldShowReleaseNotes(previous, current) {
  return !!previous && !!current && previous !== current;
}

export function showReleaseNotes(notes, { storage = globalThis.localStorage, storageKey = 'sp.release-notes', chineseOnly = false } = {}) {
  if (!notes?.version) return null;
  let previous;
  try { previous = storage.getItem(storageKey); } catch { return null; }
  const remember = () => { try { storage.setItem(storageKey, notes.version); } catch { /* optional storage */ } };
  if (!shouldShowReleaseNotes(previous, notes.version) || !notes.entries?.length) { remember(); return null; }
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'box-sizing:border-box;max-width:720px;width:calc(100% - 32px);max-height:85dvh;overflow:auto;padding:24px;background:#fafafa;color:#17202a;border:1px solid #8b969f;border-radius:8px;line-height:1.65;font:16px/1.65 system-ui;';
  dialog.setAttribute('aria-label', t('更新记录'));
  const heading = document.createElement('h2'); heading.textContent = notes.title; heading.style.cssText = 'font-size:20px;margin:0 0 12px';
  dialog.append(heading);
  if (chineseOnly) { const p = document.createElement('p'); p.textContent = t('仅提供中文'); dialog.append(p); }
  const list = document.createElement('ul');
  for (const entry of notes.entries) { const li = document.createElement('li'); li.textContent = entry; li.style.marginBottom = '12px'; list.append(li); }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = t('关闭');
  close.style.cssText = 'min-height:44px;padding:8px 24px;cursor:pointer';
  close.onclick = () => dialog.close();
  dialog.append(list, close); document.body.append(dialog);
  dialog.addEventListener('close', () => { remember(); dialog.remove(); }, { once: true });
  dialog.showModal(); close.focus();
  return dialog;
}
