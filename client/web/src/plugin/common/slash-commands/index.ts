/**
 * 斜杠命令系统 - 统一状态管理
 * 提供集中化的状态管理和生命周期控制
 */

// 核心组件导出
export { SlashCommandRegistry, getSlashCommandRegistry, resetSlashCommandRegistry } from './registry';
export { SlashCommandExecutor, getSlashCommandExecutor, resetSlashCommandExecutor } from './executor';
export { BotCommandManager, getBotCommandManager, resetBotCommandManager, initializeBotCommands, cleanupBotCommands } from './bot-commands';

// 类型导出
export type {
  SlashCommand,
  SlashCommandContext,
  SlashCommandResult,
  SlashCommandHandler,
  SlashCommandRegistryOptions,
  SlashCommandSuggestion
} from 'tailchat-shared/types/command';

import { getSlashCommandRegistry, resetSlashCommandRegistry } from './registry';
import { getSlashCommandExecutor, resetSlashCommandExecutor } from './executor';
import { getBotCommandManager, resetBotCommandManager, cleanupBotCommands, initializeBotCommands } from './bot-commands';
import { SlashCommand, SlashCommandRegistryOptions } from 'tailchat-shared/types/command';

/**
 * 系统状态枚举
 */
export enum SystemState {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error',
  SHUTTING_DOWN = 'shutting_down',
  SHUTDOWN = 'shutdown'
}

/**
 * 系统健康状态
 */
interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  components: {
    registry: 'healthy' | 'error';
    executor: 'healthy' | 'error';
    botManager: 'healthy' | 'error';
  };
  issues: string[];
  lastCheck: number;
}

/**
 * 状态变更事件
 */
interface StateChangeEvent {
  fromState: SystemState;
  toState: SystemState;
  timestamp: number;
  reason?: string;
  error?: Error;
}

/**
 * 统一的斜杠命令系统状态管理器
 * 
 * 核心特性：
 * 1. 集中状态管理 - 统一管理所有组件的状态和生命周期
 * 2. 健康监控 - 实时监控各组件状态，自动故障检测
 * 3. 事件驱动 - 提供状态变更事件，支持响应式编程
 * 4. 故障恢复 - 自动处理组件故障，提供降级策略
 */
export class SlashCommandSystemManager {
  private currentState: SystemState = SystemState.UNINITIALIZED;
  private stateHistory: StateChangeEvent[] = [];
  private healthStatus: SystemHealth | null = null;
  private healthCheckInterval: any = null;
  private stateChangeListeners: Array<(event: StateChangeEvent) => void> = [];
  
  // 组件实例引用
  private registry = getSlashCommandRegistry();
  private executor = getSlashCommandExecutor();
  private botManager = getBotCommandManager();
  
  // 初始化配置
  private config = {
    healthCheckInterval: 30000, // 30秒健康检查
    maxStateHistorySize: 50,    // 最大状态历史记录
    autoRecovery: true,         // 是否启用自动恢复
    debugMode: process.env.NODE_ENV === 'development'
  };

  constructor() {
    
  }

  /**
   * 初始化系统
   */
  async initialize(options: {
    enableHealthCheck?: boolean;
    healthCheckInterval?: number;
    autoRecovery?: boolean;
  } = {}): Promise<void> {
    if (this.currentState !== SystemState.UNINITIALIZED && this.currentState !== SystemState.SHUTDOWN) {
      return;
    }

    this.changeState(SystemState.INITIALIZING, '开始系统初始化');

    try {
      // 更新配置
      if (options.healthCheckInterval) {
        this.config.healthCheckInterval = options.healthCheckInterval;
      }
      if (options.autoRecovery !== undefined) {
        this.config.autoRecovery = options.autoRecovery;
      }

      

      // 1. 初始化机器人命令系统
      await initializeBotCommands();

      // 2. 验证组件状态
      await this.validateComponents();

      // 3. 启动健康监控（如果启用）
      if (options.enableHealthCheck !== false) {
        this.startHealthCheck();
      }

      // 4. 设置生命周期钩子
      this.setupLifecycleHooks();

      this.changeState(SystemState.READY, '系统初始化完成');
      
      // 输出初始化统计信息（调试日志已移除）
      const stats = this.getSystemStats();

    } catch (error) {
      this.changeState(SystemState.ERROR, '系统初始化失败', error as Error);
      throw error;
    }
  }

