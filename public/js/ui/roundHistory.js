import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { getBond, useData } from '../data.js';
import { t, tName } from '../../../shared/i18n.js';
import { drawRoundChart, drawUnitRounds } from './roundChart.js';
import { useLang } from './lang.js';

/** A modeless shared-history panel using the console's settled-round chart and operator ranking. */
export function RoundHistoryPanel({ history = [], players = [], onClose }) {
  const ready = useData('bonds');
  const lang = useLang();
  const snapshot = JSON.stringify([history, players.map((p) => [p.playerId, p.name])]);
  const host = useRef(null), close = useRef(null);
  const chartState = useRef({ metric: 'lp', table: false });
  const rankState = useRef({ round: null, player: '', all: false });
  const [tab, setTab] = useState('chart');
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    const escape = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) onClose();
    };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); previous?.focus?.(); };
  }, []);
  useEffect(() => {
    const names = new Map(players.map((p) => [p.playerId, p.name]));
    const nameOf = (id) => names.get(id) || id;
    if (tab === 'units') drawUnitRounds(host.current, history, nameOf, rankState.current, { name: tName });
    else drawRoundChart(host.current, history, nameOf, chartState.current, { bondRecord: getBond, name: tName });
  }, [snapshot, ready, lang, tab]);
  return html`<section id="round-history-panel" class="round-history brackets" role="dialog" aria-label=${t('每回合统计')}
    onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
    <header class="round-history__head"><h2>${t('每回合统计')}</h2>
      <button ref=${close} type="button" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </header>
    <div class="round-history__tabs" role="group" aria-label=${t('统计内容')}>
      <button type="button" aria-pressed=${tab === 'chart'} onClick=${() => setTab('chart')}>${t('每回合曲线')}</button>
      <button type="button" aria-pressed=${tab === 'units'} onClick=${() => setTab('units')}>${t('干员伤害排行')}</button>
    </div>
    <div ref=${host} class="round-history__body"></div>
    ${tab === 'units' ? html`<p class="round-history__note">${t('伤害是实际扣掉的敌人血量（不算溢出），只算各自战场；召唤物不单列。')}</p>` : null}
  </section>`;
}
