import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/repositories/inMemoryStore.js";
import { AdminDraftService } from "../../src/services/adminDraftService.js";

describe("AdminDraftService", () => {
  it("persists and clears admin drafts through the settings store", async () => {
    const store = new InMemoryStore();
    const service = new AdminDraftService(store);
    const adminId = 1n;

    await service.setDraft(adminId, {
      kind: "edit_title",
      productId: "product-1"
    });

    await expect(service.getDraft(adminId)).resolves.toEqual({
      kind: "edit_title",
      productId: "product-1"
    });

    await service.clearDraft(adminId);

    await expect(service.getDraft(adminId)).resolves.toBeNull();
  });

  it("drops invalid persisted drafts instead of trusting corrupted JSON", async () => {
    const store = new InMemoryStore();
    const service = new AdminDraftService(store);
    const adminId = 2n;

    await store.settings.set(`admin_draft:${adminId.toString()}`, {
      kind: "edit_price"
    });

    await expect(service.getDraft(adminId)).resolves.toBeNull();
    await expect(store.settings.get(`admin_draft:${adminId.toString()}`)).resolves.toBeNull();
  });
});
