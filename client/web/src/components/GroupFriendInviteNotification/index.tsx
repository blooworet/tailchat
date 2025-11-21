import React from 'react';
import { Tooltip } from 'antd';
import { IconBtn } from '@/components/IconBtn';
import { Avatar } from 'tailchat-design';
import { UserName } from '@/components/UserName';
import { useAsyncRequest } from 'tailchat-shared/hooks/useAsyncRequest';
import { t } from 'tailchat-shared/i18n';
import { showToasts, showErrorToasts } from 'tailchat-shared/manager/ui';
import type { GroupFriendInvite } from 'tailchat-shared/model/group-friend-invite';
import { handleGroupInvite } from 'tailchat-shared/model/group-friend-invite';
import { useAppDispatch } from 'tailchat-shared/redux/hooks/useAppSelector';
import { groupActions } from 'tailchat-shared/redux/slices';
import { getOrCreateSocket } from 'tailchat-shared/api/socket';
import type { GroupInfo } from 'tailchat-shared/model/group';


interface GroupFriendInviteNotificationProps {
  invite: GroupFriendInvite;
  type: 'received' | 'sent'; // 区分收到的邀请和发出的邀请
  onHandled?: () => void;
}

function GroupFriendInviteNotificationComponent({ invite, type, onHandled }: GroupFriendInviteNotificationProps) {
  const dispatch = useAppDispatch();
  const [{ loading }, handleInviteAction] = useAsyncRequest(
    async (action: 'accept' | 'reject') => {
      try {
        await handleGroupInvite(invite._id, action);
        showToasts(
          action === 'accept' ? t('已加入群组') : t('已拒绝邀请'),
          'success'
        );
        if (action === 'accept') {
          try {
            const socket = await getOrCreateSocket();
            const groups = await socket.request<GroupInfo[]>('group.getUserGroups');
            dispatch(groupActions.appendGroups(Array.isArray(groups) ? groups : []));
          } catch (e) {
            // 忽略刷新失败，不阻塞 UI
          }
        }
        onHandled?.();
      } catch (error) {
        showErrorToasts(error);
      }
    },
    [invite._id, onHandled]
  );

  const isExpired = new Date(invite.expiredAt).valueOf() < Date.now();
  const isPending = invite.status === 'pending' && !isExpired;
  const sentStatusLabel = invite.status === 'accepted'
    ? t('已接受')
    : invite.status === 'rejected'
    ? t('已拒绝')
    : isExpired
    ? t('已过期')
    : t('等待中');
  const sentStatusColor = invite.status === 'accepted'
    ? 'green'
    : invite.status === 'rejected'
    ? 'red'
    : isExpired
    ? 'orange'
    : 'blue';

  // 对于发出的邀请，显示所有状态；对于收到的邀请，只显示待处理的
  if (type === 'received' && !isPending) {
    return null; // 收到的邀请：已处理的不显示
  }

  return (
    <div className="flex items-start px-2.5 py-3 rounded group bg-black bg-opacity-0 hover:bg-opacity-20 dark:bg-white dark:bg-opacity-0 dark:hover:bg-opacity-20">
      <div className="mr-2 mt-1">
        <Avatar 
          src={(invite as any)?.groupId?.avatar}
          name={(invite as any)?.groupId?.name ?? t('未知群组')}
        />
      </div>
      <div className="flex-1 text-gray-900 dark:text-white">
        <div className="mb-1">
          {type === 'received' ? (
            <>@{(invite as any)?.inviter?._id ? <UserName userId={(invite as any).inviter._id} /> : t('未知用户')} {t('邀请你进入')} {(invite as any)?.groupId?.name ?? t('未知群组')}</>
          ) : (
            <>{t('邀请')} @{(invite as any)?.invitee?._id ? <UserName userId={(invite as any).invitee._id} /> : t('未知用户')} {t('加入')} {(invite as any)?.groupId?.name ?? t('未知群组')}</>
          )}
        </div>
        {/* 显示邀请消息 */}
        {invite.message && (
          <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded px-2 py-1 mt-1">
            {invite.message}
          </div>
        )}
      </div>
      <div className="flex items-center space-x-2 mt-1">
        {type === 'received' && isPending ? (
          // 收到的邀请：显示接受/拒绝按钮
          <>
            <Tooltip title={t('接受')}>
              <div>
                <IconBtn
                  icon="mdi:check"
                  disabled={loading}
                  onClick={() => handleInviteAction('accept')}
                />
              </div>
            </Tooltip>
            <Tooltip title={t('拒绝')}>
              <div>
                <IconBtn
                  icon="mdi:close"
                  disabled={loading}
                  onClick={() => handleInviteAction('reject')}
                />
              </div>
            </Tooltip>
          </>
        ) : (
          // 发出的邀请：显示状态标签（不依赖 antd Tag，避免类型问题）
          <span className={`ant-tag ant-tag-${sentStatusColor}`}>{sentStatusLabel}</span>
        )}
      </div>
    </div>
  );
}

export const GroupFriendInviteNotification = React.memo(GroupFriendInviteNotificationComponent);

GroupFriendInviteNotification.displayName = 'GroupFriendInviteNotification';
