export interface ChatMessageReaction {
  name: string;
  author: string;
}

export interface InlineActionItem {
  id: string;
  type: 'command' | 'url' | 'invoke' | 'modal' | 'deeplink';
  label?: string;
  params?: Record<string, unknown>;
}

export interface InlineActionRange {
  offset: number;
  length: number;
  style?: string;
  actionId: string;
}

export interface InlineKeyboardRow {
  actions: string[];
  label?: string;
}

/**
 * 音频消息元数据接口
 */
export interface AudioMessageMeta {
  type: 'audio';
  url: string;
  duration: number; // 音频时长（秒）
  fileSize?: number; // 文件大小（字节）
  mimeType?: string; // MIME类型，如 'audio/webm', 'audio/mp4' 等
  waveform?: number[]; // 可选：音频波形数据，用于可视化
}

export interface MessageMeta {
  mentions?: string[];
  reply?: {
    _id: string;
    author: string;
    content: string;
  };
  inlineActions?: {
    actions: InlineActionItem[];
    ranges?: InlineActionRange[];
    keyboard?: InlineKeyboardRow[];
    scopes?: string[];
    signature?: string;
    analytics?: {
      traceId?: string;
    };
  };
  // 音频消息相关元数据
  audio?: AudioMessageMeta;
}

export interface ChatMessage {
  _id: string;

  content: string;

  author?: string;

  groupId?: string;

  converseId: string;

  reactions?: ChatMessageReaction[];

  hasRecall?: boolean;

  meta?: MessageMeta;

  createdAt?: string;

  updatedAt?: string;
}

export const chatConverseType = [
  'DM', // 私信
  'Multi', // 多人会话
  'Group', // 群组
] as const;

export type ChatConverseType = (typeof chatConverseType)[number];

export interface ChatConverse {
  _id: string;

  name?: string;

  type: ChatConverseType;

  members: string[];
}
