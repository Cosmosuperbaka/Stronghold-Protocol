// Adapted from xinhai-ai fe60c100: resolve the owner's skin without borrowing another player's choice.
import { html } from './components.js';
import { Img } from './gameComponents.js';
import { chessPortraitUrl } from './assetUrls.js';
import { useStore } from '../store.js';
import { skinsStore } from './skins.js';
import { portraitSkin } from './portraitModel.js';
export { portraitSkin } from './portraitModel.js';
export function OperatorPortrait({ m, chess, ownerId, skin, fallback = null, ...props }) {
  const entries = useStore((s) => s.entries, Object.is, skinsStore);
  const selected = useStore((state) => portraitSkin(chess, { state, entries, ownerId, skin }));
  const base = chessPortraitUrl(m, chess);
  const src = chessPortraitUrl(m, chess, { skin: selected });
  return html`<${Img} ...${props} src=${src} fallback=${src !== base ? html`<${Img} ...${props} src=${base} fallback=${fallback} />` : fallback} />`;
}
