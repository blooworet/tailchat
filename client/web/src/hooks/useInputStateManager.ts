/**
 * 输入状态管理器 Hook
 * 基于Telegram TT架构的统一状态管理
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  InputMode,
  StateTransitionEvent
} from '../types/inputState';
import type {
  InputState,
  StateTransitionConfig,
  InputStateManagerOptions,
  InputStateManager,
  InputStateCallbacks
} from '../types/inputState';

/**
 * 状态优先级定义 (数值越高优先级越高)
 */
const MODE_PRIORITY: Record<InputMode, number> = {
  [InputMode.RECORDING]: 100,      // 录音状态 - 最高优先级
  [InputMode.COMMAND_LIST]: 80,    // 命令列表
  [InputMode.EMOJI_PICKER]: 70,    // 表情选择器
  [InputMode.ATTACHMENT]: 60,      // 附件选择器
  [InputMode.TYPING]: 50,          // 正在输入
  [InputMode.IDLE]: 0              // 空闲状态 - 最低优先级
};

/**
 * 根据当前模式计算UI状态
 */
const calculateUIState = (mode: InputMode): Omit<InputState, 'mode'> => {
  switch (mode) {
    case InputMode.RECORDING:
      return {
        canShowEmojiButton: false,    // 录音时隐藏表情按钮
        canShowAudioButton: true,     // 保持录音按钮显示（用于 Portal 渲染和状态反馈）
        canShowCommandButton: false,  // 隐藏命令按钮
        canShowAttachmentButton: false, // 隐藏附件按钮
        canShowSendButton: false,     // 隐藏发送按钮
        canTypeText: false,           // 禁用文本输入
        hasActiveInput: true
      };
    
    case InputMode.COMMAND_LIST:
      return {
        canShowEmojiButton: true,     // 保持表情按钮
        canShowAudioButton: true,     // 保持录音按钮
        canShowCommandButton: true,   // 命令按钮激活状态
        canShowAttachmentButton: true, // 保持附件按钮
        canShowSendButton: false,     // 隐藏发送按钮
        canTypeText: true,            // 允许文本输入
        hasActiveInput: true
      };
    
    case InputMode.EMOJI_PICKER:
      return {
        canShowEmojiButton: true,     // 表情按钮激活状态
        canShowAudioButton: true,     // 保持录音按钮
        canShowCommandButton: true,   // 保持命令按钮
        canShowAttachmentButton: true, // 保持附件按钮
        canShowSendButton: false,     // 隐藏发送按钮
        canTypeText: true,            // 允许文本输入
        hasActiveInput: true
      };
    
    case InputMode.ATTACHMENT:
      return {
        canShowEmojiButton: true,     // 保持表情按钮
        canShowAudioButton: true,     // 保持录音按钮
        canShowCommandButton: true,   // 保持命令按钮
        canShowAttachmentButton: true, // 附件按钮激活状态
        canShowSendButton: false,     // 隐藏发送按钮
        canTypeText: true,            // 允许文本输入
        hasActiveInput: true
      };
    
    case InputMode.TYPING:
      return {
        canShowEmojiButton: true,     // 保持表情按钮
        canShowAudioButton: false,    // 隐藏录音按钮（有文字时显示发送按钮）
        canShowCommandButton: true,   // 保持命令按钮
        canShowAttachmentButton: false, // 隐藏附件按钮
        canShowSendButton: true,      // 显示发送按钮
        canTypeText: true,            // 允许文本输入
        hasActiveInput: true
      };
    
    case InputMode.IDLE:
    default:
      return {
        canShowEmojiButton: true,     // 显示表情按钮
        canShowAudioButton: true,     // 显示录音按钮
        canShowCommandButton: true,   // 显示命令按钮
        canShowAttachmentButton: true, // 显示附件按钮
        canShowSendButton: false,     // 隐藏发送按钮
        canTypeText: true,            // 允许文本输入
        hasActiveInput: false
      };
  }
};

/**
 * 状态转换规则定义
 */
