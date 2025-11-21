import type { CacheEntry } from '../types';

// key: `${converseId}#${botUserId}#${scopeKey}`
class CommandStoreImpl {
  private map = new Map<string, CacheEntry>();
  private dirty = new Set<string>();

  makeKey(converseId: string, botUserId: string, scopeKey: string): string {
    return `${converseId}#${botUserId}#${scopeKey}`;
    }

  get(key: string): CacheEntry | undefined {
    return this.map.get(key);
  }

  set(key: string, entry: CacheEntry): void {
    this.map.set(key, entry);
    this.dirty.delete(key);
  }

  markDirtyByBot(converseId: string, botUserId: string): void {
    const prefix = `${converseId}#${botUserId}#`;
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) this.dirty.add(k);
    }
  }

  isDirty(key: string): boolean {
    return this.dirty.has(key);
  }
}

export const CommandStore = new CommandStoreImpl();
