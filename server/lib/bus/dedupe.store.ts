import type Redis from 'ioredis';

export async function dedupeHit(redis: Redis.Redis, key: string, ttlSec: number = 300): Promise<boolean> {
  try {
    const ok = await redis.set(`tp:dedupe:${key}`, '1', 'EX', ttlSec, 'NX');
    return ok !== 'OK';
  } catch {
    return false;
  }
}


