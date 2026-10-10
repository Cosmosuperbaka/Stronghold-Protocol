import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { data } from '../data.js';
import { preloadPlan, runPreload } from './preload.js';
import { t } from '../../../shared/i18n.js';

export function PreloadSection() {
  const [scope, setScope] = useState('visual');
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const controller = useRef(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  const start = async () => {
    if (controller.current) return;
    const c = new AbortController(); controller.current = c;
    setBusy(true); setError(false); setProgress(null);
    try {
      const [manifest, local] = await Promise.all([data.load('assets'), data.load('local')]);
      if (!manifest) throw new Error('manifest unavailable');
      if (c.signal.aborted) return;
      const result = await runPreload(preloadPlan(manifest, local, scope), { signal: c.signal, onProgress: (p) => {
        if (controller.current === c) setProgress(p);
      } });
      if (controller.current === c) setProgress(result);
    } catch { if (controller.current === c) setError(true); }
    finally { if (controller.current === c) { controller.current = null; setBusy(false); } }
  };
  return html`<section class="set-preload" data-testid="preload-section">
    <div class="set-row"><span class="set-row__label">${t('素材预加载')}</span>
      <select aria-label=${t('预加载范围')} value=${scope} disabled=${busy} onChange=${(e) => setScope(e.currentTarget.value)}>
        <option value="visual">${t('画面素材')}</option><option value="all">${t('全部素材')}</option>
      </select>
      <${Button} size="sm" variant="ghost" icon=${busy ? 'close' : 'refresh'} onClick=${busy ? () => controller.current?.abort() : start}>
        ${busy ? t('取消') : t('预加载')}<//>
    </div>
    ${progress ? html`<progress max=${progress.total || 1} value=${progress.done} aria-label=${t('素材预加载')}></progress>
      <p class="set-hint" role="status">${progress.done}/${progress.total}
        ${progress.cancelled ? t('已取消') : !busy && progress.done === progress.total ? t('预加载完成') : ''}
        ${progress.failed ? t('失败 {n} 项', { n: progress.failed }) : ''}</p>` : null}
    ${error ? html`<p class="set-hint" role="alert">${t('素材清单加载失败，请重试')}</p>` : null}
  </section>`;
}
