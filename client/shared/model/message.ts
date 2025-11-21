import { getOrCreateSocket } from '../api/socket';
import type { ChatMessageReaction, ChatMessage } from 'tailchat-types';
import {
  createAutoMergedRequest,
  createAutoSplitRequest,
} from '../utils/request';
import _uniq from 'lodash/uniq';
import _flatten from 'lodash/flatten';
import _zipObject from 'lodash/zipObject';

export type { ChatMessageReaction, ChatMessage };

export interface LocalChatMessage extends ChatMessage {
  /**
   * 本地添加消息的标识，用于标记该条消息尚未确定已经发送到服务端
   */
  isLocal?: boolean;
  /**
   * 判断是否发送失败
   */
  sendFailed?: boolean;
}

export interface SimpleMessagePayload {
  groupId?: string;
  converseId: string;
  content: string;
}

export interface SendMessagePayloadMeta {
  mentions?: string[];
  inlineAction?: {
    source?: string;
    traceId?: string;
    actionId?: string;
  };
  /**
   * 是否为端到端加密消息
   */
  e2ee?: boolean;
  // 音频消息相关元数据
  audio?: {
    url: string;
    duration: number;
    fileSize?: number;
    mimeType?: string;
    waveform?: number[]; // 音频波形数据，用于声纹显示
  };
}

export interface SendMessagePayload extends SimpleMessagePayload {
  /**
   * content的plain内容
   * 用于inbox
   */
  plain?: string;
  meta?: SendMessagePayloadMeta;
}

/**
 * 获取会话消息
 * @param converseId 会话ID
 * @param startId 开始ID
 */
export async function fetchConverseMessage(
  converseId: string,
  startId?: string
): Promise<ChatMessage[]> {
  const socket = await getOrCreateSocket();
  return await socket.request<ChatMessage[]>(
    'chat.message.fetchConverseMessage',
    { converseId, startId }
  );
}

/**
 * 发送消息
 * @param payload 消息体
 */
export async function sendMessage(
  payload: SendMessagePayload
): Promise<ChatMessage> {
  // E2EE: 若会话已启用加密，则在发送前对 content 加密并打标
  try {
    const { isE2EEEnabledForConverse, getRawKeyForConverse } = await import('../crypto/keychain');
    const { encryptStringWithRawKey } = await import('../crypto/e2ee');
    if (payload?.converseId && isE2EEEnabledForConverse(payload.converseId)) {
      const rawKey = getRawKeyForConverse(payload.converseId);
      if (rawKey) {
        const encrypted = await encryptStringWithRawKey(rawKey, payload.content);
        payload = {
          ...payload,
          content: encrypted,
          // 加密消息不携带 plain，避免泄露
          plain: undefined,
          meta: {
            ...(payload.meta ?? {}),
            e2ee: true,
          },
        };
      }
    }
  } catch (e) {
    // 加密异常不阻断发送，保底走明文
    // 可按需在此处上报或提示
  }

  try {
    const socket = await getOrCreateSocket();
    const data = await socket.request<ChatMessage>('chat.message.sendMessage', payload);
    return data;
  } catch (e) {
    // 检测身份认证错误
    const errorMsg = String((e as any)?.message || e || '');
    if (errorMsg.includes('undefined') && errorMsg.includes('_id')) {
      // 可能是认证丢失导致的
      throw new Error('认证已失效，请刷新页面重新连接');
    }
    throw e;
  }
}

/**
 * 撤回消息
 * @param messageId 消息ID
 */
export async function recallMessage(messageId: string): Promise<ChatMessage> {
  const socket = await getOrCreateSocket();
  return await socket.request<ChatMessage>('chat.message.recallMessage', { messageId });
}

/**
 * 编辑消息
 * @param messageId 消息ID
 * @param content 新的消息内容
 * @param meta 新的消息元数据
 */
