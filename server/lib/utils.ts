import randomString from 'crypto-random-string';
import _ from 'lodash';
import { createHash } from 'crypto';

/**
 * 返回电子邮箱的地址
 * @param email 电子邮箱
 * @returns 电子邮箱
 */
export function getEmailAddress(email: string) {
  return email.split('@')[0];
}

/**
 * 生成随机字符串
 * @param length 随机字符串长度
 */
export function generateRandomStr(length = 10): string {
  return randomString({ length });
}

export function generateRandomNumStr(length = 6) {
  return randomString({
    length,
    type: 'numeric',
  });
}

/**
 * 是否一个可用的字符串
 * 定义为有长度的字符串
 */
export function isValidStr(str: unknown): str is string {
  return typeof str == 'string' && str !== '';
}

/**
 * 判断是否是一个可用的url
 * 支持更宽松的验证，包括 Docker 容器名等内部地址
 */
export function isValidUrl(str: unknown): str is string {
  if (typeof str !== 'string' || str === '') {
    return false;
  }
  
  // 更宽松的 URL 验证，支持 Docker 容器名和内部地址
  // 基本格式检查: http(s)://host[:port][/path]
  const urlPattern = /^https?:\/\/[a-zA-Z0-9]([a-zA-Z0-9\-_.]*[a-zA-Z0-9])?(:\d+)?(\/.*)?$/;
  
  // 允许常见的内部地址模式
  const allowedPatterns = [
    urlPattern,                                      // 基本 URL 格式
    /^https?:\/\/localhost(:\d+)?(\/.*)?$/,         // localhost
    /^https?:\/\/127\.0\.0\.1(:\d+)?(\/.*)?$/,      // 127.0.0.1
    /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/, // IP 地址
  ];
  
  return allowedPatterns.some(pattern => pattern.test(str));
}

/**
 * 检测一个地址是否是一个合法的资源地址
 */
export function isValidStaticAssetsUrl(str: unknown): str is string {
  if (typeof str !== 'string') {
    return false;
  }

  const filename = _.last(str.split('/'));
  if (filename.indexOf('.') === -1) {
    return false;
  }

  return true;
}

/**
 * 休眠一定时间
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve();
    }, ms)
  );
}

/**
 * 检查url地址是否匹配
 */
export function checkPathMatch(urlList: string[], url: string): boolean {
  const fuzzList = urlList.map((url) => url.replaceAll('/', '.'));
  const fuzzUrl = url.split('?')[0].replaceAll('/', '.');

  // 考虑到serviceName中间可能会有. 且注册的时候不可能把所有情况都列出来，因此进行模糊处理
  return fuzzList.includes(fuzzUrl);
}

// ================= Username helpers =================

export const USERNAME_REGEX = /^(?!_)[A-Za-z0-9_]{5,32}(?<!_)$/;

/**
 * 系统级用户名白名单（用于豁免通用规则，如机器人后缀要求）
 * 统一使用小写进行判定
 */
export const SYSTEM_USERNAME_ALLOWLIST = new Set<string>([
  'botfather',
]);

/**
 * 返回是否命名为保留字或平台占用
 */
export function isReservedUsername(nameLower: string, opts?: { isBot?: boolean }): boolean {
  const baseReserved = new Set([
    'admin',
    'root',
    'system',
    'official',
    'support',
    'help',
    'security',
    'moderator',
    'staff',
    'team',
    'ops',
    'tailchat',
    'api',
    'www',
    'mail',
    'dev',
    'test',
    'about',
    'terms',
    'privacy',
    'status',
    // 系统级账号保留，防止被普通用户注册占用
    'botfather',
  ]);

  // 机器人/人类差异化（与方案对齐）
  if (opts?.isBot === true) {
    // 机器人必须以 bot 结尾，若不是则视为非法（由校验处处理）
  } else {
    // 人类用户不允许以 bot 结尾，避免与机器人混淆
    if (nameLower.endsWith('bot')) {
      return true;
    }
  }

  return baseReserved.has(nameLower);
}

/**
 * 规范化昵称为用户名候选（小写、仅字母数字下划线、非法折叠为 _，去首尾 _）
 */
export function normalizeUsernameCandidateFromNickname(nickname: string): string {
  if (typeof nickname !== 'string') {
    return '';
  }
  const lower = nickname.toLowerCase();
  // 替换非法字符为下划线
  const replaced = lower.replace(/[^a-z0-9_]+/g, '_');
  // 折叠多余下划线并裁剪首尾
  const collapsed = replaced.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return collapsed;
}

export function shortHash(input: string, len = 4): string {
  const hex = createHash('sha1').update(String(input)).digest('hex');
  return hex.slice(0, len);
}

/**
 * 校验用户名是否符合规则
 */
export function validateUsernameStrict(username: string, opts?: { isBot?: boolean }): boolean {
  if (typeof username !== 'string') {
    return false;
  }
  if (!USERNAME_REGEX.test(username)) {
    return false;
  }
  const lower = username.toLowerCase();
  // 系统级用户名豁免（仅对机器人校验生效）
  if (opts?.isBot === true && SYSTEM_USERNAME_ALLOWLIST.has(lower)) {
    return true;
  }
  if (opts?.isBot === true) {
    // 机器人必须以 bot 结尾
    if (!lower.endsWith('bot')) {
      return false;
    }
  } else {
    // 人类用户不允许以 bot 结尾
    if (lower.endsWith('bot')) {
      return false;
    }
  }
  if (isReservedUsername(lower, opts)) {
    return false;
  }
  return true;
}
