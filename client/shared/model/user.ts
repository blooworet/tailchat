import { getOrCreateSocket, getGlobalSocket, createSocket } from '../api/socket';
import { buildCachedRequest } from '../cache/utils';
import { sharedEvent } from '../event';
import { SYSTEM_USERID } from '../utils/consts';
import {
  createAutoMergedRequest,
  createAutoSplitRequest,
} from '../utils/request';
import _pick from 'lodash/pick';
import _uniq from 'lodash/uniq';
import _flatten from 'lodash/flatten';
import _zipObject from 'lodash/zipObject';
import { t } from '../i18n';
import type { UserBaseInfo } from 'tailchat-types';
import { isObjectId } from '../utils/string-helper';

export type { UserBaseInfo };

export interface UserLoginInfo extends UserBaseInfo {
  token: string;
  createdAt: string;
}

export interface UserSettings {
  /**
   * 消息列表虚拟化
   */
  messageListVirtualization?: boolean;

  /**
   * 消息通知免打扰(静音)
   */
  messageNotificationMuteList?: string[];

  /**
   * 群组排序, 内容为群组id
   */
  groupOrderList?: string[];

  /**
   * 是否关闭消息右键菜单
   */
  disableMessageContextMenu?: boolean;

  /**
   * 其他的设置项
   */
  [key: string]: any;
}

export function pickUserBaseInfo(userInfo: UserLoginInfo): UserBaseInfo {
  return _pick(userInfo, [
    'username',
    '_id',
    'email',
    'nickname',
    'discriminator',
    'avatar',
    'temporary',
    'type',
    'emailVerified',
    'banned',
  ]);
}

// 内置用户信息
const builtinUserInfo: Record<string, () => UserBaseInfo> = {
  [SYSTEM_USERID]: () => ({
    _id: SYSTEM_USERID,
    email: 'admin@msgbyte.com',
    nickname: t('系统'),
    discriminator: '0000',
    avatar: null,
    temporary: false,
    type: 'normalUser',
    emailVerified: false,
    banned: false,
  }),
  '': () => ({
    // dummy
    _id: '',
    email: '',
    nickname: '',
    discriminator: '0000',
    avatar: null,
    temporary: false,
    type: 'normalUser',
    emailVerified: false,
    banned: false,
  }),
};

/**
 * 用户私信列表
 */
export interface UserDMList {
  userId: string;
  converseIds: string[];
}

/**
 * 用户名登录
 * @param username 用户名
 * @param password 密码
 */
export async function loginWithUsername(
  username: string,
  password: string
): Promise<UserLoginInfo> {
  const socket = await createSocket(undefined, { allowGuest: true });
  const data = await socket.request<UserLoginInfo>('user.login', {
    username,
    password,
  });
  sharedEvent.emit('loginSuccess', pickUserBaseInfo(data));
  return data;
}

/**
 * 使用 Token 登录
 * @param token JWT令牌
 */
export async function loginWithToken(token: string): Promise<UserLoginInfo> {
  const socket = await getOrCreateSocket(token);
  const data = await socket.request<UserLoginInfo>('user.resolveToken', { token });
  sharedEvent.emit('loginSuccess', pickUserBaseInfo(data));
  return data;
}

/**
 * 发送邮箱校验码
 * @param email 邮箱
 */
export async function verifyEmail(email: string): Promise<UserLoginInfo> {
  const socket = await createSocket(undefined, { allowGuest: true });
  return await socket.request<UserLoginInfo>('user.verifyEmail', { email });
}

/**
 * 检查邮箱校验码并更新用户字段
 * @param email 邮箱
 */
export async function verifyEmailWithOTP(
  emailOTP: string
): Promise<UserLoginInfo> {
  const socket = await createSocket(undefined, { allowGuest: true });
  return await socket.request<UserLoginInfo>('user.verifyEmailWithOTP', { emailOTP });
}

/**
 * 邮箱注册账号
 * @param email 邮箱
 * @param password 密码
 */
export async function registerWithEmail({
  email,
  password,
  nickname,
  username,
  emailOTP,
}: {
  email: string;
  password: string;
  nickname?: string;
  username?: string;
  emailOTP?: string;
}): Promise<UserLoginInfo> {
  const socket = await createSocket(undefined, { allowGuest: true });
  return await socket.request<UserLoginInfo>('user.register', {
    email,
    nickname,
    username,
    password,
    emailOTP,
  });
}

/**
 * 修改密码
 */
export async function modifyUserPassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const socket = await getOrCreateSocket();
  await socket.request('user.modifyPassword', { oldPassword, newPassword });
}

/**
 * 忘记密码
 * @param email 邮箱
 */
export async function forgetPassword(email: string) {
  const socket = await createSocket(undefined, { allowGuest: true });
  await socket.request('user.forgetPassword', { email });
}

/**
 * 忘记密码
 * @param email 邮箱
 */
export async function resetPassword(
  email: string,
  password: string,
  otp: string
) {
  const socket = await createSocket(undefined, { allowGuest: true });
  await socket.request('user.resetPassword', { email, password, otp });
}

/**
 * 创建访客账号
 * @param nickname 访客昵称
 */
export async function createTemporaryUser(
  nickname: string
): Promise<UserLoginInfo> {
  const socket = await createSocket(undefined, { allowGuest: true });
  return await socket.request<UserLoginInfo>('user.createTemporaryUser', { nickname });
}

/**
 * 认领访客账号
 */
export async function claimTemporaryUser(
  userId: string,
  email: string,
  password: string,
  emailOTP?: string
): Promise<UserLoginInfo> {
  const socket = await createSocket(undefined, { allowGuest: true });
  return await socket.request<UserLoginInfo>('user.claimTemporaryUser', {
    userId,
    email,
    password,
    emailOTP,
  });
}

