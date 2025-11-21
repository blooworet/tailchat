import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { ChatConverseInfo } from '../../model/converse';
import type {
  ChatMessage,
  ChatMessageReaction,
  LocalChatMessage,
  SendMessagePayload,
} from '../../model/message';
import _uniqBy from 'lodash/uniqBy';
import _orderBy from 'lodash/orderBy';
import _last from 'lodash/last';
import { isLocalMessageId, isValidStr } from '../../utils/string-helper';
import type { InboxItem } from '../../model/inbox';

export interface ChatConverseState extends ChatConverseInfo {
  messages: LocalChatMessage[];
  hasFetchedHistory: boolean;
  /**
   * 判定是否还有更多的信息
   */
  hasMoreMessage: boolean;
}

export interface ChatState {
  currentConverseId: string | null; // 当前活跃的会话id
  converses: Record<string, ChatConverseState>; // <会话Id, 会话信息>
  ack: Record<string, string>; // <会话Id, 本地最后一条会话Id>
  /**
   * 会话成员的已读位置映射
   * <会话Id, <用户Id, lastMessageId>>
   */
  memberAcks: Record<string, Record<string, string>>;
  inbox: InboxItem[];
  /**
   * 用户“私信列表”中的会话ID（受用户显隐控制）
   */
  dmConverseIds: string[];

  /**
   * 会话最新消息mapping
   * <会话Id, 远程会话列表最后一条会话Id>
   */
  lastMessageMap: Record<string, string>;
}