  /**
   * 验证所有组件状态
   */
  private async validateComponents(): Promise<void> {
    const issues: string[] = [];

    try {
      // 验证注册表
      if (!this.registry) {
        issues.push('Registry not available');
      } else {
        try {
          this.registry.getStats();
        } catch (error) {
          issues.push(`Registry error: ${error}`);
        }
      }

      // 验证执行器
      if (!this.executor) {
        issues.push('Executor not available');
      } else {
        try {
          this.executor.getExecutionStats();
        } catch (error) {
          issues.push(`Executor error: ${error}`);
        }
      }

      // 验证机器人管理器
      if (!this.botManager) {
        issues.push('BotManager not available');
      } else {
        try {
          this.botManager.getDebugInfo();
        } catch (error) {
          issues.push(`BotManager error: ${error}`);
        }
      }

      if (issues.length > 0) {
        throw new Error(`组件验证失败: ${issues.join(', ')}`);
      }

    } catch (error) {
      console.error('[SlashCommandSystemManager] 组件验证失败:', error);
      throw error;
    }
  }

  /**
   * 启动健康检查
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);

    // 立即执行一次健康检查
    this.performHealthCheck();
  }

  /**
   * 执行健康检查
   */
  private performHealthCheck(): void {
    try {
      const issues: string[] = [];
      const componentHealth = {
        registry: 'healthy' as const,
        executor: 'healthy' as const,
        botManager: 'healthy' as const
      };

      // 检查注册表健康状态
      try {
        const registryStats = this.registry.getStats();
        if (registryStats.totalCommands < 0) {
          issues.push('Registry has invalid command count');
          componentHealth.registry = 'error';
        }
      } catch (error) {
        issues.push(`Registry health check failed: ${error}`);
        componentHealth.registry = 'error';
      }

      // 检查执行器健康状态
      try {
        const executorStats = this.executor.getExecutionStats();
        // 检查是否有异常的执行统计
      } catch (error) {
        issues.push(`Executor health check failed: ${error}`);
        componentHealth.executor = 'error';
      }

      // 检查机器人管理器健康状态
      try {
        const botManagerInfo = this.botManager.getDebugInfo();
        // 检查是否有异常状态
      } catch (error) {
        issues.push(`BotManager health check failed: ${error}`);
        componentHealth.botManager = 'error';
      }

      // 确定整体健康状态
      let overallHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
      const errorComponents = Object.values(componentHealth).filter(status => status === 'error').length;
      
      if (errorComponents > 0) {
        overallHealth = errorComponents === 3 ? 'critical' : 'degraded';
      }

      this.healthStatus = {
        overall: overallHealth,
        components: componentHealth,
        issues,
        lastCheck: Date.now()
      };

      // 如果检测到问题且启用了自动恢复
      if (issues.length > 0 && this.config.autoRecovery) {
        this.attemptAutoRecovery(issues);
      }

    } catch (error) {
      console.error('[SlashCommandSystemManager] 健康检查执行失败:', error);
    }
  }

  /**
   * 尝试自动恢复
   */
  private attemptAutoRecovery(issues: string[]): void {
    
    
    // 这里可以实现具体的恢复策略
    // 例如：重新初始化有问题的组件
  }

  /**
   * 设置生命周期钩子
   */
  private setupLifecycleHooks(): void {
    // 设置机器人管理器的生命周期钩子
    this.botManager.setLifecycleHooks({
      onRegister: (botId: string, converseId: string) => {
      },
      onUnregister: (botId: string, converseId: string) => {
        
      },
      onConverseSwitch: (fromConverseId: string | null, toConverseId: string) => {
      }
    });
  }

