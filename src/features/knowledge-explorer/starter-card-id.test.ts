import { describe, expect, it } from "vitest";
import {
  LEGACY_STARTER_CARD_ID,
  starterCardIdForUser,
  shouldScopeLegacyStarter,
} from "@/features/knowledge-explorer/starter-card-id";

describe("starter card ids", () => {
  it("gives each authenticated user a stable unique starter id", () => {
    expect(starterCardIdForUser("user-a")).toBe("glass_starter_user-a");
    expect(starterCardIdForUser("user-b")).toBe("glass_starter_user-b");
    expect(starterCardIdForUser("user-a")).not.toBe(
      starterCardIdForUser("user-b")
    );
  });

  it("migrates only when the current account does not own the legacy row", () => {
    expect(shouldScopeLegacyStarter([LEGACY_STARTER_CARD_ID], [])).toBe(true);
    expect(
      shouldScopeLegacyStarter(
        [LEGACY_STARTER_CARD_ID],
        [LEGACY_STARTER_CARD_ID]
      )
    ).toBe(false);
  });
});
