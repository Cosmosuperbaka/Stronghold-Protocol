// Cosmetic preferences, keyed by operator so normal, elite and DIY pieces share a choice.
export const SKIN_LIMIT = 256;
export const isSkinId = (id) => typeof id === 'string' && /^char_\d+_[a-z0-9]+@[A-Za-z0-9_]+#\d+$/.test(id) && id.length <= 120;
export function isSkinSelection(value) {
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= SKIN_LIMIT
    && Object.entries(value).every(([id, skin]) => /^char_\d+_[a-z0-9]+$/.test(id) && isSkinId(skin) && skin.startsWith(`${id}@`));
}
export function cleanSkins(value, catalogue = null) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, skin] of Object.entries(value).slice(0, SKIN_LIMIT)) {
    if (!isSkinSelection({ [id]: skin })) continue;
    if (catalogue && !catalogue.chars?.[id]?.some((s) => s.id === skin)) continue;
    out[id] = skin;
  }
  return out;
}
