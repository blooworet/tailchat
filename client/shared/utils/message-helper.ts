import type {
  ChatMessage,
  SendMessagePayload,
  SimpleMessagePayload,
} from '../model/message';
import _isNil from 'lodash/isNil';
import _set from 'lodash/set';
import _get from 'lodash/get';
import _pick from 'lodash/pick';

const replyMsgFields = ['_id', 'content', 'author'] as const;
export type ReplyMsgType = Pick<ChatMessage, typeof replyMsgFields[number]>;

// Forwarded message metadata (minimal cross-conversation locator)
// Stored under meta.forward
const forwardMsgFields = ['_id', 'author', 'converseId', 'groupId'] as const;
export type ForwardMsgType = Pick<
  ChatMessage,
  typeof forwardMsgFields[number]
> & {
  // optional title/source label if provided by upstream
  sourceTitle?: string;
};

export class MessageHelper {
  private payload: SendMessagePayload;

  constructor(origin: SimpleMessagePayload) {
    this.payload = { ...origin };
  }

  /**
   * 判断消息体内是否有回复信息
   */
  hasReply(): ReplyMsgType | false {
    const reply = _get(this.payload, ['meta', 'reply']);
    if (_isNil(reply)) {
      return false;
    }

    return reply;
  }

  setReplyMsg(replyMsg: ReplyMsgType) {
    if (_isNil(replyMsg)) {
      return;
    }

    _set(this.payload, ['meta', 'reply'], _pick(replyMsg, replyMsgFields));
  }

  /**
   * Forwarded message helpers
   */
  hasForward(): ForwardMsgType | false {
    const forward = _get(this.payload, ['meta', 'forward']);
    if (_isNil(forward)) {
      return false;
    }

    // provide a narrowed object with known fields; keep sourceTitle if present
    const picked = _pick(forward, [...forwardMsgFields, 'sourceTitle']);
    return picked as ForwardMsgType;
  }

  setForwardMsg(forwardMsg: ForwardMsgType) {
    if (_isNil(forwardMsg)) {
      return;
    }

    _set(
      this.payload,
      ['meta', 'forward'],
      _pick(forwardMsg, [...forwardMsgFields, 'sourceTitle'])
    );
  }

  /**
   * 生成待发送的消息体
   */
  generatePayload(): SendMessagePayload {
    return { ...this.payload };
  }
}
