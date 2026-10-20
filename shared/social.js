// Local-server discovery only; no account service or cross-server identity.
export const PRESENCE_STATUSES = Object.freeze(['online', 'away', 'busy', 'invisible']);
export const DEFAULT_SOCIAL_SETTINGS = Object.freeze({ directory: true, invitations: true, statusSelection: true, invisible: true, counts: true, hostOnly: false });
export const SOCIAL_PAGE_SIZE = 100;
export const INVITE_TTL_MS = 60000;
export const INVITE_COOLDOWN_MS = 10000;
