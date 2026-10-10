import { useStore } from '../store.js';
import { useData, data } from '../data.js';
import { html, Icon } from './components.js';
import { Img } from './gameComponents.js';
import { avatarUrl } from '../assets.js';
import { skinsStore, setSkin, availableSkins } from './skins.js';
import { t } from '../../../shared/i18n.js';
const cx = (...parts) => parts.filter(Boolean).join(' ');

export function SkinSection({ charId }) {
  const state = useStore((s) => s, Object.is, skinsStore);
  useData('skins');
  useData('assets');
  const m = data.get('assets');
  const list = data.get('skins')?.chars?.[charId] || [];
  const installed = new Set(availableSkins(data.get('skins'), m, charId).map((s) => s.id));
  if (!list.length) return null;
  const chosen = state.entries[charId] || '';
  const options = [{ id: '', name: t('默认'), group: '' }, ...list];
  return html`<section class="lo-sec lo-sec--skins" data-skin-char=${charId}>
    <header class="lo-sec__head"><h3>${t('皮肤')}</h3><span role="status">${state.sync === 'error' ? t('同步失败') : ''}</span></header>
    <div class="lo-skins" role="radiogroup" aria-label=${t('选择皮肤')}>
      ${options.map((s) => {
        const available = !s.id || installed.has(s.id);
        return html`<button type="button" role="radio" aria-checked=${chosen === s.id ? 'true' : 'false'}
          class=${cx('lo-skin', chosen === s.id && 'is-on')} data-skin=${s.id} disabled=${!available}
          onClick=${() => setSkin(charId, s.id)}>
          <${Img} src=${avatarUrl(m, charId, { skin: available ? s.id : null })} class="lo-skin__art" />
          <span class="lo-skin__text"><b>${s.name}</b><small>${available ? s.group : t('未安装')}</small></span>
          ${chosen === s.id ? html`<${Icon} name="check" />` : null}
        </button>`;
      })}
    </div>
  </section>`;
}
