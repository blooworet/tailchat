import React, { useEffect, useMemo, useState } from 'react';
import {
  ChatMessage,
  formatShortTime,
  shouldShowMessageTime,
  SYSTEM_USERID,
  t,
  useCachedUserInfo,
  MessageHelper,
  showMessageTime,
  useUserInfoList,
  UserBaseInfo,
  useUserSettings,
  useUserInfo,
  useEvent,
} from 'tailchat-shared';
// 已不再需要在组件内拉取会话成员 ack 列表
import { useRenderPluginMessageInterpreter } from './useRenderPluginMessageInterpreter';
import { getMessageRender, pluginMessageExtraParsers } from '@/plugin/common';
import {
  tokenizeWithRanges,
  tokenizeWithRangesCached,
  renderInlineText,
  renderInlineKeyboard,
  defaultOnActionClick,
  InlineActionsMeta,
  runInlineActionDecorators,
} from '@/plugin/common/inline-actions';
import { Divider, Dropdown, Popover, Tooltip } from 'antd';
import { UserName } from '@/components/UserName';
import clsx from 'clsx';
import { useChatMessageItemAction } from './useChatMessageItemAction';
import { useChatMessageReactionAction } from './useChatMessageReaction';
import { TcPopover } from '@/components/TcPopover';
import { useMessageReactions } from './useMessageReactions';
import { stopPropagation } from '@/utils/dom-helper';
import { AutoFolder, Avatar, Icon } from 'tailchat-design';
import { MessageAckContainer } from './MessageAckContainer';
import { UserPopover } from '@/components/popover/UserPopover';
import _isEmpty from 'lodash/isEmpty';
import type { LocalChatMessage } from 'tailchat-shared/model/message';
import './Item.less';
import { openModal, ModalWrapper } from '@/components/Modal';
import { NearbyMessages } from '@/routes/Main/Content/Inbox/Content/Message';
import { useAppSelector } from 'tailchat-shared/redux/hooks/useAppSelector';
import { MessageAnimationWrapper, ButtonAnimationWrapper } from 'tailchat-shared/animation';
import { getInlineActions as getCachedInlineActions, getTokens as getCachedTokens, buildMessageCacheSignature } from './parserCache';

// 迁移至 Redux 的 memberAcks 增量状态，移除本地会话级缓存与实时拉取

/**
 * 消息引用
 */
const MessageQuote: React.FC<{ payload: ChatMessage }> = React.memo(
  ({ payload }) => {
    const quote = useMemo(
      () => new MessageHelper(payload).hasReply(),
      [payload]
    );

    if (quote === false) {
      return null;
    }

    return (
      <div className="chat-message-item_quote border-l-4 border-black border-opacity-20 pl-2 opacity-80">
        {t('回复')} <UserName userId={String(quote.author)} />:{' '}
        <span>{getMessageRender(quote.content)}</span>
      </div>
    );
  }
);
MessageQuote.displayName = 'MessageQuote';

const MessageActionIcon: React.FC<{ icon: string }> = (props) => (
  <div className="px-0.5 w-6 h-6 flex justify-center items-center opacity-60 hover:opacity-100">
    <Icon icon={props.icon} />
  </div>
);

/**
 * 普通消息
 */
