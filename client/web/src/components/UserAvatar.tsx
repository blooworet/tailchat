import type { AvatarProps } from 'antd';
import React from 'react';
import { Avatar } from 'tailchat-design';
import { useCachedUserInfo } from 'tailchat-shared';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';

interface UserAvatarProps extends AvatarProps {
  userId: string;
}

/**
 * 用户头像组件
 */
export const UserAvatar: React.FC<UserAvatarProps> = React.memo((props) => {
  const { userId, ...avatarProps } = props;
  const cachedUserInfo = useCachedUserInfo(userId);
  const navigate = useNavigate();

  const handleClick = (e: React.MouseEvent) => {
    if (cachedUserInfo.username) {
      e.stopPropagation();
      navigate(`/${cachedUserInfo.username}`);
    }
  };

  return (
    <Avatar
      {...avatarProps}
      src={cachedUserInfo.avatar}
      name={cachedUserInfo.nickname}
      className={clsx(avatarProps.className, cachedUserInfo.username && 'cursor-pointer')}
      onClick={cachedUserInfo.username ? handleClick : undefined}
    />
  );
});
UserAvatar.displayName = 'UserAvatar';