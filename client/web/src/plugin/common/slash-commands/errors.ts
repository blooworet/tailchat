/**
 * 斜杠命令系统错误消息管理
 * 提供统一的错误消息定义和国际化支持
 */

// 错误代码枚举
export enum CommandErrorCode {
  // 可见性相关错误
  COMMAND_NOT_VISIBLE = 'COMMAND_NOT_VISIBLE',
  PRIVATE_CHAT_ONLY = 'PRIVATE_CHAT_ONLY',
  GROUP_CHAT_ONLY = 'GROUP_CHAT_ONLY',
  SPECIFIC_CHAT_ONLY = 'SPECIFIC_CHAT_ONLY',
  SPECIFIC_MEMBER_ONLY = 'SPECIFIC_MEMBER_ONLY',
  
  // 权限相关错误
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  GROUP_PERMISSION_REQUIRED = 'GROUP_PERMISSION_REQUIRED',
  
  // 参数相关错误
  INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
  MISSING_REQUIRED_ARGS = 'MISSING_REQUIRED_ARGS',
  
  // 系统相关错误
  COMMAND_NOT_FOUND = 'COMMAND_NOT_FOUND',
  INVALID_COMMAND_FORMAT = 'INVALID_COMMAND_FORMAT',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
}

// 错误消息接口
export interface CommandError {
  code: CommandErrorCode;
  message: string;
  details?: any;
}

// 错误消息映射 - 支持国际化
const ERROR_MESSAGES: Record<CommandErrorCode, string> = {
  // 可见性相关错误
  [CommandErrorCode.COMMAND_NOT_VISIBLE]: '命令不可用',
  [CommandErrorCode.PRIVATE_CHAT_ONLY]: '此命令仅在私聊中可用',
  [CommandErrorCode.GROUP_CHAT_ONLY]: '此命令仅在群组中可用',
  [CommandErrorCode.SPECIFIC_CHAT_ONLY]: '此命令在当前聊天中不可用',
  [CommandErrorCode.SPECIFIC_MEMBER_ONLY]: '您没有权限使用此命令',
  
  // 权限相关错误
  [CommandErrorCode.PERMISSION_DENIED]: '权限不足',
  [CommandErrorCode.INSUFFICIENT_PERMISSIONS]: '您没有执行此命令的权限',
  [CommandErrorCode.GROUP_PERMISSION_REQUIRED]: '需要群组管理权限',
  
  // 参数相关错误
  [CommandErrorCode.INVALID_ARGUMENTS]: '参数无效',
  [CommandErrorCode.MISSING_REQUIRED_ARGS]: '缺少必需参数',
  
  // 系统相关错误
  [CommandErrorCode.COMMAND_NOT_FOUND]: '未知命令',
  [CommandErrorCode.INVALID_COMMAND_FORMAT]: '无效的命令格式',
  [CommandErrorCode.EXECUTION_FAILED]: '命令执行失败',
};

// TODO: 集成到Tailchat的i18n系统
// 当前使用硬编码中文，后续需要支持多语言
const ERROR_MESSAGES_EN: Record<CommandErrorCode, string> = {
  [CommandErrorCode.COMMAND_NOT_VISIBLE]: 'Command not available',
  [CommandErrorCode.PRIVATE_CHAT_ONLY]: 'This command is only available in private chats',
  [CommandErrorCode.GROUP_CHAT_ONLY]: 'This command is only available in group chats',
  [CommandErrorCode.SPECIFIC_CHAT_ONLY]: 'This command is not available in current chat',
  [CommandErrorCode.SPECIFIC_MEMBER_ONLY]: 'You do not have permission to use this command',
  
  [CommandErrorCode.PERMISSION_DENIED]: 'Permission denied',
  [CommandErrorCode.INSUFFICIENT_PERMISSIONS]: 'You do not have permission to execute this command',
  [CommandErrorCode.GROUP_PERMISSION_REQUIRED]: 'Group management permission required',
  
  [CommandErrorCode.INVALID_ARGUMENTS]: 'Invalid arguments',
  [CommandErrorCode.MISSING_REQUIRED_ARGS]: 'Missing required arguments',
  
  [CommandErrorCode.COMMAND_NOT_FOUND]: 'Unknown command',
  [CommandErrorCode.INVALID_COMMAND_FORMAT]: 'Invalid command format',
  [CommandErrorCode.EXECUTION_FAILED]: 'Command execution failed',
};

/**
 * 创建命令错误对象
 */
export function createCommandError(
  code: CommandErrorCode,
  details?: any,
  customMessage?: string
): CommandError {
  return {
    code,
    message: customMessage || getErrorMessage(code),
    details,
  };
}

/**
 * 获取错误消息
 * TODO: 集成到Tailchat的i18n系统，根据用户语言设置返回对应消息
 */
export function getErrorMessage(code: CommandErrorCode, locale: string = 'zh-CN'): string {
  const messages = locale === 'en-US' ? ERROR_MESSAGES_EN : ERROR_MESSAGES;
  return messages[code] || ERROR_MESSAGES[CommandErrorCode.EXECUTION_FAILED];
}

/**
 * 格式化错误消息
 */
export function formatErrorMessage(
  code: CommandErrorCode,
  params?: Record<string, any>,
  locale?: string
): string {
  let message = getErrorMessage(code, locale);
  
  // 支持参数替换
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      message = message.replace(`{${key}}`, String(value));
    });
  }
  
  return message;
}

/**
 * 检查是否为命令错误
 */
export function isCommandError(error: any): error is CommandError {
  return error && typeof error === 'object' && 'code' in error && 'message' in error;
}