export const NormalMessage: React.FC<ChatMessageItemProps> = React.memo(
  (props) => {
    const { showAvatar, payload, hideAction = false } = props;
    const userInfo = useCachedUserInfo(payload.author ?? '');
    const currentUser = useUserInfo();
    const [isActionBtnActive, setIsActionBtnActive] = useState(false);
    const { settings } = useUserSettings();
    const isMobile =
      typeof window !== 'undefined' &&
      ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        window.innerWidth <= 768 ||
        /android|iphone|ipad|ipod|iemobile|opera mini/i.test(
          (navigator.userAgent || '').toLowerCase()
        ));

    const isSelf = currentUser?._id === payload.author;

    const reactions = useMessageReactions(payload);

    // Forwarded label UI: read from meta.forward via MessageHelper
    const forward = useMemo(() => new MessageHelper(payload).hasForward(), [payload]);
    const handleOpenForwardSource = useMemo(
      () => () => {
        if (!forward) return;
        const converseId = String(forward.converseId || payload.converseId || '');
        const groupId = forward.groupId ? String(forward.groupId) : undefined;
        const messageId = String(forward._id || '');
        if (!converseId || !messageId) return;

        openModal(
          <ModalWrapper title={t('转发来源')} style={{ minWidth: 480 }}>
            <div className="h-96 w-[72vw] max-w-[880px] overflow-hidden">
              <NearbyMessages
                groupId={groupId}
                converseId={converseId}
                messageId={messageId}
              />
            </div>
          </ModalWrapper>,
          { closable: true }
        );
      },
      [forward, payload.converseId]
    );

    const emojiAction = useChatMessageReactionAction(payload);
    const moreActions = useChatMessageItemAction(payload, {
      onClick: () => {
        setIsActionBtnActive(false);
      },
    });

    /**
     * 自适应视窗高度的消息折叠最大高度（仅在挂载时计算一次）
     * 目标：约等于 0.6 * window.innerHeight，兼容 SSR
     * 移除每条消息上的 resize 监听，避免会话切换时大量副作用创建/销毁导致卡顿
     */
    const autoFolderMaxHeight = useMemo(() => {
      if (typeof window === 'undefined') {
        return 680;
      }
      const vh = window.innerHeight || 0;
      const next = Math.floor(vh * 0.6);
      return next > 0 ? next : 680;
    }, []);

    // 禁止对消息进行操作，因为此时消息尚未发送到远程
    const disableOperate =
      hideAction === true ||
      payload.isLocal === true ||
      payload.sendFailed === true;

    // 使用 Redux 的 memberAcks 作判定数据源，取消每次消息/通知触发的全量拉取
    const converseIdStr = String(payload.converseId || '');
    const memberAckMap = useAppSelector((state) => state.chat.memberAcks[converseIdStr] || {});
    const { anyRead, allRead } = useMemo(() => {
      if (!isSelf) return { anyRead: false, allRead: false };
      // 仅统计“其他成员”的 ack，忽略自己，避免自我已读导致误判
      const selfId = String(currentUser?._id || '');
      const lastIds = Object.entries(memberAckMap)
        .filter(([uid]) => String(uid) !== selfId)
        .map(([_, id]) => String(id));
      if (lastIds.length === 0) return { anyRead: false, allRead: false };
      const msgId = String(payload._id);
      const ge = (a: string, b: string) => a >= b;
      const _any = lastIds.some((lastId) => ge(lastId, msgId));
      const _all = lastIds.every((lastId) => ge(lastId, msgId));
      return { anyRead: _any, allRead: _all };
    }, [isSelf, memberAckMap, payload._id, currentUser?._id]);

    const onKeyActive = useEvent(
      (e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }
    );

    const mainContent = (
      <>
        {showAvatar && (
          <div className="flex items-center">
            <div className="font-bold">
              {userInfo.nickname || <span>&nbsp;</span>}
            </div>
            <div className="hidden group-hover:block opacity-40 ml-1 text-sm">
              {formatShortTime(payload.createdAt)}
            </div>
            {payload.isEdited && (
              <div className="opacity-60 ml-1 text-xs">
                ({t('已编辑')})
              </div>
            )}
          </div>
        )}

        {/* 消息内容 */}
        <AutoFolder
          maxHeight={autoFolderMaxHeight}
          backgroundColor="var(--tc-content-background-color)"
          showFullText={
            <div className="inline-block rounded-full bg-white dark:bg-black opacity-80 py-2 px-3 hover:opacity-100">
              {t('点击展开更多')}
            </div>
          }
        >
          <div className="chat-message-item_bubble relative inline-block">
            <div className="chat-message-item_body leading-6 break-words">
              {/* Forwarded tag */}
              {forward && (
                <div className="chat-message-item_forward">
                  <div
                    className="tag cursor-pointer select-none"
                    onClick={handleOpenForwardSource}
                    role="button"
                    tabIndex={0}
                    onKeyDown={onKeyActive}
                    aria-label={t('转发来源：点击查看原消息')}
                  >
                    {t('转发自')} {forward.sourceTitle || t('原消息')}
                  </div>
                </div>
              )}

              <MessageQuote payload={payload} />

              {/* Inline actions: mobile consumes precomputed caches; desktop keeps original behavior */}
              {(() => {
                const content = String(payload.content || '');
                const meta = (payload.meta || {}) as any;
                const hasBBCodeTag = /\[(at|url|img|card|emoji|b|i|u|del|md)(?:=[^\]]*)?](.*?)\[\/\1]/i.test(content);
                const onActionClickWithContext = (action: any) => {
                  const messageContext = {
                    messageId: payload._id,
                    converseId: payload.converseId,
                    groupId: payload.groupId,
                  };
                  return defaultOnActionClick(action, messageContext);
                };

                if (isMobile) {
                  const sig = buildMessageCacheSignature(content, String((payload as any).updatedAt || ''));
                  const inlineActions = (meta.inlineActions || getCachedInlineActions(String(payload._id), sig) || null) as InlineActionsMeta | null;
                  if (hasBBCodeTag && inlineActions) {
                    const actionsMap = Object.fromEntries((inlineActions.actions || []).map((a) => [a.id, a]));
                    return (
                      <>
                        <span>{getMessageRender(content)}</span>
                        {renderInlineKeyboard(inlineActions.keyboard || [], actionsMap, onActionClickWithContext)}
                      </>
                    );
                  }
                  if (hasBBCodeTag && !inlineActions) {
                    return <span>{getMessageRender(content)}</span>;
                  }
                  if (!inlineActions) {
                    return <span>{getMessageRender(content)}</span>;
                  }
                  const actionsMap = Object.fromEntries((inlineActions.actions || []).map((a) => [a.id, a]));
                  const nodes = (getCachedTokens(String(payload._id), sig) || tokenizeWithRangesCached(content, inlineActions.ranges || []));
                  return (
                    <>
                      <span>
                        {renderInlineText(nodes, { actions: actionsMap, onActionClick: onActionClickWithContext })}
                      </span>
                      {renderInlineKeyboard(inlineActions.keyboard || [], actionsMap, onActionClickWithContext)}
                    </>
                  );
                }

                // Desktop: original behavior
                const inlineActions = (meta.inlineActions || null) as InlineActionsMeta | null;
                const hasInlineActions = inlineActions && (inlineActions.keyboard || inlineActions.ranges);
                if (hasBBCodeTag && hasInlineActions) {
                  const actionsMap = Object.fromEntries((inlineActions.actions || []).map((a) => [a.id, a]));
                  return (
                    <>
                      <span>{getMessageRender(content)}</span>
                      {renderInlineKeyboard(inlineActions.keyboard || [], actionsMap, onActionClickWithContext)}
                    </>
                  );
                }
                if (hasBBCodeTag) {
                  return <span>{getMessageRender(content)}</span>;
                }
                let finalMeta = inlineActions;
                if (!finalMeta || (!finalMeta.ranges && !finalMeta.keyboard)) {
                  const decorated = runInlineActionDecorators(content);
                  if (!decorated) {
                    return <span>{getMessageRender(content)}</span>;
                  }
                  finalMeta = decorated as InlineActionsMeta;
                }
                const actionsMap = Object.fromEntries((finalMeta.actions || []).map((a) => [a.id, a]));
                const nodes = tokenizeWithRangesCached(content, finalMeta.ranges || []);
                return (
                  <>
                    <span>
                      {renderInlineText(nodes, {
                        actions: actionsMap,
                        onActionClick: onActionClickWithContext,
                      })}
                    </span>
                    {renderInlineKeyboard(finalMeta.keyboard || [], actionsMap, onActionClickWithContext)}
                  </>
                );
              })()}

              {payload.sendFailed === true && !isSelf && (
                <Icon className="inline-block ml-1" icon="emojione:cross-mark-button" />
              )}

              {/* 解释器按钮 */}
              {useRenderPluginMessageInterpreter(payload.content)}
            </div>

            {isSelf && (
              !isMobile ? (
                <Tooltip
                  placement="topRight"
                  title={
                    payload.isLocal === true
                      ? t('发送中')
                      : payload.sendFailed === true
                      ? t('发送失败')
                      : allRead
                      ? t('已读')
                      : anyRead
                      ? t('已送达')
                      : t('已发送')
                  }
                >
                  <span
                    className={clsx('chat-message-item_status', {
                      'is-sending': payload.isLocal === true,
                      'is-failed': payload.sendFailed === true,
                      'is-read': allRead,
                      'is-delivered': !allRead && anyRead,
                      'is-sent':
                        payload.isLocal !== true &&
                        payload.sendFailed !== true &&
                        !allRead &&
                        !anyRead,
                    })}
                    aria-live="polite"
                    aria-label={
                      payload.isLocal === true
                        ? t('发送中')
                        : payload.sendFailed === true
                        ? t('发送失败')
                        : allRead
                        ? t('已读')
                        : anyRead
                        ? t('已送达')
                        : t('已发送')
                    }
                  >
                    {payload.isLocal === true ? (
                      <Icon icon="mdi:clock-time-four-outline" />
                    ) : payload.sendFailed === true ? (
                      <Icon icon="mdi:alert-circle-outline" />
                    ) : allRead ? (
                      <Icon icon="mdi:check-all" />
                    ) : anyRead ? (
                      <Icon icon="mdi:check-all" />
                    ) : (
                      <Icon icon="mdi:check" />
                    )}
                  </span>
                </Tooltip>
              ) : (
                <span
                  className={clsx('chat-message-item_status', {
                    'is-sending': payload.isLocal === true,
                    'is-failed': payload.sendFailed === true,
                    'is-read': allRead,
                    'is-delivered': !allRead && anyRead,
                    'is-sent':
                      payload.isLocal !== true &&
                      payload.sendFailed !== true &&
                      !allRead &&
                      !anyRead,
                  })}
                  aria-live="polite"
                  aria-label={
                    payload.isLocal === true
                      ? t('发送中')
                      : payload.sendFailed === true
                      ? t('发送失败')
                      : allRead
                      ? t('已读')
                      : anyRead
                      ? t('已送达')
                      : t('已发送')
                  }
                >
                  {payload.isLocal === true ? (
                    <Icon icon="mdi:clock-time-four-outline" />
                  ) : payload.sendFailed === true ? (
                    <Icon icon="mdi:alert-circle-outline" />
                  ) : allRead ? (
                    <Icon icon="mdi:check-all" />
                  ) : anyRead ? (
                    <Icon icon="mdi:check-all" />
                  ) : (
                    <Icon icon="mdi:check" />
                  )}
                </span>
              )
            )}
          </div>
        </AutoFolder>

        {/* 额外渲染 */}
        <div>
          {pluginMessageExtraParsers.map((parser) => (
            <React.Fragment key={parser.name}>
              {parser.render(payload)}
            </React.Fragment>
          ))}
        </div>

        {/* 消息反应 */}
        {reactions}
      </>
    );

  return (
    <MessageAnimationWrapper 
      messageId={payload._id}
      disabled={payload.isLocal === true}
    >
      <div
        className={clsx(
          'chat-message-item flex px-2 mobile:px-0 group relative select-text text-sm',
          {
            'bg-black bg-opacity-10': isActionBtnActive,
            'hover:bg-black hover:bg-opacity-5': !isActionBtnActive,
            self: isSelf,
            continued: !showAvatar,
          }
        )}
        data-message-id={payload._id}
      >
        {/* 头像 */}
        <div className="w-18 mobile:w-14 flex items-start justify-center pt-0.5">
          {showAvatar ? (
            isMobile ? (
              <Avatar
                className="cursor-pointer"
                size={40}
                src={userInfo.avatar}
                name={userInfo.nickname}
              />
            ) : (
              <Popover
                content={
                  !_isEmpty(userInfo) && (
                    <UserPopover userInfo={userInfo as UserBaseInfo} />
                  )
                }
                placement="top"
                trigger="click"
              >
                <Avatar
                  className="cursor-pointer"
                  size={40}
                  src={userInfo.avatar}
                  name={userInfo.nickname}
                />
              </Popover>
            )
          ) : (
            <div className="hidden group-hover:block opacity-40">
              {formatShortTime(payload.createdAt)}
            </div>
          )}
        </div>

        {/* 主体 */}
        {isMobile ? (
          <div className="flex flex-col flex-1 overflow-auto group" onContextMenu={stopPropagation}>
            {mainContent}
          </div>
        ) : (
          <Dropdown
            menu={moreActions}
            placement="bottomLeft"
            trigger={['contextMenu']}
            disabled={settings['disableMessageContextMenu']}
            onOpenChange={setIsActionBtnActive}
          >
            <div className="flex flex-col flex-1 overflow-auto group" onContextMenu={stopPropagation}>
              {mainContent}
            </div>
          </Dropdown>
        )}
          

        {/* 操作 */}
        {!disableOperate && !isMobile && (
          <div
            className={clsx(
              'bg-white dark:bg-black rounded absolute right-2 cursor-pointer -top-3 shadow-sm flex',
              {
                'opacity-0 group-hover:opacity-100 bg-opacity-80 hover:bg-opacity-100':
                  !isActionBtnActive,
                'opacity-100 bg-opacity-100': isActionBtnActive,
              }
            )}
          >
            <TcPopover
              overlayClassName="chat-message-item_action-popover"
              content={emojiAction}
              placement="bottomLeft"
              trigger={['click']}
              onOpenChange={setIsActionBtnActive}
            >
              <div
                role="button"
                aria-label={t('添加反应')}
                tabIndex={0}
                onKeyDown={onKeyActive}
              >
                <MessageActionIcon icon="mdi:emoticon-happy-outline" />
              </div>
            </TcPopover>

            <Dropdown
              menu={moreActions}
              placement="bottomRight"
              trigger={['click']}
              onOpenChange={setIsActionBtnActive}
            >
              <div
                role="button"
                aria-label={t('更多操作')}
                tabIndex={0}
                onKeyDown={onKeyActive}
              >
                <MessageActionIcon icon="mdi:dots-horizontal" />
              </div>
            </Dropdown>
          </div>
        )}
      </div>
    </MessageAnimationWrapper>
  );
}
);
NormalMessage.displayName = 'NormalMessage';