const initialState: ChatState = {
  currentConverseId: null,
  converses: {},
  ack: {},
  memberAcks: {},
  inbox: [],
  lastMessageMap: {},
  dmConverseIds: [],
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    updateCurrentConverseId(state, action: PayloadAction<string | null>) {
      state.currentConverseId = action.payload;
    },

    /**
     * 设置会话信息
     */
    setConverseInfo(state, action: PayloadAction<ChatConverseInfo>) {
      const converseId = action.payload._id;

      const originInfo = state.converses[converseId]
        ? { ...state.converses[converseId] }
        : { messages: [], hasFetchedHistory: false, hasMoreMessage: true };

      state.converses[converseId] = {
        ...originInfo,
        ...action.payload,
      };
    },

    /**
     * 追加消息
     * 会根据id进行一次排序以确保顺序
     */
    appendConverseMessage(
      state,
      action: PayloadAction<{
        converseId: string;
        messages: ChatMessage[];
      }>
    ) {
      const { converseId, messages } = action.payload;

      if (!state.converses[converseId]) {
        // 没有会话信息, 请先设置会话信息
        console.error('没有会话信息, 请先设置会话信息');
        return;
      }

      // NOTICE: 按照该规则能确保本地消息一直在最后，因为l大于任何ObjectId
      const newMessages = _orderBy(
        _uniqBy([...state.converses[converseId].messages, ...messages], '_id'),
        '_id',
        'asc'
      );

      state.converses[converseId].messages = newMessages;

      /**
       * 如果在当前会话中，则暂时不更新最后收到的消息的本地状态，避免可能出现的瞬间更新最后消息(出现小红点) 但是会立即已读（小红点消失）
       * 所以仅对非当前会话的消息进行更新最后消息
       */
      if (state.currentConverseId !== converseId) {
        const lastMessageId = _last(
          newMessages.filter((m) => !isLocalMessageId(m._id))
        )?._id;
        if (isValidStr(lastMessageId)) {
          state.lastMessageMap[converseId] = lastMessageId;
        }
      }
    },

    /**
     * 追加本地消息消息
     */
    appendLocalMessage(
      state,
      action: PayloadAction<{
        author?: string;
        localMessageId: string;
        payload: SendMessagePayload;
      }>
    ) {
      const { author, localMessageId, payload } = action.payload;
      const { converseId, groupId, content, meta } = payload;

      if (!state.converses[converseId]) {
        // 没有会话信息, 请先设置会话信息
        console.error('没有会话信息, 请先设置会话信息');
        return;
      }

      const message: LocalChatMessage = {
        _id: localMessageId,
        author,
        groupId,
        converseId,
        content,
        meta: meta as Record<string, unknown>,
        isLocal: true,
      };

      const newMessages = _orderBy(
        _uniqBy([...state.converses[converseId].messages, message], '_id'),
        '_id',
        'asc'
      );

      state.converses[converseId].messages = newMessages;
    },

    /**
     * 初始化历史信息
     */
    initialHistoryMessage(
      state,
      action: PayloadAction<{
        converseId: string;
        historyMessages: ChatMessage[];
      }>
    ) {
      const { converseId, historyMessages } = action.payload;
      if (!state.converses[converseId]) {
        // 没有会话信息, 请先设置会话信息
        console.error('没有会话信息, 请先设置会话信息');
        return;
      }

      chatSlice.caseReducers.appendConverseMessage(
        state,
        chatSlice.actions.appendConverseMessage({
          converseId,
          messages: [...historyMessages],
        })
      );

      if (historyMessages.length < 50) {
        state.converses[converseId].hasMoreMessage = false;
      }

      state.converses[converseId].hasFetchedHistory = true;
    },

    /**
     * 追加历史信息
     */
    appendHistoryMessage(
      state,
      action: PayloadAction<{
        converseId: string;
        historyMessages: ChatMessage[];
      }>
    ) {
      const { converseId, historyMessages } = action.payload;
      if (!state.converses[converseId]) {
        // 没有会话信息, 请先设置会话信息
        console.error('没有会话信息, 请先设置会话信息');
        return;
      }

      chatSlice.caseReducers.appendConverseMessage(
        state,
        chatSlice.actions.appendConverseMessage({
          converseId,
          messages: [...historyMessages],
        })
      );

      if (historyMessages.length < 50) {
        state.converses[converseId].hasMoreMessage = false;
      }
      state.converses[converseId].hasFetchedHistory = true;
    },

    removeConverse(state, action: PayloadAction<{ converseId: string }>) {
      const { converseId } = action.payload;

      if (!state.converses[converseId]) {
        return;
      }

      delete state.converses[converseId];
    },

    /**
     * 设置用户的私信会话列表（仅用于侧栏渲染顺序/显隐）
     */
    setDMConverseIds(state, action: PayloadAction<string[]>) {
      const ids = Array.isArray(action.payload) ? action.payload : [];
      state.dmConverseIds = ids;
    },

    /**
     * 添加到本地的私信会话ID
     */
    addDMConverseId(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (typeof id !== 'string' || id.length === 0) return;
      if (!state.dmConverseIds.includes(id)) {
        state.dmConverseIds.push(id);
      }
    },

    /**
     * 从本地私信会话ID列表移除
     */
    removeDMConverseId(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.dmConverseIds = state.dmConverseIds.filter((x) => x !== id);
    },

    /**
     * 清理所有会话信息
     */
    clearAllConverses(state) {
      state.converses = {};
    },

    /**
     * 设置已读消息
     */
    setConverseAck(
      state,
      action: PayloadAction<{
        converseId: string;
        lastMessageId: string;
      }>
    ) {
      const { converseId, lastMessageId } = action.payload;
      state.ack[converseId] = lastMessageId;
    },

    /**
     * 增量更新：写入某个成员在某会话的已读位置
     */
    upsertMemberAck(
      state,
      action: PayloadAction<{
        converseId: string;
        userId: string;
        lastMessageId: string;
      }>
    ) {
      const { converseId, userId, lastMessageId } = action.payload;
      if (!converseId || !userId || !lastMessageId) return;
      if (!state.memberAcks[converseId]) state.memberAcks[converseId] = {};
      state.memberAcks[converseId][userId] = lastMessageId;
    },

    /**
     * 全量覆盖：设置会话成员的已读快照（可用于低频校正）
     */
    setConverseMemberAcks(
      state,
      action: PayloadAction<{
        converseId: string;
        acks: Record<string, string>; // <userId,lastMessageId>
      }>
    ) {
      const { converseId, acks } = action.payload;
      if (!converseId || !acks) return;
      state.memberAcks[converseId] = { ...(acks || {}) };
    },

    /**
     * 更新消息信息
     */
    updateMessageInfo(
      state,
      action: PayloadAction<{
        messageId?: string;
        message: Partial<LocalChatMessage>;
      }>
    ) {
      const { message } = action.payload;
      const messageId = action.payload.messageId ?? message._id;
      const converseId = message.converseId;
      if (!converseId) {
        console.warn('Not found converse id,', message);
        return;
      }

      const converse = state.converses[converseId];
      if (!converse) {
        console.warn('Not found converse,', converseId);
        return;
      }
      // immutable update: map to a new array
      const nextMessages = converse.messages.map((m) =>
        m._id === messageId ? { ...m, ...message } : m
      );
      state.converses[converseId].messages = nextMessages;
    },

    /**
     * 删除消息
     */
    deleteMessageById(
      state,
      action: PayloadAction<{
        converseId: string;
        messageId: string;
      }>
    ) {
      const { converseId, messageId } = action.payload;
      const converse = state.converses[converseId];
      if (!converse) {
        console.warn('Not found converse,', converseId);
        return;
      }
      // immutable update: filter to a new array
      state.converses[converseId].messages = converse.messages.filter(
        (m) => m._id !== messageId
      );
    },

    /**
     * 设置远程的最后一条会话的id
     */
    setLastMessageMap(
      state,
      action: PayloadAction<
        {
          converseId: string;
          lastMessageId: string;
        }[]
      >
    ) {
      const list = action.payload;

      if (Array.isArray(list)) {
        list.forEach((item) => {
          state.lastMessageMap[item.converseId] = item.lastMessageId;
        });
      }
    },

    /**
     * 追加消息反应
     */
    appendMessageReaction(
      state,
      action: PayloadAction<{
        converseId: string;
        messageId: string;
        reaction: ChatMessageReaction;
      }>
    ) {
      const { converseId, messageId, reaction } = action.payload;
      const converse = state.converses[converseId];
      if (!converse) {
        console.warn('Not found converse,', converseId);
        return;
      }
      // immutable update: map messages, and for target message, create new reactions array
      const nextMessages = converse.messages.map((m) => {
        if (m._id !== messageId) return m;
        const prev = Array.isArray(m.reactions) ? m.reactions : [];
        return {
          ...m,
          reactions: [...prev, reaction],
        } as LocalChatMessage;
      });
      state.converses[converseId].messages = nextMessages;
    },

    /**
     * 移除消息反应
     */
    removeMessageReaction(
      state,
      action: PayloadAction<{
        converseId: string;
        messageId: string;
        reaction: ChatMessageReaction;
      }>
    ) {
      const { converseId, messageId, reaction } = action.payload;
      const converse = state.converses[converseId];
      if (!converse) {
        console.warn('Not found converse,', converseId);
        return;
      }
      // immutable update: map messages, and for target message, filter reactions
      const nextMessages = converse.messages.map((m) => {
        if (m._id !== messageId) return m;
        const prev = Array.isArray(m.reactions) ? m.reactions : [];
        const filtered = prev.filter(
          (r) => !(r.name === reaction.name && r.author === reaction.author)
        );
        return {
          ...m,
          reactions: filtered,
        } as LocalChatMessage;
      });
      state.converses[converseId].messages = nextMessages;
    },
    /**
     * 设置收件箱
     */
    setInboxList(state, action: PayloadAction<InboxItem[]>) {
      const list = action.payload;
      state.inbox = list;
    },

    /**
     * 增加收件箱项目
     */
    appendInboxItem(state, action: PayloadAction<InboxItem>) {
      state.inbox.push(action.payload);
    },
    /**
     * 设置收件箱
     */
    setInboxItemAck(state, action: PayloadAction<string>) {
      const inboxItemId = action.payload;
      const item = state.inbox.find((item) => item._id === inboxItemId);

      if (item) {
        item.readed = true;
      }
    },
  },
});

export const chatActions = chatSlice.actions;
export const chatReducer = chatSlice.reducer;
