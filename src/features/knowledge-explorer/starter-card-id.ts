export const LEGACY_STARTER_CARD_ID = "glass_starter";

export function starterCardIdForUser(userId?: string) {
  return userId
    ? `${LEGACY_STARTER_CARD_ID}_${userId}`
    : LEGACY_STARTER_CARD_ID;
}

export function isStarterCardId(cardId: string) {
  return (
    cardId === LEGACY_STARTER_CARD_ID ||
    cardId.startsWith(`${LEGACY_STARTER_CARD_ID}_`)
  );
}

export function shouldScopeLegacyStarter(
  localCardIds: string[],
  remoteCardIds: string[]
) {
  return (
    localCardIds.includes(LEGACY_STARTER_CARD_ID) &&
    !remoteCardIds.includes(LEGACY_STARTER_CARD_ID)
  );
}