/**
 * 系统消息
 */
const SystemMessage: React.FC<ChatMessageItemProps> = React.memo(({ payload }) => {
  const meta: any = (payload as any)?.meta ?? {};
  if (
    meta &&
    meta.sysType === 'groupInviteAccepted' &&
    typeof meta.inviteeId === 'string' &&
    typeof meta.inviterId === 'string'
  ) {
    return (
      <div className="text-center">
        <div className="bg-black bg-opacity-20 rounded inline-block py-0.5 px-2 my-1 mx-2 text-sm">
          <>
            <UserName userId={meta.inviteeId} /> {t('接受了')} <UserName userId={meta.inviterId} />
            {t(' 的邀请加入了群组')}
          </>
        </div>
      </div>
    );
  }
  return (
    <div className="text-center">
      <div className="bg-black bg-opacity-20 rounded inline-block py-0.5 px-2 my-1 mx-2 text-sm">
        {payload.content}
      </div>
    </div>
  );
});
SystemMessage.displayName = 'SystemMessage';

/**
 * 带userId => nickname异步解析的SystemMessage 组件
 */
const SystemMessageWithNickname: React.FC<
  ChatMessageItemProps & {
    userIds: string[];
    overwritePayload: (nicknameList: string[]) => ChatMessage;
  }
