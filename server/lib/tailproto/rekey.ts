import type Redis from 'ioredis';
import type { TailProtoSession } from './session-registry';

export interface RekeySchedulerOptions {
  intervalMs: number;
  acceptOldMs: number;
}

type GetSessionFn = (socketId: string) => TailProtoSession | undefined;
type ClearOldKeyFn = (socketId: string) => void;
type SendRekeyFn = (userId: string) => Promise<void> | void;
type MetricFn = (name: string, labels?: Record<string, string | number>, value?: number) => void;

export class TailProtoRekeyScheduler {
  private timer: any = null;
  private sockets = new Map<string, { userId?: string }>();

  constructor(
    private redis: Redis.Redis,
    private getSession: GetSessionFn,
    private sendRekey: SendRekeyFn,
    private options: RekeySchedulerOptions,
    private metric?: MetricFn,
    private clearOldKey?: ClearOldKeyFn
  ) {}

  register(socketId: string, userId?: string) {
    this.sockets.set(socketId, { userId });
  }

  unregister(socketId: string) {
    this.sockets.delete(socketId);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    const now = Date.now();
    const interval = this.options.intervalMs;
    for (const [socketId, meta] of this.sockets) {
      const s = this.getSession(socketId);
      if (!s) continue;
      // 回收超窗旧钥（统一在调度器中进行，避免入站路径状态突变）
      try {
        const ageOk = s.oldKeyCreatedAt
          ? now - s.oldKeyCreatedAt > this.options.acceptOldMs
          : now - s.kvTs > this.options.acceptOldMs; // 兼容旧版本：无时间戳时回退按 kvTs
        if (s.oldKey && ageOk) {
          if (this.clearOldKey) this.clearOldKey(socketId);
          else { (s as any).oldKey = undefined; (s as any).oldKeyCreatedAt = undefined; }
          try { if (this.metric) this.metric('tailproto_oldkey_destroyed_total', { userId: s.userId || '' }, 1); } catch {}
        }
      } catch {}
      if (now - s.kvTs < interval) continue;
      const userId = meta.userId || s.userId;
      if (!userId) continue;
      try {
        const lockKey = `tp:rekey:lock:${userId}`;
        const ok = await this.redis.set(lockKey, '1', 'PX', 5000, 'NX');
        if (ok === 'OK') {
          try {
            await Promise.resolve(this.sendRekey(userId));
            if (this.metric) this.metric('tailproto_rekey_triggered', { userId });
          } catch {}
        }
      } catch {}
    }
  }
}


