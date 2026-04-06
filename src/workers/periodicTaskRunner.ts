import { logger } from "../logger/logger.js";

export interface PeriodicTaskRunnerOptions {
  name: string;
  intervalMs: number;
  task: () => Promise<void>;
  runImmediately?: boolean;
  failureBackoffMs?: number;
  maxFailureBackoffMs?: number;
}

export class PeriodicTaskRunner {
  private loopPromise: Promise<void> | null = null;
  private stopRequested = false;
  private activeTimer: NodeJS.Timeout | null = null;
  private pendingSleepResolve: (() => void) | null = null;

  public constructor(private readonly options: PeriodicTaskRunnerOptions) {}

  public start(): void {
    if (this.loopPromise) {
      return;
    }

    this.stopRequested = false;
    this.loopPromise = this.loop();
  }

  public async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.pendingSleepResolve) {
      this.pendingSleepResolve();
      this.pendingSleepResolve = null;
    }
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  private async loop(): Promise<void> {
    logger.info("Starting background task runner.", {
      task: this.options.name,
      intervalMs: this.options.intervalMs
    });

    let consecutiveFailures = 0;
    let delayMs = this.options.runImmediately ?? true ? 0 : this.options.intervalMs;

    while (!this.stopRequested) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          this.pendingSleepResolve = resolve;
          this.activeTimer = setTimeout(() => {
            this.activeTimer = null;
            this.pendingSleepResolve = null;
            resolve();
          }, delayMs);
        });
      }

      if (this.stopRequested) {
        break;
      }

      const startedAt = Date.now();

      try {
        await this.options.task();
        consecutiveFailures = 0;
        const elapsed = Date.now() - startedAt;
        delayMs = Math.max(0, this.options.intervalMs - elapsed);
      } catch (error) {
        consecutiveFailures += 1;
        logger.error("Background task runner iteration failed.", {
          task: this.options.name,
          consecutiveFailures,
          error: error instanceof Error ? error.message : "unknown_error"
        });
        delayMs = this.nextDelay(consecutiveFailures);
      }
    }

    logger.info("Stopped background task runner.", {
      task: this.options.name
    });
  }

  private nextDelay(consecutiveFailures: number): number {
    if (consecutiveFailures === 0) {
      return this.options.intervalMs;
    }

    const failureBackoffMs = this.options.failureBackoffMs ?? Math.min(this.options.intervalMs, 5_000);
    const maxFailureBackoffMs =
      this.options.maxFailureBackoffMs ?? Math.max(this.options.intervalMs, failureBackoffMs);

    return Math.min(failureBackoffMs * 2 ** (consecutiveFailures - 1), maxFailureBackoffMs);
  }
}
