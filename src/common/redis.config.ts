import type { RedisOptions } from 'ioredis';

function envValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function buildRedisOptions(overrides: RedisOptions = {}): RedisOptions {
  const redisUrl = process.env.REDIS_URL?.trim();
  const envUsername = envValue('REDIS_USERNAME', 'REDIS_USER');
  const envPassword = envValue('REDIS_PASSWORD', 'REDIS_PASS');

  if (redisUrl) {
    const parsed = new URL(redisUrl);
    const db = parsed.pathname.replace('/', '');
    const username = parsed.username
      ? decodeURIComponent(parsed.username)
      : envUsername;
    const password = parsed.password
      ? decodeURIComponent(parsed.password)
      : envPassword;

    return {
      host: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
      username,
      password,
      db: db ? Number.parseInt(db, 10) : undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
      ...overrides,
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    username: envUsername,
    password: envPassword,
    maxRetriesPerRequest: null,
    ...overrides,
  };
}
