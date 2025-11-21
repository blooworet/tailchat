import type Redis from 'ioredis';

export type SessionSnapshot = {
  authKeyId: string;
  kv: number;
  kvTs: number;
  lastSeq: number;
  userId?: string;
};

export async function writeSessionSnapshot(
  redis: Redis.Redis,
  socketId: string,
  snapshot: SessionSnapshot,
  ttlSec: number = 120
): Promise<void> {
  const key = `tp:sess:${socketId}`;
  try {
    await redis.set(key, JSON.stringify(snapshot), 'EX', ttlSec);
  } catch {}
}

export async function readSessionSnapshot(
  redis: Redis.Redis,
  socketId: string
): Promise<SessionSnapshot | null> {
  const key = `tp:sess:${socketId}`;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as SessionSnapshot;
  } catch {
    return null;
  }
}