> = React.memo((props) => {
  const userInfos = useUserInfoList(props.userIds);
  const nicknameList = userInfos.map((user) => user.nickname);

  return (
    <SystemMessage {...props} payload={props.overwritePayload(nicknameList)} />
  );
});
SystemMessageWithNickname.displayName = 'SystemMessageWithNickname';

interface ChatMessageItemProps {
  showAvatar: boolean;
  payload: LocalChatMessage;
  hideAction?: boolean;
}
const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo((props) => {
  const payload = props.payload;
  if (payload.author === SYSTEM_USERID) {
    // 系统消息
    return <SystemMessage {...props} />;
  } else if (payload.hasRecall === true) {
    // 撤回消息
    return (
      <SystemMessageWithNickname
        {...props}
        userIds={[payload.author ?? SYSTEM_USERID]}
        overwritePayload={(nicknameList) => ({
          ...payload,
          content: t('{{nickname}} 撤回了一条消息', {
            nickname: nicknameList[0] || '',
          }),
        })}
      />
    );
  }

  // 普通消息
  return <NormalMessage {...props} />;
});
ChatMessageItem.displayName = 'ChatMessageItem';

/**
 * 构造聊天项
 */
export function buildMessageItemRow(
  messages: LocalChatMessage[],
  index: number
) {
  const message = messages[index];

  if (!message) {
    return <div />;
  }

  let showDate = true;
  let showAvatar = true;
  const messageCreatedAt = new Date(message.createdAt ?? '');
  
  if (index > 0) {
    // 当不是第一条数据时

    // 进行时间合并
    const prevMessage = messages[index - 1];
    if (
      !shouldShowMessageTime(
        new Date(prevMessage.createdAt ?? ''),
        messageCreatedAt
      )
    ) {
      showDate = false;
    }

    // 进行头像合并(在同一时间块下 且发送者为同一人)
    if (showDate === false) {
      showAvatar =
        prevMessage.author !== message.author || prevMessage.hasRecall === true;
    }
  }

  // 未读分隔条：当上一条消息 id 小于等于 ack、当前消息 id 大于 ack 时插入
  // 说明：为减少入侵，这里通过全局 selector 获取 ack（需要传参或自定义 hook 更优，后续可优化）
  const prevId = index > 0 ? String(messages[index - 1]?._id ?? '') : '';

  return (
    <MessageRow
      key={String(message._id)}
      message={message}
      prevId={prevId}
      showDate={showDate}
      showAvatar={showAvatar}
      messageCreatedAt={messageCreatedAt}
    />
  );
}