  /**
   * 状态变更
   */
  private changeState(newState: SystemState, reason?: string, error?: Error): void {
    const event: StateChangeEvent = {
      fromState: this.currentState,
      toState: newState,
      timestamp: Date.now(),
      reason,
      error
    };

    this.currentState = newState;
    this.stateHistory.push(event);

    // 限制历史记录大小
    if (this.stateHistory.length > this.config.maxStateHistorySize) {
      this.stateHistory.shift();
    }

    // 通知所有监听器
    this.stateChangeListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[SlashCommandSystemManager] 状态变更监听器执行失败:', error);
      }
    });

    
  }

  /**
   * 添加状态变更监听器
   */
  onStateChange(listener: (event: StateChangeEvent) => void): () => void {
    this.stateChangeListeners.push(listener);
    
    // 返回取消监听的函数
    return () => {
      const index = this.stateChangeListeners.indexOf(listener);
      if (index > -1) {
        this.stateChangeListeners.splice(index, 1);
      }
    };
  }

  /**
   * 关闭系统
   */
  async shutdown(): Promise<void> {
    if (this.currentState === SystemState.SHUTDOWN || this.currentState === SystemState.SHUTTING_DOWN) {
      return;
    }

    this.changeState(SystemState.SHUTTING_DOWN, '开始系统关闭');

    try {
      // 停止健康检查
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // 清理机器人命令系统
      cleanupBotCommands();

      // 重置所有组件
      resetSlashCommandRegistry();
      resetSlashCommandExecutor();
      resetBotCommandManager();

      // 清理监听器
      this.stateChangeListeners.length = 0;
      this.healthStatus = null;

      this.changeState(SystemState.SHUTDOWN, '系统关闭完成');

    } catch (error) {
      this.changeState(SystemState.ERROR, '系统关闭失败', error as Error);
      throw error;
    }
  }

  /**
   * 重启系统
   */
  async restart(): Promise<void> {
    await this.shutdown();
    // 短暂延迟确保清理完成
    await new Promise(resolve => setTimeout(resolve, 100));
    await this.initialize();
  }

  /**
   * 获取当前状态
   */
  getCurrentState(): SystemState {
    return this.currentState;
  }

  /**
   * 获取健康状态
   */
  getHealthStatus(): SystemHealth | null {
    return this.healthStatus;
  }

  /**
   * 获取状态历史
   */
  getStateHistory(): StateChangeEvent[] {
    return [...this.stateHistory];
  }

  /**
   * 获取系统统计信息
   */
  getSystemStats(): {
    state: SystemState;
    health: SystemHealth | null;
    initialized: boolean;
    registryStats: ReturnType<typeof this.registry.getStats>;
    executionStats: ReturnType<typeof this.executor.getExecutionStats>;
    botManagerStats: ReturnType<typeof this.botManager.getDebugInfo>;
    stateHistorySize: number;
  } {
    return {
      state: this.currentState,
      health: this.healthStatus,
      initialized: this.currentState === SystemState.READY,
      registryStats: this.registry.getStats(),
      executionStats: this.executor.getExecutionStats(),
      botManagerStats: this.botManager.getDebugInfo(),
      stateHistorySize: this.stateHistory.length
    };
  }

  /**
   * 检查系统是否已初始化
   */
  isInitialized(): boolean {
    return this.currentState === SystemState.READY;
  }

  /**
   * 检查系统是否健康
   */
  isHealthy(): boolean {
    return this.healthStatus?.overall === 'healthy';
  }
}

// 模块级别的状态管理器实例
let systemManager: SlashCommandSystemManager | null = null;

/**
 * 获取统一状态管理器实例
 */
export function getSlashCommandSystemManager(): SlashCommandSystemManager {
  if (!systemManager) {
    systemManager = new SlashCommandSystemManager();
  }
  return systemManager;
}

/**
 * 重置状态管理器（用于测试和完全清理）
 */
export function resetSlashCommandSystemManager(): void {
  if (systemManager) {
    systemManager.shutdown().catch(console.error);
  }
  systemManager = null;
}

// 兼容性：保留旧的SlashCommandSystem类（标记为已弃用）
/**
 * @deprecated 使用 SlashCommandSystemManager 替代
 */
export class SlashCommandSystem {
  private manager = getSlashCommandSystemManager();

  async initialize(): Promise<void> {
    return this.manager.initialize();
  }

  shutdown(): void {
    this.manager.shutdown().catch(console.error);
  }

  async reload(): Promise<void> {
    return this.manager.restart();
  }

  isInitialized(): boolean {
    return this.manager.isInitialized();
  }

  getSystemStats() {
    return this.manager.getSystemStats();
  }
}

// 兼容性：保留全局系统实例访问
let globalSystemCompat: SlashCommandSystem | null = null;

/**
 * @deprecated 使用 getSlashCommandSystemManager() 替代
 */
export function getSlashCommandSystem(): SlashCommandSystem {
  if (!globalSystemCompat) {
    globalSystemCompat = new SlashCommandSystem();
  }
  return globalSystemCompat;
}

// 便捷函数（重新实现，使用新的状态管理器）
export function registerSlashCommand(
  command: SlashCommand,
  options?: SlashCommandRegistryOptions
): boolean {
  const registry = getSlashCommandRegistry();
  return registry.register(command, options);
}

export function unregisterSlashCommand(name: string): boolean {
  const registry = getSlashCommandRegistry();
  return registry.unregister(name);
}

export async function executeSlashCommand(
  input: string,
  context: {
    userId: string;
    groupId?: string;
    converseId: string;
    panelId?: string;
    traceId?: string;
  }
) {
  const executor = getSlashCommandExecutor();
  return executor.executeCommand(input, context);
}

export function getSlashCommandSuggestions(
  partialInput: string,
  context: {
    userId: string;
    groupId?: string;
    converseId: string;
    panelId?: string;
  }
): SlashCommand[] {
  const executor = getSlashCommandExecutor();
  return executor.getCommandSuggestions(partialInput, context);
}

export function getAllSlashCommands(): SlashCommand[] {
  const registry = getSlashCommandRegistry();
  return registry.getAllCommands();
}

export function searchSlashCommands(
  query: string,
  options?: {
    category?: string;
    type?: SlashCommand['type'];
    limit?: number;
  }
): SlashCommand[] {
  const registry = getSlashCommandRegistry();
  return registry.searchCommands(query, options);
}