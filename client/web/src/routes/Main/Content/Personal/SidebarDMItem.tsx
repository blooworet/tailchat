import {
  chatActions,
  ChatConverseState,
  getCachedUserInfo,
  model,
  useAppDispatch,
  useAsync,
  useAsyncRequest,
  useDMConverseName,
  useUnread,
  useUserId,
} from 'tailchat-shared';
import React from 'react';
import { SidebarItem } from '../SidebarItem';
import { CombinedAvatar, Icon } from 'tailchat-design';
import _without from 'lodash/without';

interface SidebarDMItemProps {
  converse: ChatConverseState;
}
export const SidebarDMItem: React.FC<SidebarDMItemProps> = React.memo(
  (props) => {
    const converse = props.converse;
    const converseId = converse._id;
    const name = useDMConverseName(converse);
    const userId = useUserId();
    const [hasUnread] = useUnread([converseId]);
    const dispatch = useAppDispatch();

    const { value: icon } = useAsync(async () => {
      if (!userId) {
        return;
      }

      const userInfos = (
        await Promise.all(
          _without<string>(converse.members, userId).map((memberUserId) =>
            getCachedUserInfo(memberUserId)
          )
        )
      ).filter((u): u is any => !!u && !!u._id);

      const items = userInfos.map((user) => ({
        name: user?.nickname || '已删除用户',
        src: user?.avatar || '',
      }));

      return <CombinedAvatar items={items.length > 0 ? items : [{ name: '已删除用户', src: '' }]} />;
    }, [converse.members, userId]);

    const [, handleRemove] = useAsyncRequest(async () => {
      dispatch(chatActions.removeConverse({ converseId }));
      // 同步更新本地“私信列表”ids，确保侧栏即时隐藏
      dispatch(chatActions.removeDMConverseId(converseId));
      await model.user.removeUserDMConverse(converseId);
    }, [converseId]);

    return (
      <SidebarItem
        key={converseId}
        name={name}
        action={
          <Icon
            icon="mdi:close"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleRemove();
            }}
          />
        }
        icon={icon}
        to={`/main/personal/converse/${converseId}`}
        badge={hasUnread}
      />
    );
  }
);
SidebarDMItem.displayName = 'SidebarDMItem';
