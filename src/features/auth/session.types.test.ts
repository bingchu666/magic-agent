import { describe, expect, it } from "vitest";
import { supabaseUserToSessionUser } from "@/features/auth/session.types";
import type { User } from "@supabase/supabase-js";

function userWithMetadata(metadata: Record<string, unknown>) {
  return {
    id: "user_1",
    email: "person@example.com",
    user_metadata: metadata,
  } as User;
}

describe("supabaseUserToSessionUser", () => {
  it("does not grant admin access from user-editable metadata", () => {
    const session = supabaseUserToSessionUser(userWithMetadata({ role: "admin" }));
    expect(session.role).toBe("user");
  });

  it("uses the database profile as the trusted role source", () => {
    const session = supabaseUserToSessionUser(
      userWithMetadata({ role: "user", name: "Metadata name" }),
      { role: "admin", name: "Profile name", locale: "en" }
    );
    expect(session).toMatchObject({
      id: "user_1",
      role: "admin",
      name: "Profile name",
      locale: "en",
    });
  });
});
