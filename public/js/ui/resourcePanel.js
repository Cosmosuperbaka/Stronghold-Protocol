// 标题页与设置里的资源预载入口（官方 pill 壳 × 本库预载引擎）。
// 本库引擎（preload/*：IndexedDB + weishucdn / R2 双镜像 + 后台续传）是唯一的下载引擎；官方
// v0.3.0-extended.2 的 Cache-Storage 引擎（resources/index.js，含 ZIP 导入导出）不再被 UI 驱动，
// 模块与其单元测试保留（2026-10-17 决策：一套引擎，官方 UI）。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel, ProgressBar } from './components.js';
import { preloadStore, statusLabel, pctOf, openPreload } from './preload.js';
import { t } from '../../../shared/i18n.js';
const cx = (...parts) => parts.filter(Boolean).join(' ');

function usePreloadUi() {
  const [st, setState] = useState(preloadStore.get());
  useEffect(() => preloadStore.subscribe(setState), []);
  return st;
}

/** 设置 ▸ 预载资源行：本库引擎的状态 + 打开预载管理。 */
export function ResourceRow() {
  const st = usePreloadUi();
  const s = st.state;
  return html`<div class="set-res">
    <div class="set-row">
      <span class="set-row__label">${t('预载资源')}<${MicroLabel}>PRELOAD<//></span>
      <${Button} variant="secondary" size="sm" icon="expand" onClick=${openPreload}>${t('资源管理')}<//>
    </div>
    <p class="set-hint">${statusLabel(s)}${s && s.total ? ` ${pctOf(s.done, s.total)}%` : ''} · ${t('必备与可选资源，经镜像加速下载到浏览器（IndexedDB）。')}</p>
  </div>`;
}

/** 标题页的紧凑入口：pill 显示本库预载进度，点击打开预载管理。 */
export function ResourceLauncher() {
  const st = usePreloadUi();
  const s = st.state;
  const total = s?.total || 0;
  const done = s?.done || 0;
  const running = s?.status === 'running';
  return html`<div class=${`res-pill${running ? ' is-on' : ''}`}>
    <button type="button" class="res-pill__head" title=${t('打开预载管理（镜像加速下载）')} onClick=${openPreload}>
      <span class="res-pill__label">${t('预载资源')}<${MicroLabel}>PRELOAD<//></span>
      <span class=${cx('res-pill__state', running && 'is-on')}>${statusLabel(s)}${total ? ` ${pctOf(done, total)}%` : ''}</span>
    </button>
    ${total ? html`<${ProgressBar} value=${done} max=${Math.max(1, total)} size="sm" tone="mint" />`
      : html`<p class="res-pill__hint">${t('必备 / 可选资源 · 镜像加速')}</p>`}
  </div>`;
}