const TRANSITION_RULES: StateTransitionConfig[] = [
  // 录音相关转换
  { from: InputMode.IDLE, to: InputMode.RECORDING, event: StateTransitionEvent.START_RECORDING, allowed: true },
  { from: InputMode.TYPING, to: InputMode.RECORDING, event: StateTransitionEvent.START_RECORDING, allowed: true },
  { from: InputMode.RECORDING, to: InputMode.IDLE, event: StateTransitionEvent.STOP_RECORDING, allowed: true },
  { from: InputMode.RECORDING, to: InputMode.IDLE, event: StateTransitionEvent.CANCEL_RECORDING, allowed: true },
  
  // 输入相关转换
  { from: InputMode.IDLE, to: InputMode.TYPING, event: StateTransitionEvent.START_TYPING, allowed: true },
  { from: InputMode.TYPING, to: InputMode.IDLE, event: StateTransitionEvent.STOP_TYPING, allowed: true },
  
  // 表情选择器转换
  { from: InputMode.IDLE, to: InputMode.EMOJI_PICKER, event: StateTransitionEvent.OPEN_EMOJI_PICKER, allowed: true },
  { from: InputMode.TYPING, to: InputMode.EMOJI_PICKER, event: StateTransitionEvent.OPEN_EMOJI_PICKER, allowed: true },
  { from: InputMode.EMOJI_PICKER, to: InputMode.IDLE, event: StateTransitionEvent.CLOSE_EMOJI_PICKER, allowed: true },
  { from: InputMode.EMOJI_PICKER, to: InputMode.TYPING, event: StateTransitionEvent.CLOSE_EMOJI_PICKER, allowed: true },
  
  // 命令列表转换
  { from: InputMode.IDLE, to: InputMode.COMMAND_LIST, event: StateTransitionEvent.OPEN_COMMAND_LIST, allowed: true },
  { from: InputMode.TYPING, to: InputMode.COMMAND_LIST, event: StateTransitionEvent.OPEN_COMMAND_LIST, allowed: true },
  { from: InputMode.COMMAND_LIST, to: InputMode.IDLE, event: StateTransitionEvent.CLOSE_COMMAND_LIST, allowed: true },
  { from: InputMode.COMMAND_LIST, to: InputMode.TYPING, event: StateTransitionEvent.CLOSE_COMMAND_LIST, allowed: true },
  
  // 附件选择器转换
  { from: InputMode.IDLE, to: InputMode.ATTACHMENT, event: StateTransitionEvent.OPEN_ATTACHMENT, allowed: true },
  { from: InputMode.TYPING, to: InputMode.ATTACHMENT, event: StateTransitionEvent.OPEN_ATTACHMENT, allowed: true },
  { from: InputMode.ATTACHMENT, to: InputMode.IDLE, event: StateTransitionEvent.CLOSE_ATTACHMENT, allowed: true },
  { from: InputMode.ATTACHMENT, to: InputMode.TYPING, event: StateTransitionEvent.CLOSE_ATTACHMENT, allowed: true },
  
  // 重置转换 - 从任何状态都可以重置到IDLE
  { from: InputMode.RECORDING, to: InputMode.IDLE, event: StateTransitionEvent.RESET, allowed: true },
  { from: InputMode.TYPING, to: InputMode.IDLE, event: StateTransitionEvent.RESET, allowed: true },
  { from: InputMode.EMOJI_PICKER, to: InputMode.IDLE, event: StateTransitionEvent.RESET, allowed: true },
  { from: InputMode.COMMAND_LIST, to: InputMode.IDLE, event: StateTransitionEvent.RESET, allowed: true },
  { from: InputMode.ATTACHMENT, to: InputMode.IDLE, event: StateTransitionEvent.RESET, allowed: true },
];

/**
 * 输入状态管理器Hook
 */