const MessageRow: React.FC<{ 
  message: LocalChatMessage; 
  prevId?: string; 
  showDate: boolean; 
  showAvatar: boolean; 
  messageCreatedAt: Date;
}> = ({ message, prevId = '', showDate, showAvatar, messageCreatedAt }) => {
  const converseId = String(message.converseId ?? '');
  const ackId = useAppSelector((state) => state.chat.ack[converseId]);
  const isMobile =
    typeof window !== 'undefined' &&
    ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      window.innerWidth <= 768 ||
      /android|iphone|ipad|ipod|iemobile|opera mini/i.test((navigator.userAgent || '').toLowerCase()));
  let showUnreadDivider = false;
  if (ackId) {
    const curId = String(message._id);
    if ((prevId !== '' && prevId <= ackId) && curId > ackId) {
      showUnreadDivider = true;
    }
  }

  // 为避免移动端在某些情况下由于子级 memo/缓存导致的旧内容保留，
  // 使用签名增强行 key，使内容变化时强制 remount（仅移动端）。
  const sig = buildMessageCacheSignature(
    String(message.content || ''),
    String((message as any).updatedAt || ''),
    String(((message as any)?.meta?.inlineActions?.signature) || '')
  );

  return (
    <div key={isMobile ? `${String(message._id)}:${sig}` : String(message._id)}>
      {showDate && (
        <Divider className="text-sm opacity-40 px-6 font-normal select-text">
          {showMessageTime(messageCreatedAt)}
        </Divider>
      )}
      {showUnreadDivider && (
        <Divider className="text-xs opacity-70 px-6 font-normal select-text">
          —— {t('未读消息')} ——
        </Divider>
      )}

      {message.isLocal === true ? (
        <div className="opacity-50">
          <ChatMessageItem 
            showAvatar={showAvatar} 
            payload={message}
          />
        </div>
      ) : isMobile ? (
        <ChatMessageItem 
          showAvatar={showAvatar} 
          payload={message}
        />
      ) : (
        <MessageAckContainer converseId={message.converseId} messageId={message._id}>
          <ChatMessageItem 
            showAvatar={showAvatar} 
            payload={message}
          />
        </MessageAckContainer>
      )}
    </div>
  );
};