export async function editMessage(
  messageId: string,
  content?: string,
  meta?: Record<string, unknown>
): Promise<ChatMessage> {
  let nextContent = content;
  let nextMeta: Record<string, unknown> | undefined = meta;
  try {
    if (content) {
      const { getRawKeyForConverse, isE2EEEnabledForConverse } = await import('../crypto/keychain');
      // 编辑消息不易获取 converseId，这里仅在调用方已在 meta 中打标时重新加密
      if ((meta as any)?.converseId && isE2EEEnabledForConverse(String((meta as any).converseId))) {
        const rawKey = getRawKeyForConverse(String((meta as any).converseId));
        if (rawKey) {
          const { encryptStringWithRawKey } = await import('../crypto/e2ee');
          nextContent = await encryptStringWithRawKey(rawKey, content);
          nextMeta = { ...(meta ?? {}), e2ee: true };
        }
      }
    }
  } catch {}

  // 完全走 WS 加密通道
  const socket = await getOrCreateSocket();
  const data = await socket.request<ChatMessage>('chat.message.editMessage', {
    messageId,
    content: nextContent,
    meta: nextMeta,
  });
  return data;
}

export async function deleteMessage(messageId: string): Promise<boolean> {
  const socket = await getOrCreateSocket();
  return await socket.request<boolean>('chat.message.deleteMessage', { messageId });
}

/**
 * 搜索聊天记录
 * @param converseId 会话id
 * @param messageText 聊天文本
 */
export async function searchMessage(
  text: string,
  converseId: string,
  groupId?: string
): Promise<ChatMessage[]> {
  const socket = await getOrCreateSocket();
  return await socket.request<ChatMessage[]>('chat.message.searchMessage', {
    text,
    converseId,
    groupId,
  });
}

interface LastMessageInfo {
  converseId: string;
  lastMessageId: string;
}

/**
 * 基于会话id获取会话最后一条消息的id
 */
async function fetchConverseLastMessages(
  converseIds: string[]
): Promise<{ converseId: string; lastMessageId: string }[]> {
  const socket = await getOrCreateSocket();
  return await socket.request<{ converseId: string; lastMessageId: string }[]>(
    'chat.message.fetchConverseLastMessages',
    { converseIds }
  );
}

export const _fetchConverseLastMessageInfo = createAutoMergedRequest<
  string[],
  (LastMessageInfo | null)[]
>(
  createAutoSplitRequest(
    async (converseIdsList) => {
      const uniqList = _uniq(_flatten(converseIdsList));
      const infoList = await fetchConverseLastMessages(uniqList);

      const map = _zipObject<LastMessageInfo | null>(uniqList, infoList);

      // 将请求结果根据传输来源重新分组
      return converseIdsList.map((converseIds) =>
        converseIds.map((converseId) => map[converseId] ?? null)
      );
    },
    'serial',
    100
  )
);
export function getConverseLastMessageInfo(converseIds: string[]) {
  return _fetchConverseLastMessageInfo(converseIds);
}

/**
 * @param converseId 会话ID
 * @param messageId 消息ID
 * @returns 消息附近的信息
 */
export async function fetchNearbyMessage(params: {
  groupId?: string;
  converseId: string;
  messageId: string;
}): Promise<ChatMessage[]> {
  const socket = await getOrCreateSocket();
  return await socket.request<ChatMessage[]>(
    'chat.message.fetchNearbyMessage',
    params
  );
}

/**
 * 增加表情行为
 */
export async function addReaction(
  messageId: string,
  emoji: string
): Promise<boolean> {
  const socket = await getOrCreateSocket();
  return await socket.request<boolean>('chat.message.addReaction', { messageId, emoji });
}

/**
 * 移除表情行为
 */
export async function removeReaction(
  messageId: string,
  emoji: string
): Promise<boolean> {
  const socket = await getOrCreateSocket();
  return await socket.request<boolean>('chat.message.removeReaction', { messageId, emoji });
}