export const useInputStateManager = (options: InputStateManagerOptions = {}): InputStateManager => {
  const {
    initialMode = InputMode.IDLE,
    debug = false,
    transitionTimeout = 5000,
    callbacks = {}
  } = options;

  // 状态管理
  const [currentMode, setCurrentMode] = useState(initialMode);
  const [state, setState] = useState(() => ({
    mode: initialMode,
    ...calculateUIState(initialMode)
  }));

  // 订阅者管理
  const subscribersRef = useRef(new Set<(state: InputState) => void>());
  const callbacksRef = useRef(callbacks);
  const transitionTimeoutRef = useRef(null as NodeJS.Timeout | null);

  // 错误状态处理增强
  const [errorCount, setErrorCount] = useState(0);
  const [lastError, setLastError] = useState(null as { error: Error; timestamp: number; event: StateTransitionEvent } | null);
  const recoveryTimeoutRef = useRef(null as NodeJS.Timeout | null);
  const maxErrorCount = 3; // 最大错误次数
  const recoveryDelay = 1000; // 自动恢复延迟（ms）

  // 更新回调引用
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);


  // 错误处理和恢复机制
  const logError = useCallback((error: Error, event: StateTransitionEvent, context?: any) => {
    const errorInfo = {
      error: error.message,
      stack: error.stack,
      event,
      currentMode,
      timestamp: new Date().toISOString(),
      context,
      errorCount: errorCount + 1
    };

    console.error('[InputStateManager] 状态管理器错误:', errorInfo);
    
    // 更新错误统计
    setErrorCount((prev: number) => prev + 1);
    setLastError({ error, timestamp: Date.now(), event });

    // 尝试触发错误回调
    try {
      callbacksRef.current.onError?.(error, event, state);
    } catch (callbackError) {
      console.error('[InputStateManager] 错误回调执行失败:', callbackError);
    }
  }, [currentMode, errorCount, state]);

  // 自动恢复机制
  const attemptRecovery = useCallback((fromEvent?: StateTransitionEvent) => {
    if (errorCount >= maxErrorCount) {
      // 降级到最基本的状态
      try {
        setCurrentMode(InputMode.IDLE);
        setState({
          mode: InputMode.IDLE,
          ...calculateUIState(InputMode.IDLE)
        });
        setErrorCount(0); // 重置错误计数
      } catch (fallbackError) {
        console.error('[InputStateManager] 降级失败，系统可能不稳定:', fallbackError);
      }
      return;
    }

    // 标准自动恢复
    if (recoveryTimeoutRef.current) {
      clearTimeout(recoveryTimeoutRef.current);
    }

    recoveryTimeoutRef.current = setTimeout(() => {
      try {
        
        // 检查当前状态是否异常
        const isCurrentStateValid = Object.values(InputMode).includes(currentMode);
        
        if (!isCurrentStateValid) {
          updateState(InputMode.IDLE, StateTransitionEvent.RESET);
        } else {
          // 尝试重新计算UI状态
          const recalculatedState = calculateUIState(currentMode);
          setState((prev: InputState) => ({
            ...prev,
            ...recalculatedState
          }));
        }

        // 成功恢复后重置错误计数
        setErrorCount(0);
        setLastError(null);
      } catch (recoveryError) {
        logError(recoveryError as Error, StateTransitionEvent.RESET, { 
          recoveryAttempt: errorCount + 1,
          originalEvent: fromEvent 
        });
      }
    }, recoveryDelay);
  }, [errorCount, maxErrorCount, currentMode, recoveryDelay]);

  // 状态一致性检查
  const validateState = useCallback(() => {
    try {
      // 检查状态枚举是否有效
      if (!Object.values(InputMode).includes(currentMode)) {
        throw new Error(`无效的输入模式: ${currentMode}`);
      }

      // 检查状态对象完整性
      const requiredProperties = ['mode', 'canShowEmojiButton', 'canShowAudioButton', 'canShowCommandButton', 'canShowAttachmentButton', 'canShowSendButton', 'canTypeText', 'hasActiveInput'];
      for (const prop of requiredProperties) {
        if (!(prop in state)) {
          throw new Error(`状态对象缺少属性: ${prop}`);
        }
      }

      return true;
    } catch (error) {
      logError(error as Error, StateTransitionEvent.RESET, { validationFailure: true });
      return false;
    }
  }, [currentMode, state, logError]);

  // 通知订阅者
  const notifySubscribers = useCallback((newState: InputState) => {
    subscribersRef.current.forEach((callback: (state: InputState) => void) => {
      try {
        callback(newState);
      } catch (error) {
        console.error('[InputStateManager] Subscriber callback error:', error);
      }
    });
  }, []);

  // 更新状态 (增强错误处理)
  const updateState = useCallback((newMode: InputMode, event?: StateTransitionEvent) => {
    try {
      // 状态预验证
      if (!Object.values(InputMode).includes(newMode)) {
        throw new Error(`尝试切换到无效状态: ${newMode}`);
      }

      const oldState = state;
      const newState: InputState = {
        mode: newMode,
        ...calculateUIState(newMode)
      };


      setState(newState);
      setCurrentMode(newMode);
      
      // 触发回调
      try {
        callbacksRef.current.onStateChange?.(newState, oldState);
        if (event) {
          callbacksRef.current.onAfterTransition?.(event, newState);
        }
      } catch (callbackError) {
        logError(callbackError as Error, event || StateTransitionEvent.RESET, { 
          callbackType: 'stateChange/afterTransition',
          newMode,
          oldMode: oldState.mode 
        });
        // 回调错误不应该阻止状态更新，只记录错误
      }
      
      // 通知订阅者
      notifySubscribers(newState);

      // 状态更新成功，重置错误计数
      if (errorCount > 0) {
        setErrorCount(0);
        setLastError(null);
      }

    } catch (error) {
      logError(error as Error, event || StateTransitionEvent.RESET, { 
        attemptedMode: newMode,
        currentMode: state.mode 
      });
      
      // 触发自动恢复
      attemptRecovery(event);
    }
  }, [state, notifySubscribers, errorCount, logError, attemptRecovery]);

  // 检查状态转换是否允许
  const canTransition = useCallback((event: StateTransitionEvent): boolean => {
    const rule = TRANSITION_RULES.find(r => 
      r.from === currentMode && r.event === event
    );
    
    if (!rule) {
      return false;
    }
    
    if (!rule.allowed) {
      return false;
    }
    
    // 检查自定义条件
    if (rule.condition && !rule.condition(state)) {
      return false;
    }
    
    return true;
  }, [currentMode, state]);

  // 执行状态转换 (增强错误处理)
  const transition = useCallback((event: StateTransitionEvent): boolean => {
    try {
      // 状态一致性预检查
      if (!validateState()) {
        attemptRecovery(event);
        return false;
      }

      // 清除之前的超时
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }


      // 检查是否允许转换
      if (!canTransition(event)) {
        try {
          callbacksRef.current.onConflict?.(event, state);
        } catch (conflictError) {
          logError(conflictError as Error, event, { conflictCallback: true });
        }
        return false;
      }

      // 前置回调 (带错误处理)
      try {
        if (callbacksRef.current.onBeforeTransition?.(event, state) === false) {
          return false;
        }
      } catch (beforeError) {
        logError(beforeError as Error, event, { beforeTransitionCallback: true });
        // 前置回调错误时，允许继续转换
      }

      // 查找目标状态
      const rule = TRANSITION_RULES.find(r => 
        r.from === currentMode && r.event === event
      );

      if (!rule) {
        const error = new Error(`未找到转换规则: ${currentMode} -> ${event}`);
        logError(error, event, { availableRules: TRANSITION_RULES.filter(r => r.from === currentMode) });
        return false;
      }

      // 执行状态转换
      updateState(rule.to, event);

      // 设置转换超时保护
      if (transitionTimeout > 0) {
        transitionTimeoutRef.current = setTimeout(() => {
          updateState(InputMode.IDLE, StateTransitionEvent.RESET);
        }, transitionTimeout);
      }

      return true;
    } catch (error) {
      logError(error as Error, event, { transitionAttempt: true });
      
      // 严重错误时触发自动恢复
      attemptRecovery(event);
      return false;
    }
  }, [currentMode, canTransition, state, updateState, transitionTimeout, validateState, attemptRecovery, logError]);

  // 重置状态
  const reset = useCallback(() => {
    updateState(InputMode.IDLE, StateTransitionEvent.RESET);
  }, [updateState]);

  // 获取当前模式
  const getMode = useCallback(() => currentMode, [currentMode]);

  // 检查是否处于特定模式
  const isMode = useCallback((mode: InputMode) => currentMode === mode, [currentMode]);

  // 订阅状态变化
  const subscribe = useCallback((callback: (state: InputState) => void) => {
    subscribersRef.current.add(callback);
    
    // 返回取消订阅函数
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  // 清理函数 (增强错误恢复清理)
  useEffect(() => {
    return () => {
      // 清理所有定时器
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
      if (recoveryTimeoutRef.current) {
        clearTimeout(recoveryTimeoutRef.current);
      }
      
      // 清理订阅者
      subscribersRef.current.clear();
      
      // 重置错误状态
      setErrorCount(0);
      setLastError(null);
      
    };
  }, []);


  return {
    state,
    transition,
    canTransition,
    reset,
    getMode,
    isMode,
    subscribe
  };
};
