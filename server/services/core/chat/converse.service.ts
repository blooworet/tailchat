import _ from 'lodash';
import { Types } from 'mongoose';
import {
  TcDbService,
  TcService,
  TcContext,
  UserStruct,
  call,
  DataNotFoundError,
  NoPermissionError,
  SYSTEM_USERID,
  config,
} from 'tailchat-server-sdk';
import type {
  ConverseDocument,
  ConverseModel,
} from '../../../models/chat/converse';

interface ConverseService
  extends TcService,
    TcDbService<ConverseDocument, ConverseModel> {}
class ConverseService extends TcService {
  get serviceName(): string {
    return 'chat.converse';
  }

  onInit(): void {
    this.registerLocalDb(require('../../../models/chat/converse').default);

    this.registerAction('createDMConverse', this.createDMConverse, {
      params: {
        /**
         * 创建私人会话的参与者ID列表
         */
        memberIds: { type: 'array', items: 'string' },
      },
    } as any);
    this.registerAction(
      'appendDMConverseMembers',
      this.appendDMConverseMembers,
      {
        params: {
          converseId: 'string',
          memberIds: 'array',
        },
      } as any
    );
    this.registerAction('findConverseInfo', this.findConverseInfo, {
      params: {
        converseId: 'string',
      },
    } as any);
    this.registerAction('findAndJoinRoom', this.findAndJoinRoom);
    this.registerAction('ensureDMWithUser', this.ensureDMWithUser, {
      params: {
        userId: 'string',
      },
    } as any);
    this.registerAction('startBotDM', this.startBotDM, {
      params: {
        botUserId: 'string',
        payload: { type: 'any', optional: true },
      },
    } as any);
  }

  async createDMConverse(ctx: TcContext<{ memberIds: string[] }>) {
    const userId = ctx.meta.userId;
    const rawMemberIds = ctx.params.memberIds;
    const t = ctx.meta.t;

    const cleanedMemberIds = _.uniq((rawMemberIds || []).map(String));
    if (cleanedMemberIds.length === 1 && cleanedMemberIds[0] === String(userId)) {
      throw new Error(t('不能与自己创建会话'));
    }
    const participantList = _.uniq([String(userId), ...cleanedMemberIds]);

    if (participantList.length < 2) {
      throw new Error(t('成员数异常，无法创建会话'));
    }

    let converse: ConverseDocument;
    if (participantList.length === 2) {
      // 私信会话
      converse = await this.adapter.model.findConverseWithMembers(
        participantList
      );
      if (converse === null) {
        // 创建新的会话
        converse = await this.adapter.model.create({
          type: 'DM',
          members: participantList.map((id) => new Types.ObjectId(id)),
        });
      }
    }

    if (participantList.length > 2) {
      // 多人会话
      converse = await this.adapter.model.create({
        type: 'Multi',
        members: participantList.map((id) => new Types.ObjectId(id)),
      });
    }

    const roomId = String(converse._id);
    await Promise.all(
      participantList.map((memberId) =>
        call(ctx).joinSocketIORoom([roomId], memberId)
      )
    );

    // 广播更新消息
    await this.roomcastNotify(
      ctx,
      roomId,
      'updateDMConverse',
      converse.toJSON()
    );

    // 更新dmlist 异步处理
    Promise.all(
      participantList.map(async (memberId) => {
        try {
          await ctx.call(
            'user.dmlist.addConverse',
            { converseId: roomId },
            {
              meta: {
                userId: memberId,
              },
            }
          );
        } catch (e) {
          this.logger.error(e);
        }
      })
    );

    if (participantList.length > 2) {
      // 如果创建的是一个多人会话(非双人), 发送系统消息
      await Promise.all(
        _.without(participantList, userId).map<Promise<UserStruct>>(
          (memberId) => call(ctx).getUserInfo(memberId)
        )
      ).then((infoList) => {
        return call(ctx).sendSystemMessage(
          t('{{user}} 邀请 {{others}} 加入会话', {
            user: ctx.meta.user.nickname,
            others: infoList.map((info) => info.nickname).join(', '),
          }),
          roomId
        );
      });
    }

    return await this.transformDocuments(ctx, {}, converse);
  }

  /**
   * 确保与指定用户存在双人私信会话，并返回会话ID
   */
  async ensureDMWithUser(ctx: TcContext<{ userId: string }>) {
    const t = ctx.meta?.t || ((key: string) => key);
    const selfId = ctx.meta.userId;
    const otherId = ctx.params.userId;
    if (!selfId || !otherId || selfId === otherId) {
      throw new Error(t('invalid userId'));
    }
    const converse = await this.adapter.model.findConverseWithMembers([
      String(selfId),
      String(otherId),
    ]);
    if (converse) {
      // 即便会话已存在，也要确保双方加入房间，避免被动用户未入房无法收到消息
      const roomId = String(converse._id);
      try { await call(ctx).joinSocketIORoom([roomId], String(selfId)); } catch {}
      try { await call(ctx).joinSocketIORoom([roomId], String(otherId)); } catch {}
      return { converseId: roomId };
    }
    const created = await this.adapter.model.create({
      type: 'DM',
      members: [new Types.ObjectId(selfId), new Types.ObjectId(otherId)],
    });
    const roomId = String(created._id);
    await Promise.all([
      call(ctx).joinSocketIORoom([roomId], String(selfId)),
      call(ctx).joinSocketIORoom([roomId], String(otherId)),
    ]);
    await this.roomcastNotify(ctx, roomId, 'updateDMConverse', created.toJSON());
    return { converseId: roomId };
  }

