import {
  getModelForClass,
  prop,
  DocumentType,
  index,
  ReturnModelType,
  Ref,
} from '@typegoose/typegoose';
import { Base, TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';
import type { Types } from 'mongoose';
import { User } from '../user/user';

const openAppCapability = [
  'bot', // 机器人
  'webpage', // 网页
  'oauth', // 第三方登录
] as const;

type OpenAppCapability = typeof openAppCapability[number];

/**
 * 确保输出类型为应用能力
 */
export function filterAvailableAppCapability(
  input: string[]
): OpenAppCapability[] {
  return input.filter((item) =>
    openAppCapability.includes(item as OpenAppCapability)
  ) as OpenAppCapability[];
}

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
  enableCallbackAnswer?: boolean; // 是否启用回调响应功能，默认为true
  callbackAnswerRateLimit?: number; // 每分钟最大响应次数，默认60
  /**
   * 是否接收所在群组内的全部消息（无需 @）
   * 默认关闭
   */
  receiveAllGroupMessages?: boolean;
}

/**
 * 开放平台应用
 */
@index({ appId: 1 }, { unique: true })
@index({ appSecret: 1 }, { unique: true })
export class OpenApp extends TimeStamps implements Base {
  _id: Types.ObjectId;
  id: string;

  @prop({
    ref: () => User,
  })
  owner: Ref<User>;
  
  @prop()
  appId: string;

  @prop()
  appSecret: string;

  @prop()
  appName: string;

  @prop()
  appDesc: string;

  @prop()
  appIcon: string; // url

  @prop({
    enum: openAppCapability,
    type: [String],
    default: [],
  })
  capability: OpenAppCapability[];

  @prop()
  oauth?: OpenAppOAuth;

  @prop({
    default: {},
  })
  bot?: OpenAppBot;

  /**
   * 根据appId获取openapp的实例
   * 用于获得完整数据(包括secret)
   * 并顺便判断是否拥有该开放平台用户的修改权限
   */
  static async findAppByIdAndOwner(
    this: ReturnModelType<typeof OpenApp>,
    appId: string,
    ownerId: string
  ) {
    const res = await this.findOne({
      appId,
      owner: ownerId,
    }).exec();

    return res;
  }

  /**
   * 根据appSecret获取openapp的实例
   * 用于获得完整数据
   * 并判断是否拥有该开放平台用户的修改权限
   */
  static async findAppBySecretAndOwner(
    this: ReturnModelType<typeof OpenApp>,
    appSecret: string,
    ownerId: string
  ) {
    const res = await this.findOne({
      appSecret,
      owner: ownerId,
    }).exec();

    return res;
  }
}

export type OpenAppDocument = DocumentType<OpenApp>;

const model = getModelForClass(OpenApp);

export type OpenAppModel = typeof model;

export default model;
