import { getMessageTextDecorators } from '@/plugin/common';
import React from 'react';
import {
  ChatBoxContextProvider,
  ConverseMessageProvider,
  useConverseMessageContext,
  useAppSelector,
} from 'tailchat-shared';
import { ErrorView } from '../ErrorView';
import { ChatBoxPlaceholder } from './ChatBoxPlaceholder';
import { ChatInputBox } from './ChatInputBox';
import { ChatMessageList } from './ChatMessageList';
import { ChatReply } from './ChatReply';
import { preprocessMessage } from './preprocessMessage';
import { BotStartButton } from './ChatMessageList/BotStartButton';

type ChatBoxProps =
  | {
      converseId: string;
      converseTitle?: React.ReactNode;
      isGroup: false;
      groupId?: string;
    }
  | {
      converseId: string;
      converseTitle?: React.ReactNode;
      isGroup: true;
      groupId: string;
    };
const ChatBoxInner: React.FC<ChatBoxProps> = React.memo((props) => {
  const { converseId, converseTitle } = props;
  const {
    messages,
    loading,
    error,
    isLoadingMore,
    hasMoreMessage,
    fetchMoreMessage,
    sendMessage,
  } = useConverseMessageContext();

  // 获取会话信息以获取members
  const converse = useAppSelector((state) => state.chat.converses[converseId]);
  const members = converse?.members ?? [];
  const currentUserId = useAppSelector((state) => state.user.info?._id);

  // 判断是否是与机器人的对话且没有消息
  const [showBotStart, setShowBotStart] = React.useState(false);

  React.useEffect(() => {
    // 检查是否是私信对话
    if (props.isGroup) {
      setShowBotStart(false);
      return;
    }

    // 检查是否没有消息
    if (messages.length > 0) {
      setShowBotStart(false);
      return;
    }

    // 检查对方是否是机器人
    const checkIfBotConverse = async () => {
      if (!currentUserId || members.length === 0) {
        setShowBotStart(false);
        return;
      }

      const otherUserId = members.find((m) => m !== currentUserId);
      if (!otherUserId) {
        setShowBotStart(false);
        return;
      }

      try {
        const { getCachedUserInfo } = await import('tailchat-shared/cache/cache');
        const userInfo = await getCachedUserInfo(otherUserId);
        const isBot = userInfo.type === 'pluginBot' || userInfo.type === 'openapiBot';
        setShowBotStart(isBot);
      } catch (e) {
        setShowBotStart(false);
      }
    };

    checkIfBotConverse();
  }, [props.isGroup, messages.length, members, currentUserId]);

  // 处理发送 /start 命令
  const handleSendStart = React.useCallback(async () => {
    try {
      // 获取机器人用户ID（排除自己）
      const botUserId = members.find((m) => m !== currentUserId);
      
      if (!botUserId) {
        console.error('找不到机器人用户ID');
        setShowBotStart(false);
        return;
      }

      // 导入必要的函数
      const { getCachedUserInfo } = await import('tailchat-shared/cache/cache');
      const userInfo = await getCachedUserInfo(botUserId);
      
      // 确认是机器人
      if (userInfo.type !== 'pluginBot' && userInfo.type !== 'openapiBot') {
        console.error('对方不是机器人');
        setShowBotStart(false);
        return;
      }

      const content = '/start';
      await sendMessage({
        converseId: props.converseId,
        groupId: props.groupId,
        content,
        plain: content,
        meta: {
          dmStartFromButton: true,
        },
      });
      
      // 发送后立即隐藏START按钮，显示输入框
      setShowBotStart(false);
    } catch (error) {
      console.error('发送 /start 失败:', error);
      setShowBotStart(false);
    }
  }, [props.converseId, props.groupId, sendMessage, members, currentUserId]);

  if (loading) {
    return <ChatBoxPlaceholder />;
  }

  if (error) {
    return <ErrorView error={error} />;
  }

  return (
    <div className="w-full h-full flex flex-col select-text relative text-sm">
      <ChatMessageList
        key={converseId}
        title={converseTitle}
        messages={messages}
        isLoadingMore={isLoadingMore}
        hasMoreMessage={hasMoreMessage}
        onLoadMore={fetchMoreMessage}
      />

      <ChatReply />

      {/* 根据是否显示START按钮来切换显示输入框或START按钮 */}
      {showBotStart ? (
        <BotStartButton onSendStart={handleSendStart} />
      ) : (
        <ChatInputBox
          converseId={props.converseId}
          groupId={props.groupId}
          isGroup={props.isGroup}
          onSendMsg={async (msg, meta) => {
            const content = preprocessMessage(msg);
            await sendMessage({
              converseId: props.converseId,
              groupId: props.groupId,
              content,
              plain: getMessageTextDecorators().serialize(content),
              meta,
            });
          }}
        />
      )}
    </div>
  );
});
ChatBoxInner.displayName = 'ChatBoxInner';

export const ChatBox: React.FC<ChatBoxProps> = React.memo((props) => {
  return (
    <ChatBoxContextProvider>
      <ConverseMessageProvider
        converseId={props.converseId}
        isGroup={props.isGroup}
      >
        <ChatBoxInner {...props} />
      </ConverseMessageProvider>
    </ChatBoxContextProvider>
  );
});
ChatBox.displayName = 'ChatBox';
