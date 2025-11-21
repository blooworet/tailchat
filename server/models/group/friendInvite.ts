import {
  getModelForClass,
  prop,
  DocumentType,
  Ref,
  ReturnModelType,
  modelOptions,
} from '@typegoose/typegoose';
import { Base, TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';
import type { Types } from 'mongoose';
import { User } from '../user/user';
import { Group } from './group';

/**
 * 群组好友邀请状态
 */
export enum GroupFriendInviteStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
  Expired = 'expired',
}

/**
 * 群组好友邀请
 */
@modelOptions({
  options: {
    customName: 'group_friend_invite',
  },
})
export class GroupFriendInvite extends TimeStamps implements Base {
  _id: Types.ObjectId;
  id: string;

  /**
   * 群组ID
   */
  @prop({
    ref: () => Group,
    required: true,
    index: true,
  })
  groupId: Ref<Group>;

  /**
   * 邀请人ID
   */
  @prop({
    ref: () => User,
    required: true,
    index: true,
  })
  inviter: Ref<User>;

  /**
   * 被邀请人ID
   */
  @prop({
    ref: () => User,
    required: true,
    index: true,
  })
  invitee: Ref<User>;

  /**
   * 邀请消息
   */
  @prop({
    maxlength: 200,
  })
  message?: string;

  /**
   * 邀请状态
   */
  @prop({
    enum: GroupFriendInviteStatus,
    default: GroupFriendInviteStatus.Pending,
    index: true,
  })
  status: GroupFriendInviteStatus;

  /**
   * 过期时间（默认7天）
   */
  @prop({
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    index: true,
  })
  expiredAt: Date;

  /**
   * 处理时间
   */
  @prop()
  handledAt?: Date;

  /**
   * 创建群组好友邀请
   */
  static async createInvite(
    this: ReturnModelType<typeof GroupFriendInvite>,
    groupId: string,
    inviter: string,
    invitee: string,
    message?: string
  ): Promise<GroupFriendInviteDocument> {
    // 检查是否已有未处理的邀请
    const existingInvite = await this.findOne({
      groupId,
      inviter,
      invitee,
      status: GroupFriendInviteStatus.Pending,
      expiredAt: { $gt: new Date() },
    });

    if (existingInvite) {
      throw new Error('已存在未处理的邀请');
    }

    const invite = await this.create({
      groupId,
      inviter,
      invitee,
      message,
      status: GroupFriendInviteStatus.Pending,
    });

    return invite;
  }

  /**
   * 获取用户收到的群组邀请
   */
  static async getUserReceivedInvites(
    this: ReturnModelType<typeof GroupFriendInvite>,
    userId: string
  ): Promise<GroupFriendInviteDocument[]> {
    return await this.find({
      invitee: userId,
      status: GroupFriendInviteStatus.Pending,
      expiredAt: { $gt: new Date() },
    })
      .populate('groupId', 'name avatar memberCount')
      .populate('inviter', 'nickname avatar')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * 获取用户发出的群组邀请
   */
  static async getUserSentInvites(
    this: ReturnModelType<typeof GroupFriendInvite>,
    userId: string
  ): Promise<GroupFriendInviteDocument[]> {
    return await this.find({
      inviter: userId,
      expiredAt: { $gt: new Date() },
    })
      .populate('groupId', 'name avatar')
      .populate('invitee', 'nickname avatar')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * 处理邀请
   */
  static async handleInvite(
    this: ReturnModelType<typeof GroupFriendInvite>,
    inviteId: string,
    action: 'accept' | 'reject'
  ): Promise<GroupFriendInviteDocument> {
    const status = action === 'accept' 
      ? GroupFriendInviteStatus.Accepted 
      : GroupFriendInviteStatus.Rejected;

    const invite = await this.findByIdAndUpdate(
      inviteId,
      {
        status,
        handledAt: new Date(),
      },
      { new: true }
    );

    if (!invite) {
      throw new Error('邀请不存在');
    }

    return invite;
  }

  /**
   * 清理过期邀请
   */
  static async cleanExpiredInvites(
    this: ReturnModelType<typeof GroupFriendInvite>
  ): Promise<void> {
    await this.updateMany(
      {
        status: GroupFriendInviteStatus.Pending,
        expiredAt: { $lt: new Date() },
      },
      {
        status: GroupFriendInviteStatus.Expired,
      }
    );
  }
}

export type GroupFriendInviteDocument = DocumentType<GroupFriendInvite>;
export type GroupFriendInviteModel = ReturnModelType<typeof GroupFriendInvite>;

export default getModelForClass(GroupFriendInvite);
