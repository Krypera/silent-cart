import { UnauthorizedError } from "../domain/errors.js";
import type { SilentCartStore } from "../repositories/store.js";

export class AdminAuthorizationService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly envAllowlist: bigint[]
  ) {}

  public async syncAllowlist(): Promise<void> {
    await this.store.admins.syncAllowlist(this.envAllowlist);
  }

  public async assertAdminPrivateChat(userId: bigint, chatType: string): Promise<void> {
    if (chatType !== "private") {
      throw new UnauthorizedError("Admin actions are only allowed in a private chat with the bot.");
    }

    const isAllowed = this.envAllowlist.includes(userId) && (await this.store.admins.isKnownAdmin(userId));
    if (!isAllowed) {
      throw new UnauthorizedError("You are not authorized to use admin actions.");
    }
  }
}
