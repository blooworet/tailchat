import moment from 'moment';
import { Types } from 'mongoose';
import type {
  MessageDocument,
  MessageModel,
} from '../../../models/chat/message';
import {
  TcService,
  TcDbService,
  GroupBaseInfo,
  TcContext,
  DataNotFoundError,
  NoPermissionError,
  call,
  PERMISSION,
  NotFoundError,
  SYSTEM_USERID,
  config,
} from 'tailchat-server-sdk';
import type { Group } from '../../../models/group/group';
import { isValidStr } from '../../../lib/utils';
import _ from 'lodash';
import { validateReplyKeyboardMeta } from './validators/replyKeyboard';

interface MessageService
  extends TcService,
    TcDbService<MessageDocument, MessageModel> {}
class MessageService extends TcService {
  get serviceName(): string {
    return 'chat.message';
  }

  onInit(): void {
    this.registerLocalDb(require('../../../models/chat/message').default);

    // Metrics: 机器人私信 /start 触发计数
    try {
      (this.broker as any).metrics?.register({
        name: 'bot_dm_start_total',
        type: 'counter',
        description: 'Total bot DM /start triggers',
        labelNames: [],
      });
      (this.broker as any).metrics?.register({
        name: 'bot_dm_send_total',
        type: 'counter',
        description: 'Total bot DM send messages',
        labelNames: [],
      });
      (this.broker as any).metrics?.register({
        name: 'bot_dm_send_blocked_total',
        type: 'counter',
        description: 'Total bot DM send blocked by user',
        labelNames: [],
      });
    } catch (e) {}

    this.registerAction('fetchConverseMessage', this.fetchConverseMessage, {
      params: {
        converseId: 'string',
        startId: { type: 'string', optional: true },
      },
    });
    this.registerAction('fetchNearbyMessage', this.fetchNearbyMessage, {
      params: {
        groupId: { type: 'string', optional: true },
        converseId: 'string',
        messageId: 'string',
        num: { type: 'number', optional: true },
      },
    });
    this.registerAction('sendMessage', this.sendMessage, {
      params: {
        converseId: 'string',
        groupId: [{ type: 'string', optional: true }],
        content: 'string',
        plain: { type: 'string', optional: true },
        meta: { type: 'any', optional: true },
      },
    });
    this.registerAction('recallMessage', this.recallMessage, {
      params: {
        messageId: 'string',
      },
    });
    this.registerAction('getMessage', this.getMessage, {
      params: {
        messageId: 'string',
      },
    });
    this.registerAction('deleteMessage', this.deleteMessage, {
      params: {
        messageId: 'string',
      },
    });
    this.registerAction('deleteAllMessages', this.deleteAllMessages, {
      params: {
        isAdminOperation: { type: 'boolean', optional: true },
      },
    });
    this.registerAction('searchMessage', this.searchMessage, {
      params: {
        groupId: { type: 'string', optional: true },
        converseId: 'string',
        text: 'string',
      },
    });
    this.registerAction(
      'fetchConverseLastMessages',
      this.fetchConverseLastMessages,
      {
        params: {
          converseIds: 'array',
        },
      }
    );
    this.registerAction('addReaction', this.addReaction, {
      params: {
        messageId: 'string',
        emoji: 'string',
      },
    });
    this.registerAction('removeReaction', this.removeReaction, {
      params: {
        messageId: 'string',
        emoji: 'string',
      },
    });
    this.registerAction('editMessage', this.editMessage, {
      params: {
        messageId: 'string',
        content: { type: 'string', optional: true },
        meta: { type: 'object', optional: true },
      },
    });
  }

