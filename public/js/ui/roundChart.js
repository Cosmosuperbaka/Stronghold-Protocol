// Shared per-round chart for the host console and all in-match viewers.
import { t, N_ } from '../../../shared/i18n.js';
const SERIES = ['#69adff', '#ff9973', '#64d5af', '#f2ca62'];
const INK = { grid: '#2c2c2a', axis: '#555d58', label: '#b3bcb6', text: '#dfe6e2', surface: '#101311' };
const METRICS = [['lp', 'LP'], ['funds', N_('剩余金币')], ['spent', N_('累计花费')], ['dmg', N_('累计伤害')], ['roundDmg', N_('本回合伤害')], ['level', N_('商店等级')], ['income', N_('本回合收入')], ['expense', N_('本回合支出')]];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const full = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => Math.abs(n) >= 1e4 ? compact.format(n) : full.format(n);
const chartViews = new WeakMap();
function seriesOf(history, nameOf) {
  const last = history[history.length - 1];
  return last ? last.players.map((p, i) => ({ id: p.playerId, name: nameOf(p.playerId), color: SERIES[i] || INK.label })) : [];
}


export function pointsOf(history, id, key) {
  const out = [];
  let wasAlive = true;
  for (const h of history) {
    const p = h.players.find((x) => x.playerId === id);
    if (!p) continue;
    const value = key.startsWith('bond:') ? (p.bonds ? (p.bonds.find((b) => b.id === key.slice(5))?.layers ?? 0) : null) : p[key];
    if ((p.alive || wasAlive) && value != null && Number.isFinite(Number(value))) out.push({ round: h.round, v: Number(value) });
    wasAlive = p.alive;
  }
  return out;
}

export function niceScale(max) {
  if (!(max > 0)) return { top: 1, step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * pow).find((x) => x >= raw));
  return { top: Math.ceil(max / step) * step, step };
}

/**
 * A line chart of one metric by round, one line per player, drawn into `host`: legend, end labels, a crosshair with
 * one tooltip listing every player at that round, and a table view. `state` { metric, table } survives re-renders.
 */
