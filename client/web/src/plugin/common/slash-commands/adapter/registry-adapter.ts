import { getSlashCommandRegistry } from '../registry';
import type { CommandSetDTO } from '../types';
import type { SlashCommand } from 'tailchat-shared/types/command';

const registry = getSlashCommandRegistry();

export function syncToRegistry(dtos: CommandSetDTO[]) {
  for (const dto of dtos) {
    if (dto.notModified || !dto.userId || !dto.appId || !dto.commands) continue;
    const source = `bot:${dto.appId}:${dto.userId}`;

    // unregister existing of same source by names
    // naive approach: try unregister by `${name}:${source}` if present
    for (const cmd of dto.commands) {
      registry.unregister(`${cmd.command}:${source}`);
    }

    const batch: Array<{ command: SlashCommand; options?: any }> = [];
    for (const cmd of dto.commands) {
      const sc: SlashCommand = {
        name: cmd.command,
        label: `/${cmd.command}`,
        description: cmd.description,
        icon: 'mdi:robot',
        type: 'bot',
        category: 'bot',
        priority: 40,
        scope: cmd.scope as any,
        botId: dto.appId as any,
        botName: dto.appName as any,
        botUserId: dto.userId as any,
        handler: () => Promise.resolve({ success: false, shouldSend: false, content: '' }),
      } as any;
      batch.push({ command: sc, options: { source } });
    }
    registry.batchRegister(batch);
  }
}
