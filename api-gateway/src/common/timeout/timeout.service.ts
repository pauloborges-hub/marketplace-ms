import { Injectable, Logger } from '@nestjs/common';
import { TimeoutOptions } from './timeout.interface';

@Injectable()
export class TimeoutService {
  private readonly logger = new Logger(TimeoutService.name);
  private readonly defaultOptions: TimeoutOptions = {
    timeout: 5000,
    retries: 3,
    backoffMultiplier: 2,
    maxBackoff: 30000,
  };

  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    options: Partial<TimeoutOptions> = {},
  ): Promise<T> {
    const config = { ...this.defaultOptions, ...options };

    return this.executeWithRetry(operation, config);
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: TimeoutOptions,
  ): Promise<T> {
    let lastError: Error;
    let delay = 1000;

    for (let attempt = 0; attempt <= options.retries; attempt++) {
      try {
        this.logger.debug(`Attempt ${attempt + 1}/${options.retries + 1}`);

        const result = await Promise.race([
          operation(),
          this.createTimeoutPromise(options.timeout),
        ]);

        if (attempt > 0) {
          this.logger.log(`Operation succeded on attempt ${attempt + 1}`);
        }

        return result as T;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Attempt ${attempt + 1} failed: ${lastError.message}`);

        if (attempt < options.retries) {
          await this.delay(delay);
          delay = Math.min(
            delay * options.backoffMultiplier,
            options.maxBackoff,
          );
        }
      }
    }

    this.logger.error(`All ${options.retries + 1} attemps failed`);

    throw lastError!;
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async executeWithCustomTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return Promise.race([operation(), this.createTimeoutPromise(timeoutMs)]);
  }
}
