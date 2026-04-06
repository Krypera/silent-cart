import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../../src/domain/errors.js";
import { createHarness } from "../helpers/harness.js";

describe("AdminAuthorizationService", () => {
  it("allows private chat admins and rejects others", async () => {
    const { adminAuthorizationService } = createHarness();
    await adminAuthorizationService.syncAllowlist();

    await expect(adminAuthorizationService.assertAdminPrivateChat(1n, "private")).resolves.toBeUndefined();
    await expect(adminAuthorizationService.assertAdminPrivateChat(2n, "private")).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    await expect(adminAuthorizationService.assertAdminPrivateChat(1n, "group")).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });
});
