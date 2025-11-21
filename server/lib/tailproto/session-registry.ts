import { computeAuthKeyId } from './crypto';
const Redis = require('ioredis');
const { LRUCache } = require('lru-cache');

export interface TailProtoSession {
  socketId: string;
  userId?: string;
  authKey: Buffer;
  authKeyId: string;
  kv: number; // key version
  oldKey?: Buffer;
  oldKeyCreatedAt?: number;
  oldKeyHits?: number;
  oldKeyFirstHitAt?: number;
  rekeyDeadlineTs?: number;
  lastSeq: number;
  kvTs: number;
}

class SessionRegistry {
  private redis: any;
  private keyPrefix = 'tailchat:session:';
  private cache: any;
  private cacheTTL = 30000; // 30 seconds
  private isRedisHealthy = true;
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  constructor(redis?: any) {
    this.redis = redis || new Redis(process.env.TRANSPORTER || 'redis://redis:6379', {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    
    // Initialize LRU cache for read performance
    this.cache = new LRUCache({
      max: 1000, // Max 1000 sessions in cache
      ttl: this.cacheTTL,
    });

    // Setup Redis error handling
    this.redis.on('error', (err) => {
      console.error('[TailProtoSessionRegistry] Redis error:', err);
      this.isRedisHealthy = false;
    });

    this.redis.on('connect', () => {
      console.log('[TailProtoSessionRegistry] Redis connected');
      this.isRedisHealthy = true;
    });

    // Start health check
    this.startHealthCheck().catch(err => {
      console.error('[TailProtoSessionRegistry] Failed to start health check:', err);
    });
  }

  private async startHealthCheck() {
    const checkHealth = async () => {
      try {
        await this.redis.ping();
        this.isRedisHealthy = true;
      } catch (err) {
        console.error('[TailProtoSessionRegistry] Health check failed:', err);
        this.isRedisHealthy = false;
      }
    };

    // Check health every 30 seconds
    this.healthCheckInterval = setInterval(checkHealth, 30000);
    
    // Initial health check
    await checkHealth();
  }

  private async withRedisFallback<T>(operation: () => Promise<T>, fallback: () => T): Promise<T> {
    if (!this.isRedisHealthy) {
      console.warn('[TailProtoSessionRegistry] Redis unhealthy, using fallback');
      return fallback();
    }
    
    try {
      return await operation();
    } catch (err) {
      console.error('[TailProtoSessionRegistry] Redis operation failed:', err);
      this.isRedisHealthy = false;
      return fallback();
    }
  }

  private getSessionKey(socketId: string): string {
    return `${this.keyPrefix}${socketId}`;
  }

  private serializeSession(session: TailProtoSession): string {
    return JSON.stringify({
      ...session,
      authKey: session.authKey.toString('base64'),
      oldKey: session.oldKey ? session.oldKey.toString('base64') : undefined,
    });
  }

  private deserializeSession(data: string): TailProtoSession {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      authKey: Buffer.from(parsed.authKey, 'base64'),
      oldKey: parsed.oldKey ? Buffer.from(parsed.oldKey, 'base64') : undefined,
    };
  }

  async create(params: { socketId: string; userId?: string; authKey: Buffer; kv?: number }): Promise<TailProtoSession> {
    const kv = typeof params.kv === 'number' ? params.kv : 1;
    const s: TailProtoSession = {
      socketId: params.socketId,
      userId: params.userId,
      authKey: params.authKey,
      authKeyId: computeAuthKeyId(params.authKey),
      kv,
      lastSeq: 0,
      kvTs: Date.now(),
    };
    
    await this.withRedisFallback(
      async () => {
        await this.redis.setex(
          this.getSessionKey(params.socketId),
          7 * 24 * 60 * 60, // 7天过期
          this.serializeSession(s)
        );
        this.cache.set(params.socketId, s);
        return s;
      },
      () => {
        // Fallback: store in cache only
        this.cache.set(params.socketId, s);
        return s;
      }
    );
    
    return s;
  }

  async get(socketId: string): Promise<TailProtoSession | undefined> {
    // Check cache first
    const cached = this.cache.get(socketId);
    if (cached) {
      return cached;
    }

    return this.withRedisFallback(
      async () => {
        const data = await this.redis.get(this.getSessionKey(socketId));
        if (data) {
          const session = this.deserializeSession(data);
          this.cache.set(socketId, session);
          return session;
        }
        return undefined;
      },
      () => {
        // Fallback: return undefined if not in cache
        return undefined;
      }
    );
  }

  async rotate(socketId: string, newKey: Buffer): Promise<TailProtoSession | undefined> {
    const s = await this.get(socketId);
    if (!s) return undefined;
    
    s.oldKey = s.authKey;
    s.oldKeyCreatedAt = Date.now();
    s.oldKeyHits = 0;
    s.oldKeyFirstHitAt = undefined;
    s.authKey = newKey;
    s.authKeyId = computeAuthKeyId(newKey);
    s.kv += 1;
    s.kvTs = Date.now();
    
    await this.withRedisFallback(
      async () => {
        await this.redis.setex(
          this.getSessionKey(socketId),
          7 * 24 * 60 * 60,
          this.serializeSession(s)
        );
        this.cache.set(socketId, s);
        return s;
      },
      () => {
        // Fallback: update cache only
        this.cache.set(socketId, s);
        return s;
      }
    );
    
    return s;
  }

  async destroyOldKey(socketId: string): Promise<boolean> {
    const s = await this.get(socketId);
    if (!s || !s.oldKey) return false;
    
    s.oldKey = undefined;
    s.oldKeyCreatedAt = undefined;
    s.oldKeyHits = undefined;
    s.oldKeyFirstHitAt = undefined;
    
    await this.withRedisFallback(
      async () => {
        await this.redis.setex(
          this.getSessionKey(socketId),
          7 * 24 * 60 * 60,
          this.serializeSession(s)
        );
        this.cache.set(socketId, s);
        return true;
      },
      () => {
        // Fallback: update cache only
        this.cache.set(socketId, s);
        return true;
      }
    );
    
    return true;
  }

  async destroy(socketId: string): Promise<void> {
    this.cache.delete(socketId);
    
    await this.withRedisFallback(
      async () => {
        await this.redis.del(this.getSessionKey(socketId));
      },
      () => {
        // Fallback: cache already cleared
      }
    );
  }

  async size(): Promise<number> {
    return this.withRedisFallback(
      async () => {
        const keys = await this.redis.keys(`${this.keyPrefix}*`);
        return keys.length;
      },
      () => {
        // Fallback: return cache size
        return this.cache.size;
      }
    );
  }

  // Clean up method for graceful shutdown
  async cleanup(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

export const TailProtoSessionRegistry = new SessionRegistry();