export function drawRoundChart(host, history, nameOf, state, { bondRecord = () => null, name = (s) => s } = {}) {
  if (!history.length) { host.innerHTML = `<p class="meta">${esc(t('第一回合结算后开始记录。'))}</p>`; chartViews.delete(host); return; }
  const series = seriesOf(history, nameOf);
  const bonds = new Map();
  for (const h of history) for (const p of h.players) for (const b of p.bonds || []) if (b.active && !b.noStack && !bondRecord(b.id)?.noStack) bonds.set(b.id, name(b.name));
  const metrics = [...METRICS.map(([id, label]) => [id, t(label)]), ...[...bonds].map(([id, name]) => ['bond:' + id, t('盟约层数 · {name}', { name })])];
  const [key, label] = metrics.find((x) => x[0] === state.metric) || metrics[0];
  let view = chartViews.get(host);
  if (!view || view.bar.parentNode !== host || view.labels !== t('曲线指标')) {
    const bar = document.createElement('div'), content = document.createElement('div');
    bar.className = 'row';
    bar.innerHTML = `<label>${esc(t('指标'))} <select aria-label="${esc(t('曲线指标'))}"></select></label>
      <button type="button"></button>`;
    host.replaceChildren(bar, content);
    view = { bar, content, labels: t('曲线指标') }; chartViews.set(host, view);
  }
  const { bar, content } = view;
  const select = bar.querySelector('select'), button = bar.querySelector('button');
  const redraw = () => drawRoundChart(host, history, nameOf, state, { bondRecord, name });
  syncSelectOptions(select, metrics, key);
  select.onchange = (e) => { state.metric = e.target.value; redraw(); };
  button.textContent = state.table ? t('看曲线') : t('看表格');
  button.setAttribute('aria-pressed', String(!!state.table));
  button.onclick = () => { state.table = !state.table; redraw(); };
  content.replaceChildren();
  const rounds = history.map((h) => h.round);
  if (state.table) {
    const table = document.createElement('div');
    table.className = 'xscroll';
    table.innerHTML = `<table><caption class="meta" style="text-align:left">${esc(t('{label}（每回合结算后）', { label }))}</caption>
      <thead><tr><th scope="col">${esc(t('回合'))}</th>${series.map((s) => `<th scope="col" class="n">${esc(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${rounds.map((r) => `<tr><th scope="row">${r}</th>${series.map((s) => { const p = pointsOf(history, s.id, key).find((x) => x.round === r); return `<td class="n">${p ? full.format(p.v) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    content.append(table);
    return;
  }
  const lines = series.map((s) => ({ ...s, pts: pointsOf(history, s.id, key) }));
  const W = 720, H = 260, L = 52, R = 96, T = 12, B = 30;
  const x0 = rounds[0], x1 = rounds[rounds.length - 1];
  const X = (r) => (x1 === x0 ? L + (W - L - R) / 2 : L + ((r - x0) / (x1 - x0)) * (W - L - R));
  const { top, step } = niceScale(Math.max(0, ...lines.flatMap((l) => l.pts.map((p) => p.v))));
  const Y = (v) => T + (1 - v / top) * (H - T - B);
  let svg = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? INK.axis : INK.grid}" stroke-width="1"/>`;
    svg += `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" fill="${INK.label}" font-size="11">${fmt(v)}</text>`;
  }
  const every = Math.ceil(rounds.length / 15);
  rounds.forEach((r, i) => { if (i % every === 0 || i === rounds.length - 1) svg += `<text x="${X(r)}" y="${H - B + 18}" text-anchor="middle" fill="${INK.label}" font-size="11">${r}</text>`; });
  svg += `<text x="${W - R}" y="${H - 2}" text-anchor="end" fill="${INK.label}" font-size="11">${esc(t('回合'))}</text>`;
  for (const l of lines) {
    if (!l.pts.length) continue;
    svg += `<polyline fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${l.pts.map((p) => `${X(p.round)},${Y(p.v)}`).join(' ')}"/>`;
    for (const p of l.pts) svg += `<circle cx="${X(p.round)}" cy="${Y(p.v)}" r="4" fill="${l.color}" stroke="${INK.surface}" stroke-width="2"/>`;
  }
  // end labels in text ink, nudged apart; the line end beside each carries the color
  const ends = lines.filter((l) => l.pts.length).map((l) => { const p = l.pts[l.pts.length - 1]; return { l, x: X(p.round), y: Y(p.v) }; }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
  const over = ends.length ? ends[ends.length - 1].y - (H - B) : 0;
  if (over > 0) for (const e of ends) e.y -= over;
  for (const e of ends) svg += `<text x="${e.x + 8}" y="${e.y + 4}" fill="${INK.text}" font-size="12">${esc(e.l.name)}</text>`;
  svg += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="${INK.label}" stroke-width="1" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}" fill="transparent"/>`;

  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const l of lines) { const sp = document.createElement('span'); sp.style.setProperty('--c', l.color); sp.textContent = l.name; legend.append(sp); }
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('{label}曲线，第 {from}–{to} 回合，切换到表格可读出数值', { label, from: x0, to: x1 }))}"><title>${esc(label)}</title>${svg}</svg><div class="tip" role="presentation"></div>`;
  content.append(legend, wrap);

  const svgEl = wrap.querySelector('svg'), cross = wrap.querySelector('.cross'), tip = wrap.querySelector('.tip');
  wrap.querySelector('.hit').addEventListener('pointermove', (e) => {
    const box = svgEl.getBoundingClientRect();
    const k = box.width / W;
    const vx = (e.clientX - box.left) / k;
    let r = rounds[0];
    for (const x of rounds) if (Math.abs(X(x) - vx) < Math.abs(X(r) - vx)) r = x;
    cross.setAttribute('x1', X(r)); cross.setAttribute('x2', X(r)); cross.setAttribute('visibility', 'visible');
    tip.textContent = '';
    const head = document.createElement('b');
    head.textContent = t('第 {round} 回合 · {label}', { round: r, label });
    tip.append(head);
    const rows = lines.map((l) => ({ l, p: l.pts.find((p) => p.round === r) })).filter((x) => x.p).sort((a, b) => b.p.v - a.p.v);
    for (const { l, p } of rows) {
      const line = document.createElement('div');
      const sw = document.createElement('span'); sw.className = 'k'; sw.style.setProperty('--c', l.color);
      const v = document.createElement('span'); v.className = 'v'; v.textContent = full.format(p.v);
      const n = document.createElement('span'); n.textContent = l.name;
      line.append(sw, v, n);
      tip.append(line);
    }
    tip.style.display = 'block';
    const px = X(r) * k;
    tip.style.left = `${px + 12 + tip.offsetWidth > box.width ? px - 12 - tip.offsetWidth : px + 12}px`;
    tip.style.top = '8px';
  });
  wrap.querySelector('.hit').addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
}


