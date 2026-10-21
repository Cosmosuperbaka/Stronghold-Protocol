// Read the active board renderer rather than a separate requestAnimationFrame loop (which ignores the player's cap).
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useSettings } from './settings.js';
import { t } from '../../../shared/i18n.js';

export function FrameRatePill({ view }) {
  const { showFps } = useSettings();
  const [fps, setFps] = useState(null);
  useEffect(() => {
    setFps(null);
    if (!showFps || view?.kind !== 'engine' || typeof view.raw?.stats !== 'function') return;
    const sample = () => {
      const value = document.hidden ? null : view.raw.stats()?.fps;
      setFps(Number.isFinite(value) && value > 0 ? Math.round(value) : null);
    };
    sample();
    const timer = setInterval(sample, 1000);
    document.addEventListener('visibilitychange', sample);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sample); };
  }, [showFps, view]);
  if (!showFps) return null;
  const label = fps == null ? t('当前帧率不可用') : t('当前帧率 {fps} FPS', { fps });
  return html`<span class="ping fps-pill" data-testid="fps-display" title=${label} aria-label=${label}>
    <span class="fps-pill__value">${fps ?? '--'}</span><span class="fps-pill__unit">FPS</span>
  </span>`;
}
