import { createStore, loadPref, savePref, store } from '../store.js';
import { data } from '../data.js';
import { cleanSkins } from '../../../shared/skins.js';
import { installPrefSync } from './loadoutSync.js';
import { validSpine } from '../assets.js';

export function availableSkins(catalogue, manifest, charId) {
  return (catalogue?.chars?.[charId] || []).filter((skin) => {
    const entry = manifest?.chars?.[charId]?.skins?.[skin.id];
    return !!entry?.avatar && validSpine(entry.spine?.front);
  });
}
export function randomSkins(catalogue, manifest, random = Math.random) {
  const entries = {};
  for (const charId of Object.keys(catalogue?.chars || {})) {
    const options = availableSkins(catalogue, manifest, charId);
    if (options.length) entries[charId] = options[Math.floor(random() * options.length)].id;
  }
  return entries;
}

export const skinsStore = createStore({ entries: cleanSkins(loadPref('skins', {})), sync: 'idle' });
export function setSkins(entries) {
  const clean = cleanSkins(entries);
  savePref('skins', clean);
  skinsStore.set({ entries: clean });
}
export function setSkin(charId, skinId) {
  const next = { ...skinsStore.get().entries };
  if (skinId) next[charId] = skinId; else delete next[charId];
  setSkins(next);
}
export function skinForUnit(info) {
  if (info.side === 'enemy' || info.kind === 'token' || info.standInFor) return null;
  const charId = info.diy?.charId || String(info.spine || info.avatar || '').replace(/_[12]$/, '');
  const state = store.get();
  if (info.ownerId) return state.match.public?.players?.find((p) => p.playerId === info.ownerId)?.skins?.[charId] || null;
  return skinsStore.get().entries[charId] || null;
}
export function installSkinsSync({ net, timers, target = skinsStore } = {}) {
  return installPrefSync({ net, timers, target, key: 'entries', stateKey: 'sync', msgType: 'room.skins', field: 'skins', tag: 'skins',
    prepare: async () => {
      const catalogue = await data.load('skins');
      return catalogue ? cleanSkins(target.get().entries, catalogue) : null;
    } });
}
