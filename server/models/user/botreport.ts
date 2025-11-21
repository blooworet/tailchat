import { getModelForClass, index, modelOptions, prop } from '@typegoose/typegoose';
import type { Types } from 'mongoose';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

@modelOptions({ options: { customName: 'user_botreports' } })
@index({ userId: 1, botUserId: 1, createdAt: -1 })
export class UserBotReport extends TimeStamps {
  _id: Types.ObjectId;

  @prop({ required: true })
  userId!: Types.ObjectId; // 举报人

  @prop({ required: true })
  botUserId!: Types.ObjectId; // 被举报的机器人

  @prop({ required: true })
  reason!: string; // 原因枚举/自由文本

  @prop()
  details?: string; // 详细描述
}

const model = getModelForClass(UserBotReport);
export type UserBotReportModel = typeof model;
export default model;


