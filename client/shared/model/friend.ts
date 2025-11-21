import { getGlobalSocket } from '../api/socket';

export interface FriendRequest {
  _id: string;
  from: string;
  to: string;
  message: string;
}

/**
 * 发送好友请求
 * @param targetId 目标用户id
 */
export async function addFriendRequest(
  targetId: string
): Promise<FriendRequest> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  return await socket.request<FriendRequest>('friend.request.add', {
    to: targetId,
  });
}

/**
 * 同意好友请求
 * @param requestId 好友请求ID
 */
export async function acceptFriendRequest(requestId: string): Promise<void> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  await socket.request('friend.request.accept', { requestId });
}

/**
 * 拒绝好友请求
 * @param requestId 好友请求ID
 */
export async function denyFriendRequest(requestId: string): Promise<void> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  await socket.request('friend.request.deny', { requestId });
}

/**
 * 取消好友请求
 * @param requestId 好友请求ID
 */
export async function cancelFriendRequest(requestId: string): Promise<void> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  await socket.request('friend.request.cancel', { requestId });
}

/**
 * 移除好友(单项)
 */
export async function removeFriend(friendUserId: string): Promise<void> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  await socket.request('friend.removeFriend', { friendUserId });
}

/**
 * 设置好友昵称
 */
export async function setFriendNickname(
  targetId: string,
  nickname: string
): Promise<void> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  await socket.request('friend.setFriendNickname', { targetId, nickname });
}
