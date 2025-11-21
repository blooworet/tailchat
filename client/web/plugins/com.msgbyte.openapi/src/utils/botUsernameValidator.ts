/**
 * 机器人用户名验证工具
 * 遵循 Telegram 机器人用户名规则
 */

import { Translate } from '../translate';

export interface BotUsernameValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * 验证机器人用户名是否符合 Telegram 规则
 * 
 * 规则：
 * ✅ 必须以 "bot" 或 "Bot" 结尾
 * ✅ 长度要求：最少 5 个字符，最多 32 个字符（不含 @）
 * ✅ 可使用字符：仅限 英文字母（A–Z, a–z）、数字（0–9）、下划线（_）
 * 🚫 不可使用字符：空格、符号（如 ., -, @, #, !, ?, 等）、中文、表情符号等
 * ⚠️ 不区分大小写：MyBot 与 mybot 视为相同用户名（唯一性冲突）
 * ⚙️ 用户名唯一：全局唯一，已被占用就不能再用
 */
export function validateBotUsername(username: string): BotUsernameValidationResult {
  if (!username || typeof username !== 'string') {
    return {
      isValid: false,
      error: Translate.usernameCannotBeEmpty
    };
  }

  // 长度检查
  if (username.length < 5) {
    return {
      isValid: false,
      error: Translate.usernameTooShort
    };
  }

  if (username.length > 32) {
    return {
      isValid: false,
      error: Translate.usernameTooLong
    };
  }

  // 字符集检查：只允许英文字母、数字、下划线
  const allowedCharsRegex = /^[A-Za-z0-9_]+$/;
  if (!allowedCharsRegex.test(username)) {
    return {
      isValid: false,
      error: Translate.usernameInvalidChars
    };
  }

  // 不能以下划线开头或结尾
  if (username.startsWith('_') || username.endsWith('_')) {
    return {
      isValid: false,
      error: Translate.usernameInvalidFormat
    };
  }

  // 必须以 "bot" 结尾（不区分大小写）
  const lowerUsername = username.toLowerCase();
  if (!lowerUsername.endsWith('bot')) {
    return {
      isValid: false,
      error: Translate.botUsernameMustEndWithBot
    };
  }

  // 检查是否为保留用户名
  const reservedUsernames = [
    'botfather',
    'systembot',
    'adminbot',
    'supportbot',
    'helpbot',
    'officialbot',
    'securitybot',
    'moderatorbot',
    'staffbot',
    'teambot'
  ];

  if (reservedUsernames.includes(lowerUsername)) {
    return {
      isValid: false,
      error: Translate.usernameReserved
    };
  }

  return {
    isValid: true
  };
}


/**
 * 格式化用户名显示
 */
export function formatBotUsername(username: string): string {
  return username ? `@${username}` : '';
}
