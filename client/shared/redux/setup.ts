import type { AppStore } from './store';
import type { AppSocket } from '../api/socket';
import {
  chatActions,
  globalActions,
  groupActions,
  userActions,
} from './slices';
import type { FriendRequest } from '../model/friend';
import { getCachedConverseInfo } from '../cache/cache';
import { requestMemberAckSnapshot } from './acks/snapshot';
import type { GroupInfo } from '../model/group';
import type { ChatMessage, ChatMessageReaction } from '../model/message';
import { socketEventListeners, rawSocketEventListeners } from '../manager/socket';
import { showToasts } from '../manager/ui';
import { t } from '../i18n';
import type { ChatConverseInfo } from '../model/converse';
import { ChatConverseType } from '../model/converse';
import { appendUserDMConverse } from '../model/user';
import { sharedEvent } from '../event';
import type { InboxItem } from '../model/inbox';
import { useGlobalConfigStore } from '../store/globalConfig';
import type { GlobalConfig } from '../model/config';
import { getRawKeyForConverse, isE2EEEnabledForConverse } from '../crypto/keychain';
import { decryptStringWithRawKey, isE2EEContentString } from '../crypto/e2ee';

/**
 * 初始化 Redux 上下文
 * 该文件用于处理远程数据与本地 Redux 状态的交互
 */
export function setupRedux(socket: AppSocket, store: AppStore) {
  store.dispatch(globalActions.setNetworkStatus('initial'));
  initial(socket, store);
  listenNotify(socket, store);

  // 断线重连重新初始化信息
  socket.onReconnect(() => {
    console.warn('因为断线重连触发重新同步远程数据');
    const run = async () => {
      // 重置会话列表（先清空，避免旧状态干扰）
      store.dispatch(chatActions.clearAllConverses());
      // 等待初始化完成（内部已等待 TailProto 就绪）
      await initial(socket, store);
      // 初始化完成后，针对当前活跃会话拉取他人已读快照
      try {
        const cid = store.getState().chat.currentConverseId;
        if (typeof cid === 'string' && cid) {
          await requestMemberAckSnapshot(cid, (store as any));
        }
      } catch {}
      // 初始化完成后再触发 UI 侧的重连副作用
      store.dispatch(globalActions.incReconnectNum());
    };

    // 等待命名空间连接完成后再初始化，避免请求在半连接态超时
    if ((socket as any).connected) {
      run();
    } else if (typeof (socket as any).onceConnect === 'function') {
      (socket as any).onceConnect(run);
    } else {
      // 兜底：轮询等待连接，最多 15s
      const startAt = Date.now();
      const iv = setInterval(() => {
        if ((socket as any).connected) {
          clearInterval(iv);
          run();
        } else if (Date.now() - startAt > 15000) {
          clearInterval(iv);
          // 仍未连接，直接尝试；AppSocket.request 内部还会再等待一次连接
          run();
        }
      }, 200);
    }
  });

  sharedEvent.on('updateNetworkStatus', (status) => {
    store.dispatch(globalActions.setNetworkStatus(status));
  });

  // 页面从后台恢复时，对当前活跃会话做一次他人已读快照
  try {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVisible = () => {
        try {
          if (document.visibilityState === 'visible') {
            const cid = store.getState().chat.currentConverseId;
            if (typeof cid === 'string' && cid) {
              requestMemberAckSnapshot(cid, (store as any));
            }
          }
        } catch {}
      };
      document.addEventListener('visibilitychange', onVisible);
    }
  } catch {}
}

/**
 * 初始化数据
 */
