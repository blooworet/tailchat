import { UserName } from '@/components/UserName';
import { fetchImagePrimaryColor } from '@/utils/image-helper';
import { Space, Tag } from 'antd';
import React, { useEffect } from 'react';
import { t, UserBaseInfo } from 'tailchat-shared';
import { UserProfileContainer } from '../../UserProfileContainer';
import { usePluginUserExtraInfo } from './usePluginUserExtraInfo';

export const PersonalUserPopover: React.FC<{
  userInfo: UserBaseInfo;
}> = React.memo((props) => {
  const { userInfo } = props;
  const userExtra = userInfo.extra ?? {};
  const pluginUserExtraInfoEl = usePluginUserExtraInfo(userExtra);

  useEffect(() => {
    if (userInfo.avatar) {
      fetchImagePrimaryColor(userInfo.avatar).then((rgba) => {
        console.log('fetchImagePrimaryColor', rgba);
      });
    }
  }, [userInfo.avatar]);

  return (
    <div className="w-80 -mx-4 -my-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      <UserProfileContainer userInfo={userInfo}>
        <div className="text-center mb-2">
          <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            <UserName userId={userInfo._id} />
          </div>
          {userInfo.username && (
            <div className="text-sm text-gray-500 dark:text-gray-400">@{userInfo.username}</div>
          )}
        </div>

        <Space size={4} wrap={true} className="py-1">
          {userInfo.type === 'openapiBot' && (
            <Tag color="orange">{t('开放平台机器人')}</Tag>
          )}

          {userInfo.type === 'pluginBot' && (
            <Tag color="orange">{t('插件机器人')}</Tag>
          )}

          {userInfo.temporary && <Tag color="processing">{t('游客')}</Tag>}
        </Space>

        {/* 已移除“开始”按钮 */}

        <div className="pt-2">{pluginUserExtraInfoEl}</div>
      </UserProfileContainer>
    </div>
  );
});
PersonalUserPopover.displayName = 'PersonalUserPopover';
