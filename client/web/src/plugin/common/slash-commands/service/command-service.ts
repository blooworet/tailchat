import { CommandStore } from '../store/command-store';
import type { CommandSetDTO } from '../types';
import { getGlobalSocket } from '@/utils/global-state-helper';

export async function loadCommandsForBots(opts: {
  converseId: string;
  groupId?: string;
  botUserIds: string[];
  scopeKey: string;
}): Promise<CommandSetDTO[]> {
  const { converseId, groupId, botUserIds, scopeKey } = opts;
  let socket = getGlobalSocket();
  if (!socket || !socket.connected) {
    try {
      const mod: any = await import('tailchat-shared');
      socket = await mod.createSocket();
    } catch {
      return [];
    }
  }

  // optional If-* headers: we use a single version/etag for each bot key
  const results: CommandSetDTO[] = [];
  for (const uid of botUserIds) {
    const key = CommandStore.makeKey(converseId, uid, scopeKey);
    const cache = CommandStore.get(key);
    const payload: any = {
      botUserIds: [uid],
      converseId,
      groupId,
      ifVersion: cache?.version,
      ifEtag: cache?.etag,
    };
    try {
      const arr = await socket.request<CommandSetDTO[]>('openapi.app.getBotCommandsByUserIds', payload);
      const dto = arr && arr[0];
      if (!dto) continue;
      if (!dto.notModified && dto.commands) {
        CommandStore.set(key, {
          version: dto.version,
          etag: dto.etag,
          commands: dto.commands,
          ts: Date.now(),
        });
      }
      results.push(dto);
    } catch (e) {
      // swallow, keep old cache
    }
  }
  return results;
}