  /**
   * 主动触发与机器人 DM 的 /start 事件
   */
  async startBotDM(ctx: TcContext<{ botUserId: string; payload?: any }>) {
    const t = ctx.meta?.t || ((key: string) => key);
    const fromUserId = ctx.meta.userId;
    const botUserId = ctx.params.botUserId;
    if (!fromUserId || !botUserId || fromUserId === botUserId) {
      throw new Error(t('invalid arguments'));
    }
    // 若调用者为机器人，需具备 dm.start scope
    try {
      const decoded: any = await ctx.call('user.extractTokenMeta', { token: ctx.meta.token });
      if (decoded && decoded.btid) {
        const rec = await (require('../../../models/bottoken').default).findById(decoded.btid).lean().exec();
        const scopes: string[] = Array.isArray(rec?.scopes) ? (rec!.scopes as any) : [];
        if (!scopes.includes('dm.start')) {
          throw new Error(t('Bot scope denied: dm.start'));
        }
      }
    } catch (e) {
      if (String(e?.message || '').includes('dm.start')) {
        throw e;
      }
      // 其他错误忽略，按人类用户处理
    }
    const botUser = await call(ctx).getUserInfo(botUserId);
    if (!botUser || (botUser.type !== 'pluginBot' && botUser.type !== 'openapiBot')) {
      throw new Error(t('target is not a bot'));
    }

    // Deep Link payload validation (Telegram-like): up to 64 chars, only A-Z a-z 0-9 _
    if (typeof ctx.params.payload !== 'undefined' && ctx.params.payload !== null) {
      const s = String(ctx.params.payload);
      if (s.length > 64) {
        throw new Error(t('Invalid deep link payload: length must be <= 64'));
      }
      if (!/^[A-Za-z0-9_]*$/.test(s)) {
        throw new Error(t('Invalid deep link payload: only A–Z, a–z, 0–9 and underscore are allowed'));
      }
      // normalize payload to string
      ctx.params.payload = s;
    }

    // 频控：同一 用户→机器人 在窗口内最多 N 次（可配置）
    const rl = (config as any)?.feature?.botDmStartRateLimit || {};
    const limit = Number(rl.count) > 0 ? Number(rl.count) : 30; // default widened: 30
    const windowSec = Number(rl.windowSec) > 0 ? Number(rl.windowSec) : 60; // default 60s
    await this.simpleRateLimit(`botdm:start:${fromUserId}:${botUserId}`, limit, windowSec, t);

    // 确保私信会话：使用真实 Context 调用，避免伪 ctx 导致 ctx.call 不存在
    const { converseId } = await ctx.call('chat.converse.ensureDMWithUser', {
      userId: botUserId,
    }) as any;

    ctx.emit('bot.dm.start', {
      botUserId,
      fromUserId,
      converseId,
      timestamp: Date.now(),
      params: ctx.params.payload,
    });

    return { converseId };
  }

