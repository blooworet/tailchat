/**
 * 消息动效管理器
 * 基于 OOP 设计理念，封装动效逻辑和状态管理
 */

export enum AnimationType {
  CONTENT_UPDATE = 'content-update',
  BUTTON_UPDATE = 'button-update',
  STATUS_CHANGE = 'status-change',
  LOADING = 'loading',
  ERROR = 'error',
  SUCCESS = 'success'
}

export type AnimationState = 'idle' | 'preparing' | 'animating' | 'completing' | 'error';

export interface AnimationPhase {
  name: string;
  duration: number;
  styles?: Record<string, string | number>;
  easing?: string;
  callback?: () => void | Promise<void>;
}

export interface AnimationDefinition {
  type: AnimationType;
  phases: AnimationPhase[];
  onStart?: () => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface AnimationConfig {
  duration: number;
  easing: string;
  reducedMotion: boolean;
  enabledAnimations: AnimationType[];
  performanceMode: 'high' | 'medium' | 'low';
}

export interface BatchAnimationDefinition {
  messageId: string;
  animation: AnimationDefinition;
  delay?: number;
}

interface AnimationStateEntry {
  state: AnimationState;
  definition?: AnimationDefinition;
  element?: HTMLElement;
  cleanup?: () => void;
}

export class MessageAnimationManager {
  private animations = new Map<string, AnimationStateEntry>();
  private config: AnimationConfig;
  private rafId?: number;
  
  constructor(config: Partial<AnimationConfig> = {}) {
    this.config = {
      duration: 300,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      reducedMotion: this.detectReducedMotion(),
      enabledAnimations: Object.values(AnimationType),
      performanceMode: this.detectPerformanceMode(),
      ...config
    };
  }

  /**
   * 检测用户是否偏好减少动效
   */
  private detectReducedMotion(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * 检测设备性能模式
   */
  private detectPerformanceMode(): 'high' | 'medium' | 'low' {
    if (typeof navigator === 'undefined') return 'medium';
    
    // 基于设备内存和硬件并发数判断性能
    const memory = (navigator as any).deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    
    if (memory >= 8 && cores >= 8) return 'high';
    if (memory >= 4 && cores >= 4) return 'medium';
    return 'low';
  }

  /**
   * 注册消息动效
   */
  registerMessageAnimation(messageId: string, element: HTMLElement): void {
    if (this.animations.has(messageId)) {
      this.cleanupAnimation(messageId);
    }

    this.animations.set(messageId, {
      state: 'idle',
      element
    });
  }

  /**
   * 触发动效
   */
  async triggerAnimation(messageId: string, animation: AnimationDefinition): Promise<void> {
    const entry = this.animations.get(messageId);
    if (!entry || !entry.element) {
      console.warn(`Animation target not found for message: ${messageId}`);
      return;
    }

    // 检查动效是否被禁用
    if (this.config.reducedMotion || !this.config.enabledAnimations.includes(animation.type)) {
      // 直接执行回调，跳过动画
      animation.onStart?.();
      for (const phase of animation.phases) {
        await phase.callback?.();
      }
      animation.onComplete?.();
      return;
    }

    // 根据性能模式调整动效
    const adjustedAnimation = this.adjustAnimationForPerformance(animation);

    try {
      entry.state = 'preparing';
      entry.definition = adjustedAnimation;
      
      adjustedAnimation.onStart?.();
      
      entry.state = 'animating';
      await this.executeAnimationPhases(entry.element, adjustedAnimation.phases);
      
      entry.state = 'completing';
      adjustedAnimation.onComplete?.();
      
      entry.state = 'idle';
    } catch (error) {
      entry.state = 'error';
      adjustedAnimation.onError?.(error as Error);
      console.error('Animation failed:', error);
    }
  }

  /**
   * 根据性能模式调整动效
   */
  private adjustAnimationForPerformance(animation: AnimationDefinition): AnimationDefinition {
    const performanceMultiplier = {
      high: 1,
      medium: 0.8,
      low: 0.5
    }[this.config.performanceMode];

    return {
      ...animation,
      phases: animation.phases.map(phase => ({
        ...phase,
        duration: Math.round(phase.duration * performanceMultiplier)
      }))
    };
  }

  /**
   * 执行动效阶段
   */
  private async executeAnimationPhases(element: HTMLElement, phases: AnimationPhase[]): Promise<void> {
    for (const phase of phases) {
      await this.executeAnimationPhase(element, phase);
    }
  }

  /**
   * 执行单个动效阶段
   */
  private executeAnimationPhase(element: HTMLElement, phase: AnimationPhase): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 执行回调
        const callbackResult = phase.callback?.();
        
        // 如果没有样式变化或持续时间为0，直接完成
        if (!phase.styles || phase.duration === 0) {
          if (callbackResult instanceof Promise) {
            callbackResult.then(resolve).catch(reject);
          } else {
            resolve();
          }
          return;
        }

        // 应用样式变化
        const originalStyles = new Map<string, string>();
        
        // 保存原始样式
        Object.keys(phase.styles).forEach(prop => {
          originalStyles.set(prop, element.style.getPropertyValue(prop));
        });

        // 设置过渡
        const transition = `all ${phase.duration}ms ${phase.easing || this.config.easing}`;
        element.style.transition = transition;

        // 应用新样式
        Object.entries(phase.styles).forEach(([prop, value]) => {
          element.style.setProperty(prop, String(value));
        });

        // 监听过渡结束
        const handleTransitionEnd = (event: TransitionEvent) => {
          if (event.target === element) {
            element.removeEventListener('transitionend', handleTransitionEnd);
            
            // 清理过渡样式
            element.style.transition = '';
            
            resolve();
          }
        };

        element.addEventListener('transitionend', handleTransitionEnd);

        // 超时保护
        setTimeout(() => {
          element.removeEventListener('transitionend', handleTransitionEnd);
          element.style.transition = '';
          resolve();
        }, phase.duration + 100);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 批量执行动效
   */
  async batchAnimations(animations: BatchAnimationDefinition[]): Promise<void> {
    const promises = animations.map(({ messageId, animation, delay = 0 }) => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          this.triggerAnimation(messageId, animation).finally(resolve);
        }, delay);
      });
    });

    await Promise.all(promises);
  }

  /**
   * 获取动效状态
   */
  getAnimationState(messageId: string): AnimationState {
    return this.animations.get(messageId)?.state || 'idle';
  }

  /**
   * 清理动效
   */
  cleanupAnimation(messageId: string): void {
    const entry = this.animations.get(messageId);
    if (entry) {
      entry.cleanup?.();
      
      // 清理元素样式
      if (entry.element) {
        entry.element.style.transition = '';
        entry.element.style.transform = '';
        entry.element.style.opacity = '';
      }
      
      this.animations.delete(messageId);
    }
  }

  /**
   * 清理所有动效
   */
  cleanupAllAnimations(): void {
    this.animations.forEach((_, messageId) => {
      this.cleanupAnimation(messageId);
    });
    
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AnimationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): AnimationConfig {
    return { ...this.config };
  }

  /**
   * 检查动效是否启用
   */
  isAnimationEnabled(type: AnimationType): boolean {
    return !this.config.reducedMotion && this.config.enabledAnimations.includes(type);
  }
}

