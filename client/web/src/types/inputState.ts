/**
 * 输入框状态管理相关类型定义
 * 基于Telegram TT架构设计
 */

/**
 * 输入模式枚举 - 按优先级排序
 */
export enum InputMode {
  /** 空闲状态 - 默认状态 */
  IDLE = 'idle',
  /** 正在输入文本 */
  TYPING = 'typing',
  /** 录音状态 - 最高优先级 */
  RECORDING = 'recording',
  /** 表情选择器激活 */
  EMOJI_PICKER = 'emoji',
  /** 命令列表展开 */
  COMMAND_LIST = 'command',
  /** 附件选择器激活 */
  ATTACHMENT = 'attachment'
}

/**
 * 状态转换事件类型
 */
export enum StateTransitionEvent {
  /** 开始录音 */
  START_RECORDING = 'startRecording',
  /** 停止录音 */
  STOP_RECORDING = 'stopRecording',
  /** 取消录音 */
  CANCEL_RECORDING = 'cancelRecording',
  /** 开始输入 */
  START_TYPING = 'startTyping',
  /** 停止输入 */
  STOP_TYPING = 'stopTyping',
  /** 打开表情选择器 */
  OPEN_EMOJI_PICKER = 'openEmojiPicker',
  /** 关闭表情选择器 */
  CLOSE_EMOJI_PICKER = 'closeEmojiPicker',
  /** 打开命令列表 */
  OPEN_COMMAND_LIST = 'openCommandList',
  /** 关闭命令列表 */
  CLOSE_COMMAND_LIST = 'closeCommandList',
  /** 打开附件选择器 */
  OPEN_ATTACHMENT = 'openAttachment',
  /** 关闭附件选择器 */
  CLOSE_ATTACHMENT = 'closeAttachment',
  /** 重置到空闲状态 */
  RESET = 'reset'
}

/**
 * 输入状态接口
 */
export interface InputState {
  /** 当前输入模式 */
  mode: InputMode;
  /** 是否可以显示表情按钮 */
  canShowEmojiButton: boolean;
  /** 是否可以显示录音按钮 */
  canShowAudioButton: boolean;
  /** 是否可以显示命令按钮 */
  canShowCommandButton: boolean;
  /** 是否可以显示附件按钮 */
  canShowAttachmentButton: boolean;
  /** 是否可以显示发送按钮 */
  canShowSendButton: boolean;
  /** 是否允许文本输入 */
  canTypeText: boolean;
  /** 当前是否有活动输入 */
  hasActiveInput: boolean;
}

/**
 * 状态转换配置
 */
export interface StateTransitionConfig {
  /** 源状态 */
  from: InputMode;
  /** 目标状态 */
  to: InputMode;
  /** 触发事件 */
  event: StateTransitionEvent;
  /** 是否允许此转换 */
  allowed: boolean;
  /** 转换条件检查函数 */
  condition?: (currentState: InputState) => boolean;
}

/**
 * 状态管理器回调函数类型
 */
export interface InputStateCallbacks {
  /** 状态变化回调 */
  onStateChange?: (newState: InputState, oldState: InputState) => void;
  /** 状态转换前回调 */
  onBeforeTransition?: (event: StateTransitionEvent, currentState: InputState) => boolean;
  /** 状态转换后回调 */
  onAfterTransition?: (event: StateTransitionEvent, newState: InputState) => void;
  /** 状态冲突回调 */
  onConflict?: (event: StateTransitionEvent, currentState: InputState) => void;
  /** 错误处理回调 */
  onError?: (error: Error, event: StateTransitionEvent, currentState: InputState) => void;
}

/**
 * 状态管理器选项
 */
export interface InputStateManagerOptions {
  /** 初始状态模式 */
  initialMode?: InputMode;
  /** 是否启用调试日志 */
  debug?: boolean;
  /** 状态转换超时时间 (ms) */
  transitionTimeout?: number;
  /** 回调函数 */
  callbacks?: InputStateCallbacks;
}

/**
 * 状态管理器返回类型
 */
export interface InputStateManager {
  /** 当前状态 */
  state: InputState;
  /** 触发状态转换 */
  transition: (event: StateTransitionEvent) => boolean;
  /** 检查是否可以进行状态转换 */
  canTransition: (event: StateTransitionEvent) => boolean;
  /** 重置到空闲状态 */
  reset: () => void;
  /** 获取当前模式 */
  getMode: () => InputMode;
  /** 检查是否处于特定模式 */
  isMode: (mode: InputMode) => boolean;
  /** 订阅状态变化 */
  subscribe: (callback: (state: InputState) => void) => () => void;
}