  /**
   * 简易速率限制：在 windowSec 窗口内同 key 允许最多 limit 次
   */
  private async simpleRateLimit(key: string, limit: number, windowSec: number, t?: (key: string) => string) {
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
      const translateFn = t || ((key: string) => key);
      throw new Error(translateFn('Too many /start in short time'));
    }
    await cacher.set(key, { n: rec.n + 1, ts: rec.ts || now }, windowSec);
  }

  /**
   * 在多人会话中添加成员
   */
  async appendDMConverseMembers(
    ctx: TcContext<{ converseId: string; memberIds: string[] }>
  ) {
    const userId = ctx.meta.userId;
    const { converseId, memberIds } = ctx.params;

    const converse = await this.adapter.model.findById(converseId);
    if (!converse) {
      throw new DataNotFoundError();
    }

    if (!converse.members.map(String).includes(userId)) {
      throw new Error(ctx.meta.t('不是会话参与者, 无法添加成员'));
    }

    converse.members.push(...memberIds.map((uid) => new Types.ObjectId(uid)));
    await converse.save();

    await Promise.all(
      memberIds.map((uid) =>
        call(ctx).joinSocketIORoom([String(converseId)], uid)
      )
    );

    // 广播更新会话列表
    await this.roomcastNotify(
      ctx,
      converseId,
      'updateDMConverse',
      converse.toJSON()
    );

    // 更新dmlist 异步处理
    Promise.all(
      memberIds.map(async (memberId) => {
        try {
          await ctx.call(
            'user.dmlist.addConverse',
            { converseId },
            {
              meta: {
                userId: memberId,
              },
            }
          );
        } catch (e) {
          this.logger.error(e);
        }
      })
    );

    // 发送系统消息, 异步处理
    await Promise.all(
      memberIds.map<Promise<UserStruct>>((memberId) =>
        ctx.call('user.getUserInfo', { userId: memberId })
      )
    ).then((infoList) => {
      return call(ctx).sendSystemMessage(
        `${ctx.meta.user.nickname} 邀请 ${infoList
          .map((info) => info.nickname)
          .join(', ')} 加入会话`,
        converseId
      );
    });

    return converse;
  }

  /**
   * 查找会话
   */
  async findConverseInfo(
    ctx: TcContext<{
      converseId: string;
    }>
  ) {
    const converseId = ctx.params.converseId;
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;

    console.info('[findConverseInfo] Request started', { 
      converseId, 
      userId, 
      hasUserId: !!userId,
      userIdType: typeof userId 
    });

    const converse = await this.adapter.findById(converseId);
    
    if (!converse) {
      console.error('[findConverseInfo] Converse not found', { converseId });
      throw new DataNotFoundError(t('会话不存在'));
    }

    console.info('[findConverseInfo] Converse found', {
      converseId: converse._id,
      memberCount: converse.members?.length || 0,
      hasMembers: !!(converse.members && converse.members.length > 0)
    });

    if (userId !== SYSTEM_USERID) {
      // not system, check permission
      const memebers = converse.members ?? [];
      
      console.info('[findConverseInfo] Permission check details', {
        userId,
        userIdType: typeof userId,
        memberCount: memebers.length,
        members: memebers.map((m, idx) => ({
          index: idx,
          type: typeof m,
          value: String(m),
          hexString: (m as any)?.toHexString?.(),
          toString: m?.toString?.(),
          directMatch: String(m) === userId,
          hexMatch: (m as any)?.toHexString?.() === userId,
          toStringMatch: m?.toString?.() === userId
        }))
      });
      
      const userIdMatches = memebers.some((member) => {
        // 支持ObjectId和字符串两种格式的比较
        const memberStr = String(member);
        const memberHex = (member as any)?.toHexString?.() || memberStr;
        return memberStr === userId || memberHex === userId || member?.toString() === userId;
      });
      
      console.info('[findConverseInfo] Permission check result', {
        userIdMatches,
        userId,
        converseId
      });
      
      if (!userIdMatches) {
        console.error('[findConverseInfo] Permission denied', {
          userId,
          converseId,
          memberCount: memebers.length,
          members: memebers.map(m => ({ type: typeof m, value: String(m) }))
        });
        throw new NoPermissionError(t('没有获取会话信息权限'));
      }
    }

    console.info('[findConverseInfo] Permission check passed, returning converse');
    return await this.transformDocuments(ctx, {}, converse);
  }

  /**
   * 查找包含指定用户的所有会话
   * 用于按需加载机器人命令时，查询机器人所在的会话
   */
  async findByMember(ctx: TcContext<{
    userId: string;
  }>) {
    const { userId } = ctx.params;

    try {
      // 查询所有包含该用户的会话
      const { Types } = require('mongoose');
      const converses = await this.adapter.model.find({
        members: new Types.ObjectId(userId)
      }).select('_id members type').lean().exec();

      this.logger.info(`[findByMember] 找到用户 ${userId} 的 ${converses.length} 个会话`);

      return converses.map(c => ({
        _id: String(c._id),
        members: (c.members || []).map((m: any) => String(m)),
        type: c.type
      }));
    } catch (error) {
      this.logger.error(`[findByMember] 查询失败:`, error);
      throw error;
    }
  }

  /**
   * 查找用户相关的所有会话并加入房间
   * @returns 返回相关信息
   */
  async findAndJoinRoom(ctx: TcContext) {
    const userId = ctx.meta.userId;
    const dmConverseIds = await this.adapter.model.findAllJoinedConverseId(
      userId
    );

    // 获取群组列表
    const { groupIds, textPanelIds, subscribeFeaturePanelIds } =
      await ctx.call<{
        groupIds: string[];
        textPanelIds: string[];
        subscribeFeaturePanelIds: string[];
      }>('group.getJoinedGroupAndPanelIds');

    await call(ctx).joinSocketIORoom([
      `u-${userId}`, // 添加用户个人房间，用于unicast推送
      ...dmConverseIds,
      ...groupIds,
      ...textPanelIds,
      ...subscribeFeaturePanelIds,
    ]);

    return {
      dmConverseIds,
      groupIds,
      textPanelIds,
      subscribeFeaturePanelIds,
    };
  }
}

export default ConverseService;
