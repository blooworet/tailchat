import React, { useState } from 'react';
import { Empty, Spin, Badge } from 'antd';
import { PillTabs } from '@/components/PillTabs';
import { t, useAsyncRefresh } from 'tailchat-shared';
import {
  getUserReceivedInvites,
  getUserSentInvites,
} from 'tailchat-shared/model/group-friend-invite';
import { GroupFriendInviteNotification } from '@/components/GroupFriendInviteNotification';

/**
 * 群组邀请管理页面
 */
export const GroupInvites: React.FC = React.memo(() => {
  const [activeKey, setActiveKey] = useState('1');

  // 收到的邀请
  const {
    loading: receivedLoading,
    value: receivedInvites = [],
    refresh: refreshReceived,
  } = useAsyncRefresh(async () => {
    return await getUserReceivedInvites();
  }, []);

  // 发出的邀请
  const {
    loading: sentLoading,
    value: sentInvites = [],
    refresh: refreshSent,
  } = useAsyncRefresh(async () => {
    return await getUserSentInvites();
  }, []);

  const handleInviteHandled = () => {
    refreshReceived();
    refreshSent();
  };

  return (
    <div className="w-full">
      <PillTabs
        className="h-full"
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          {
            key: '1',
            label: (
              <Badge
                className="text-black dark:text-white"
                size="small"
                count={receivedInvites.length}
              >
                {t('收到的邀请')}
              </Badge>
            ),
            children: (
              <div className="h-full overflow-y-auto">
                {receivedLoading ? (
                  <div className="flex justify-center items-center h-32">
                    <Spin size="large" />
                  </div>
                ) : receivedInvites.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('暂无收到的群组邀请')}
                  />
                ) : (
                  <div>
                    {receivedInvites.map((invite) => (
                      <GroupFriendInviteNotification
                        key={invite._id}
                        invite={invite}
                        type="received"
                        onHandled={handleInviteHandled}
                      />
                    ))}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: '2',
            label: t('发出的邀请'),
            children: (
              <div className="h-full overflow-y-auto">
                {sentLoading ? (
                  <div className="flex justify-center items-center h-32">
                    <Spin size="large" />
                  </div>
                ) : sentInvites.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('暂无发出的群组邀请')}
                  />
                ) : (
                  <div>
                    {sentInvites.map((invite) => (
                      <GroupFriendInviteNotification
                        key={invite._id}
                        invite={invite}
                        type="sent"
                        onHandled={handleInviteHandled}
                      />
                    ))}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
});

GroupInvites.displayName = 'GroupInvites';
