import { getGlobalSocket } from '../api/socket';
import {
  createAutoMergedRequest,
  createAutoSplitRequest,
} from '../utils/request';
import _uniq from 'lodash/uniq';
import _flatten from 'lodash/flatten';
import _zipObject from 'lodash/zipObject';

export enum ChatConverseType {
  DM = 'DM', // 单人会话
  Multi = 'Multi', // 多人会话
  Group = 'Group', // 群组会话(暂时无用)
}

export interface ChatConverseInfo {
  _id: string;
  name: string;
  type: ChatConverseType;
  members: string[];
}

/**
 * 尝试创建私聊会话
 * 如果已创建则返回之前的
 */
export async function createDMConverse(
  memberIds: string[]
): Promise<ChatConverseInfo> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  return await socket.request<ChatConverseInfo>('chat.converse.createDMConverse', { memberIds });
}

/**
 * 在多人会话中添加成员
 */
export async function appendDMConverseMembers(
  converseId: string,
  memberIds: string[]
) {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  return await socket.request<any>('chat.converse.appendDMConverseMembers', { converseId, memberIds });
}

/**
 * 获取会话信息
 * @param converseId 会话ID
 */
export async function fetchConverseInfo(
  converseId: string
): Promise<ChatConverseInfo> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  
  // 调试信息 - 临时移除
  // console.debug('[fetchConverseInfo] Socket status:', ...);
  
  return await socket.request<ChatConverseInfo>('chat.converse.findConverseInfo', { converseId });
}

/**
 * 更新会话已读
 * @param converseId 会话ID
 * @param lastMessageId 最后一条消息ID
 */
export async function updateAck(converseId: string, lastMessageId: string) {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  await socket.request('chat.ack.update', { converseId, lastMessageId });
}

interface AckInfo {
  userId: string;
  converseId: string;
  lastMessageId: string;
}

/**
 * 获取用户存储在远程的会话信息
 */
export async function fetchUserAck(): Promise<AckInfo[]> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  const data = await socket.request<any[]>('chat.ack.all');
  if (!Array.isArray(data)) {
    return [];
  }

  return data;
}

/**
 * 获取用户存储在远程的会话信息
 */
export async function fetchUserAckList(
  converseIds: string[]
): Promise<(AckInfo | null)[]> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  const data = await socket.request<(AckInfo | null)[]>('chat.ack.list', { converseIds });
  if (!Array.isArray(data)) {
    return [];
  }

  return data;
}

/**
 * 获取某个会话内其他成员的已读信息
 */
export async function fetchConverseMemberAcks(
  converseId: string
): Promise<AckInfo[]> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  const data = await socket.request<AckInfo[]>('chat.ack.converse', { converseId });
  if (!Array.isArray(data)) {
    return [];
  }

  return data;
}

const _fetchConverseAckInfo = createAutoMergedRequest<
  string[],
  (AckInfo | null)[]
>(
  createAutoSplitRequest(
    async (converseIdsList) => {
      const uniqList = _uniq(_flatten(converseIdsList));
      const infoList = await fetchUserAckList(uniqList);

      const map = _zipObject<AckInfo | null>(uniqList, infoList);

      // 将请求结果根据传输来源重新分组
      return converseIdsList.map((converseIds) =>
        converseIds.map((converseId) => map[converseId] ?? null)
      );
    },
    'serial',
    100
  )
);

/**
 * 获取会话信息
 */
export async function getConverseAckInfo(
  converseIds: string[]
): Promise<(AckInfo | null)[]> {
  return _fetchConverseAckInfo(converseIds);
}
