import type { InboxStruct, MessageMetaStruct } from './chat';

export interface BotStartEventPayload {
  botUserId: string; // 目标机器人用户ID
  fromUserId: string; // 触发者用户ID
  converseId: string; // 私信会话ID
  timestamp: number; // 事件时间戳（ms）
  params?: Record<string, any>; // 可选参数，如 /start payload
}

/**
 * 默认服务的事件映射
 */
export interface BuiltinEventMap {
  'gateway.auth.addWhitelists': { urls: string[] };
  // 机器人私聊启动事件（/start）
  'bot.dm.start': BotStartEventPayload;
  'chat.message.updateMessage':
    | {
        type: 'add';
        groupId?: string;
        converseId: string;
        messageId: string;
        author: string;
        content: string;
        plain?: string;
        meta: MessageMetaStruct;
      }
    | {
        type: 'recall' | 'delete';
        groupId?: string;
        converseId: string;
        messageId: string;
        meta: MessageMetaStruct;
      }
    | {
        type: 'edit';
        groupId?: string;
        converseId: string;
        messageId: string;
        content?: string;
        meta: MessageMetaStruct;
      };
  'config.updated': { config: Record<string, any> };
  'chat.inbox.append': InboxStruct;
}
