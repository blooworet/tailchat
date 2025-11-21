import { useMemo } from 'react';
import { useAppSelector, useUserId } from 'tailchat-shared';

/**
 * 检查指定用户是否为当前用户的好友
 * @param userId 要检查的用户ID
 * @returns 是否为好友
 */
export function useIsFriend(userId: string): boolean {
  const friends = useAppSelector((state) => state.user.friends);
  
  return useMemo(() => {
    return friends.some((friend) => friend.id === userId);
  }, [friends, userId]);
}

/**
 * 检查DM对话中的其他用户是否都是好友
 * @param members 对话成员列表
 * @returns 是否所有其他成员都是好友
 */
export function useAreAllMembersFriends(members: string[]): boolean {
  const currentUserId = useUserId();
  const friends = useAppSelector((state) => state.user.friends);
  
  return useMemo(() => {
    if (!currentUserId) return true;
    
    // 获取除当前用户外的其他成员
    const otherMembers = members.filter(id => id !== currentUserId);
    
    // 检查是否所有其他成员都是好友
    return otherMembers.every(memberId => 
      friends.some(friend => friend.id === memberId)
    );
  }, [members, currentUserId, friends]);
}

/**
 * 获取DM对话中不是好友的用户列表
 * @param members 对话成员列表
 * @returns 不是好友的用户ID列表
 */
export function useNonFriendMembers(members: string[]): string[] {
  const currentUserId = useUserId();
  const friends = useAppSelector((state) => state.user.friends);
  
  return useMemo(() => {
    if (!currentUserId) return [];
    
    // 获取除当前用户外的其他成员
    const otherMembers = members.filter(id => id !== currentUserId);
    
    // 返回不是好友的成员
    return otherMembers.filter(memberId => 
      !friends.some(friend => friend.id === memberId)
    );
  }, [members, currentUserId, friends]);
}