async function initial(socket: AppSocket, store: AppStore) {
  console.log('初始化Redux上下文...');

  // 立即请求加入房间
  let loadedDmFromJoin = false; // 不再用于决定侧栏数据来源，仅保留变量
  try {
    if ((socket as any).waitReady) {
      await (socket as any).waitReady();
    }
  } catch {}
  // TailProto/Socket 就绪后，对当前会话做一次他人已读快照
  try {
    const cid = store.getState().chat.currentConverseId;
    if (typeof cid === 'string' && cid) {
      await requestMemberAckSnapshot(cid, (store as any));
    }
  } catch {}
  socket
    .request<{
      dmConverseIds: string[];
      groupIds: string[];
      textPanelIds: string[];
      subscribeFeaturePanelIds: string[];
    }>('chat.converse.findAndJoinRoom')
    .then((_payload) => {
      // 仅用于让服务端把当前用户加入对应的 Socket 房间
      // 不再用返回的 dmConverseIds 来渲染侧栏，避免“被动会话”自动出现
      loadedDmFromJoin = true; // 标记已完成房间加入
    })
    .catch((err) => {
      console.error(err);
      showToasts(
        t('无法加入房间, 您将无法获取到最新的信息, 请刷新页面后重试'),
        'error'
      );
      // 不再向上抛出，避免未捕获的 Promise 错误中断后续流程
    });

  // 获取好友列表
  socket
    .request<{ id: string; nickname?: string }[]>('friend.getAllFriends')
    .then((data) => {
      const list = Array.isArray(data) ? data : [];
      store.dispatch(userActions.setFriendList(list));
    });

  // 获取好友邀请列表
  socket.request<FriendRequest[]>('friend.request.allRelated').then((data) => {
    const list = Array.isArray(data) ? data : [];
    store.dispatch(userActions.setFriendRequests(list));
  });

  // 获取群组好友邀请列表
  socket.request<any[]>('group.friendInvite.getUserReceivedInvites').then((data) => {
    store.dispatch(userActions.setGroupInvites(data ?? []));
  }).catch((err) => {
    console.warn('Failed to load group invites:', err);
  });

  // 获取所有的当前用户会话列表
  socket.request<string[]>('user.dmlist.getAllConverse').then((data) => {
    // 以用户的“私信列表”为准渲染侧栏
    const ids = (Array.isArray(data) ? data : []).filter(
      (v) => typeof v === 'string' && v.length > 0
    );
    store.dispatch(chatActions.setDMConverseIds(ids));
    ids.forEach(async (converseId) => {
      try {
        const converse = await getCachedConverseInfo(converseId);
        store.dispatch(chatActions.setConverseInfo(converse));
      } catch (e) {
        console.error(e);
      }
    });
  });

  /**
   * 获取用户群组列表
   */
  socket.request<GroupInfo[]>('group.getUserGroups').then((groups) => {
    const list = Array.isArray(groups) ? groups : [];
    store.dispatch(groupActions.appendGroups(list));
  });

  socket.request<InboxItem[]>('chat.inbox.all').then((list) => {
    store.dispatch(chatActions.setInboxList(Array.isArray(list) ? list : []));
  });
}

/**
 * 监听远程通知
 */