  /**
   * 获取会话消息
   */
  async fetchConverseMessage(
    ctx: TcContext<{
      converseId: string;
      startId?: string;
    }>
  ) {
    // Scope: 机器人读取消息需要 'message.read'
    let decoded: any = null;
    if (typeof ctx.meta.token === 'string' && ctx.meta.token.length > 0) {
      decoded = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
    }
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        if (!rec || !Array.isArray(rec.scopes) || !rec.scopes.includes('message.read')) {
          throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
        }
      } catch (e) {
        throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
      }
    }
    const { converseId, startId } = ctx.params;
    // DM 读取需要 'dm.read' 细粒度权限
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        if (!rec || !Array.isArray(rec.scopes) || !rec.scopes.includes('dm.read')) {
          throw new NoPermissionError(ctx.meta.t('Bot scope denied: dm.read'));
        }
      } catch (e) {
        throw new NoPermissionError(ctx.meta.t('Bot scope denied: dm.read'));
      }
    }
    const docs = await this.adapter.model.fetchConverseMessage(
      converseId,
      startId ?? null
    );

    return this.transformDocuments(ctx, {}, docs);
  }

  /**
   * 获取一条消息附近的消息
   * 以会话为准
   *
   * 额外需要converseId是为了防止暴力查找
   */
  async fetchNearbyMessage(
    ctx: TcContext<{
      groupId?: string;
      converseId: string;
      messageId: string;
      num?: number;
    }>
  ) {
    // Scope: 机器人读取消息需要 'message.read'
    let decoded: any = null;
    if (typeof ctx.meta.token === 'string' && ctx.meta.token.length > 0) {
      decoded = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
    }
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        if (!rec || !Array.isArray(rec.scopes) || !rec.scopes.includes('message.read')) {
          throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
        }
      } catch (e) {
        throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
      }
    }
    const { groupId, converseId, messageId, num = 5 } = ctx.params;
    const { t } = ctx.meta;

    // 鉴权是否能获取到会话内容
    await this.checkConversePermission(ctx, converseId, groupId);

    const message = await this.adapter.model
      .findOne({
        _id: new Types.ObjectId(messageId),
        converseId: new Types.ObjectId(converseId),
      })
      .limit(1)
      .exec();

    if (!message) {
      throw new DataNotFoundError(t('没有找到消息'));
    }

    const [prev, next] = await Promise.all([
      this.adapter.model
        .find({
          _id: {
            $lt: new Types.ObjectId(messageId),
          },
          converseId: new Types.ObjectId(converseId),
        })
        .sort({ _id: -1 })
        .limit(num)
        .exec()
        .then((arr) => arr.reverse()),
      this.adapter.model
        .find({
          _id: {
            $gt: new Types.ObjectId(messageId),
          },
          converseId: new Types.ObjectId(converseId),
        })
        .sort({ _id: 1 })
        .limit(num)
        .exec(),
    ]);

    console.log({ prev, next });

    return this.transformDocuments(ctx, {}, [...prev, message, ...next]);
  }

  /**
   * 发送普通消息
   */
  async sendMessage(
    ctx: TcContext<{
      converseId: string;
      groupId?: string;
      content: string;
      plain?: string;
      meta?: object;
    }>
  ) {
    const { converseId, groupId, content, plain, meta } = ctx.params;
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;
    const isGroupMessage = isValidStr(groupId);

    // Sanitize Reply Keyboard meta (optional)
    const originalMeta: any = meta ?? {};
    let sanitizedMeta: any = originalMeta;
    try {
      if (originalMeta && Object.prototype.hasOwnProperty.call(originalMeta, 'replyKeyboard')) {
        const rk = validateReplyKeyboardMeta(originalMeta.replyKeyboard, this.logger);
        sanitizedMeta = { ...originalMeta };
        if (rk) {
          sanitizedMeta.replyKeyboard = rk;
        } else {
          delete sanitizedMeta.replyKeyboard;
        }
      }
    } catch (e) {
      try { this.logger?.warn?.('[replyKeyboard] validate failed:', String((e as any)?.message || e)); } catch {}
      sanitizedMeta = { ...originalMeta };
      if (sanitizedMeta && typeof sanitizedMeta === 'object') {
        delete sanitizedMeta.replyKeyboard;
      }
    }

    // Scope: 机器人消息发送需要细粒度权限（群组: message.send；私信: dm.send）
    let decoded: any = null;
    if (typeof ctx.meta.token === 'string' && ctx.meta.token.length > 0) {
      decoded = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
    }
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        const scopes: string[] = Array.isArray(rec?.scopes) ? (rec!.scopes as any) : [];
        const needed = isGroupMessage ? 'message.send' : 'dm.send';
        if (!scopes.includes(needed)) {
          throw new NoPermissionError(t(`Bot scope denied: ${needed}`));
        }
      } catch (e) {
        const needed = isGroupMessage ? 'message.send' : 'dm.send';
        throw new NoPermissionError(t(`Bot scope denied: ${needed}`));
      }
    }

    /**
     * 鉴权
     */
    await this.checkConversePermission(ctx, converseId, groupId); // 鉴权是否能获取到会话内容
    if (isGroupMessage) {
      // 是群组消息, 鉴权是否禁言
      const groupInfo = await call(ctx).getGroupInfo(groupId);
      const member = groupInfo.members.find((m) => String(m.userId) === userId);
      if (member) {
        // 因为有机器人，所以如果没有在成员列表中找到不报错
        if (new Date(member.muteUntil).valueOf() > new Date().valueOf()) {
          throw new Error(t('您因为被禁言无法发送消息'));
        }
      }
    }

    // 私信路径：/start 路由到机器人
    if (!isGroupMessage) {
      try {
        // 限制：仅当显式开启 botDmStartFromTyped 才从手动输入的 /start 触发 dm.start
        const allowTypedStartDmEvent = !!(config?.feature && (config as any).feature.botDmStartFromTyped === true);
        if (!allowTypedStartDmEvent) {
          throw new Error(t('botDmStartFromTyped disabled'));
        }
        // FEATURE: bot DM start 开关
        if (config?.feature && (config as any).feature.botDmStart === false) {
          // 关闭则透传为普通消息
          throw new Error(t('botDmStart disabled'));
        }
        const converseInfo = await call(ctx).getConverseInfo(converseId);
        if (converseInfo && Array.isArray(converseInfo.members) && converseInfo.members.length === 2) {
          const [m1, m2] = converseInfo.members.map((m: any) => String(m));
          const otherUserId = m1 === userId ? m2 : m1;
          // 若发送者为机器人而接收者屏蔽了该机器人，则禁止发送
          try {
            const senderInfo = await call(ctx).getUserInfo(userId);
            if (senderInfo && (senderInfo.type === 'pluginBot' || senderInfo.type === 'openapiBot')) {
              const blocked = await ctx.call('user.isBotBlocked', { botUserId: userId }, { meta: { userId: otherUserId } } as any);
              if (blocked === true) {
                try { (this.broker as any).metrics?.increment?.('bot_dm_send_blocked_total'); } catch (e) {}
                try { ctx.emit('audit.bot.dm.blocked', { fromUserId: userId, toUserId: otherUserId, timestamp: Date.now() }); } catch (e) {}
                throw new NoPermissionError(t('对方已屏蔽该机器人，无法发送消息'));
              }
              // 机器人 DM 发送频控：每 60s 最多 20 条
              await this.simpleRateLimit(`botdm:send:${userId}:${otherUserId}`, 20, 60);
            }
          } catch (e) {
            if (e instanceof NoPermissionError) {
              throw e;
            }
            // 其他错误不影响主流程
          }
          if (otherUserId && otherUserId !== userId) {
            const otherUser = await call(ctx).getUserInfo(otherUserId);
            if (otherUser && (otherUser.type === 'pluginBot' || otherUser.type === 'openapiBot')) {
              const text = (typeof plain === 'string' && plain.trim().length > 0 ? plain : content).trim();
              const match = text.match(/^\/start(?:\s+(.*))?$/i);
              if (match) {
                // 速率限制：同一 用户→机器人 在窗口内最多 N 次（可配置）
                const rl = (config as any)?.feature?.botDmStartRateLimit || {};
                const limit = Number(rl.count) > 0 ? Number(rl.count) : 30; // default widened: 30
                const windowSec = Number(rl.windowSec) > 0 ? Number(rl.windowSec) : 60; // default 60s
                await this.simpleRateLimit(`botdm:start:${userId}:${otherUserId}`, limit, windowSec);

                const payload: any = {
                  botUserId: otherUserId,
                  fromUserId: userId,
                  converseId,
                  timestamp: Date.now(),
                };
                const arg = (match[1] || '').trim();
                if (arg.length > 0) {
                  payload.params = { text: arg };
                }
                ctx.emit('bot.dm.start', payload);
                // 审计与指标
                try {
                  ctx.emit('audit.bot.dm.start', payload);
                } catch (e) {}
                try {
                  (this.broker as any).metrics?.increment?.('bot_dm_start_total');
                } catch (e) {}
              }
            }
          }
        }
      } catch (e) {
        // 保守处理：不影响正常发消息流程
        // 使用 console.warn 以避免类型定义差异导致的 this.logger 报错
        console.warn('bot.dm.start route failed:', String(e));
      }
    }

    const message = await this.adapter.insert({
      converseId: new Types.ObjectId(converseId),
      groupId:
        typeof groupId === 'string' ? new Types.ObjectId(groupId) : undefined,
      author: new Types.ObjectId(userId),
      content,
      meta: sanitizedMeta,
    });

    const json = await this.transformDocuments(ctx, {}, message);

    if (isGroupMessage) {
      this.roomcastNotify(ctx, converseId, 'add', json);
    } else {
      // 如果是私信的话需要基于用户去推送
      // 因为用户可能不订阅消息(删除了dmlist)
      const converseInfo = await call(ctx).getConverseInfo(converseId);
      if (converseInfo) {
        const converseMemberIds = converseInfo.members.map((m) => String(m));
        // 若发送者为机器人，计数 DM 发送
        try {
          const senderInfo = await call(ctx).getUserInfo(userId);
          if (senderInfo && (senderInfo.type === 'pluginBot' || senderInfo.type === 'openapiBot')) {
            (this.broker as any).metrics?.increment?.('bot_dm_send_total');
          }
        } catch (e) {}

        call(ctx)
          .isUserOnline(converseMemberIds)
          .then((onlineList) => {
            _.zip(converseMemberIds, onlineList).forEach(
              ([memberId, isOnline]) => {
                if (isOnline) {
                  // 用户在线，则直接推送，通过客户端来创建会话
                  this.unicastNotify(ctx, memberId, 'add', json);
                } else {
                  // 用户离线，确保追加到会话中
                  ctx.call(
                    'user.dmlist.addConverse',
                    { converseId },
                    {
                      meta: {
                        userId: memberId,
                      },
                    }
                  );
                }
              }
            );
          });

        // 将人类用户发给 openapi 机器人的 DM 文本转发为 inbox，供开放平台回调
        try {
          if (Array.isArray(converseInfo.members) && converseInfo.members.length === 2) {
            const [m1, m2] = converseInfo.members.map((m: any) => String(m));
            const otherUserId = m1 === userId ? m2 : m1;
            if (otherUserId && otherUserId !== userId) {
              const [otherUser, senderInfo] = await Promise.all([
                call(ctx).getUserInfo(otherUserId),
                call(ctx).getUserInfo(userId),
              ]);
              const isOtherOpenapiBot = !!otherUser && otherUser.type === 'openapiBot';
              const isSenderBot = !!senderInfo && (senderInfo.type === 'pluginBot' || senderInfo.type === 'openapiBot');
              if (isOtherOpenapiBot && !isSenderBot) {
                const textSent = (typeof plain === 'string' && plain.trim().length > 0 ? plain : content).trim();
                const isStartMsg = /^\/start(?:\s+.*)?$/i.test(textSent);
                const typedStartEnabled = !!(config?.feature && (config as any).feature.botDmStartFromTyped === true);
                const dmStartFromButton = !!(sanitizedMeta && (sanitizedMeta as any).dmStartFromButton === true);

                if (!(isStartMsg && dmStartFromButton && typedStartEnabled === true)) {
                  await ctx.call('chat.inbox.append', {
                    userId: otherUserId,
                    type: 'message',
                    payload: {
                      groupId: undefined,
                      converseId: String(converseId),
                      messageId: String(message._id),
                      messageAuthor: String(userId),
                      messageSnippet: (sanitizedMeta && (sanitizedMeta as any).e2ee === true) ? '加密消息' : content,
                      messagePlainContent: (sanitizedMeta && (sanitizedMeta as any).e2ee === true) ? undefined : (plain ?? undefined),
                    },
                  });
                }
              }
            }
          }
        } catch (e) {
          // 忽略转发异常，避免影响主消息流程
          try { this.logger?.warn?.('[openapiBot DM forward] failed:', String((e as any)?.message || e)); } catch {}
        }
      }
    }

    ctx.emit('chat.message.updateMessage', {
      type: 'add',
      groupId: groupId ? String(groupId) : undefined,
      converseId: String(converseId),
      messageId: String(message._id),
      author: userId,
      content,
      plain,
      meta: sanitizedMeta ?? {},
    });

    // 审计：如包含 inlineAction 透传信息，生成审计事件
    try {
      const ia = (meta as any)?.inlineAction;
      if (ia && (ia.source || ia.traceId || ia.actionId)) {
        ctx.emit('audit.inline.applyChatInput', {
          userId,
          converseId,
          groupId: groupId ? String(groupId) : undefined,
          source: ia.source,
          traceId: ia.traceId,
          actionId: ia.actionId,
          ts: Date.now(),
        });
      }
    } catch (e) {}

    return json;
  }

  /**
   * 撤回消息
   */
  async recallMessage(ctx: TcContext<{ messageId: string }>) {
    const { messageId } = ctx.params;
    const { t, userId } = ctx.meta;

    const message = await this.adapter.model.findById(messageId);
    if (!message) {
      throw new DataNotFoundError(t('该消息未找到'));
    }

    if (message.hasRecall === true) {
      throw new Error(t('该消息已被撤回'));
    }

    // 消息撤回限时
    if (
      moment().valueOf() - moment(message.createdAt).valueOf() >
      15 * 60 * 1000
    ) {
      throw new Error(t('无法撤回 {{minutes}} 分钟前的消息', { minutes: 15 }));
    }

    let allowToRecall = false;

    //#region 撤回权限检查
    const groupId = message.groupId;
    if (groupId) {
      // 是一条群组信息
      const group: GroupBaseInfo = await ctx.call('group.getGroupBasicInfo', {
        groupId: String(groupId),
      });
      if (String(group.owner) === userId) {
        allowToRecall = true; // 是管理员 允许修改
      }
    }

    if (String(message.author) === String(userId)) {
      // 撤回者是消息所有者
      allowToRecall = true;
    }

    if (allowToRecall === false) {
      throw new NoPermissionError(t('撤回失败, 没有权限'));
    }
    //#endregion

    const converseId = String(message.converseId);
    message.hasRecall = true;
    await message.save();

    const json = await this.transformDocuments(ctx, {}, message);

    this.roomcastNotify(ctx, converseId, 'update', json);
    ctx.emit('chat.message.updateMessage', {
      type: 'recall',
      groupId: groupId ? String(groupId) : undefined,
      converseId: String(converseId),
      messageId: String(message._id),
      meta: message.meta ?? {},
    });

    return json;
  }

  /**
   * 获取消息
   */
  async getMessage(ctx: TcContext<{ messageId: string }>) {
    // Scope: 机器人读取消息需要 'message.read'
    let decoded: any = null;
    if (typeof ctx.meta.token === 'string' && ctx.meta.token.length > 0) {
      decoded = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
    }
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        if (!rec || !Array.isArray(rec.scopes) || !rec.scopes.includes('message.read')) {
          throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
        }
      } catch (e) {
        throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
      }
    }
    const { messageId } = ctx.params;
    const { t, userId } = ctx.meta;
    const message = await this.adapter.model.findById(messageId);
    if (!message) {
      throw new DataNotFoundError(t('该消息未找到'));
    }
    const converseId = String(message.converseId);
    const groupId = message.groupId;
    // 鉴权
    if (!groupId) {
      // 私人会话
      const converseInfo = await call(ctx).getConverseInfo(converseId);
      if (!converseInfo.members.map((m) => String(m)).includes(userId)) {
        throw new NoPermissionError(t('没有当前会话权限'));
      }
    } else {
      // 群组会话
      const groupInfo = await call(ctx).getGroupInfo(String(groupId));
      if (!groupInfo.members.map((m) => m.userId).includes(userId)) {
        throw new NoPermissionError(t('没有当前会话权限'));
      }
    }
    return message;
  }

  /**
   * 删除消息（群组 + 私信）
   * 群组：需管理员权限；私信：仅作者本人或系统用户可删
   */
  async deleteMessage(ctx: TcContext<{ messageId: string }>) {
    const { messageId } = ctx.params;
    const { t, userId } = ctx.meta;

    const message = await this.adapter.model.findById(messageId);
    if (!message) {
      throw new DataNotFoundError(t('该消息未找到'));
    }

    const converseId = String(message.converseId);
    const groupId = message.groupId;
    if (!groupId) {
      // 私人会话：仅作者本人或系统允许删除
      if (String(message.author) !== String(userId) && userId !== SYSTEM_USERID) {
        throw new Error(t('无法删除私人信息'));
      }
    } else {
      // 群组会话, 进行权限校验
      const [hasPermission] = await call(ctx).checkUserPermissions(
        String(groupId),
        userId,
        [PERMISSION.core.deleteMessage]
      );

      if (!hasPermission) {
        throw new NoPermissionError(t('没有删除权限')); // 仅管理员允许删除
      }
    }

    await this.adapter.removeById(messageId); // TODO: 考虑是否要改为软删除

    this.roomcastNotify(ctx, converseId, 'delete', { converseId, messageId });
    ctx.emit('chat.message.updateMessage', {
      type: 'delete',
      groupId: groupId ? String(groupId) : undefined,
      converseId: String(converseId),
      messageId: String(message._id),
      meta: message.meta ?? {},
    });

    return true;
  }

  /**
   * 搜索消息
   */
  async searchMessage(
    ctx: TcContext<{ groupId?: string; converseId: string; text: string }>
  ) {
    // Scope: 机器人读取消息需要 'message.read'
    const decoded: any = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        if (!rec || !Array.isArray(rec.scopes) || !rec.scopes.includes('message.read')) {
          throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
        }
      } catch (e) {
        throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
      }
    }
    const { groupId, converseId, text } = ctx.params;
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;

    if (groupId) {
      const groupInfo = await call(ctx).getGroupInfo(groupId);
      if (!groupInfo.members.map((m) => m.userId).includes(userId)) {
        throw new Error(t('不是群组成员无法搜索消息'));
      }
    }

    const messages = this.adapter.model
      .find({
        groupId: groupId ?? null,
        converseId,
        // 跳过端到端加密消息，避免对密文做文本搜索
        'meta.e2ee': { $ne: true },
        content: {
          $regex: text,
        },
        author: {
          $not: {
            $eq: SYSTEM_USERID,
          },
        },
      })
      .sort({ _id: -1 })
      .limit(10)
      .maxTimeMS(5 * 1000); // 超过5s的查询直接放弃

    return messages;
  }

  /**
   * 基于会话id获取会话最后一条消息的id
   */
  async fetchConverseLastMessages(ctx: TcContext<{ converseIds: string[] }>) {
    // Scope: 机器人读取消息需要 'message.read'
    let decoded: any = null;
    if (typeof ctx.meta.token === 'string' && ctx.meta.token.length > 0) {
      decoded = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
    }
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        if (!rec || !Array.isArray(rec.scopes) || !rec.scopes.includes('message.read')) {
          throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
        }
      } catch (e) {
        throw new NoPermissionError(ctx.meta.t('Bot scope denied: message.read'));
      }
    }
    const { converseIds } = ctx.params;

    // 这里使用了多个请求，但是通过limit=1会将查询范围降低到最低
    // 这种方式会比用聚合操作实际上更加节省资源
    const list = await Promise.all(
      converseIds.map((id) => {
        return this.adapter.model
          .findOne(
            {
              converseId: new Types.ObjectId(id),
            },
            {
              _id: 1,
              converseId: 1,
            }
          )
          .sort({
            _id: -1,
          })
          .limit(1)
          .exec();
      })
    );

    return list.map((item) =>
      item
        ? {
            converseId: String(item.converseId),
            lastMessageId: String(item._id),
          }
        : null
    );
  }

  async addReaction(
    ctx: TcContext<{
      messageId: string;
      emoji: string;
    }>
  ) {
    const { messageId, emoji } = ctx.params;
    const userId = ctx.meta.userId;

    const message = await this.adapter.model.findById(messageId);

    const appendReaction = {
      name: emoji,
      author: new Types.ObjectId(userId),
    };

    await this.adapter.model.updateOne(
      {
        _id: messageId,
      },
      {
        $push: {
          reactions: {
            ...appendReaction,
          },
        },
      }
    );

    const converseId = String(message.converseId);
    this.roomcastNotify(ctx, converseId, 'addReaction', {
      converseId,
      messageId,
      reaction: {
        ...appendReaction,
      },
    });

    return true;
  }

  async removeReaction(
    ctx: TcContext<{
      messageId: string;
      emoji: string;
    }>
  ) {
    const { messageId, emoji } = ctx.params;
    const userId = ctx.meta.userId;

    const message = await this.adapter.model.findById(messageId);

    const removedReaction = {
      name: emoji,
      author: new Types.ObjectId(userId),
    };

    await this.adapter.model.updateOne(
      {
        _id: messageId,
      },
      {
        $pull: {
          reactions: {
            ...removedReaction,
          },
        },
      }
    );

    const converseId = String(message.converseId);
    this.roomcastNotify(ctx, converseId, 'removeReaction', {
      converseId,
      messageId,
      reaction: {
        ...removedReaction,
      },
    });

    return true;
  }

  /**
   * 编辑消息
   */
  async editMessage(
    ctx: TcContext<{
      messageId: string;
      content?: string;
      meta?: object;
    }>
  ) {
    const { messageId, content, meta } = ctx.params;
    const { t, userId } = ctx.meta;

    // Scope: 机器人编辑消息需要 'message.edit' 权限
    let decoded: any = null;
    if (typeof ctx.meta.token === 'string' && ctx.meta.token.length > 0) {
      decoded = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
    }
    if (decoded && decoded.btid) {
      try {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        if (!rec || !Array.isArray(rec.scopes) || !rec.scopes.includes('message.edit')) {
          throw new NoPermissionError(t('Bot scope denied: message.edit'));
        }
      } catch (e) {
        throw new NoPermissionError(t('Bot scope denied: message.edit'));
      }
    }

    const message = await this.adapter.model.findById(messageId);
    if (!message) {
      throw new DataNotFoundError(t('该消息未找到'));
    }

    // 权限检查：只允许消息作者或管理员编辑
    let allowToEdit = false;
    const groupId = message.groupId;
    
    if (groupId) {
      // 是群组消息，检查是否为群组管理员
      const group: GroupBaseInfo = await ctx.call('group.getGroupBasicInfo', {
        groupId: String(groupId),
      });
      if (String(group.owner) === userId) {
        allowToEdit = true; // 是管理员 允许编辑
      }
    }

    if (String(message.author) === String(userId)) {
      // 编辑者是消息所有者
      allowToEdit = true;
    }

    if (allowToEdit === false) {
      throw new NoPermissionError(t('编辑失败, 没有权限'));
    }

    // 更新消息内容
    const updateData: any = {
      isEdited: true,
      editedAt: new Date(),
    };

    if (content !== undefined) {
      updateData.content = content;
    }

    if (meta !== undefined) {
      updateData.meta = meta;
    }

    await this.adapter.model.updateOne(
      { _id: messageId },
      { $set: updateData }
    );

    // 获取更新后的消息
    const updatedMessage = await this.adapter.model.findById(messageId);
    const json = await this.transformDocuments(ctx, {}, updatedMessage);

    const converseId = String(message.converseId);
    
    // 广播消息编辑事件
    this.roomcastNotify(ctx, converseId, 'edit', json);
    
    ctx.emit('chat.message.updateMessage', {
      type: 'edit',
      groupId: groupId ? String(groupId) : undefined,
      converseId: String(converseId),
      messageId: String(message._id),
      content: content,
      meta: meta ?? {},
    });

    return json;
  }

  /**
   * 校验会话权限，如果没有抛出异常则视为正常
   */
  private async checkConversePermission(
    ctx: TcContext,
    converseId: string,
    groupId?: string
  ) {
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;
    if (userId === SYSTEM_USERID) {
      return;
    }

    const userInfo = await call(ctx).getUserInfo(userId); // TODO: 可以通过在默认的meta信息中追加用户类型来减少一次请求来优化
    if (userInfo.type === 'pluginBot') {
      // 如果是插件机器人则拥有所有权限(开放平台机器人需要添加到群组才有会话权限)
      return;
    }

    // 鉴权是否能获取到会话内容
    if (groupId) {
      // 是群组
      const group = await call(ctx).getGroupInfo(groupId);
      if (group.members.findIndex((m) => String(m.userId) === userId) === -1) {
        // 不存在该用户
        throw new NoPermissionError(t('没有当前会话权限'));
      }
    } else {
      // 是普通会话
      const converse = await ctx.call<
        any,
        {
          converseId: string;
        }
      >('chat.converse.findConverseInfo', {
        converseId,
      });

      if (!converse) {
        throw new NotFoundError(t('没有找到会话信息'));
      }
      const memebers = converse.members ?? [];
      if (memebers.findIndex((member) => String(member) === userId) === -1) {
        throw new NoPermissionError(t('没有当前会话权限'));
      }
    }
  }

  /**
   * 删除所有消息
   * 仅允许系统管理员使用
   */
  async deleteAllMessages(ctx: TcContext<{ isAdminOperation?: boolean }>) {
    const { userId, t } = ctx.meta;
    const { isAdminOperation } = ctx.params;
    
    // 检查权限：只允许系统管理员（SYSTEM_USERID）或 admin 操作执行
    if (userId !== SYSTEM_USERID && !isAdminOperation) {
      throw new NoPermissionError(t('只有系统管理员可以执行此操作'));
    }
    
    try {
      // 先获取所有消息，以便后续通知
      const allMessages = await this.adapter.model.find({}).lean().exec();
      
      // 按会话分组消息
      const messagesByConverse = new Map<string, any[]>();
      allMessages.forEach((msg) => {
        const converseId = String(msg.converseId);
        if (!messagesByConverse.has(converseId)) {
          messagesByConverse.set(converseId, []);
        }
        messagesByConverse.get(converseId)!.push(msg);
      });
      
      // 删除所有消息
      const result = await this.adapter.model.deleteMany({});
      
      // 通知所有会话中的用户删除消息
      for (const [converseId, messages] of messagesByConverse.entries()) {
        // 对该会话进行广播通知，告知所有用户这些消息被删除
        for (const message of messages) {
          try {
            this.roomcastNotify(ctx, converseId, 'delete', {
              converseId,
              messageId: String(message._id),
            });
          } catch (e) {
            console.warn('Failed to notify delete for message', String(message._id), String(e));
          }
        }
      }
      
      // 发出全局事件，记录删除了所有消息
      ctx.emit('chat.message.deleteAllMessages', {
        type: 'deleteAll',
        deletedCount: result.deletedCount,
        timestamp: new Date(),
      });
      
      return {
        success: true,
        deletedCount: result.deletedCount,
      };
    } catch (err) {
      console.error('删除所有消息时出错:', err);
      throw new Error(ctx.meta.t('删除所有消息时出错: {{error}}', { error: String(err) }));
    }
  }

  /**
   * 简易速率限制：在 windowSec 窗口内同 key 允许最多 limit 次
   */
  private async simpleRateLimit(key: string, limit: number, windowSec: number) {
    const cacher = (this.broker as any).cacher;
    if (!cacher) return;
    const now = Date.now();
    const rec = (await cacher.get(key)) as { n: number; ts: number } | null;
    if (!rec) {
      await cacher.set(key, { n: 1, ts: now }, windowSec);
      return;
    }
    if (typeof rec.n !== 'number') {
      await cacher.set(key, { n: 1, ts: now }, windowSec);
      return;
    }
    if (rec.n >= limit) {
      throw new Error('Too many /start in short time');
    }
    await cacher.set(key, { n: rec.n + 1, ts: rec.ts || now }, windowSec);
  }
}

export default MessageService;
