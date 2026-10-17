// Opt-in deployment URLs; no reference-site defaults or secrets are served to browsers.
import { parseResourcePackRoutes } from '../../shared/resourcePackRoutes.js';
export function cdnBase(value) {
  if (!value) return '';
  const url = new URL(String(value));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid CDN base URL');
  return url.href.replace(/\/+$/, '');
}
export function deploymentCdn({ assetsCdn = process.env.SP_ASSETS_CDN, dataCdn = process.env.SP_DATA_CDN, resourcePackRoutes = process.env.SP_RESOURCE_PACK_ROUTES } = {}) {
  return { assetsCdn: cdnBase(assetsCdn), dataCdn: cdnBase(dataCdn), resourcePackRoutes: parseResourcePackRoutes(resourcePackRoutes) };
}
