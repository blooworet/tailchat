import { TcService, config, TcContext, call, t } from 'tailchat-server-sdk';
import { isValidStr, isValidUrl } from '../../lib/utils';
import type { OpenApp } from '../../models/openapi/app';
import got from 'got';
import _ from 'lodash';

class OpenBotService extends TcService {
  get serviceName(): string {
    return 'openapi.bot';
  }

  onInit(): void {
    if (!config.enableOpenapi) {
      return;
    }

    // 监听机器人回调响应事件，转发给前端
    this.registerEventListener('bot.callback.answer', async (payload: any, ctx) => {
      const { userId, text, show_alert, traceId, ts } = payload;
      
      if (!userId || !text) {
        return;
      }
      
      // 通过 gateway.notify 将事件推送给特定用户
      await ctx.call('gateway.notify', {
        type: 'unicast',
        target: userId,
        eventName: 'notify:bot.callback.answer',
        eventData: {
          text,
          show_alert: show_alert || false,
          traceId,
          ts,
        },
      });
      
      this.logger.info(`[bot.callback.answer] Sent to user ${userId}: ${text}`);
    });

    this.registerEventListener('chat.inbox.append', async (payload: any, ctx) => {
      const userInfo = await call(ctx).getUserInfo(String(payload.userId));

      if (!userInfo) {
        return;
      }

      if (userInfo.type !== 'openapiBot') {
        return;
      }

      // 开放平台机器人
      const botId: string | null = await ctx.call('user.findOpenapiBotId', {
        email: userInfo.email,
      });

      if (!(isValidStr(botId) && botId.startsWith('open_'))) {
        return;
      }

      // 是合法的机器人id

      const appId = botId.replace('open_', '');
      // 通过appId查询应用信息（系统内部调用，无权限检查）
      // 这里保留使用appId作为查询条件，因为历史数据中机器人ID基于appId生成
      const appInfo: OpenApp | null = await ctx.call('openapi.app.findByAppIdInternal', {
        appId,
      });
      const callbackUrl = _.get(appInfo, 'bot.callbackUrl');

      if (!isValidUrl(callbackUrl)) {
        this.logger.info('机器人回调地址不是一个可用的url, skip.');
        return;
      }

      got
        .post(callbackUrl, {
          json: payload,
          headers: {
            'X-TC-Payload-Type': 'inbox',
          },
        })
        .then(() => {
          this.logger.info('调用机器人通知接口回调成功');
        })
        .catch((err) => {
          this.logger.error('调用机器人通知接口回调失败:', err);
        });
    });

    // 监听 DM /start 事件并转发到开放平台机器人回调
    this.registerEventListener('bot.dm.start', async (payload: any, ctx) => {
      try {
        const { botUserId, fromUserId, converseId, params, timestamp } = payload || {};
        if (!botUserId || !fromUserId || !converseId) {
          return;
        }

        // 仅开放平台机器人需要 HTTP 回调
        const u = await call(ctx).getUserInfo(String(botUserId));
        if (!u || u.type !== 'openapiBot') {
          return;
        }

        // 解析机器人对应应用与回调地址
        const botId: string | null = await ctx.call('user.findOpenapiBotId', {
          email: u.email,
        });
        if (!(botId && botId.startsWith('open_'))) {
          return;
        }
        const appId = botId.replace('open_', '');
        const appInfo: any = await ctx.call('openapi.app.findByAppIdInternal', { appId });
        const callbackUrl = _.get(appInfo, 'bot.callbackUrl');
        if (!isValidUrl(callbackUrl)) {
          this.logger.info('[bot.dm.start] 机器人回调地址不可用, skip');
          return;
        }

        const forward = {
          type: 'dm.start',
          payload: {
            botUserId: String(botUserId),
            fromUserId: String(fromUserId),
            converseId: String(converseId),
            params,
            timestamp: timestamp || Date.now(),
          },
        };

        got
          .post(callbackUrl, {
            json: forward,
            headers: {
              'X-TC-Payload-Type': 'dm.start',
            },
          })
          .then(() => {
            this.logger.info('[bot.dm.start] forwarded to bot callback', u.username);
          })
          .catch((err) => {
            this.logger.error('[bot.dm.start] forward failed:', err);
          });
      } catch (err) {
        this.logger.error('[bot.dm.start] handler error:', err);
      }
    });

    // 可选：群内全部消息转发（无需 @），由应用开关控制
    this.registerEventListener('chat.message.updateMessage', async (payload: any, ctx) => {
      try {
        const { type, groupId, converseId, messageId, author, content, plain, meta = {} } = payload || {};
        // 仅处理新增的群组消息
        if (type !== 'add' || !groupId) {
          return;
        }

        // 获取群组信息，找到其中的 openapiBot 成员
        const groupInfo: any = await call(ctx).getGroupInfo(String(groupId));
        if (!groupInfo || !Array.isArray(groupInfo.members)) {
          return;
        }

        // 提前准备：消息是否 @ 了某些用户
        const mentions: string[] = Array.isArray(meta.mentions) ? meta.mentions.map(String) : [];

        for (const m of groupInfo.members) {
          const botUserId = String(m.userId);
          const u = await call(ctx).getUserInfo(botUserId);
          if (!u || u.type !== 'openapiBot') {
            continue;
          }

          // 若已 @ 机器人，则由 inbox 监听负责回调，避免重复
          if (mentions.includes(botUserId)) {
            continue;
          }

          // 提取 appId 并获取应用信息
          const botId: string | null = await ctx.call('user.findOpenapiBotId', {
            email: u.email,
          });
          if (!(botId && botId.startsWith('open_'))) {
            continue;
          }
          const appId = botId.replace('open_', '');
          const appInfo: any = await ctx.call('openapi.app.findByAppIdInternal', { appId });

          // 校验开关、能力与回调地址
          const recvAll = !!appInfo?.bot?.receiveAllGroupMessages;
          const allowGroup = appInfo?.bot?.allowGroup !== false;
          const callbackUrl = _.get(appInfo, 'bot.callbackUrl');
          if (!recvAll || !allowGroup || !isValidUrl(callbackUrl)) {
            continue;
          }

          // 组装与 inbox 一致的结构并回调
          const inboxLikePayload = {
            userId: botUserId,
            type: 'message',
            payload: {
              groupId: String(groupId),
              converseId: String(converseId),
              messageId: String(messageId),
              messageAuthor: String(author),
              messageSnippet: meta?.e2ee === true ? '加密消息' : content,
              messagePlainContent: meta?.e2ee === true ? undefined : plain,
            },
          };

          got
            .post(callbackUrl, {
              json: inboxLikePayload,
              headers: {
                'X-TC-Payload-Type': 'inbox',
              },
            })
            .then(() => {
              this.logger.info('[bot.recvAll] forwarded message to bot', u.username);
            })
            .catch((err) => {
              this.logger.error('[bot.recvAll] forward failed:', err);
            });
        }
      } catch (err) {
        this.logger.error('[bot.recvAll] handler error:', err);
      }
    });

    // 新增：监听按钮回调事件
    this.registerEventListener('bot.inline.invoke', async (payload: any, ctx) => {
      const botUserId = payload.botUserId;
      
      if (!botUserId) {
        return;
      }

      const userInfo = await call(ctx).getUserInfo(String(botUserId));

      if (!userInfo) {
        return;
      }

      if (userInfo.type !== 'openapiBot') {
        return;
      }

      // 开放平台机器人
      const botId: string | null = await ctx.call('user.findOpenapiBotId', {
        email: userInfo.email,
      });

      if (!(isValidStr(botId) && botId.startsWith('open_'))) {
        return;
      }

      // 是合法的机器人id
      const appId = botId.replace('open_', '');
      const appInfo: OpenApp | null = await ctx.call('openapi.app.findByAppIdInternal', {
        appId,
      });
      const callbackUrl = _.get(appInfo, 'bot.callbackUrl');

      if (!isValidUrl(callbackUrl)) {
        this.logger.info('机器人回调地址不是一个可用的url, skip.');
        return;
      }

      // 构造按钮回调payload，类似Telegram的callback_query
      const callbackPayload = {
        type: 'buttonCallback',
        payload: {
          messageAuthor: payload.fromUserId,
          converseId: payload.converseId,
          groupId: payload.groupId,
          originalMessageId: payload.originalMessageId,
          actionId: payload.actionId,
          type: payload.type,
          params: payload.params,
          traceId: payload.traceId,
          ts: payload.ts,
        }
      };

      got
        .post(callbackUrl, {
          json: callbackPayload,
          headers: {
            'X-TC-Payload-Type': 'buttonCallback',
          },
        })
        .then(() => {
          this.logger.info('调用机器人按钮回调接口成功');
        })
        .catch((err) => {
          this.logger.error('调用机器人按钮回调接口失败:', err);
        });
    });

    this.registerAction('login', this.login, {
      params: {
        token: 'string',
      },
    });
    this.registerAction('getOrCreateBotAccount', this.getOrCreateBotAccount, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
      },
      visibility: 'public',
    });
    this.registerAction('getOrCreateBotAccountByAppId', this.getOrCreateBotAccountByAppId, {
      params: {
        appId: 'string',
      },
    });

    this.registerAction('answerCallbackQuery', this.answerCallbackQuery, {
      rest: 'POST /openapi/bot/answerCallbackQuery',
      params: {
        appSecret: 'string',
        traceId: 'string',
        userId: 'string',
        text: 'string',
        show_alert: { type: 'boolean', optional: true },
        cache_time: { type: 'number', optional: true },
      },
      visibility: 'published',
    });

    // HTTP-only bot APIs (Telegram-like), wrapper endpoints
    this.registerAction('sendMessage', this.sendMessage, {
      rest: 'POST /openapi/bot/sendMessage',
      params: {
        converseId: 'string',
        groupId: { type: 'string', optional: true },
        content: 'string',
        plain: { type: 'string', optional: true },
        meta: { type: 'any', optional: true },
      },
      visibility: 'published',
    });
    this.registerAction('editMessage', this.editMessage, {
      rest: 'POST /openapi/bot/editMessage',
      params: {
        messageId: 'string',
        content: { type: 'string', optional: true },
        meta: { type: 'object', optional: true },
      },
      visibility: 'published',
    });
    this.registerAction('deleteMessage', this.deleteMessage, {
      rest: 'POST /openapi/bot/deleteMessage',
      params: {
        messageId: 'string',
      },
      visibility: 'published',
    });
    this.registerAction('ensureDMWithUser', this.ensureDMWithUser, {
      rest: 'POST /openapi/bot/ensureDMWithUser',
      params: {
        userId: 'string',
      },
      visibility: 'published',
    });
    this.registerAction('whoami', this.whoami, {
      rest: 'GET /openapi/bot/whoami',
      visibility: 'published',
    });
  }

  /**
   * 登录
   *
   * 并自动创建机器人账号
   */
  async login(ctx: TcContext<{ token: string }>) {
    const { token } = ctx.params;
    const valid = await ctx.call('openapi.app.authToken', {
      token,
      capability: ['bot'],
    });

    if (!valid) {
      throw new Error(t('Auth failed.'));
    }

    // 校验通过, 获取机器人账号存在
    const { userId, email, nickname, avatar } = await this.localCall(
      'getOrCreateBotAccount',
      {
        appSecret: token,
      }
    );

    const jwt: string = await ctx.call('user.generateUserToken', {
      userId,
      email,
      nickname,
      avatar,
    });

    // 获取应用信息以返回 appId
    const appInfo: OpenApp = await ctx.call('openapi.app.getForIntegration', {
      appSecret: token,
    });

    return { jwt, userId, email, nickname, avatar, appId: appInfo.appId };
  }

  /**
   * 获取或创建机器人账号
   */
  async getOrCreateBotAccount(ctx: TcContext<{ appId?: string; appSecret?: string }>): Promise<{
    userId: string;
    email: string;
    nickname: string;
    avatar: string;
  }> {
    const { appId, appSecret } = ctx.params;
    
    if (!appId && !appSecret) {
      throw new Error(t('Either appId or appSecret must be provided'));
    }
    
    await this.waitForServices(['user']);

    const appInfo: OpenApp = await ctx.call('openapi.app.getForIntegration', appSecret ? { appSecret } : { appId });

    try {
      // 使用appId作为机器人ID的标识，保持与历史数据的一致性
      // 虽然对外接口使用appSecret，但内部系统仍使用appId来创建和查找机器人
      const botId = 'open_' + appInfo.appId;
      const nickname = appInfo.appName;
      const avatar = appInfo.appIcon;
      const { _id: botUserId, email } = await ctx.call<
        {
          _id: string;
          email: string;
        },
        any
      >('user.ensureOpenapiBot', {
        botId,
        nickname,
        avatar,
        username: appInfo.bot?.username,
      });

      this.logger.info('[getOrCreateBotAccount] Bot Id:', botUserId);

      return {
        userId: String(botUserId),
        email,
        nickname,
        avatar,
      };
    } catch (e) {
      this.logger.error(e);
      throw e;
    }
  }

  /**
   * 通过 appId 获取或创建机器人账号
   * 专门用于群组添加机器人等公开场景
   */
  async getOrCreateBotAccountByAppId(ctx: TcContext<{ appId: string }>): Promise<{
    userId: string;
    email: string;
    nickname: string;
    avatar: string;
  }> {
    const { appId } = ctx.params;
    
    await this.waitForServices(['user']);

    // 通过公开的 appId 获取应用信息
    const appInfo: OpenApp = await ctx.call('openapi.app.getPublicByAppId', {
      appId,
    });

    try {
      const botId = 'open_' + appInfo.appId;
      const nickname = appInfo.appName;
      const avatar = appInfo.appIcon;
      const { _id: botUserId, email } = await ctx.call<
        {
          _id: string;
          email: string;
        },
        any
      >('user.ensureOpenapiBot', {
        botId,
        nickname,
        avatar,
        // 注意：这里不设置 username，因为群组添加机器人不需要设置用户名
      });

      this.logger.info('[getOrCreateBotAccountByAppId] Bot Id:', botUserId);

      return {
        userId: String(botUserId),
        email,
        nickname,
        avatar,
      };
    } catch (e) {
      this.logger.error(e);
      throw e;
    }
  }

  /**
   * 回答按钮回调查询
   * 类似 Telegram 的 answerCallbackQuery
   */
  async answerCallbackQuery(ctx: TcContext<{
    appSecret: string;
    traceId: string;
    userId: string;
    text: string;
    show_alert?: boolean;
    cache_time?: number;
  }>) {
    const { appSecret, traceId, userId, text, show_alert = false } = ctx.params;

    // 1. 验证 appSecret 并获取机器人信息
    const appInfo: OpenApp | null = await ctx.call('openapi.app.getForIntegration', { appSecret });

    if (!appInfo) {
      throw new Error('Invalid appSecret');
    }

    const botId = 'open_' + appInfo.appId;
    const botUserInfo: any = await ctx.call('user.ensureOpenapiBot', {
      botId,
      nickname: appInfo.appName,
      avatar: appInfo.appIcon,
    });
    const botUserId = String(botUserInfo._id);

    // 2. 验证 traceId 是否存在且未使用
    const cacher = (this.broker as any).cacher;
    if (!cacher) {
      throw new Error('Cache service not available');
    }

    const traceKey = `callback:trace:${traceId}`;
    const traceInfo = await cacher.get(traceKey);

    if (!traceInfo) {
      throw new Error('Invalid or expired traceId');
    }

    // 3. 验证 traceId 是否属于该机器人
    if (traceInfo.botUserId !== botUserId) {
      throw new Error('TraceId does not belong to this bot');
    }

    // 4. 验证 userId 是否为原始点击用户
    if (traceInfo.fromUserId !== userId) {
      throw new Error('UserId mismatch');
    }

    // 5. 验证文本长度
    if (text.length > 200) {
      throw new Error('Text too long (max 200 characters)');
    }

    // 6. 检查频率限制
    const rateLimit = _.get(appInfo, 'bot.callbackAnswerRateLimit', 60);
    const rateLimitKey = `callback:rate:${botUserId}`;
    try {
      const now = Date.now();
      const rec = await cacher.get(rateLimitKey) as { n: number; ts: number } | null;
      
      if (!rec) {
        await cacher.set(rateLimitKey, { n: 1, ts: now }, 60);
      } else {
        if (rec.n >= rateLimit) {
          throw new Error('Rate limit exceeded');
        }
        await cacher.set(rateLimitKey, { n: rec.n + 1, ts: rec.ts || now }, 60);
      }
    } catch (err) {
      if ((err as Error).message === 'Rate limit exceeded') {
        throw err;
      }
      // 频率限制失败不阻止功能
      this.logger.warn('Rate limit check failed:', err);
    }

    // 7. 广播事件到前端
    ctx.emit('bot.callback.answer', {
      userId,
      text,
      show_alert,
      traceId,
      ts: Date.now(),
    });

    // 8. 标记 traceId 为已使用
    await cacher.del(traceKey);

    this.logger.info(`[answerCallbackQuery] Bot ${botUserId} answered callback for user ${userId}`);

    return { success: true };
  }

  /**
   * HTTP wrapper: send message
   */
  async sendMessage(ctx: TcContext<{
    converseId: string;
    groupId?: string;
    content: string;
    plain?: string;
    meta?: any;
  }>) {
    return await ctx.call('chat.message.sendMessage', ctx.params);
  }

  /**
   * HTTP wrapper: edit message
   */
  async editMessage(ctx: TcContext<{
    messageId: string;
    content?: string;
    meta?: Record<string, any>;
  }>) {
    return await ctx.call('chat.message.editMessage', ctx.params);
  }

  /**
   * HTTP wrapper: delete message
   */
  async deleteMessage(ctx: TcContext<{ messageId: string }>) {
    return await ctx.call('chat.message.deleteMessage', ctx.params);
  }

  /**
   * HTTP wrapper: ensure DM with a user
   */
  async ensureDMWithUser(ctx: TcContext<{ userId: string }>) {
    return await ctx.call('chat.converse.ensureDMWithUser', {
      userId: ctx.params.userId,
    });
  }

  /**
   * HTTP wrapper: whoami
   */
  async whoami(ctx: TcContext) {
    const u = (ctx.meta as any)?.user || {};
    return _.pick(u, ['_id', 'nickname', 'email', 'avatar']);
  }
}

export default OpenBotService;
