import { getReduxStore, isValidStr } from '..';
import { getCachedConverseInfo, getCachedUserInfo } from '../cache/cache';
import { t } from '../i18n';
import type { ChatConverseInfo } from '../model/converse';
// 不再在“确保会话存在”时自动把会话加入 dmlist，
// 让侧栏显隐仅由用户主动行为（发送消息/显式添加）驱动
import type { FriendInfo } from '../redux/slices/user';

/**
 * 确保私信会话存在
 */
export async function ensureDMConverse(
  converseId: string,
  currentUserId: string
): Promise<ChatConverseInfo> {
  const converse = await getCachedConverseInfo(converseId);
  if (converse === null) {
    // TODO
    throw new Error(t('找不到私信会话'));
  }

  if (!converse.members.includes(currentUserId)) {
    throw new Error(t('会话没有权限'));
  }

  return converse;
}

export function buildFriendNicknameMap(
  friends: FriendInfo[]
): Record<string, string> {
  const friendNicknameMap: Record<string, string> = friends.reduce(
    (prev, curr) => {
      return {
        ...prev,
        [curr.id]: curr.nickname,
      };
    },
    {}
  );

  return friendNicknameMap;
}

/**
 * 获取私信会话的会话名
 * @param userId 当前用户的ID(即自己)
 * @param converse 会话信息
 */
export async function getDMConverseName(
  userId: string,
  converse: Pick<ChatConverseInfo, 'name' | 'members'>
): Promise<string> {
  if (isValidStr(converse.name)) {
    return converse.name;
  }

  const otherConverseMembers = converse.members.filter((m) => m !== userId); // 成员Id
  const otherMembersInfo = (
    await Promise.all(
      otherConverseMembers.map((memberId) => getCachedUserInfo(memberId))
    )
  ).filter((m): m is any => !!m && !!m._id);
  const friends = getReduxStore().getState().user.friends;
  const friendNicknameMap = buildFriendNicknameMap(friends);

  const memberNicknames = otherMembersInfo.map((m) => {
    if (!m || !m._id) {
      return t('已删除用户');
    }
    if (friendNicknameMap[m._id]) {
      return friendNicknameMap[m._id];
    }
    return m.nickname ?? t('已删除用户');
  });
  const len = memberNicknames.length;

  if (len === 0) {
    return t('已失效会话');
  } else if (len === 1) {
    return memberNicknames[0] ?? t('已删除用户');
  } else if (len === 2) {
    return `${memberNicknames[0]}, ${memberNicknames[1]}`;
  } else {
    return `${memberNicknames[0]}, ${memberNicknames[1]} ...`;
  }
}
