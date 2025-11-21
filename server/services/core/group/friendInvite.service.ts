import {
  TcService,
  TcContext,
  TcDbService,
  call,
  NoPermissionError,
  PERMISSION,
  EntityError,
} from 'tailchat-server-sdk';
import type {
  GroupFriendInvite,
  GroupFriendInviteDocument,
  GroupFriendInviteModel,
} from '../../../models/group/friendInvite';
import { isValidStr } from '../../../lib/utils';

interface GroupFriendInviteService
  extends TcService,
    TcDbService<GroupFriendInviteDocument, GroupFriendInviteModel> {}

class GroupFriendInviteService extends TcService {
  get serviceName(): string {
    return 'group.friendInvite';
  }

  onInit(): void {
    this.registerLocalDb(require('../../../models/group/friendInvite').default);

    this.registerAction('inviteFriendToGroup', this.inviteFriendToGroup, {
      params: {
        groupId: 'string',
        friendId: 'string',
        message: { type: 'string', optional: true },
      },
    });

    this.registerAction('handleGroupInvite', this.handleGroupInvite, {
      params: {
        inviteId: 'string',
        action: { type: 'enum', values: ['accept', 'reject'] },
      },
    });

    this.registerAction('getUserReceivedInvites', this.getUserReceivedInvites);
    this.registerAction('getUserSentInvites', this.getUserSentInvites);
    this.registerAction('getGroupInviteById', this.getGroupInviteById, {
      params: {
        inviteId: 'string',
      },
    });

    // 定时清理过期邀请
    this.registerAction('cleanExpiredInvites', this.cleanExpiredInvites);
  }

  /**
   * 邀请好友加入群组
   */
  async inviteFriendToGroup(
    ctx: TcContext<{
      groupId: string;
      friendId: string;
      message?: string;
    }>
  ): Promise<GroupFriendInvite> {
    const { groupId, friendId, message } = ctx.params;
    const { userId, t } = ctx.meta;

    if (!isValidStr(groupId)) {
      throw new EntityError(t('群组ID不能为空'));
    }

    if (!isValidStr(friendId)) {
      throw new EntityError(t('好友ID不能为空'));
    }

    if (userId === friendId) {
      throw new EntityError(t('不能邀请自己'));
    }

    // 1. 权限检查：是否有邀请权限
    const [hasInvitePermission] = await call(ctx).checkUserPermissions(
      groupId,
      userId,
      [PERMISSION.core.invite]
    );

    if (!hasInvitePermission) {
      throw new NoPermissionError(t('没有邀请权限'));
    }

    // 2. 检查是否为好友关系
    const isFriend = await ctx.call('friend.isFriend', {
      userId,
      targetId: friendId,
    });

    if (!isFriend) {
      throw new EntityError(t('只能邀请好友加入群组'));
    }

    // 3. 检查目标用户是否已在群组中
    const isMember = await ctx.call('group.isMember', {
      groupId,
      userId: friendId,
    });

    if (isMember) {
      throw new EntityError(t('用户已在群组中'));
    }

    // 4. 创建邀请记录
    const invite = await this.adapter.model.createInvite(
      groupId,
      userId,
      friendId,
      message
    );

    const transformedInvite = await this.transformDocuments(ctx, {}, invite);

    // 5. 发送通知给被邀请人
    this.unicastNotify(ctx, friendId, 'groupFriendInvite', {
      type: 'receive',
      invite: transformedInvite,
    });

    // 6. 获取群组和邀请人信息用于通知
    const [groupInfo, inviterInfo] = await Promise.all([
      call(ctx).getGroupInfo(groupId),
      call(ctx).getUserInfo(userId),
    ]);

    // 7. 邀请发送成功，不在此时发送系统消息
    // 系统消息将在好友接受邀请并成功加入群组时发送

    return transformedInvite;
  }

