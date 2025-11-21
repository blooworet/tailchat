import React, { useState, useEffect } from 'react';
import { AvatarWithPreview } from 'tailchat-design';
import { getUserOnlineStatus } from 'tailchat-shared/model/user';

/**
 * 用户信息容器
 */
export const UserProfileContainer = React.memo((props: any) => {
  const { userInfo } = props;
  const userId = userInfo._id;
  const [isOnline, setIsOnline] = useState(false);

  // 获取在线状态
  useEffect(() => {
    const fetchOnlineStatus = async () => {
      try {
        const onlineStatusList = await getUserOnlineStatus([userId]);
        setIsOnline(onlineStatusList?.[0] ?? false);
      } catch (e) {
        // 错误时保持 false
        setIsOnline(false);
      }
    };

    fetchOnlineStatus();
  }, [userId]);

  return (
    <div className="text-center p-8">
      {/* 头像居中显示 */}
      <div className="flex justify-center mb-6">
        <AvatarWithPreview
          size={120}
          src={userInfo.avatar}
          name={userInfo.nickname}
          isOnline={isOnline}
        />
      </div>

      {/* 用户信息内容 */}
      <div className="text-gray-900 dark:text-white">{props.children}</div>
    </div>
  );
});
UserProfileContainer.displayName = 'UserProfileContainer';
