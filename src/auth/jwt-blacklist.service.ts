import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';

/**
 * US-015 – JWT immediate revocation via Redis blacklist.
 *
 * On logout, the token's (sub, iat) pair is stored in Redis with a TTL equal
 * to the remaining validity window of the token.  JwtStrategy checks the
 * blacklist on every authenticated request.
 */
@Injectable()
export class JwtBlacklistService implements OnModuleDestroy {
  private readonly logger = new Logger(JwtBlacklistService.name);
  private readonly redis: IORedis;

  constructor() {
    this.redis = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.redis.on('error', (err: Error) => {
      this.logger.warn(`Redis blacklist connection error: ${err.message}`);
    });
  }

  private key(sub: string, iat: number): string {
    return `jwt:bl:${sub}:${iat}`;
  }

  /**
   * Add a token to the blacklist.
   * @param sub   Subject (accountId) from JWT payload.
   * @param iat   Issued-at timestamp (seconds since epoch).
   * @param exp   Expiry timestamp (seconds since epoch).
   */
  async revoke(sub: string, iat: number, exp: number): Promise<void> {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // already expired, nothing to store
    try {
      await this.redis.set(this.key(sub, iat), '1', 'EX', ttl);
    } catch (err) {
      this.logger.error(`Failed to blacklist token: ${String(err)}`);
    }
  }

  /**
   * Returns true when the (sub, iat) pair has been revoked.
   */
  async isRevoked(sub: string, iat: number): Promise<boolean> {
    try {
      const result = await this.redis.get(this.key(sub, iat));
      return result !== null;
    } catch {
      // On Redis failure, fail-open to avoid locking out all users.
      return false;
    }
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
