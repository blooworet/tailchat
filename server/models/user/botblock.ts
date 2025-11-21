import { getModelForClass, index, modelOptions, prop } from '@typegoose/typegoose';
import type { Types } from 'mongoose';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

@modelOptions({ options: { customName: 'user_botblocks' } })
@index({ userId: 1, botUserId: 1 }, { unique: true })
export class UserBotBlock extends TimeStamps {
  _id: Types.ObjectId;

  @prop({ required: true })
  userId!: Types.ObjectId;

  @prop({ required: true })
  botUserId!: Types.ObjectId;
}

const model = getModelForClass(UserBotBlock);
export type UserBotBlockModel = typeof model;
export default model;


