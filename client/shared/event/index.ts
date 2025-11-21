import { useEffect } from 'react';
import { useUpdateRef } from '../hooks/useUpdateRef';
import type { ChatMessage, SendMessagePayload } from '../model/message';
import { EventEmitter } from 'eventemitter-strict';
import type { UserBaseInfo, UserSettings } from '../model/user';

/**
 * 共享事件类型
 */
export interface SharedEventMap {
  /**
   * 登录成功
   */
  loginSuccess: (userInfo: UserBaseInfo) => void;

  /**
   * app加载成功
   */
  appLoaded: () => void;

  /**
   * 修改配色方案
   */
  loadColorScheme: (schemeName: string) => void;

  /**
   * 请求webrtc相关权限
   * 目前用于视频会议
   */
  ensureWebRTCPermission: () => void;

  /**
   * 网络状态更新
   */
  updateNetworkStatus: (
    status: 'connected' | 'reconnecting' | 'disconnected'
  ) => void;

  /**
   * 发送消息
   */
  sendMessage: (payload: SendMessagePayload) => void;

  /**
   * 回复消息事件
   *
   * 如果为null则是清空
   */
  replyMessage: (payload: ChatMessage | null) => void;

  /**
   * 接受到消息(所有的(相对receiveUnmutedMessage来说))
   */
  receiveMessage: (payload: ChatMessage) => void;

  /**
   * 接受到未被静音的消息
   * 一般用于消息推送
   */
  receiveUnmutedMessage: (payload: ChatMessage) => void;

  /**
   * 群组面板状态更新
   */
  groupPanelBadgeUpdate: () => void;

  /**
   * 用户设置发生了变更
   */
  userSettingsUpdate: (userSettings: UserSettings) => void;

  /**
   * 统一应用输入事件
   * 用于从消息点击、建议面板等入口，将文本填充/追加/直接发送到输入框
   * v2: 增加来源与追踪字段（保持向后兼容）
   */
  applyChatInput: (payload: {
    text: string;
    mode?: 'replace' | 'append' | 'send';
    /** 事件来源：inline | keyboard | decorator | other */
    source?: string;
    /** 前后端贯穿的追踪ID */
    traceId?: string;
    /** 动作ID（与 inlineActions 中的 actionId 对应） */
    actionId?: string;
  }) => void;

  /**
   * E2EE 密钥更新（例如创建/轮换）
   */
  'e2ee.keyUpdate': (payload: { converseId: string }) => void;

  /**
   * E2EE 状态变更（开启/关闭）
   */
  'e2ee.stateChanged': (payload: { converseId: string; enabled: boolean }) => void;
}
export type SharedEventType = keyof SharedEventMap;

const bus = new EventEmitter<SharedEventMap>();

/**
 * 事件中心
 */
export const sharedEvent = {
  on<T extends SharedEventType>(eventName: T, listener: SharedEventMap[T]) {
    bus.on(eventName, listener);
  },
  off<T extends SharedEventType>(eventName: T, listener: SharedEventMap[T]) {
    bus.off(eventName, listener);
  },
  emit<T extends SharedEventType>(
    eventName: T,
    ...args: Parameters<SharedEventMap[T]>
  ) {
    bus.emit(eventName, ...args);
  },
};

export function useSharedEventHandler<
  T extends SharedEventType,
  H extends SharedEventMap[T]
>(eventName: T, handler: H) {
  const handlerRef = useUpdateRef(handler);

  useEffect(() => {
    const _handler: SharedEventMap[T] = (...args: any[]) => {
      (handlerRef.current as any)(...args);
    };

    sharedEvent.on(eventName, _handler);

    return () => {
      sharedEvent.off(eventName, _handler);
    };
  }, []);
}
