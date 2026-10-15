import { t } from '../../../shared/i18n.js';

// Shared by the game and the standalone host console, which does not load theme.css.
// Mount scoped styles synchronously so the native dialog never paints in its light default.
function createReleaseDialog(title, label = title) {
  if (!document.getElementById('release-dialog-styles')) {
    const style = document.createElement('style');
    style.id = 'release-dialog-styles';
    style.textContent = `
      .release-notes {
        --release-accent: var(--mint-500, #4ed8af);
        --release-line: var(--line-2, #3e4b45);
        box-sizing: border-box; color-scheme: dark;
        width: min(720px, calc(100% - 32px)); max-width: none;
        max-height: 85vh; max-height: 85dvh; padding: 0;
        overflow: hidden; background: var(--bg-1, #141816);
        color: var(--text-hi, #f2f2f2); border: 1px solid var(--release-line);
        border-radius: 0; box-shadow: 0 24px 64px #000a;
        font: 16px/1.65 var(--font-cjk, system-ui, "Microsoft YaHei", sans-serif);
        user-select: text; -webkit-user-select: text;
      }
      .release-notes[open] { display: flex; flex-direction: column; }
      .release-notes::backdrop { background: rgba(3, 5, 4, .78); }
      .release-notes__head { display: block; flex: none; padding: 20px 24px 16px; border-bottom: 1px solid var(--release-line); }
      .release-notes__head::before {
        content: ''; display: block; height: 4px; margin: -20px -24px 16px;
        background: repeating-linear-gradient(-45deg, var(--release-accent) 0 6px, transparent 6px 13px);
        opacity: .55;
      }
      .release-notes__title { margin: 0; color: var(--text-hi, #f2f2f2); font-size: 20px; line-height: 1.45; font-weight: 700; overflow-wrap: anywhere; }
      .release-notes__body {
        min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 20px 24px;
        color: var(--text-md, #c3cbc7); overflow-wrap: anywhere;
        scrollbar-width: thin; scrollbar-color: var(--release-line) var(--bg-1, #141816);
      }
      .release-notes__body::-webkit-scrollbar { width: 6px; }
      .release-notes__body::-webkit-scrollbar-thumb { background: var(--release-line); }
      .release-notes__body::-webkit-scrollbar-thumb:hover { background: var(--release-accent); }
      .release-notes__body p { margin: 0; }
      .release-notes__language { margin-bottom: 16px !important; color: var(--text-lo, #8a948f); font-size: 14px; }
      .release-notes__list { margin: 0; padding-left: 22px; }
      .release-notes__list li + li { margin-top: 12px; }
      .release-notes__list li::marker { color: var(--release-accent); }
      .release-notes__actions {
        display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: 12px;
        padding: 16px 24px; border-top: 1px solid var(--release-line); background: var(--bg-0, #0c0f0e);
      }
      .release-notes__button {
        box-sizing: border-box; min-height: 44px; padding: 8px 24px; font: inherit;
        color: var(--text-hi, #f2f2f2); background: var(--bg-2, #1e2421);
        border: 1px solid var(--release-line); border-radius: 0; cursor: pointer;
      }
      .release-notes__button:hover { border-color: var(--release-accent); }
      .release-notes__button--primary { background: var(--release-accent); color: var(--text-on-mint, #06110d); border-color: var(--release-accent); font-weight: 600; }
      .release-notes__button--primary:hover { background: var(--mint-400, #59f4ca); }
      .release-notes__button:focus-visible { outline: 2px solid var(--release-accent); outline-offset: 3px; }
      .release-notes__button:active { transform: translateY(1px); }
      .release-notes ::selection { color: var(--text-on-mint, #06110d); background: var(--release-accent); }
      @media (max-width: 480px), (max-height: 480px) {
        .release-notes__head { padding: 16px; }
        .release-notes__head::before { margin: -16px -16px 12px; }
        .release-notes__body { padding: 16px; }
        .release-notes__actions { padding: 12px 16px; }
      }
    `;
    document.head.append(style);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'release-notes';
  dialog.setAttribute('aria-label', label);
  const header = document.createElement('header'); header.className = 'release-notes__head';
  const heading = document.createElement('h2'); heading.className = 'release-notes__title'; heading.textContent = title;
  header.append(heading);
  const body = document.createElement('div'); body.className = 'release-notes__body';
  const actions = document.createElement('div'); actions.className = 'release-notes__actions';
  dialog.append(header, body, actions);
  return { dialog, body, actions };
}

function releaseButton(label, primary = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label;
  button.className = `release-notes__button${primary ? ' release-notes__button--primary' : ''}`;
  return button;
}

/** The host's update notice uses the same theme as release notes; Esc means later. */
export function showReleaseUpdatePrompt({ title, message, confirmLabel, cancelLabel }) {
  const { dialog, body, actions } = createReleaseDialog(title);
  const text = document.createElement('p'); text.textContent = message; body.append(text);
  const cancel = releaseButton(cancelLabel), confirm = releaseButton(confirmLabel, true);
  cancel.onclick = () => dialog.close();
  confirm.onclick = () => dialog.close('confirm');
  actions.append(cancel, confirm);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { const confirmed = dialog.returnValue === 'confirm'; dialog.remove(); resolve(confirmed); }, { once: true });
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}

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
  const { dialog, body, actions } = createReleaseDialog(notes.title, t('更新记录'));
  if (chineseOnly) { const p = document.createElement('p'); p.className = 'release-notes__language'; p.textContent = t('仅提供中文'); body.append(p); }
  const list = document.createElement('ul'); list.className = 'release-notes__list';
  for (const entry of notes.entries) { const li = document.createElement('li'); li.textContent = entry; list.append(li); }
  const close = releaseButton(t('关闭'), true);
  close.onclick = () => dialog.close();
  body.append(list); actions.append(close); document.body.append(dialog);
  dialog.addEventListener('close', () => { remember(); dialog.remove(); }, { once: true });
  dialog.showModal(); close.focus();
  return dialog;
}