  /**
   * 处理群组邀请（接受/拒绝）
   */
  async handleGroupInvite(
    ctx: TcContext<{
      inviteId: string;
      action: 'accept' | 'reject';
    }>
  ): Promise<void> {
    const { inviteId, action } = ctx.params;
    const { userId, t } = ctx.meta;

    if (!isValidStr(inviteId)) {
      throw new EntityError(t('邀请ID不能为空'));
    }

    // 1. 获取邀请信息
    const invite = await this.adapter.model.findById(inviteId);
    if (!invite) {
      throw new EntityError(t('邀请不存在'));
    }

    // 2. 权限检查：只有被邀请人可以处理
    if (String(invite.invitee) !== userId) {
      throw new NoPermissionError(t('无权处理此邀请'));
    }

    // 3. 检查邀请状态
    if (invite.status !== 'pending') {
      throw new EntityError(t('邀请已被处理'));
    }

    // 4. 检查是否过期
    if (new Date(invite.expiredAt).valueOf() < Date.now()) {
      throw new EntityError(t('邀请已过期'));
    }

    if (action === 'accept') {
      // 5a. 接受邀请：加入群组
      try {
        await ctx.call('group.addMember', {
          groupId: String(invite.groupId),
          userId,
        });

        // 更新邀请状态
        await this.adapter.model.handleInvite(inviteId, 'accept');

        // 通知邀请人
        this.unicastNotify(ctx, String(invite.inviter), 'groupFriendInvite', {
          type: 'accepted',
          inviteId,
          invitee: await call(ctx).getUserInfo(userId),
        });

        // 添加系统消息
        const [groupInfo, inviteeInfo, inviterInfo] = await Promise.all([
          call(ctx).getGroupInfo(String(invite.groupId)),
          call(ctx).getUserInfo(userId),
          call(ctx).getUserInfo(String(invite.inviter)),
        ]);

        await call(ctx).addGroupSystemMessage(
          String(invite.groupId),
          '',
          {
            sysType: 'groupInviteAccepted',
            inviteeId: String(userId),
            inviterId: String(invite.inviter),
          }
        );
      } catch (error) {
        // 如果加入群组失败，不更新邀请状态
        throw error;
      }
    } else {
      // 5b. 拒绝邀请
      await this.adapter.model.handleInvite(inviteId, 'reject');

      // 通知邀请人
      this.unicastNotify(ctx, String(invite.inviter), 'groupFriendInvite', {
        type: 'rejected',
        inviteId,
        invitee: await call(ctx).getUserInfo(userId),
      });
    }
  }

  /**
   * 获取用户收到的群组邀请
   */
  async getUserReceivedInvites(ctx: TcContext<{}>): Promise<GroupFriendInvite[]> {
    const { userId } = ctx.meta;

    const invites = await this.adapter.model.getUserReceivedInvites(userId);
    return await this.transformDocuments(ctx, {}, invites);
  }

  /**
   * 获取用户发出的群组邀请
   */
  async getUserSentInvites(ctx: TcContext<{}>): Promise<GroupFriendInvite[]> {
    const { userId } = ctx.meta;

    const invites = await this.adapter.model.getUserSentInvites(userId);
    return await this.transformDocuments(ctx, {}, invites);
  }

  /**
   * 根据ID获取群组邀请
   */
  async getGroupInviteById(
    ctx: TcContext<{ inviteId: string }>
  ): Promise<GroupFriendInvite | null> {
    const { inviteId } = ctx.params;
    const { userId } = ctx.meta;

    const invite = await this.adapter.model
      .findById(inviteId)
      .populate('groupId', 'name avatar memberCount')
      .populate('inviter', 'nickname avatar')
      .populate('invitee', 'nickname avatar')
      .exec();

    if (!invite) {
      return null;
    }

    // 权限检查：只有邀请人或被邀请人可以查看
    if (
      String(invite.inviter._id) !== userId &&
      String(invite.invitee._id) !== userId
    ) {
      throw new NoPermissionError(ctx.meta.t('无权查看此邀请'));
    }

    return await this.transformDocuments(ctx, {}, invite);
  }

  /**
   * 清理过期邀请
   */
  async cleanExpiredInvites(ctx: TcContext<{}>): Promise<void> {
    await this.adapter.model.cleanExpiredInvites();
  }
}

export default GroupFriendInviteService;
