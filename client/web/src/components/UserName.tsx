import React from 'react';
import { isEmpty } from 'lodash';
import {
  useCachedUserInfo,
  useFriendNickname,
} from 'tailchat-shared';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';

interface UserNameProps {
  userId: string;
  showDiscriminator?: boolean;
  className?: string;
  style?: React.CSSProperties;

  fallbackName?: string;
}

/**
 * 纯净版的 UserName, 无需redux上下文
 */
export const UserNamePure: React.FC<UserNameProps> = React.memo((props) => {
  const { userId, showDiscriminator, className, style, fallbackName } = props;
  const cachedUserInfo = useCachedUserInfo(userId);

  return (
    <span className={className} style={style}>
      {cachedUserInfo.nickname ??
        (isEmpty(fallbackName) ? <span>&nbsp;</span> : fallbackName)}
    </span>
  );
});
UserNamePure.displayName = 'UserNamePure';

/**
 * 增加好友名称patch的 UserName
 */
export const UserName: React.FC<UserNameProps> = React.memo((props) => {
  const { userId, showDiscriminator, className, style, fallbackName } = props;
  const cachedUserInfo = useCachedUserInfo(userId);
  const friendNickname = useFriendNickname(userId);
  const navigate = useNavigate();

  const handleClick = () => {
    if (cachedUserInfo.username) {
      navigate(`/${cachedUserInfo.username}`);
    }
  };

  return (
    <span 
      className={clsx(className, cachedUserInfo.username && 'cursor-pointer hover:underline')} 
      style={style}
      onClick={cachedUserInfo.username ? handleClick : undefined}
    >
      {friendNickname ? (
        <>
          {friendNickname}
          <span className="opacity-60">({cachedUserInfo.nickname})</span>
        </>
      ) : (
        cachedUserInfo.nickname ??
        (isEmpty(fallbackName) ? <span>&nbsp;</span> : fallbackName)
      )}
    </span>
  );
});
UserName.displayName = 'UserName';

const UserNameDiscriminator: React.FC<{ discriminator: string }> = React.memo(
  ({ discriminator }) => {
    return (
      <span className="text-gray-500 dark:text-gray-300">
        #{discriminator}
      </span>
    );
  }
);
UserNameDiscriminator.displayName = 'UserNameDiscriminator';