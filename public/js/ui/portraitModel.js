export function portraitSkin(chess, { state, entries, ownerId, skin } = {}) {
  if (!chess || chess.standInFor || chess.isHidden) return null;
  if (skin !== undefined) return skin || null;
  const id = chess.charId || chess.baseId || chess.chessId;
  const owner = ownerId === undefined ? state?.me?.playerId : ownerId;
  const player = state?.match?.public?.players?.find((p) => p.playerId === owner);
  if (player?.isBot) return null;
  return player ? player.skins?.[id] || null : ownerId === undefined || owner != null && owner === state?.me?.playerId ? entries?.[id] || null : null;
}
