import { Types } from 'mongoose';
import type { AckDocument, AckModel } from '../../../models/chat/ack';
import { TcService, TcContext, TcDbService } from 'tailchat-server-sdk';

/**
 * 消息已读管理
 */

interface AckService extends TcService, TcDbService<AckDocument, AckModel> {}
class AckService extends TcService {
  private _ackRate?: Map<string, number>;
  get serviceName(): string {
    return 'chat.ack';
  }

  onInit(): void {
    this.registerLocalDb(require('../../../models/chat/ack').default);
    // Public fields
    this.registerDbField(['userId', 'converseId', 'lastMessageId']);
    this._ackRate = new Map();

    this.registerAction('update', this.updateAck, {
      params: {
        converseId: 'string',
        lastMessageId: 'string',
      },
    });
    this.registerAction('list', this.listAck, {
      params: {
        converseIds: {
          type: 'array',
          items: 'string',
        },
      },
    });
    this.registerAction('converse', this.listAckByConverse, {
      params: {
        converseId: 'string',
      },
    });
    this.registerAction('all', this.allAck);
  }

  /**
   * 更新用户在会话中已读的最后一条消息
   */
  async updateAck(
    ctx: TcContext<{
      converseId: string;
      lastMessageId: string;
    }>
  ) {
    const { converseId, lastMessageId } = ctx.params;
    const userId = ctx.meta.userId;
    const ip = (ctx.meta as any)?.ip || (ctx.meta as any)?.remoteAddress || '';
    const ua = (ctx.meta as any)?.userAgent || (ctx.meta as any)?.headers?.['user-agent'] || '';

    const audit = (status: string, reason?: string) => {
      try {
        (this as any).logger?.info?.('ack.update', {
          status,
          reason: reason || 'ok',
          userId: String(userId || ''),
          converseId: String(converseId || ''),
          lastMessageId: String(lastMessageId || ''),
          ip: String(ip || ''),
          ua: String(ua || ''),
        });
      } catch {}
    };

    // rate limit: 1 req/sec per user per converse (per-process)
    try {
      const key = `${String(userId)}:${String(converseId)}`;
      const now = Date.now();
      const last = this._ackRate?.get(key) || 0;
      if (now - last < 1000) {
        this._ackRate?.set(key, now);
        audit('limited', 'rate');
        return;
      }
      this._ackRate?.set(key, now);
    } catch {}

    // membership check
    let isMember = false;
    try {
      const ConverseModel = require('../../../models/chat/converse').default;
      const c = await ConverseModel.findById(converseId);
      if (c && Array.isArray(c.members)) {
        isMember = c.members.some((m: any) => String(m) === String(userId));
      } else {
        const GroupModel = require('../../../models/group/group').default;
        const g = await GroupModel.findOne({ 'panels.id': converseId });
        if (g && Array.isArray(g.members)) {
          isMember = g.members.some((m: any) => String(m?.userId) === String(userId));
        }
      }
    } catch (e) {
      isMember = false;
    }
    if (!isMember) {
      audit('denied', 'not_in_converse');
      throw new Error('Not in conversation');
    }

    // lastMessageId ownership check
    try {
      const MessageModel = require('../../../models/chat/message').default;
      const msg = await MessageModel.findById(lastMessageId);
      if (!msg || String(msg.converseId) !== String(converseId)) {
        audit('denied', 'invalid_message');
        throw new Error('Invalid lastMessageId');
      }
    } catch (e) {
      if (String((e as any)?.message || '') !== 'Invalid lastMessageId') {
        audit('denied', 'invalid_message');
        throw new Error('Invalid lastMessageId');
      } else {
        throw e;
      }
    }

    await this.adapter.model.updateOne(
      {
        converseId,
        userId,
      },
      {
        lastMessageId: new Types.ObjectId(lastMessageId),
      },
      {
        upsert: true,
      }
    );

    // 通知会话成员：某成员的 ack 已更新
    try {
      await this.roomcastNotify(ctx, String(converseId), 'updated', {
        converseId: String(converseId),
        userId: String(userId),
        lastMessageId: String(lastMessageId),
      });
      audit('ok');
    } catch (e) {
      (this as any).logger?.warn?.('ack updated notify failed:', String(e));
    }
  }

  /**
   * 所有的ack信息
   */
  async listAck(ctx: TcContext<{ converseIds: string[] }>) {
    const userId = ctx.meta.userId;
    const { converseIds } = ctx.params;

    const list = await this.adapter.model.find({
      userId,
      converseId: {
        $in: [...converseIds],
      },
    });

    return converseIds.map((converseId) => {
      const lastMessageId =
        list
          .find((item) => String(item.converseId) === converseId)
          ?.lastMessageId?.toString() ?? null;

      return lastMessageId
        ? {
            converseId,
            lastMessageId,
          }
        : null;
    });
  }

  /**
   * 所有的ack信息
   */
  async allAck(ctx: TcContext) {
    const userId = ctx.meta.userId;

    const list = await this.adapter.model.find({
      userId,
    });

    return await this.transformDocuments(ctx, {}, list);
  }

  /**
   * 获取某个会话内其他成员的已读信息
   */
  async listAckByConverse(ctx: TcContext<{ converseId: string }>) {
    const userId = ctx.meta.userId;
    const converseId = ctx.params.converseId;

    let memberObjectIds: Types.ObjectId[] = [];

    // 尝试从 Converse 表查询（私聊/多人会话场景）
    const ConverseModel = require('../../../models/chat/converse').default;
    const converse = await ConverseModel.findById(converseId);
    
    if (converse) {
      // 私聊/多人会话场景：从会话成员列表获取
      memberObjectIds = (converse.members || [])
        .map((m: any) => new Types.ObjectId(String(m)))
        .filter((oid) => String(oid) !== String(userId));
    } else {
      // 群聊场景：converseId 实际是 panelId，需要从群组成员查询
      try {
        const GroupModel = require('../../../models/group/group').default;
        
        // 查找包含该 panelId 的群组
        const group = await GroupModel.findOne({
          'panels.id': converseId,
        });

        if (group && group.members) {
          memberObjectIds = (group.members || [])
            .map((m: any) => new Types.ObjectId(String(m.userId)))
            .filter((oid) => String(oid) !== String(userId));
        }
      } catch (e) {
        (this as any).logger?.warn?.(
          'Failed to get group members for ack:',
          String(e)
        );
      }
    }

    if (memberObjectIds.length === 0) {
      return [];
    }

    const list = await this.adapter.model.find({
      converseId: new Types.ObjectId(converseId),
      userId: { $in: memberObjectIds },
    });

    return await this.transformDocuments(ctx, {}, list);
  }
}

export default AckService;
