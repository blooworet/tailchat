import { getGlobalSocket } from '../api/socket';

/**
 * 群组好友邀请状态
 */
export enum GroupFriendInviteStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
  Expired = 'expired',
}

/**
 * 群组好友邀请接口
 */
export interface GroupFriendInvite {
  _id: string;
  groupId: {
    _id: string;
    name: string;
    avatar?: string;
    memberCount?: number;
  };
  inviter: {
    _id: string;
    nickname: string;
    avatar?: string;
  };
  invitee: {
    _id: string;
    nickname: string;
    avatar?: string;
  };
  message?: string;
  status: GroupFriendInviteStatus;
  expiredAt: string;
  handledAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 邀请好友加入群组
 */
export async function inviteFriendToGroup(
  groupId: string,
  friendId: string,
  message?: string
): Promise<GroupFriendInvite> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  return await socket.request<GroupFriendInvite>('group.friendInvite.inviteFriendToGroup', {
    groupId,
    friendId,
    message,
  });
}

/**
 * 处理群组邀请
 */
export async function handleGroupInvite(
  inviteId: string,
  action: 'accept' | 'reject'
): Promise<void> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  try { await (socket as any).waitReady?.(); } catch {}
  await socket.request('group.friendInvite.handleGroupInvite', { inviteId, action });
}

/**
 * 获取用户收到的群组邀请
 */
export async function getUserReceivedInvites(): Promise<GroupFriendInvite[]> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  const list = await socket.request<GroupFriendInvite[]>('group.friendInvite.getUserReceivedInvites');
  return Array.isArray(list) ? list : [];
}

/**
 * 获取用户发出的群组邀请
 */
export async function getUserSentInvites(): Promise<GroupFriendInvite[]> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  const list = await socket.request<GroupFriendInvite[]>('group.friendInvite.getUserSentInvites');
  return Array.isArray(list) ? list : [];
}

/**
 * 根据ID获取群组邀请
 */
export async function getGroupInviteById(
  inviteId: string
): Promise<GroupFriendInvite | null> {
  const socket = getGlobalSocket();
  if (!socket) throw new Error('Socket not ready');
  return await socket.request<GroupFriendInvite | null>('group.friendInvite.getGroupInviteById', { inviteId });
}
