import React, { useEffect, useRef, useState, useContext, createContext } from 'react';
import { CSSTransition } from 'react-transition-group';
import { useSharedEventHandler } from '../event';
import { 
  MessageAnimationManager, 
  AnimationType, 
  AnimationState, 
  AnimationDefinition,
  DefaultAnimations 
} from './MessageAnimationManager';
import type { ChatMessage } from '../model/message';

// 动效上下文
interface AnimationContextValue {
  manager: MessageAnimationManager;
  isEnabled: boolean;
}

const AnimationContext = createContext<AnimationContextValue | null>(null);

// 动效提供者组件
interface AnimationProviderProps {
  children: React.ReactNode;
  config?: Partial<import('./MessageAnimationManager').AnimationConfig>;
}

export const AnimationProvider: React.FC<AnimationProviderProps> = ({ 
  children, 
  config = {} 
}) => {
  const managerRef = useRef<MessageAnimationManager>();
  
  if (!managerRef.current) {
    managerRef.current = new MessageAnimationManager(config);
  }

  useEffect(() => {
    const manager = managerRef.current!;
    
    // 清理函数
    return () => {
      manager.cleanupAllAnimations();
    };
  }, []);

  const contextValue: AnimationContextValue = {
    manager: managerRef.current,
    isEnabled: true
  };

  return (
    <AnimationContext.Provider value={contextValue}>
      {children}
    </AnimationContext.Provider>
  );
};

// 使用动效管理器的 Hook
export const useAnimationManager = (): MessageAnimationManager => {
  const context = useContext(AnimationContext);
  if (!context) {
    throw new Error('useAnimationManager must be used within AnimationProvider');
  }
  return context.manager;
};

// 消息动效包装器属性
interface MessageAnimationWrapperProps {
  messageId: string;
  animationType?: AnimationType;
  customAnimation?: AnimationDefinition;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * 消息动效包装器组件
 * 为消息提供动效支持
 */
export const MessageAnimationWrapper: React.FC<MessageAnimationWrapperProps> = ({
  messageId,
  animationType = AnimationType.CONTENT_UPDATE,
  customAnimation,
  disabled = false,
  children,
  className = ''
}) => {
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const elementRef = useRef<HTMLDivElement>(null);
  const animationManager = useAnimationManager();
  const isAnimatingRef = useRef(false);

  // 注册动效元素
  useEffect(() => {
    if (elementRef.current && !disabled) {
      animationManager.registerMessageAnimation(messageId, elementRef.current);
    }
    
    return () => {
      if (!disabled) {
        animationManager.cleanupAnimation(messageId);
      }
    };
  }, [messageId, disabled, animationManager]);

  // 监听消息编辑事件
  useSharedEventHandler('chat.message.edit', (message: ChatMessage) => {
    if (message._id === messageId && !disabled && !isAnimatingRef.current) {
      triggerUpdateAnimation();
    }
  });

  // 触发更新动效
  const triggerUpdateAnimation = async () => {
    if (isAnimatingRef.current || disabled) return;
    
    isAnimatingRef.current = true;
    
    const animation = customAnimation || DefaultAnimations.CONTENT_UPDATE;
    
    try {
      await animationManager.triggerAnimation(messageId, {
        ...animation,
        onStart: () => {
          setAnimationState('animating');
          animation.onStart?.();
        },
        onComplete: () => {
          setAnimationState('idle');
          animation.onComplete?.();
          isAnimatingRef.current = false;
        },
        onError: (error) => {
          setAnimationState('error');
          animation.onError?.(error);
          isAnimatingRef.current = false;
        }
      });
    } catch (error) {
      console.error('Animation failed:', error);
      setAnimationState('error');
      isAnimatingRef.current = false;
    }
  };

  // 公开触发动效的方法
  const triggerAnimation = (type: AnimationType, customDef?: AnimationDefinition) => {
    if (disabled || isAnimatingRef.current) return Promise.resolve();
    
    const animation = customDef || DefaultAnimations[type] || DefaultAnimations.CONTENT_UPDATE;
    return triggerUpdateAnimation();
  };

  // 为子组件提供动效控制
  const animationControls = {
    triggerAnimation,
    animationState,
    isAnimating: isAnimatingRef.current
  };

  return (
    <div
      ref={elementRef}
      className={`message-animation-wrapper ${className} ${animationState}`}
      data-message-id={messageId}
      data-animation-state={animationState}
    >
      {typeof children === 'function' 
        ? (children as any)(animationControls)
        : children
      }
    </div>
  );
};

// 按钮动效包装器
interface ButtonAnimationWrapperProps {
  buttonId: string;
  messageId: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const ButtonAnimationWrapper: React.FC<ButtonAnimationWrapperProps> = ({
  buttonId,
  messageId,
  disabled = false,
  children,
  className = '',
  onClick
}) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const animationManager = useAnimationManager();

  const handleClick = async () => {
    if (disabled || isAnimating) return;
    
    // 触发按钮动效
    if (elementRef.current) {
      setIsAnimating(true);
      
      try {
        await animationManager.triggerAnimation(`${messageId}-${buttonId}`, {
          ...DefaultAnimations.BUTTON_UPDATE,
          onComplete: () => {
            setIsAnimating(false);
          },
          onError: () => {
            setIsAnimating(false);
          }
        });
      } catch (error) {
        setIsAnimating(false);
      }
    }
    
    // 执行原始点击事件
    onClick?.();
  };

  useEffect(() => {
    if (elementRef.current && !disabled) {
      animationManager.registerMessageAnimation(`${messageId}-${buttonId}`, elementRef.current);
    }
    
    return () => {
      if (!disabled) {
        animationManager.cleanupAnimation(`${messageId}-${buttonId}`);
      }
    };
  }, [messageId, buttonId, disabled, animationManager]);

  return (
    <div
      ref={elementRef}
      className={`button-animation-wrapper ${className} ${isAnimating ? 'animating' : ''}`}
      onClick={handleClick}
    >
      {children}
    </div>
  );
};

// 加载状态动效组件
interface LoadingAnimationProps {
  isLoading: boolean;
  children: React.ReactNode;
  className?: string;
}

export const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  isLoading,
  children,
  className = ''
}) => {
  return (
    <CSSTransition
      in={isLoading}
      timeout={300}
      classNames="loading-animation"
      unmountOnExit={false}
    >
      <div className={`loading-animation-wrapper ${className} ${isLoading ? 'loading' : ''}`}>
        {children}
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-shimmer" />
          </div>
        )}
      </div>
    </CSSTransition>
  );
};

// 错误状态动效组件
interface ErrorAnimationProps {
  hasError: boolean;
  children: React.ReactNode;
  className?: string;
  onAnimationComplete?: () => void;
}

export const ErrorAnimation: React.FC<ErrorAnimationProps> = ({
  hasError,
  children,
  className = '',
  onAnimationComplete
}) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const animationManager = useAnimationManager();

  useEffect(() => {
    if (hasError && elementRef.current) {
      animationManager.triggerAnimation('error-animation', {
        ...DefaultAnimations.ERROR,
        onComplete: onAnimationComplete
      });
    }
  }, [hasError, animationManager, onAnimationComplete]);

  useEffect(() => {
    if (elementRef.current) {
      animationManager.registerMessageAnimation('error-animation', elementRef.current);
    }
    
    return () => {
      animationManager.cleanupAnimation('error-animation');
    };
  }, [animationManager]);

  return (
    <div
      ref={elementRef}
      className={`error-animation-wrapper ${className} ${hasError ? 'error' : ''}`}
    >
      {children}
    </div>
  );
};
