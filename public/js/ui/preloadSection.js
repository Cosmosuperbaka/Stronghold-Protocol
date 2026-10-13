// 预载资源: the settings entry into the preloader. The widget itself sits bottom-right on the title / lobby screens
// (ui/preload.js PreloadWidget); this row opens the manager dialog (ui/preload.js PreloadModal via openPreload()).
// Replaces the old scope-select + one-shot runPreload section — the ported preloader (preload/*) plans by category,
// runs in the background with its own concurrency and caches to IndexedDB.

import { html, Button, MicroLabel } from './components.js';
import { openPreload } from './preload.js';
import { t } from '../../../shared/i18n.js';

export function PreloadSection() {
  return html`<section class="set-preload" data-testid="preload-section">
    <div class="set-row"><span class="set-row__label">${t('素材预载')}<${MicroLabel}>PRELOAD<//></span>
      <span class="set-hint">${t('进度 / 分类 / 并发都在预载面板里管理')}</span>
      <${Button} size="sm" variant="ghost" icon="download" onClick=${() => openPreload()}>${t('打开预载面板')}<//>
    </div>
  </section>`;
}
