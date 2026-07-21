import { Logger } from '@nestjs/common';

type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  name?: string;
}

/**
 * Circuit breaker sans dépendance externe.
 * States : closed (normal) → open (service KO) → half-open (test) → closed
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureAt: number | null = null;
  private readonly logger: Logger;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60_000;
    this.name = options.name ?? 'CircuitBreaker';
    this.logger = new Logger(this.name);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const elapsed = Date.now() - (this.lastFailureAt ?? 0);
      if (elapsed >= this.timeout) {
        this.state = 'half-open';
        this.successCount = 0;
        this.logger.warn('Circuit half-open — testing service');
      } else {
        const remaining = Math.ceil((this.timeout - elapsed) / 1000);
        throw new Error(
          `Service indisponible (circuit ouvert). Réessayez dans ${remaining}s.`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'closed';
        this.lastFailureAt = null;
        this.logger.log('Circuit closed — service recovered');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();
    if (
      this.state === 'half-open' ||
      this.failureCount >= this.failureThreshold
    ) {
      this.state = 'open';
      this.logger.error(
        `Circuit open after ${this.failureCount} failures — pausing ${this.timeout / 1000}s`,
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
