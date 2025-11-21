import { getOrCreateSocket } from '../api/socket';
export type {
  BasicInboxItem,
  MessageInboxItem,
  MarkdownInboxItem,
  InboxItem,
} from 'tailchat-types';

/**
 * 设置收件箱某条记录已读
 */
export async function setInboxAck(inboxItemIds: string[]) {
  const socket = await getOrCreateSocket();
  await socket.request('chat.inbox.ack', { inboxItemIds });
}

/**
 * 清空收件箱
 */
export async function clearInbox() {
  const socket = await getOrCreateSocket();
  await socket.request('chat.inbox.clear', {});
}
