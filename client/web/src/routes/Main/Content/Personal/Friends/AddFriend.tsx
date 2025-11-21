import { Button, Divider, Typography, Tag } from 'antd';
import {
  addFriendRequest,
  findUserByUsernameCI,
  showErrorToasts,
  showToasts,
  t,
  useAppSelector,
  useAsyncFn,
  UserBaseInfo,
} from 'tailchat-shared';
import React, { useCallback, useState } from 'react';
import _isNil from 'lodash/isNil';
import { Avatar } from 'tailchat-design';
import { NoData } from '@/components/NoData';

const SearchFriendResult: React.FC<{
  result: UserBaseInfo | undefined | null;
}> = React.memo(({ result }) => {
  const [hasSentUserId, setHasSentUserId] = useState(''); // 记录已发送的
  const handleAddFriend = useCallback(async (userId: string) => {
    try {
      await addFriendRequest(userId);
      setHasSentUserId(userId);
      showToasts(t('已发送申请'), 'success');
    } catch (err) {
      showErrorToasts(err);
    }
  }, []);

  if (result === undefined) {
    return null;
  }

  if (result === null) {
    return <NoData />;
  }

  const hasSent = hasSentUserId === result._id;

  return (
    <div>
      <Divider />

      <div className="rounded-md border border-black border-opacity-30 px-4 py-3 bg-black bg-opacity-10 flex justify-between items-center mobile:flex-col">
        <div className="mobile:w-full mobile:mb-1">
          <Avatar
            className="mb-3"
            size={60}
            name={result.nickname}
            src={result.avatar}
          />
          <div className="text-lg flex items-center gap-2 flex-wrap">
            <span>{result.nickname}</span>
            {result.username ? (
              <span className="text-opacity-60 text-sm text-white">@{result.username}</span>
            ) : null}
            {result?.extra && (result as any).extra?.flag ? (
              <Tag color="gold" className="align-middle">{(result as any).extra.flag}</Tag>
            ) : null}
          </div>
        </div>

        <Button
          type="primary"
          className="bg-green-600 border-0 mobile:w-full"
          disabled={hasSent}
          onClick={() => handleAddFriend(result._id)}
        >
          {hasSent ? t('已申请') : t('申请好友')}
        </Button>
      </div>
    </div>
  );
});
SearchFriendResult.displayName = 'SearchFriendResult';

const SelfIdentify: React.FC = React.memo(() => {
  const userInfo = useAppSelector((state) => state.user.info);
  const display = userInfo?.username ? `@${userInfo.username}` : '';

  return (
    <div>
      <Divider />

      <div className="rounded-md border border-black border-opacity-30 px-4 py-3 bg-black bg-opacity-10 text-center">
        <div>{t('您的个人唯一标识')}</div>
        {display ? (
          <Typography.Title level={4} copyable={true} className="select-text">
            {display}
          </Typography.Title>
        ) : null}
      </div>
    </div>
  );
});
SelfIdentify.displayName = 'SelfIdentify';

export const AddFriend: React.FC = React.memo(() => {
  const [username, setUsername] = useState('');
  const [{ loading, value }, searchUser] = useAsyncFn(async () => {
    // 搜索用户
    try {
      const data = await findUserByUsernameCI(username);

      if (data === null) {
        showToasts(t('没有找到该用户'), 'warning');
      }

      return data;
    } catch (err) {
      showErrorToasts(err);
    }
  }, [username]);

  return (
    <div className="px-8 py-2">
      <div className="text-lg my-2">{t('添加好友')}</div>
      <div className="my-1">{t('您可以直接输入对方的用户名以添加好友')}</div>

      <div className="px-4 py-2 my-3 flex border border-black border-opacity-30 rounded items-center bg-black bg-opacity-10 mobile:flex-col">
        <input
          className="bg-transparent flex-1 text-base leading-9 outline-none mobile:w-full mobile:mb-1"
          placeholder={t('用户名（5–32，字母数字与下划线）')}
          onChange={(e) => setUsername(e.target.value)}
        />

        <Button
          type="primary"
          className="bg-indigo-600 disabled:opacity-80 border-none mobile:w-full"
          disabled={username === ''}
          loading={loading}
          onClick={searchUser}
        >
          {t('按用户名查找')}
        </Button>
      </div>

      {_isNil(value) ? <SelfIdentify /> : <SearchFriendResult result={value} />}
    </div>
  );
});
AddFriend.displayName = 'AddFriend';