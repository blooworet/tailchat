import React, { useState, useMemo } from 'react';
import { Button, Input, Checkbox, Empty, Divider, message } from 'antd';
import { ModalWrapper } from '@/components/Modal';
import { Avatar } from 'tailchat-design';
import { UserName } from '@/components/UserName';
import { Icon } from 'tailchat-design';
import {
  useAppSelector,
  useAsyncRequest,
  t,
  PERMISSION,
  useHasGroupPermission,
  useUserInfoList,
  showToasts,
  showErrorToasts,
} from 'tailchat-shared';
import { inviteFriendToGroup } from 'tailchat-shared/model/group-friend-invite';
import { closeModal } from '@/components/Modal';

interface InviteFriendToGroupProps {
  groupId: string;
  onSuccess?: () => void;
}

interface FriendItemProps {
  friendId: string;
  selected: boolean;
  onToggle: (friendId: string, selected: boolean) => void;
  userInfo?: any;
}

const FriendItem: React.FC<FriendItemProps> = React.memo(
  ({ friendId, selected, onToggle, userInfo }) => {
    const handleClick = (e: React.MouseEvent) => {
      // 如果点击的是复选框，不处理外层点击事件
      if ((e.target as HTMLElement).closest('.ant-checkbox-wrapper')) {
        return;
      }
      onToggle(friendId, !selected);
    };

    return (
      <div
        className="flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer transition-colors"
        onClick={handleClick}
      >
        <Checkbox 
          checked={selected} 
          onChange={(e) => {
            e.stopPropagation(); // 阻止事件冒泡
            onToggle(friendId, e.target.checked);
          }} 
        />
        <Avatar 
          className="ml-3 mr-3" 
          size={40} 
          src={userInfo?.avatar}
          name={userInfo?.nickname || userInfo?.username}
        />
        <div className="flex-1">
          <UserName userId={friendId} />
        </div>
      </div>
    );
  }
);
FriendItem.displayName = 'FriendItem';

export const InviteFriendToGroup: React.FC<InviteFriendToGroupProps> = React.memo(
  ({ groupId, onSuccess }) => {
    const friends = useAppSelector((state) => state.user.friends);
    const friendIds = useMemo(() => friends.map((f) => f.id), [friends]);
    const userInfos = useUserInfoList(friendIds);
    
    const [hasInvitePermission] = useHasGroupPermission(groupId, [
      PERMISSION.core.invite,
    ]);

    const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
    const [inviteMessage, setInviteMessage] = useState('');
    const [searchText, setSearchText] = useState('');

    // 过滤好友列表
    const filteredFriends = useMemo(() => {
      if (!searchText.trim()) {
        return friendIds;
      }

      const searchLower = searchText.toLowerCase();
      return friendIds.filter((friendId) => {
        const userInfo = userInfos.find((u) => u?._id === friendId);
        return (
          userInfo?.nickname?.toLowerCase().includes(searchLower) ||
          userInfo?.email?.toLowerCase().includes(searchLower)
        );
      });
    }, [friendIds, userInfos, searchText]);

    const [{ loading }, handleInviteFriends] = useAsyncRequest(
      async () => {
        if (selectedFriends.length === 0) {
          showErrorToasts(t('请选择要邀请的好友'));
          return;
        }

        const promises = selectedFriends.map((friendId) =>
          inviteFriendToGroup(groupId, friendId, inviteMessage || undefined)
        );

        await Promise.all(promises);

        showToasts(
          t('已向 {{count}} 位好友发送邀请', { count: selectedFriends.length }),
          'success'
        );

        onSuccess?.();
        closeModal();
      },
      [groupId, selectedFriends, inviteMessage, onSuccess]
    );

    const handleToggleFriend = (friendId: string, selected: boolean) => {
      if (selected) {
        setSelectedFriends((prev) => {
          // 避免重复添加
          if (prev.includes(friendId)) {
            return prev;
          }
          return [...prev, friendId];
        });
      } else {
        setSelectedFriends((prev) => prev.filter((id) => id !== friendId));
      }
    };

    const handleSelectAll = () => {
      if (selectedFriends.length === filteredFriends.length) {
        setSelectedFriends([]);
      } else {
        setSelectedFriends([...filteredFriends]);
      }
    };

    if (!hasInvitePermission) {
      return (
        <ModalWrapper title={t('邀请好友加入群组')}>
          <div className="text-center py-8">
            <Icon className="text-6xl text-gray-400 mb-4" icon="mdi:account-remove" />
            <div className="text-gray-500">{t('您没有邀请权限')}</div>
          </div>
        </ModalWrapper>
      );
    }

    if (friends.length === 0) {
      return (
        <ModalWrapper title={t('邀请好友加入群组')}>
          <div className="text-center py-8">
            <Icon className="text-6xl text-gray-400 mb-4" icon="mdi:account-plus" />
            <div className="text-gray-500">{t('暂无好友可邀请')}</div>
            <div className="text-sm text-gray-400 mt-2">
              {t('先去添加一些好友吧')}
            </div>
          </div>
        </ModalWrapper>
      );
    }

    return (
      <ModalWrapper title={t('邀请好友加入群组')} style={{ width: 480 }}>
        <div className="space-y-4">
          {/* 搜索框 */}
          <Input
            placeholder={t('搜索好友')}
            prefix={<Icon icon="mdi:magnify" />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />

          {/* 邀请消息 */}
          <div>
            <div className="mb-2 text-sm text-gray-600">
              {t('邀请消息')} ({t('可选')})
            </div>
            <Input.TextArea
              placeholder={t('输入邀请消息...')}
              value={inviteMessage}
              onChange={(e) => setInviteMessage(e.target.value)}
              maxLength={200}
              rows={3}
              showCount
            />
          </div>

          <Divider className="my-4" />

          {/* 好友列表 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-gray-600">
                {t('选择好友')} ({selectedFriends.length}/{filteredFriends.length})
              </div>
              {filteredFriends.length > 0 && (
                <Button type="link" size="small" onClick={handleSelectAll}>
                  {selectedFriends.length === filteredFriends.length
                    ? t('取消全选')
                    : t('全选')}
                </Button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto border rounded">
              {filteredFriends.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('没有找到匹配的好友')}
                />
              ) : (
                filteredFriends.map((friendId) => {
                  const userInfo = userInfos.find((u) => u?._id === friendId);
                  return (
                    <FriendItem
                      key={friendId}
                      friendId={friendId}
                      selected={selectedFriends.includes(friendId)}
                      onToggle={handleToggleFriend}
                      userInfo={userInfo}
                    />
                  );
                })
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end space-x-2 pt-4">
            <Button onClick={() => closeModal()}>{t('取消')}</Button>
            <Button
              type="primary"
              loading={loading}
              disabled={selectedFriends.length === 0}
              onClick={handleInviteFriends}
            >
              {t('发送邀请')} ({selectedFriends.length})
            </Button>
          </div>
        </div>
      </ModalWrapper>
    );
  }
);

InviteFriendToGroup.displayName = 'InviteFriendToGroup';