/** Shared console ranking: one settled round, all players or one, top ten or all. */
const pct = (x) => `${(x * 100).toFixed(x >= 0.1 ? 0 : 1)}%`;
const unitViews = new WeakMap();
function syncSelectOptions(select, options, value) {
  // A native select's popup belongs to this exact DOM node. Do not replace it or its options while choosing.
  const signature = JSON.stringify(options);
  const sync = () => {
    if (select.dataset.options !== signature) {
      select.innerHTML = options.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
      select.dataset.options = signature;
    }
    select.value = String(value);
  };
  select.onblur = sync;
  if (document.activeElement !== select) sync();
}
export function drawUnitRounds(host, history, nameOf, state, { name = (s) => s } = {}) {
  if (!history.length) { host.innerHTML = `<p class="meta">${esc(t('第一回合结算后开始记录。'))}</p>`; unitViews.delete(host); return; }
  const latest = history[history.length - 1].round;
  const h = history.find((x) => x.round === state.round) || history[history.length - 1];
  const colorOf = new Map(h.players.map((p, i) => [p.playerId, SERIES[i] || INK.label]));
  const rows = [];
  const source = state.cumulative ? history.filter((x) => x.round <= h.round) : [h];
  const aggregate = new Map();
  for (const entry of source) for (const p of entry.players) {
    if (state.player && p.playerId !== state.player) continue;
    for (const u of p.units || []) {
      const key = JSON.stringify([p.playerId, u.name || u.defId]);
      const row = aggregate.get(key) || { ...u, playerId: p.playerId, dmg: 0, kills: 0 };
      row.dmg += Number(u.dmg) || 0;
      row.kills += Number(u.kills) || 0;
      aggregate.set(key, row);
    }
  }
  const sums = new Map();
  for (const row of aggregate.values()) sums.set(row.playerId, (sums.get(row.playerId) || 0) + row.dmg);
  for (const row of aggregate.values()) rows.push({ ...row, share: sums.get(row.playerId) > 0 ? row.dmg / sums.get(row.playerId) : 0 });
  rows.sort((a, b) => b.dmg - a.dmg || b.kills - a.kills);
  const shown = state.all ? rows : rows.slice(0, 10);
  const max = rows.length ? rows[0].dmg : 0;
  let view = unitViews.get(host);
  if (!view || view.bar.parentNode !== host || view.labels !== t('查看第几回合')) {
    const bar = document.createElement('div'), table = document.createElement('div');
    bar.className = 'row'; table.className = 'xscroll';
    bar.innerHTML = `<label>${esc(t('查看'))} <select data-k="round" aria-label="${esc(t('查看第几回合'))}"></select></label>
      <label>${esc(t('玩家'))} <select data-k="player" aria-label="${esc(t('只看哪个玩家'))}"></select></label>
      <button type="button" data-k="all"></button><button type="button" data-k="cumulative"></button><span class="meta" data-k="enemy"></span>`;
    host.replaceChildren(bar, table);
    view = { bar, table, name, labels: t('查看第几回合') }; unitViews.set(host, view);
  }
  const { bar, table } = view;
  const roundSelect = bar.querySelector('[data-k="round"]'), playerSelect = bar.querySelector('[data-k="player"]');
  const redraw = () => drawUnitRounds(host, history, nameOf, state, { name });
  syncSelectOptions(roundSelect, history.map((x) => [x.round, t('第 {r} 回合', { r: x.round }) + (x.live ? t('（进行中）') : x.round === latest ? t('（最新）') : '')]), h.round);
  syncSelectOptions(playerSelect, [['', t('全部')], ...h.players.map((p) => [p.playerId, nameOf(p.playerId)])], state.player || '');
  roundSelect.onblur = redraw;
  roundSelect.onchange = (e) => {
    const r = Number(e.target.value);
    state.round = r === latest ? null : r;
    redraw();
  };
  playerSelect.onchange = (e) => { state.player = e.target.value; redraw(); };
  const cumulative = bar.querySelector('[data-k="cumulative"]'), allButton = bar.querySelector('[data-k="all"]');
  cumulative.textContent = state.cumulative ? t('看本回合') : t('看累计'); cumulative.setAttribute('aria-pressed', String(!!state.cumulative));
  cumulative.onclick = () => { state.cumulative = !state.cumulative; redraw(); };
  allButton.hidden = rows.length <= 10;
  allButton.textContent = state.all ? t('只看前 10') : t('看全部 {n} 个', { n: rows.length }); allButton.setAttribute('aria-pressed', String(!!state.all));
  allButton.onclick = () => { state.all = !state.all; redraw(); };
  const enemy = bar.querySelector('[data-k="enemy"]');
  enemy.textContent = h.enemy ? `${t('敌人：')}${h.enemy.typeName} · ${h.enemy.special}` : '';
  table.innerHTML = rows.length ? `<table><caption class="meta" style="text-align:left">${esc(state.cumulative ? t('累计至第 {r} 回合', { r: h.round }) : t('第 {r} 回合', { r: h.round }))}</caption><thead><tr><th scope="col" class="n">#</th><th scope="col">${esc(t('干员'))}</th><th scope="col">${esc(t('玩家'))}</th><th scope="col" class="n">${esc(t('伤害'))}</th><th scope="col" style="min-width:160px"><span class="sr-only">${esc(t('伤害条'))}</span></th><th scope="col" class="n">${esc(t('击杀'))}</th><th scope="col" class="n">${esc(t('占本人'))}</th></tr></thead>
    <tbody>${shown.map((u, i) => `<tr><td class="n">${i + 1}</td><th scope="row">${esc(name(u.name))}</th><td>${esc(nameOf(u.playerId))}</td><td class="n">${full.format(u.dmg)}</td>
      <td><span class="dmg-bar" style="--c:${colorOf.get(u.playerId)};width:${max > 0 ? Math.max(1, (u.dmg / max) * 100) : 0}%"></span></td>
      <td class="n">${u.kills}</td><td class="n">${pct(u.share)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="meta">${esc(t('这回合没有干员伤害记录（比如没有干员上场）。'))}</p>`;
}
