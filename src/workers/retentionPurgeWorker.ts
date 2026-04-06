import { RetentionService } from "../services/retentionService.js";

export class RetentionPurgeWorker {
  public constructor(private readonly retentionService: RetentionService) {}

  public async runOnce(): Promise<void> {
    await this.retentionService.purgeExpiredLinks(new Date());
  }
}
