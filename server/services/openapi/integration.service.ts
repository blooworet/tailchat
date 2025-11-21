import { call, TcContext, TcService, config, DataNotFoundError } from 'tailchat-server-sdk';
import { isValidStr } from '../../lib/utils';
import type { OpenApp } from '../../models/openapi/app';

/**
 * 第三方应用集成
 */
class OpenAppIntegrationService extends TcService {
  get serviceName(): string {
    return 'openapi.integration';
  }

  onInit(): void {
    if (!config.enableOpenapi) {
      return;
    }

    this.registerAction('addBotUser', this.addBotUser, {
      params: {
        appId: 'string', // 只接受 appId，不接受 appSecret
        groupId: 'string',
      },
    });

    this.registerAction('addBotUserByUsername', this.addBotUserByUsername, {
      params: {
        username: 'string', // 机器人用户名
        groupId: 'string',
      },
    });

    this.registerAction('addBotUserUnified', this.addBotUserUnified, {
      params: {
        appId: { type: 'string', optional: true }, // appId 或 username 二选一
        username: { type: 'string', optional: true }, // appId 或 username 二选一
        groupId: 'string',
      },
    });
  }

  /**
   * 在群组中添加机器人用户
   * 只接受 appId（公开信息），不接受 appSecret（私密信息）
   */
  async addBotUser(
    ctx: TcContext<{
      appId: string;
      groupId: string;
    }>
  ) {
    const { appId, groupId } = ctx.params;
    const t = ctx.meta.t;

    // 通过公开的 appId 获取应用信息
    const openapp: OpenApp = await ctx.call('openapi.app.getPublicByAppId', {
      appId,
    });

    if (!openapp) {
      throw new DataNotFoundError();
    }

    if (!openapp.capability.includes('bot')) {
      throw new Error(t('该应用的机器人服务尚未开通'));
    }

    // 检查机器人是否允许被添加到群组
    if (openapp.bot?.allowGroup === false) {
      throw new Error(t('该机器人不支持群组，仅限私聊使用'));
    }

    // 通过 appId 获取或创建机器人账号（不需要 appSecret）
    const botAccount: any = await ctx.call(
      'openapi.bot.getOrCreateBotAccountByAppId',
      {
        appId,
      }
    );

    const userId = botAccount.userId;
    if (!isValidStr(userId)) {
      throw new Error(t('无法获取到机器人ID'));
    }

    await ctx.call(
      'group.joinGroup',
      {
        groupId,
      },
      {
        meta: {
          userId,
        },
      }
    );

    await call(ctx).addGroupSystemMessage(
      String(groupId),
      `${ctx.meta.user.nickname} 在群组中添加了机器人 ${botAccount.nickname}`
    );
  }

  /**
   * 通过用户名在群组中添加机器人用户
   */
  async addBotUserByUsername(
    ctx: TcContext<{
      username: string;
      groupId: string;
    }>
  ) {
    const { username, groupId } = ctx.params;
    const t = ctx.meta.t;

    // 根据用户名查找机器人用户
    const botUser: any = await ctx.call('user.findBotByUsername', {
      username,
    });

    if (!botUser) {
      throw new DataNotFoundError(t('机器人用户不存在或用户名无效'));
    }

    // 验证用户类型，确保是机器人
    if (!['pluginBot', 'openapiBot'].includes(botUser.type)) {
      throw new Error(t('指定的用户不是机器人账户'));
    }

    // 检查机器人是否有用户名
    if (!botUser.username) {
      throw new Error(t('该机器人没有设置用户名，无法通过用户名添加'));
    }

    // 对于开放平台机器人，需要检查 allowGroup 设置
    if (botUser.type === 'openapiBot') {
      // 从机器人的 email 中提取 appId
      // email 格式: open_${appId}@openapi.msgbyte.com
      const emailMatch = botUser.email?.match(/^open_(.+)@openapi\.msgbyte\.com$/);
      if (emailMatch) {
        const appId = emailMatch[1];
        
        try {
          // 获取应用的公开信息以检查 allowGroup 设置
          const openapp: any = await ctx.call('openapi.app.getPublicByAppId', {
            appId,
          });

          if (openapp && openapp.bot?.allowGroup === false) {
            throw new Error(t('该机器人不支持群组，仅限私聊使用'));
          }
        } catch (error) {
          // 如果是我们主动抛出的错误，直接重新抛出
          if (error.message === t('该机器人不支持群组，仅限私聊使用')) {
            throw error;
          }
          
          // 其他错误，记录详细信息
          this.logger.error(`无法验证机器人 ${username} 的群组权限设置:`, error);
          throw new Error(t('无法验证机器人的群组权限设置'));
        }
      } else {
        // 如果 email 格式不匹配，为安全起见，禁止添加
        this.logger.warn(`开放平台机器人 ${username} 的 email 格式异常: ${botUser.email}`);
        throw new Error(t('机器人信息异常，无法添加到群组'));
      }
    }

    const userId = botUser._id;
    if (!isValidStr(userId)) {
      throw new Error(t('无法获取到机器人ID'));
    }

    // 将机器人添加到群组
    await ctx.call(
      'group.joinGroup',
      {
        groupId,
      },
      {
        meta: {
          userId,
        },
      }
    );

    // 添加系统消息
    await call(ctx).addGroupSystemMessage(
      String(groupId),
      `${ctx.meta.user.nickname} 在群组中添加了机器人 ${botUser.nickname} (@${botUser.username})`
    );

    return {
      success: true,
      botUser: {
        _id: botUser._id,
        nickname: botUser.nickname,
        username: botUser.username,
        avatar: botUser.avatar,
        type: botUser.type,
      },
    };
  }

  /**
   * 统一的机器人集成方法
   * 支持通过 appId 或 username 添加机器人到群组
   */
  async addBotUserUnified(
    ctx: TcContext<{
      appId?: string;
      username?: string;
      groupId: string;
    }>
  ) {
    const { appId, username, groupId } = ctx.params;
    const t = ctx.meta.t;

    // 验证参数：appId 和 username 必须提供其中一个
    if (!appId && !username) {
      throw new Error(t('必须提供 appId 或 username 其中一个参数'));
    }

    if (appId && username) {
      throw new Error(t('appId 和 username 不能同时提供，请选择其中一种方式'));
    }

    // 根据提供的参数选择相应的集成方式
    if (appId) {
      // 使用 appId 集成
      return await this.addBotUser(ctx as TcContext<{ appId: string; groupId: string }>);
    } else if (username) {
      // 使用 username 集成
      return await this.addBotUserByUsername(ctx as TcContext<{ username: string; groupId: string }>);
    }
  }
}

export default OpenAppIntegrationService;