/**
 * 音频消息相关辅助函数
 */

/**
 * 判断消息是否为音频消息
 * @param message 聊天消息对象
 * @returns 是否为音频消息
 */
export function isAudioMessage(message: ChatMessage): boolean {
  return !!(message.meta?.audio && message.content.includes('[card') && message.content.includes('type="audio"'));
}

/**
 * 从音频消息中提取音频信息
 * @param message 音频消息对象
 * @returns 音频信息或null
 */
export function extractAudioInfo(message: ChatMessage): {
  url: string;
  duration: number;
  fileSize?: number;
  mimeType?: string;
  waveform?: number[];
} | null {
  if (!isAudioMessage(message)) {
    return null;
  }

  const audioMeta = message.meta?.audio;
  if (!audioMeta) {
    // 尝试从content中解析（兼容BBCode格式）
    const match = message.content.match(/\[card[^>]*url="([^"]*)"[^>]*duration="([^"]*)"[^>]*\]/);
    if (match) {
      return {
        url: match[1],
        duration: parseInt(match[2]) || 0,
      };
    }
    return null;
  }

  return {
    url: audioMeta.url,
    duration: audioMeta.duration,
    fileSize: audioMeta.fileSize,
    mimeType: audioMeta.mimeType,
    waveform: audioMeta.waveform,
  };
}

/**
 * 格式化音频消息的显示文本
 * @param duration 音频时长（秒）
 * @returns 格式化后的显示文本
 */
export function formatAudioMessageText(duration: number): string {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  
  if (minutes > 0) {
    return `语音消息 ${minutes}分${seconds}秒`;
  } else {
    return `语音消息 ${seconds}秒`;
  }
}

/**
 * 提取音频消息的波形数据
 * @param message 音频消息对象
 * @returns 波形数据数组或null
 */
export function extractWaveformData(message: ChatMessage): number[] | null {
  if (!isAudioMessage(message)) {
    return null;
  }

  const audioMeta = message.meta?.audio;
  if (audioMeta?.waveform && Array.isArray(audioMeta.waveform)) {
    return audioMeta.waveform;
  }

  // 尝试从BBCode内容中解析波形数据
  const waveformMatch = message.content.match(/waveform="([^"]*)"/);
  if (waveformMatch && waveformMatch[1]) {
    try {
      const waveformData = JSON.parse(waveformMatch[1]);
      if (Array.isArray(waveformData)) {
        return waveformData;
      }
    } catch (error) {
      console.warn('Failed to parse waveform data from BBCode:', error);
    }
  }

  return null;
}

/**
 * 验证音频消息的完整性
 * @param message 音频消息对象
 * @returns 验证结果
 */
export function validateAudioMessage(message: ChatMessage): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!isAudioMessage(message)) {
    errors.push('不是有效的音频消息');
    return { isValid: false, errors };
  }

  const audioInfo = extractAudioInfo(message);
  if (!audioInfo) {
    errors.push('缺少音频元数据');
    return { isValid: false, errors };
  }

  // 验证URL
  if (!audioInfo.url || typeof audioInfo.url !== 'string') {
    errors.push('音频URL无效');
  }

  // 验证时长
  if (typeof audioInfo.duration !== 'number' || audioInfo.duration <= 0) {
    errors.push('音频时长无效');
  }

  // 验证文件大小（如果提供）
  if (audioInfo.fileSize !== undefined && 
      (typeof audioInfo.fileSize !== 'number' || audioInfo.fileSize <= 0)) {
    errors.push('音频文件大小无效');
  }

  // 验证波形数据（如果提供）
  const waveformData = extractWaveformData(message);
  if (waveformData !== null) {
    if (!Array.isArray(waveformData) || waveformData.length === 0) {
      errors.push('波形数据格式无效');
    } else if (waveformData.some(val => typeof val !== 'number' || val < 0 || val > 31)) {
      errors.push('波形数据值超出有效范围（0-31）');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
