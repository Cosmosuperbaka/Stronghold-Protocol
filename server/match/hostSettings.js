// server/match/hostSettings.js — the host's standing settings for every room and every match of this server process,
// set by the local console (server/admin.js, which keeps them in logs/admin-settings.json across restarts).
// i18n-ignore-file: host-console messages in Chinese, not player UI (tools/i18n.mjs)
//
// prep: the 休整期 timer of a timed match (match/prep.js enterPrep reads prepSeconds; a match without a prep timer —
// solo, or a 同盟 room with one human: Match.soloUntimed — stays untimed). A room's prepOverride replaces the standing
// setting; null follows future standing changes. The internal developer timerScale still applies via setDeadline,
// but the console only configures prep time. A change reaches a running match at its next 休整期.
//   { mode: 'default' }                     the data's prepTime (config rounds[r].prepTime)
//   { mode: 'scale', scale }                data × scale (0.1–10)
//   { mode: 'fixed', seconds }              every round the same (5–3600 s)
//   { mode: 'perRound', rounds: { r: s } }  the listed rounds, the data for the others
//   { mode: 'untimed' }                     no timer: the prep ends when every player is ready (or the console ends it)

const MODES = new Set(['default', 'scale', 'fixed', 'perRound', 'untimed']);
const DEFAULT_PREP = Object.freeze({ mode: 'default' });
let prep = DEFAULT_PREP;
// Custom host rule: read once when a 联防 starts; each battle has fresh trait counters.
let uniteLayerGains = false;
let roundCharts = true;

export function getRoundCharts() { return roundCharts; }
export function setRoundCharts(v) {
  if (typeof v !== 'boolean') return { error: '局内曲线设置必须为开或关' };
  roundCharts = v;
  return { ok: true };
}

export function getUniteLayerGains() { return uniteLayerGains; }

export function setUniteLayerGains(v) {
  if (typeof v !== 'boolean') return { error: '联防叠层设置必须为开或关' };
  uniteLayerGains = v;
  return { ok: true };
}

const secsOk = (v) => Number.isInteger(v) && v >= 5 && v <= 3600;

/** Validated copy of a prep setting. @returns {{ prep: object } | { error: string }} */
export function normalizePrep(v) {
  const o = v && typeof v === 'object' ? v : {};
  const mode = MODES.has(o.mode) ? o.mode : null;
  if (!mode) return { error: '未知的休整期设置' };
  if (mode === 'scale') {
    const scale = Number(o.scale);
    if (!(scale >= 0.1 && scale <= 10)) return { error: '倍率范围 0.1–10' };
    return { prep: { mode, scale } };
  }
  if (mode === 'fixed') {
    const seconds = Number(o.seconds);
    if (!secsOk(seconds)) return { error: '秒数范围 5–3600 的整数' };
    return { prep: { mode, seconds } };
  }
  if (mode === 'perRound') {
    const rounds = {};
    for (const [k, s] of Object.entries(o.rounds && typeof o.rounds === 'object' ? o.rounds : {})) {
      if (s === '' || s == null) continue;
      const r = Number(k);
      const n = Number(s);
      if (!Number.isInteger(r) || r < 1 || r > 30) return { error: `没有第 ${k} 回合` };
      if (!secsOk(n)) return { error: `第 ${r} 回合：秒数范围 5–3600 的整数` };
      rounds[r] = n;
    }
    return { prep: { mode, rounds } };
  }
  return { prep: { mode } };
}

export function getPrep() { return prep; }

/** @returns {{ ok: true } | { error: string }} */
export function setPrep(v) {
  const r = normalizePrep(v);
  if (r.error) return r;
  prep = Object.freeze(r.prep);
  return { ok: true };
}

/** Back to the data's timers and the official 联防 rule (tests). */
export function resetHostSettings() { prep = DEFAULT_PREP; uniteLayerGains = false; roundCharts = true; }

/** The 休整期 seconds of round r for a match whose data gives `base` (null = untimed stays untimed). */
export function prepSecondsFor(round, base, p = prep) {
  if (!(base > 0)) return null;
  switch (p.mode) {
    case 'scale': return Math.max(1, Math.round(base * p.scale));
    case 'fixed': return p.seconds;
    case 'perRound': return Object.hasOwn(p.rounds, round) ? p.rounds[round] : base;
    case 'untimed': return null;
    default: return base;
  }
}

/** match/prep.js: the prep timer of m's current round. */
export function prepSeconds(m, base) {
  return prepSecondsFor(m.round, base, m.prepOverride ?? prep);
}