function listenNotify(socket: AppSocket, store: AppStore) {
  const tryDecrypt = async (msg: ChatMessage): Promise<ChatMessage> => {
    try {
      const flagged = (msg as any)?.meta?.e2ee === true || isE2EEContentString(msg.content);
      if (!flagged) return msg;
      const rawKey = getRawKeyForConverse(msg.converseId);
      if (!rawKey) return { ...msg, content: '*** 加密消息（未配置密钥）***' } as any;
      const plaintext = await decryptStringWithRawKey(rawKey, msg.content as any);
      return { ...msg, content: plaintext };
    } catch (e) {
      return { ...msg, content: '*** 加密消息（解密失败）***' } as any;
    }
  };
  socket.listen<{ userId: string }>('friend.add', ({ userId }) => {
    if (typeof userId !== 'string') {
      console.error('错误的信息', userId);
      return;
    }
    store.dispatch(userActions.appendFriend({ id: userId }));
  });

  socket.listen<FriendRequest>('friend.request.add', (request) => {
    store.dispatch(userActions.appendFriendRequest(request));
  });

  socket.listen<{ requestId: string }>(
    'friend.request.remove',
    ({ requestId }) => {
      store.dispatch(userActions.removeFriendRequest(requestId));
    }
  );

  // 监听群组好友邀请通知（事件名包含服务名前缀）
  socket.listen<{ type: string; invite?: any; inviteId?: string; invitee?: any }>(
    'group.friendInvite.groupFriendInvite',
    (data) => {
      if (data.type === 'receive' && data.invite) {
        // 收到新的群组邀请
        store.dispatch(userActions.appendGroupInvite(data.invite));
      } else if (data.type === 'accepted' && data.inviteId) {
        // 邀请被接受
        store.dispatch(userActions.updateGroupInviteStatus({
          inviteId: data.inviteId,
          status: 'accepted'
        }));
      } else if (data.type === 'rejected' && data.inviteId) {
        // 邀请被拒绝
        store.dispatch(userActions.updateGroupInviteStatus({
          inviteId: data.inviteId,
          status: 'rejected'
        }));
      }
    }
  );

  socket.listen<ChatMessage>('chat.message.add', async (message) => {
    // 处理接受到的消息
    message = await tryDecrypt(message);
    const converseId = message.converseId;
    const converse = store.getState().chat.converses[converseId];

    // 添加消息到会话中
    const appendMessage = () => {
      store.dispatch(
        chatActions.appendConverseMessage({
          converseId,
          messages: [message],
        })
      );
    };

    if (converse) {
      // 如果该会话已经加载(群组面板/已加载的DM)
      appendMessage();
    } else if (!message.groupId) {
      // DM：若不在 converses 但已在 DM 列表中，则按需加载会话信息并立即渲染消息
      try {
        const dmIds = store.getState().chat.dmConverseIds;
        if (Array.isArray(dmIds) && dmIds.includes(converseId)) {
          getCachedConverseInfo(converseId)
            .then((c) => {
              store.dispatch(chatActions.setConverseInfo(c));
              appendMessage();
              // 更新最后一条消息，用于排序
              store.dispatch(
                chatActions.setLastMessageMap([
                  { converseId, lastMessageId: message._id },
                ])
              );
            })
            .catch(() => {});
        }
      } catch {}
    } else {
      // 是群组未加载的消息面板的消息
      // 设置会话信息
      store.dispatch(
        chatActions.setLastMessageMap([
          {
            converseId,
            lastMessageId: message._id,
          },
        ])
      );
    }

    sharedEvent.emit('receiveMessage', message); // 推送到通知中心
  });

  socket.listen<ChatMessage>('chat.message.update', async (message) => {
    store.dispatch(
      chatActions.updateMessageInfo({
        message: await tryDecrypt(message),
      })
    );
  });

  socket.listen<ChatMessage>('chat.message.edit', async (message) => {
    store.dispatch(
      chatActions.updateMessageInfo({
        message: await tryDecrypt(message),
      })
    );
  });

  socket.listen<{
    converseId: string;
    messageId: string;
  }>('chat.message.delete', ({ converseId, messageId }) => {
    store.dispatch(
      chatActions.deleteMessageById({
        converseId,
        messageId,
      })
    );
  });

  socket.listen<{
    converseId: string;
    messageId: string;
    reaction: ChatMessageReaction;
  }>('chat.message.addReaction', ({ converseId, messageId, reaction }) => {
    store.dispatch(
      chatActions.appendMessageReaction({
        converseId,
        messageId,
        reaction,
      })
    );
  });

  socket.listen<{
    converseId: string;
    messageId: string;
    reaction: ChatMessageReaction;
  }>('chat.message.removeReaction', ({ converseId, messageId, reaction }) => {
    store.dispatch(
      chatActions.removeMessageReaction({
        converseId,
        messageId,
        reaction,
      })
    );
  });

  // Ack updates push from server
  socket.listen<{ converseId: string; userId: string; lastMessageId: string }>(
    'chat.ack.updated',
    ({ converseId, userId, lastMessageId }) => {
      // 1) 增量应用到 Redux：记录该成员在该会话的已读位置
      try {
        store.dispatch(chatActions.upsertMemberAck({ converseId, userId, lastMessageId }));
      } catch {}

      // 2) 兼容旧的 UI 刷新路径：通过 sharedEvent 通知组件重计算，但组件应避免每次全量拉取
      try {
        const fake: ChatMessage = {
          _id: lastMessageId,
          converseId,
          author: userId,
          content: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          __isAckUpdate: true,
        } as any;
        sharedEvent.emit('receiveMessage', fake);
      } catch (e) {}
    }
  );

  socket.listen<ChatConverseInfo>(
    'chat.converse.updateDMConverse',
    (converse) => {
      store.dispatch(chatActions.setConverseInfo(converse));
      try {
        // 将新产生的私信/多人会话加入到侧栏对话列表
        if (
          converse &&
          (converse.type === ChatConverseType.DM || converse.type === ChatConverseType.Multi)
        ) {
          const ids = store.getState().chat.dmConverseIds;
          if (!ids.includes(converse._id)) {
            store.dispatch(chatActions.addDMConverseId(converse._id));
          }
        }
      } catch {}
    }
  );

  socket.listen<GroupInfo>('group.add', (groupInfo) => {
    store.dispatch(groupActions.appendGroups([groupInfo]));
  });

  socket.listen<GroupInfo>('group.updateInfo', (groupInfo) => {
    store.dispatch(groupActions.updateGroup(groupInfo));
  });

  socket.listen<{ groupId: string }>('group.remove', ({ groupId }) => {
    store.dispatch(groupActions.removeGroup(groupId));
  });

  socket.listen<InboxItem>('chat.inbox.append', (item) => {
    store.dispatch(chatActions.appendInboxItem(item));
  });

  socket.listen('chat.inbox.updated', () => {
    // 检测到收件箱列表被更新，需要重新获取
    socket.request<InboxItem[]>('chat.inbox.all').then((list) => {
      store.dispatch(chatActions.setInboxList(list));
    });
  });

  socket.listen(
    'config.updateClientConfig',
    (config: Partial<GlobalConfig>) => {
      useGlobalConfigStore.setState((state) => ({
        ...state,
        ...config,
      }));
    }
  );

  // 其他的额外的通知
  socketEventListeners.forEach(({ eventName, eventFn }) => {
    socket.listen(eventName, eventFn);
  });

  // 原始事件监听器（不添加 'notify:' 前缀）
  // 用于监听服务端直接广播的事件，如 'openapi.command.updated'
  rawSocketEventListeners.forEach(({ eventName, eventFn }) => {
    (socket as any).listener.push([eventName, eventFn]);
  });
}
