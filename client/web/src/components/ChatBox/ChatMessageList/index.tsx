import { LoadingSpinner } from '@/components/LoadingSpinner';
import React from 'react';
import { useSingleUserSetting } from 'tailchat-shared';
import { NormalMessageList } from './NormalList';
import type { MessageListProps } from './types';
import { VirtualizedMessageList } from './VirtualizedList';

export const ChatMessageList: React.FC<MessageListProps> = React.memo(
  (props) => {
    const { value: useVirtualizedList, loading } = useSingleUserSetting(
      'messageListVirtualization',
      false
    );

    const isMobile =
      typeof window !== 'undefined' &&
      ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        window.innerWidth <= 768 ||
        /android|iphone|ipad|ipod|iemobile|opera mini/i.test(
          (navigator.userAgent || '').toLowerCase()
        ));

    if (loading) {
      return (
        <div className="flex-1">
          <LoadingSpinner />
        </div>
      );
    }

    const shouldVirtualize = isMobile ? true : useVirtualizedList;

    return shouldVirtualize ? (
      <VirtualizedMessageList {...props} />
    ) : (
      <NormalMessageList {...props} />
    );
  }
);
ChatMessageList.displayName = 'ChatMessageList';
