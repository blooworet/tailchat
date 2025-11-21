import type { Ref } from '@typegoose/typegoose';
import type { Converse } from '../../../models/chat/converse';
import type {
  UserDMList,
  UserDMListDocument,
  UserDMListModel,
} from '../../../models/user/dmlist';
import { TcService, TcContext, TcDbService, db } from 'tailchat-server-sdk';

interface UserDMListService
  extends TcService,
    TcDbService<UserDMListDocument, UserDMListModel> {}
class UserDMListService extends TcService {
  get serviceName(): string {
    return 'user.dmlist';
  }

  onInit(): void {
    this.registerLocalDb(require('../../../models/user/dmlist').default);
    this.registerAction('addConverse', this.addConverse, {
      params: {
        converseId: 'string',
      },
    });
    this.registerAction('removeConverse', this.removeConverse, {
      params: {
        converseId: 'string',
      },
    });
    this.registerAction('getAllConverse', this.getAllConverse);
  }

  async addConverse(ctx: TcContext<{ converseId: string }>) {
    const userId = ctx.meta.userId;
    const converseId = ctx.params.converseId;

    const record = await this.adapter.model.findOrCreate({
      userId,
    });

    const res = await this.adapter.model.findByIdAndUpdate(record.doc._id, {
      $addToSet: {
        converseIds: new db.Types.ObjectId(converseId),
      },
    });

    return await this.transformDocuments(ctx, {}, res);
  }

  /**
   * 移除会话
   */
  async removeConverse(ctx: TcContext<{ converseId: string }>) {
    const userId = ctx.meta.userId;
    const converseId = ctx.params.converseId;

    const oid = new db.Types.ObjectId(converseId);
    const { modifiedCount } = await this.adapter.model
      .updateOne(
        { userId },
        {
          $pull: {
            // 兼容历史数据：可能混存 ObjectId 与 string，两者都尝试移除
            converseIds: { $in: [oid, converseId] as any[] },
          },
        }
      )
      .exec();

    return { modifiedCount };
  }

  /**
   * 获取所有会话
   */
  async getAllConverse(ctx: TcContext): Promise<string[]> {
    const userId = ctx.meta.userId;

    const doc = await this.adapter.model.findOne({
      userId,
    });

    const res: UserDMList | null = await this.transformDocuments(ctx, {}, doc);
    const raw = res?.converseIds ?? [];
    // 统一返回字符串形式的会话ID，避免前端拿到 Object/ObjectId 导致下游参数校验失败
    const ids = (raw as any[]).map((v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && typeof (v as any)._id === 'string') return (v as any)._id;
      try { return String(v); } catch { return ''; }
    }).filter((s) => typeof s === 'string' && s.length > 0);
    return ids;
  }
}

export default UserDMListService;