// 默认动效定义
export const DefaultAnimations = {
  CONTENT_UPDATE: {
    type: AnimationType.CONTENT_UPDATE,
    phases: [
      {
        name: 'prepare',
        duration: 100,
        styles: { opacity: '0.8', transform: 'scale(0.99)' }
      },
      {
        name: 'reveal',
        duration: 300,
        styles: { opacity: '1', transform: 'scale(1)' },
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
      }
    ]
  } as AnimationDefinition,

  BUTTON_UPDATE: {
    type: AnimationType.BUTTON_UPDATE,
    phases: [
      {
        name: 'highlight',
        duration: 150,
        styles: { 
          boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.5)',
          transform: 'scale(1.02)'
        }
      },
      {
        name: 'settle',
        duration: 200,
        styles: { 
          boxShadow: 'none',
          transform: 'scale(1)'
        }
      }
    ]
  } as AnimationDefinition,

  LOADING: {
    type: AnimationType.LOADING,
    phases: [
      {
        name: 'pulse',
        duration: 200,
        styles: { opacity: '0.7' }
      },
      {
        name: 'restore',
        duration: 200,
        styles: { opacity: '1' }
      }
    ]
  } as AnimationDefinition,

  ERROR: {
    type: AnimationType.ERROR,
    phases: [
      {
        name: 'shake',
        duration: 500,
        styles: { animation: 'error-shake 0.5s ease-in-out' }
      }
    ]
  } as AnimationDefinition,

  SUCCESS: {
    type: AnimationType.SUCCESS,
    phases: [
      {
        name: 'glow',
        duration: 300,
        styles: { 
          boxShadow: '0 0 10px rgba(34, 197, 94, 0.5)',
          backgroundColor: 'rgba(34, 197, 94, 0.1)'
        }
      },
      {
        name: 'fade',
        duration: 200,
        styles: { 
          boxShadow: 'none',
          backgroundColor: 'transparent'
        }
      }
    ]
  } as AnimationDefinition
};
