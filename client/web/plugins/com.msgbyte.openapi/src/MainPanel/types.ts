const openAppCapability = [
  'bot', // 机器人
  'webpage', // 网页
  'oauth', // 第三方登录
] as const;

export type OpenAppCapability = typeof openAppCapability[number];

export interface OpenAppOAuth {
  redirectUrls: string[];
}

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

/**
 * 机器人命令定义
 */
export interface BotCommand {
  command: string;      // 命令名，最多32个字符，仅[a-z0-9_]+
  description: string;  // 命令描述，最多256个字符
  scope?: CommandScope; // 命令可见范围，可选，默认为 'default'
}

export interface OpenAppBot {
  callbackUrl: string;
  username?: string; // 机器人用户名
  allowGroup?: boolean; // 是否允许被添加到群组，默认为true
  commands?: BotCommand[]; // 机器人命令列表
  /** 接收所在群组内全部消息 */
  receiveAllGroupMessages?: boolean;
}

export interface OpenApp {
  _id: string;
  appId: string;
  appSecret: string;
  appName: string;
  appDesc: string;
  appIcon: string;
  capability: OpenAppCapability[];
  oauth?: OpenAppOAuth;
  bot?: OpenAppBot;

  owner: string;
}
