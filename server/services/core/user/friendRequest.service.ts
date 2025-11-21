import {
  TcService,
  TcDbService,
  TcContext,
  Errors,
  DataNotFoundError,
  NoPermissionError,
  config,
} from 'tailchat-server-sdk';
import _ from 'lodash';
import type { FriendRequest } from '../../../models/user/friendRequest';

interface FriendService extends TcService, TcDbService<any> {}
class FriendService extends TcService {
  get serviceName(): string {
    return 'friend.request';
  }
  onInit(): void {
    this.registerLocalDb(require('../../../models/user/friendRequest').default);
    // this.registerMixin(TcCacheCleaner(['cache.clean.friend']));

    this.registerAction('add', this.add, {
      params: {
        to: 'string',
        message: [{ type: 'string', optional: true }],
      },
    });
    this.registerAction('allRelated', this.allRelated);
    this.registerAction('accept', this.accept, {
      params: {
        requestId: 'string',
      },
    });
    this.registerAction('deny', this.deny, {
      params: {
        requestId: 'string',
      },
    });
    this.registerAction('cancel', this.cancel, {
      params: {
        requestId: 'string',
      },
    });
  }

  /**
   * 请求添加好友
   */
  async add(ctx: TcContext<{ to: string; message?: string }>) {
    const from = ctx.meta.userId;
    const t = ctx.meta.t;

    const { to, message } = ctx.params;

    if (config.feature.disableAddFriend === true) {
      throw new NoPermissionError(t('管理员禁止添加好友功能'));
    }

    if (from === to) {
      throw new Errors.MoleculerError(t('不能添加自己为好友'));
    }

    const exist = await this.adapter.findOne({
      from,
      to,
    });
    if (exist) {
      throw new Errors.MoleculerError(t('不能发送重复的好友请求'));
    }

    const isFriend = await ctx.call('friend.checkIsFriend', { targetId: to });
    if (isFriend) {
      throw new Error(t('对方已经是您的好友, 不能再次添加'));
    }

    // 检查目标用户是否为机器人
    try {
      const targetUser = await ctx.call('user.getUserInfo', { userId: to });
      
      // 如果目标是机器人（pluginBot 或 openapiBot），直接建立好友关系
      if (targetUser && ((targetUser as any).type === 'pluginBot' || (targetUser as any).type === 'openapiBot')) {
        // 直接建立好友关系，跳过等待确认
        await ctx.call('friend.buildFriendRelation', {
          user1: from,
          user2: to,
        });

        // 返回自动接受的好友请求信息
        return {
          _id: null, // 没有实际的请求记录
          from,
          to,
          message,
          autoAccepted: true, // 标记为自动接受
          createdAt: new Date(),
        };
      }
    } catch (e) {
      // 如果获取用户信息失败，继续按正常流程处理
      this.broker.logger.warn('Failed to check if target is bot, proceeding with normal friend request:', e);
    }

    // 正常用户：创建好友请求等待确认
    const doc = await this.adapter.insert({
      from,
      to,
      message,
    });
    const request = await this.transformDocuments(ctx, {}, doc);

    this.listcastNotify(ctx, [from, to], 'add', request);

    return request;
  }

  /**
   * 所有与自己相关的好友请求
   */
  async allRelated(ctx: TcContext) {
    const userId = ctx.meta.userId;

    const doc = await this.adapter.find({
      query: {
        $or: [{ from: userId }, { to: userId }],
      },
    });

    const list = await await this.transformDocuments(ctx, {}, doc);
    return list;
  }

  /**
   * 接受好友请求
   */
  async accept(ctx: TcContext<{ requestId: string }>) {
    const requestId = ctx.params.requestId;

    const request: FriendRequest = await this.adapter.findById(requestId);
    if (_.isNil(request)) {
      throw new DataNotFoundError(ctx.meta.t('该好友请求未找到'));
    }

    if (ctx.meta.userId !== String(request.to)) {
      throw new NoPermissionError();
    }

    await ctx.call('friend.buildFriendRelation', {
      user1: String(request.from),
      user2: String(request.to),
    });

    await this.adapter.removeById(request._id);

    this.listcastNotify(
      ctx,
      [String(request.from), String(request.to)],
      'remove',
      {
        requestId,
      }
    );

    // 兜底：确保 DM 已加入双方 dmlist（若上游已处理则此处无副作用）
    try {
      const ensureRes: { converseId: string } = await ctx.call(
        'chat.converse.ensureDMWithUser',
        { userId: String(request.from) },
        { meta: { ...ctx.meta, userId: String(request.to) } }
      );
      const cid = String((ensureRes as any)?.converseId || '');
      if (cid) {
        try { await ctx.call('user.dmlist.addConverse', { converseId: cid }, { meta: { ...ctx.meta, userId: String(request.to) } }); } catch {}
        try { await ctx.call('user.dmlist.addConverse', { converseId: cid }, { meta: { ...ctx.meta, userId: String(request.from) } }); } catch {}
      }
    } catch {}
  }

  /**
   * 拒绝好友请求
   */
  async deny(ctx: TcContext<{ requestId: string }>) {
    const requestId = ctx.params.requestId;

    const request: FriendRequest = await this.adapter.findById(requestId);
    if (_.isNil(request)) {
      throw new DataNotFoundError(ctx.meta.t('该好友请求未找到'));
    }

    if (ctx.meta.userId !== String(request.to)) {
      throw new NoPermissionError();
    }

    await this.adapter.removeById(request._id);

    this.listcastNotify(
      ctx,
      [String(request.from), String(request.to)],
      'remove',
      {
        requestId,
      }
    );
  }

  /**
   * 取消好友请求
   */
  async cancel(ctx: TcContext<{ requestId: string }>) {
    const requestId = ctx.params.requestId;

    const request: FriendRequest = await this.adapter.findById(requestId);
    if (_.isNil(request)) {
      throw new DataNotFoundError(ctx.meta.t('该好友请求未找到'));
    }

    if (ctx.meta.userId !== String(request.from)) {
      throw new NoPermissionError();
    }

    await this.adapter.removeById(request._id);

    this.listcastNotify(
      ctx,
      [String(request.from), String(request.to)],
      'remove',
      {
        requestId,
      }
    );
  }
}
export default FriendService;