/**
 * 使用唯一标识名搜索用户
 * @param uniqueName 唯一标识用户昵称: 用户昵称#0000
 */
export async function searchUserWithUniqueName(
  uniqueName: string
): Promise<UserBaseInfo> {
  throw new Error('Deprecated API: 请按用户名搜索（不含#）');
}

/**
 * 新：按 username 精确查找（大小写不敏感）
 */
export async function findUserByUsernameCI(username: string): Promise<UserBaseInfo | null> {
  const socket = await getOrCreateSocket();
  return await socket.request<UserBaseInfo | null>('user.findUserByUsernameCI', { username });
}

const _fetchUserInfo = createAutoMergedRequest<string, UserBaseInfo>(
  createAutoSplitRequest(
    async (userIds) => {
      // 这里用post是为了防止一次性获取的userId过多超过url限制
      const socket = await getOrCreateSocket();
      return await socket.request<UserBaseInfo[]>('user.getUserInfoList', { userIds });
    },
    'serial',
    1000
  )
);
/**
 * 获取用户基本信息
 * @param userId 用户ID
 */
export async function fetchUserInfo(userId: string | { _id?: string; id?: string; userId?: string } | any): Promise<UserBaseInfo> {
  const normalizeUserId = (raw: any): string => {
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
    if (raw && typeof raw === 'object') {
      if (typeof raw._id === 'string') return raw._id;
      if (typeof raw.id === 'string') return raw.id;
      if (typeof raw.userId === 'string') return raw.userId;
      // 兜底：在一层对象里寻找第一个疑似 ObjectId 的字符串
      try {
        for (const k of Object.keys(raw)) {
          const v: any = (raw as any)[k];
          if (typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v)) return v;
        }
      } catch {}
    }
    return '';
  };

  const id = normalizeUserId(userId);

  if (builtinUserInfo[id] && typeof builtinUserInfo[id] === 'function') {
    return builtinUserInfo[id]();
  }

  if (!isObjectId(id)) {
    // 返回占位用户，避免页面报错；同时不触发后端查询
    return builtinUserInfo['']();
  }

  const userInfo = await _fetchUserInfo(id);

  return userInfo;
}

const _fetchUserOnlineStatus = createAutoMergedRequest<string[], boolean[]>(
  createAutoSplitRequest(
    async (userIdsList) => {
      const uniqList = _uniq(_flatten(userIdsList));
      // 这里用post是为了防止一次性获取的userId过多超过url限制
      const socket = await getOrCreateSocket();
      const data = await socket.request<boolean[]>('gateway.checkUserOnline', { userIds: uniqList });
      const map = _zipObject<boolean>(uniqList, data as any);

      // 将请求结果根据传输来源重新分组
      return userIdsList.map((userIds) =>
        userIds.map((userId) => map[userId] ?? false)
      );
    },
    'serial',
    1000
  )
);

/**
 * 获取用户在线状态
 */
export async function getUserOnlineStatus(
  userIds: Array<string | { _id?: string; id?: string; userId?: string } | any>
): Promise<boolean[]> {
  const ids = userIds.map((raw) => {
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
    if (raw && typeof raw === 'object') {
      if (typeof raw._id === 'string') return raw._id;
      if (typeof raw.id === 'string') return raw.id;
      if (typeof raw.userId === 'string') return raw.userId;
    }
    return '';
  });
  return _fetchUserOnlineStatus(ids);
}

/**
 * 将会话添加到用户私信列表
 * 如果已添加则后端忽略
 */
export async function appendUserDMConverse(
  converseId: string
): Promise<UserDMList> {
  const socket = await getOrCreateSocket();
  return await socket.request<UserDMList>('user.dmlist.addConverse', { converseId });
}

/**
 * 移除会话列表
 */
export async function removeUserDMConverse(
  converseId: string
): Promise<UserDMList> {
  const socket = await getOrCreateSocket();
  return await socket.request<UserDMList>('user.dmlist.removeConverse', { converseId });
}

/**
 * 修改用户属性
 * @param fieldName 要修改的属性名
 * @param fieldValue 要修改的属性的值
 */
type AllowedModifyField = 'nickname' | 'avatar';
export async function modifyUserField(
  fieldName: AllowedModifyField,
  fieldValue: unknown
): Promise<UserBaseInfo> {
  const socket = await getOrCreateSocket();
  return await socket.request<UserBaseInfo>('user.updateUserField', { fieldName, fieldValue });
}

export async function modifyUserExtra(
  fieldName: string,
  fieldValue: unknown
): Promise<UserBaseInfo> {
  const socket = await getOrCreateSocket();
  return await socket.request<UserBaseInfo>('user.updateUserExtra', { fieldName, fieldValue });
}

/**
 * 获取用户设置
 */
export async function getUserSettings(): Promise<UserSettings> {
  const socket = await getOrCreateSocket();
  try { await (socket as any).waitReady?.(); } catch {}
  const data = await socket.request<UserSettings>('user.getUserSettings', {});
  sharedEvent.emit('userSettingsUpdate', data);
  return data;
}

/**
 * 设置用户设置
 */
export async function setUserSettings(
  settings: UserSettings
): Promise<UserSettings> {
  const socket = await getOrCreateSocket();
  return await socket.request<UserSettings>('user.setUserSettings', { settings });
}

/**
 * 检查Token是否可用
 */
export const checkTokenValid = buildCachedRequest(
  'tokenValid',
  async (token: string): Promise<boolean> => {
    const socket = await getOrCreateSocket();
    return await socket.request<boolean>('user.checkTokenValid', { token });
  }
);
