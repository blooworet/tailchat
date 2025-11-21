import { useMemo } from 'react';
import { ChatConverseType } from '../../model/converse';
import type { ChatConverseState } from '../slices/chat';
import { useAppSelector } from './useAppSelector';

/**
 * 获取私信会话列表
 * 并补充一些信息
 */
export function useDMConverseList(): ChatConverseState[] {
  const converses = useAppSelector((state) => state.chat.converses);
  const lastMessageMap = useAppSelector((state) => state.chat.lastMessageMap);
  const dmConverseIds = useAppSelector((state) => state.chat.dmConverseIds);

  const filteredConverse = useMemo(
    () =>
      Object.entries(converses)
        .filter(([id, info]) =>
          [ChatConverseType.DM, ChatConverseType.Multi].includes(info.type) &&
          dmConverseIds.includes(id)
        )
        .map(([, info]) => info),
    [converses, dmConverseIds]
  );

  return useMemo(() => {
    return filteredConverse.sort((a: ChatConverseState, b: ChatConverseState) => {
      return (lastMessageMap[a._id] ?? '') < (lastMessageMap[b._id] ?? '')
        ? 1
        : -1;
    });
  }, [filteredConverse, lastMessageMap]);
}
