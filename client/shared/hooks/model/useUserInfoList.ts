import { getCachedUserInfo } from '../../cache/cache';
import type { UserBaseInfo } from '../../model/user';
import { useAsync } from '../useAsync';

/**
 * 用户信息列表
 */
export function useUserInfoList(userIds: Array<string | { _id?: string; id?: string; userId?: string } | any> = []): UserBaseInfo[] {
  const { value: userInfoList = [] } = useAsync(async () => {
    const users = await Promise.all(userIds.map((id) => getCachedUserInfo(id)));
    // 容错：过滤已删除/不存在的用户，避免下游读取 null._id 报错
    return users.filter((u): u is UserBaseInfo => !!u && !!(u as any)._id);
  }, [userIds.map((x) => (typeof x === 'string' ? x : (x?._id || x?.id || x?.userId || ''))).join(',')]);

  return userInfoList;
}
