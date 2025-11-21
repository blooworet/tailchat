/**
 * 斜杠命令系统类型定义
 */

/**
 * 命令范围类型定义
 */
export type CommandScopeType = 'default' | 'all_private_chats' | 'all_group_chats' | 'chat' | 'chat_member';

/**
 * 命令范围接口
 */
export interface CommandScope {
  type: CommandScopeType;
  chat_id?: string;  // 当 type 为 'chat' 或 'chat_member' 时使用
  user_id?: string;  // 当 type 为 'chat_member' 时使用
}

export interface SlashCommand {
  /** 命令名称（不包含 /） */
  name: string;
  /** 命令显示标签 */
  label: string;
  /** 命令描述 */
  description?: string;
  /** 命令图标 */
  icon?: string;
  /** 命令类型 */
  type: 'builtin' | 'plugin' | 'bot';
  /** 命令分类 */
  category?: string;
  /** 是否需要参数 */
  requiresArgs?: boolean;
  /** 参数提示 */
  argsHint?: string;
  /** 命令别名 */
  aliases?: string[];
  /** 权限要求 */
  permissions?: string[];
  /** 执行处理器 */
  handler: SlashCommandHandler;
  /** 命令优先级（用于排序） */
  priority?: number;
  /** 命令可见范围 */
  scope?: CommandScope;
  /** 机器人ID（仅用于bot类型命令） */
  botId?: string;
  /** 机器人名称（仅用于bot类型命令） */
  botName?: string;
  /** 机器人用户ID（MongoDB ObjectId，用于Avatar组件生成头像） */
  botUserId?: string;
}

/**
 * 聊天环境上下文接口
 * 用于命令可见性判断和环境感知过滤
 */
export interface ChatContext {
  /** 是否为群组聊天 */
  isGroup: boolean;
  /** 群组ID（如果在群组中） */
  groupId?: string;
  /** 当前用户ID */
  userId: string;
  /** 会话ID */
  converseId: string;
  /** 会话成员ID列表（用于命令过滤和机器人检测） */
  converseMemberIds?: string[] | null;
}

export interface SlashCommandContext {
  /** 当前用户ID */
  userId: string;
  /** 群组ID（如果在群组中） */
  groupId?: string;
  /** 会话ID */
  converseId: string;
  /** 面板ID（如果在面板中） */
  panelId?: string;
  /** 原始输入文本 */
  rawInput: string;
  /** 解析后的参数 */
  args: string[];
  /** 命令执行的追踪ID */
  traceId?: string;
}

export interface SlashCommandResult {
  /** 执行是否成功 */
  success: boolean;
  /** 结果消息 */
  message?: string;
  /** 错误信息 */
  error?: string;
  /** 是否需要发送消息 */
  shouldSend?: boolean;
  /** 要发送的内容 */
  content?: string;
  /** 消息元数据 */
  meta?: any;
}

export type SlashCommandHandler = (
  context: SlashCommandContext
) => Promise<SlashCommandResult> | SlashCommandResult;

export interface SlashCommandRegistryOptions {
  /** 是否允许覆盖已存在的命令 */
  allowOverride?: boolean;
  /** 命令作用域 */
  scope?: 'global' | 'group' | 'dm' | 'specific';
  /** 注册来源 */
  source?: string;
}

export interface SlashCommandSuggestion {
  /** 命令ID */
  id: string;
  /** 显示文本 */
  display: string;
  /** 命令对象 */
  command: SlashCommand;
}

/**
 * 机器人回调响应接口
 * 用于机器人向特定用户显示提示框
 */
export interface BotCallbackAnswer {
  /** 追踪ID（关联到原始按钮点击） */
  traceId: string;
  /** 目标用户ID */
  userId: string;
  /** 提示文本内容（最多200字符） */
  text: string;
  /** 是否显示弹窗（true=弹窗，false=Toast气泡） */
  show_alert?: boolean;
  /** 时间戳 */
  ts: number;
}