import type { SlashCommand, SlashCommandContext, SlashCommandResult, CommandScope } from 'tailchat-shared/types/command';
import { getSlashCommandRegistry } from './registry';
import { showToasts } from '@/plugin/common';
import { getGlobalSocket } from '@/utils/global-state-helper';
import { loadCommandsForBots } from './service/command-service';
import { syncToRegistry } from './adapter/registry-adapter';
import { buildScopeKey } from './scope';

// Debug helpers removed
const dlog = (..._args: any[]) => {};
const dwarn = (..._args: any[]) => {};

/**
 * 异步操作配置
 */
interface AsyncOperationConfig {
  timeout: number;           // 超时时间（毫秒）
  maxRetries: number;        // 最大重试次数
  retryDelay: number;        // 初始重试延迟（毫秒）
  backoffMultiplier: number; // 退避倍数
  enableCircuitBreaker: boolean; // 启用熔断器
}

/**
 * 熔断器状态
 */
enum CircuitState {
  CLOSED = 'closed',     // 正常状态
  OPEN = 'open',         // 熔断状态
  HALF_OPEN = 'half_open' // 半开状态
}

/**
 * 增强异步操作管理器
 * 
 * 特性：
 * 1. 超时控制 - 防止请求无限挂起
 * 2. 智能重试 - 指数退避重试机制  
 * 3. 熔断器 - 快速失败保护系统稳定性
 * 4. 降级策略 - 服务不可用时的备选方案
 * 5. 错误边界 - 异常隔离，不影响其他功能
 */
class EnhancedAsyncManager {
  private readonly defaultConfig: AsyncOperationConfig = {
    timeout: 10000,           // 10秒超时
    maxRetries: 3,            // 最多重试3次
    retryDelay: 1000,         // 1秒初始延迟
    backoffMultiplier: 2,     // 指数退避
    enableCircuitBreaker: true
  };

  // 熔断器状态管理
  private circuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  
  // 熔断器配置
  private readonly circuitBreakerConfig = {
    failureThreshold: 5,      // 失败阈值
    recoveryTimeout: 30000,   // 恢复超时30秒
    halfOpenMaxCalls: 3       // 半开状态最大调用数
  };

  // 操作统计
  private stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timeouts: 0,
    retries: 0,
    circuitBreakerTrips: 0
  };

  /**
   * 超时包装器
   */
  private withTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number, 
    operationName: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stats.timeouts++;
        reject(new Error(`[${operationName}] 操作超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      promise
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  }

  /**
   * 智能重试包装器（指数退避）
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    config: AsyncOperationConfig,
    operationName: string
  ): Promise<T> {
    let lastError: Error = new Error('操作失败');
    let delay = config.retryDelay;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await operation();
        
        // 成功时重置延迟
        if (attempt > 0) {
          this.stats.retries++;
          console.log(`[${operationName}] 重试成功 (第${attempt}次重试)`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // 最后一次尝试，不再重试
        if (attempt === config.maxRetries) {
          break;
        }

        // 判断是否应该重试（某些错误不适合重试）
        if (!this.shouldRetry(lastError)) {
          break;
        }

        console.warn(`[${operationName}] 第${attempt + 1}次尝试失败，${delay}ms后重试:`, lastError.message);
        
        // 等待后重试
        await this.sleep(delay);
        delay *= config.backoffMultiplier;
      }
    }

    throw lastError;
  }

  /**
   * 判断错误是否应该重试
   */
  private shouldRetry(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // 网络相关错误可以重试
    if (message.includes('network') || 
        message.includes('timeout') || 
        message.includes('connection') ||
        message.includes('503') || 
        message.includes('502') ||
        message.includes('500')) {
      return true;
    }
    
    // 权限、参数错误等不应该重试
    if (message.includes('401') || 
        message.includes('403') || 
        message.includes('400') ||
        message.includes('invalid')) {
      return false;
    }
    
    return true; // 默认可以重试
  }

  /**
   * 熔断器检查
   */
  private checkCircuitBreaker(operationName: string): void {
    if (!this.defaultConfig.enableCircuitBreaker) return;

    const now = Date.now();

    switch (this.circuitState) {
      case CircuitState.OPEN:
        // 检查是否可以进入半开状态
        if (now - this.lastFailureTime >= this.circuitBreakerConfig.recoveryTimeout) {
          this.circuitState = CircuitState.HALF_OPEN;
          this.successCount = 0;
          console.log(`[${operationName}] 熔断器进入半开状态`);
        } else {
          this.stats.circuitBreakerTrips++;
          throw new Error(`[${operationName}] 熔断器开启，服务暂时不可用`);
        }
        break;
        
      case CircuitState.HALF_OPEN:
        // 半开状态下限制调用数
        if (this.successCount >= this.circuitBreakerConfig.halfOpenMaxCalls) {
          throw new Error(`[${operationName}] 熔断器半开状态，超过最大调用数`);
        }
        break;
    }
  }

  /**
   * 记录操作结果
   */
  private recordResult(success: boolean, operationName: string): void {
    this.stats.totalRequests++;
    
    if (success) {
      this.stats.successfulRequests++;
      this.failureCount = 0;
      
      if (this.circuitState === CircuitState.HALF_OPEN) {
        this.successCount++;
        if (this.successCount >= this.circuitBreakerConfig.halfOpenMaxCalls) {
          this.circuitState = CircuitState.CLOSED;
          console.log(`[${operationName}] 熔断器恢复正常状态`);
        }
      }
    } else {
      this.stats.failedRequests++;
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.circuitState === CircuitState.CLOSED && 
          this.failureCount >= this.circuitBreakerConfig.failureThreshold) {
        this.circuitState = CircuitState.OPEN;
        console.error(`[${operationName}] 熔断器开启 (失败${this.failureCount}次)`);
      } else if (this.circuitState === CircuitState.HALF_OPEN) {
        this.circuitState = CircuitState.OPEN;
        console.error(`[${operationName}] 熔断器重新开启`);
      }
    }
  }

  /**
   * 执行增强的异步操作
   */
  async executeAsync<T>(
    operation: () => Promise<T>,
    operationName: string,
    config?: Partial<AsyncOperationConfig>,
    fallback?: () => Promise<T> | T
  ): Promise<T> {
    const fullConfig = { ...this.defaultConfig, ...config };
    
    try {
      // 熔断器检查
      this.checkCircuitBreaker(operationName);

      // 执行操作（带超时和重试）
      const result = await this.withRetry(
        () => this.withTimeout(operation(), fullConfig.timeout, operationName),
        fullConfig,
        operationName
      );

      this.recordResult(true, operationName);
      return result;

    } catch (error) {
      this.recordResult(false, operationName);
      
      console.error(`[${operationName}] 操作失败:`, error);

      // 如果有降级策略，尝试执行
      if (fallback) {
        console.log(`[${operationName}] 尝试降级策略`);
        try {
          const fallbackResult = await Promise.resolve(fallback());
          console.log(`[${operationName}] 降级策略执行成功`);
          return fallbackResult;
        } catch (fallbackError) {
          console.error(`[${operationName}] 降级策略也失败:`, fallbackError);
        }
      }

      throw error;
    }
  }

  /**
   * 延迟工具
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      circuitState: this.circuitState,
      failureCount: this.failureCount,
      successRate: this.stats.totalRequests > 0 
        ? this.stats.successfulRequests / this.stats.totalRequests 
        : 0
    };
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreaker(): void {
    this.circuitState = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    console.log('[EnhancedAsyncManager] 熔断器已重置');
  }

  /**
   * 清除统计信息
   */
  clearStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeouts: 0,
      retries: 0,
      circuitBreakerTrips: 0
    };
    console.log('[EnhancedAsyncManager] 统计信息已清除');
  }
}

// 机器人命令响应类型
interface BotCommandsResponse {
  appId: string;
  appName: string;
  userId?: string; // 机器人对应的真实用户ID
  version?: number;
  etag?: string;
  commands: Array<{
    command: string;
    description: string;
    usage?: string;
    examples?: string[];
    scope?: CommandScope;
  }>;
}

// 机器人命令定义
interface BotCommandDefinition {
  botId: string; // appId
  botName: string;
  botUserId?: string;
  converseId: string; // 所属会话ID（新增：实现会话隔离）
  commands: {
    name: string;
    description?: string;
    usage?: string;
    examples?: string[];
    scope?: CommandScope;
  }[];
}

// 命令生命周期钩子类型
interface CommandLifecycleHooks {
  onRegister?: (botId: string, converseId: string) => void;
  onUnregister?: (botId: string, converseId: string) => void;
  onUpdate?: (botId: string, converseId: string) => void;
  onConverseSwitch?: (fromConverseId: string | null, toConverseId: string) => void;
}

// 全局异步管理器实例
const globalAsyncManager = new EnhancedAsyncManager();

/**
 * 按机器人用户ID列表获取命令（增强版：带超时、重试、熔断器）
 */
const fetchBotCommandsByUserIds = async (
  botUserIds: string[],
  converseId: string,
  groupId?: string
): Promise<BotCommandsResponse[]> => {
  // 降级策略：返回空数组，不影响其他功能
  const fallback = (): BotCommandsResponse[] => {
    console.log(`[fetchBotCommandsByUserIds] 使用降级策略，会话 ${converseId} 返回空命令列表`);
    return [];
  };

  return globalAsyncManager.executeAsync(
    async () => {
    if (!botUserIds || botUserIds.length === 0) {
      console.log(`[fetchBotCommandsByUserIds] 会话 ${converseId} 没有机器人成员`);
      return [];
    }

    let socket = getGlobalSocket();
    if (!socket || !socket.connected) {
      try {
        const mod: any = await import('tailchat-shared');
        socket = await mod.createSocket();
      } catch (e) {
        console.warn('[fetchBotCommandsByUserIds] 获取Socket失败，返回空结果');
        return [];
      }
    }

      

      // 修复：API限制一次只能请求一个botUserId，需要逐个请求
      const allBotCommands: BotCommandsResponse[] = [];
      
      for (const botUserId of botUserIds) {
        try {
    const requestParams = {
            botUserIds: [botUserId], // API要求单个botUserId数组
      converseId,
      groupId
    };

      const botCommands = await socket.request<BotCommandsResponse[]>(
      'openapi.app.getBotCommandsByUserIds',
      requestParams
    );
    
    if (botCommands && botCommands.length > 0) {
            allBotCommands.push(...botCommands);
            
    }
  } catch (error) {
          console.warn(`[fetchBotCommandsByUserIds] ⚠️ 机器人 ${botUserId} 命令获取失败:`, error);
          // 继续处理其他机器人，不中断整个流程
        }
      }
      
      
      return allBotCommands;
    },
    'fetchBotCommands',
    {
      timeout: 8000,        // 8秒超时（机器人命令加载）
      maxRetries: 2,        // 最多重试2次
      retryDelay: 800,      // 800ms初始延迟
      backoffMultiplier: 1.5 // 较小的退避倍数
    },
    fallback
  );
};

/**
 * 优化的机器人命令管理器
 * 
 * 核心修复：
 * 1. 按会话隔离命令注册，彻底解决重叠问题
 * 2. 使用复合键确保唯一性
 * 3. 完善会话切换清理逻辑
 * 4. 添加命令生命周期钩子
 */
export class BotCommandManager {
  
  // 当前活跃的会话ID
  private activeConverseId: string | null = null;
  
  // 并发控制
  private loadingConverses = new Set<string>();
  private loadPromises = new Map<string, Promise<void>>();
  

  
  // 并发控制增强
  private requestQueue = new Map<string, Promise<BotCommandsResponse[]>>(); // 请求去重
  private lockTimeouts = new Map<string, NodeJS.Timeout>(); // 锁超时管理
  private deadlockDetection = new Map<string, number>(); // 死锁检测
  
  // 请求节流控制
  private lastRequestTime = new Map<string, number>(); // key: `${converseId}:${botUserId}`
  private pendingRequests = new Set<string>(); // 防止重复请求
  // 会话 -> 已注册命令键集合（用于精准清理），命令键格式为 `${name}:${source}`
  private converseToKeys = new Map<string, Set<string>>();
  
  
  // 生命周期钩子
  private lifecycleHooks: CommandLifecycleHooks = {};
  
  // 增强异步管理器
  private asyncManager = globalAsyncManager;
  
  // 基础配置
  private config = {
    lockTimeout: 30 * 1000,         // 30秒锁超时
    deadlockTimeout: 60 * 1000,     // 60秒死锁检测
  };
  
  private registry = getSlashCommandRegistry();
  
  /**
   * 设置生命周期钩子
   */
  setLifecycleHooks(hooks: CommandLifecycleHooks): void {
    this.lifecycleHooks = { ...this.lifecycleHooks, ...hooks };
  }
  




  
  
  /**
   * 增强的并发锁管理
   */
  private acquireLock(lockKey: string): boolean {
    if (this.pendingRequests.has(lockKey)) {
      return false;
    }
    
    // 死锁检测
    const lockStart = Date.now();
    this.deadlockDetection.set(lockKey, lockStart);
    
    // 设置锁超时
    const timeoutId = setTimeout(() => {
      console.warn(`[BotCommandManager] 锁超时，强制释放: ${lockKey}`);
      this.releaseLock(lockKey);
    }, this.config.lockTimeout);
    
    this.lockTimeouts.set(lockKey, timeoutId);
    this.pendingRequests.add(lockKey);
    
    return true;
  }
  
  /**
   * 释放并发锁
   */
  private releaseLock(lockKey: string): void {
    this.pendingRequests.delete(lockKey);
    this.deadlockDetection.delete(lockKey);
    
    const timeoutId = this.lockTimeouts.get(lockKey);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.lockTimeouts.delete(lockKey);
    }
  }
  
  /**
   * 请求去重：相同参数的并发请求合并
   */
  private async getOrCreateRequest(
    requestKey: string,
    botUserIds: string[],
    converseId: string,
    groupId?: string
  ): Promise<BotCommandsResponse[]> {
    // 检查是否已有相同的请求在进行中
    const existingRequest = this.requestQueue.get(requestKey);
    if (existingRequest) {
      dlog(`[BotCommandManager] 复用现有请求: ${requestKey}`);
      return existingRequest;
    }
    
    // 创建新请求
    const request = fetchBotCommandsByUserIds(botUserIds, converseId, groupId);
    this.requestQueue.set(requestKey, request);
    
    try {
      const result = await request;
      return result;
    } finally {
      // 清理请求队列
      this.requestQueue.delete(requestKey);
    }
  }
  
  
  
  /**
   * 设置当前活跃会话
   * 会话切换时自动清理旧会话命令
   */
  setActiveConverse(converseId: string | null): void {
    const previousConverseId = this.activeConverseId;
    
    if (previousConverseId && previousConverseId !== converseId) {
      
      // 清理旧会话的命令数据
      this.cleanupConverseCommands(previousConverseId);
    }
    
    this.activeConverseId = converseId;
    
    // 触发生命周期钩子
    this.lifecycleHooks.onConverseSwitch?.(previousConverseId, converseId || '');
  }
  
  /**
   * 清理指定会话的命令数据
   * 删除注册表中属于特定会话的所有命令
   */
  private cleanupConverseCommands(converseId: string): void {
    if (!converseId) return;
    
    
    
    // 精准清理：根据注册时记录的命令键集合进行批量注销
    const keys = this.converseToKeys.get(converseId);
    if (!keys || keys.size === 0) {
      return;
    }
    const cleanedCount = this.registry.batchUnregister(Array.from(keys));
    this.converseToKeys.delete(converseId);
    
    
    // 通知UI更新（移除旧会话命令）
    this.emitCommandUpdateEvent({
      converseIds: [converseId],
      reason: 'converse-switched',
      soft: false
    });
  }


  /**
   * 为指定会话加载机器人命令
   * 实现会话隔离和并发控制
   */
  async loadCommandsForConverse(
    converseId: string, 
    groupId?: string, 
    botUserIds?: string[]
  ): Promise<void> {
    if (!botUserIds || botUserIds.length === 0) {
      return;
    }
    
    // 并发控制：防止重复加载
    if (this.loadingConverses.has(converseId)) {
      const promise = this.loadPromises.get(converseId);
      if (promise) {
        await promise;
      }
      return;
    }
    
    this.loadingConverses.add(converseId);
    
    const loadPromise = this.doLoadCommands(converseId, groupId, botUserIds);
    this.loadPromises.set(converseId, loadPromise);
    
    try {
      await loadPromise;
    } finally {
      this.loadingConverses.delete(converseId);
      this.loadPromises.delete(converseId);
    }
  }
  
  /**
   * 直接从服务器获取并注册命令（无缓存）
   */
  private async doLoadCommands(
    converseId: string,
    groupId?: string,
    botUserIds?: string[]
  ): Promise<void> {
    if (!botUserIds?.length) return;
    
    try {
      
      
      // 直接从服务器获取命令
      const botCommands = await fetchBotCommandsByUserIds(botUserIds, converseId, groupId);
      
      // 直接注册到全局注册表
      let registeredCount = 0;
      for (const botData of botCommands) {
        if (botData.commands?.length > 0) {
          registeredCount += await this.registerBotCommands(converseId, botData);
        }
      }
      
      // 发出更新事件
      this.emitCommandUpdateEvent({
        converseIds: [converseId],
        reason: 'loaded',
        soft: false
      });
      
      
      
    } catch (error) {
      console.error(`[BotCommandManager] 加载会话 ${converseId} 命令失败:`, error);
      throw error;
    }
  }
  
  /**
   * 直接注册机器人命令到全局注册表（无缓存）
   */
  private async registerBotCommands(
    converseId: string,
    botData: BotCommandsResponse
  ): Promise<number> {
    const { appId: botId, appName: botName, userId: botUserId, commands } = botData;
    
    let registeredCount = 0;
    
    for (const cmdDef of commands) {
      const slashCommand: SlashCommand = {
        name: cmdDef.command,
        label: `/${cmdDef.command} (${botName})`,
        description: cmdDef.description || `${botName} 机器人命令`,
        icon: 'mdi:robot',
        type: 'bot',
        category: 'bot',
        priority: 40,
        scope: cmdDef.scope,
        botId,
        botName,
        botUserId,
        handler: async (context: SlashCommandContext): Promise<SlashCommandResult> => {
          return await this.executeBotCommand(botId, cmdDef.command, context);
        },
        _botMeta: {
          botId,
          botName,
          botUserId,
          converseId,
          originalName: cmdDef.command,
          usage: cmdDef.usage,
          examples: cmdDef.examples,
          scope: cmdDef.scope
        }
      } as any;

      // 注册到全局注册表
      const registrySource = `bot:${converseId}:${botId}${botUserId ? `:${botUserId}` : ''}`;
      const success = this.registry.register(slashCommand, {
        source: registrySource,
        scope: this.determineRegistryScope(cmdDef.scope) as 'dm' | 'global' | 'group' | 'specific',
        allowOverride: true
      });
      
      if (success) {
        registeredCount++;
        // 记录命令键用于后续按会话精准清理
        const key = `${cmdDef.command}:${registrySource}`;
        let set = this.converseToKeys.get(converseId);
        if (!set) {
          set = new Set<string>();
          this.converseToKeys.set(converseId, set);
        }
        set.add(key);
      }
    }
    
    // 触发生命周期钩子
    this.lifecycleHooks.onRegister?.(botId, converseId);
    
    
    return registeredCount;
  }
  
  

  /**
   * 执行机器人命令
   */
  private async executeBotCommand(
    botId: string,
    commandName: string,
    context: SlashCommandContext
  ): Promise<SlashCommandResult> {
    try {
      const botCommand = `/${commandName} ${context.args.join(' ')}`.trim();
      
      const socket = getGlobalSocket();
      if (!socket || !socket.connected) {
        throw new Error('Socket 未连接');
      }
      await socket.request('chat.message.sendMessage', {
        converseId: context.converseId,
        groupId: context.groupId,
        content: botCommand,
        meta: {
          botCommand: true,
          botId: botId,
          originalCommand: commandName,
          mentions: [botId]
        }
      });

      showToasts(`机器人命令 ${botCommand} 已发送`, 'success');
      return {
        success: true,
        shouldSend: false,
        content: '',
      };
    } catch (error) {
      console.error('Failed to execute bot command:', error);
      return {
        success: false,
        error: `执行机器人命令失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 生成机器人键（会话内唯一）
   */
  private generateBotKey(botId: string, botUserId?: string): string {
    return `${botId}${botUserId ? `#${botUserId}` : ''}`;
  }
  
  /**
   * 生成命令键（全局唯一）
   */
  private generateCommandKey(
    converseId: string,
    botId: string,
    botUserId: string | undefined,
    commandName: string
  ): string {
    return `${commandName}:bot:${converseId}:${botId}${botUserId ? `:${botUserId}` : ''}`;
  }
  
  /**
   * 确定注册中心作用域
   */
  private determineRegistryScope(commandScope?: CommandScope): string {
    if (!commandScope || commandScope.type === 'default') return 'global';
    if (commandScope.type === 'all_private_chats') return 'dm';
    if (commandScope.type === 'all_group_chats') return 'group';
    if (commandScope.type === 'chat' || commandScope.type === 'chat_member') {
      return 'specific';
    }
    return 'global';
  }
  
  /**
   * 发出命令更新事件
   */
  public emitCommandUpdateEvent(detail: any): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('slash-commands-updated', { detail })
      );
    }
  }
  
  /**
   * 获取已注册的机器人列表（当前会话）
   */
  getRegisteredBots(converseId?: string): BotCommandDefinition[] {
    // 无缓存系统：返回空数组
    return [];
  }
  
  /**
   * 获取调试信息
   */
  getDebugInfo(): {
    activeConverseId: string | null;
    concurrencyStats: {
      activeRequests: number;
      queuedRequests: number;
      pendingLocks: number;
      deadlockDetections: number;
    };
    asyncStats: {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      timeouts: number;
      retries: number;
      circuitBreakerTrips: number;
      circuitState: string;
      successRate: number;
    };
  } {
    // 获取异步操作统计
    const asyncManagerStats = this.asyncManager.getStats();
    
    return {
      activeConverseId: this.activeConverseId,
      concurrencyStats: {
        activeRequests: this.requestQueue.size,
        queuedRequests: this.loadPromises.size,
        pendingLocks: this.pendingRequests.size,
        deadlockDetections: this.deadlockDetection.size
      },
      asyncStats: {
        totalRequests: asyncManagerStats.totalRequests,
        successfulRequests: asyncManagerStats.successfulRequests,
        failedRequests: asyncManagerStats.failedRequests,
        timeouts: asyncManagerStats.timeouts,
        retries: asyncManagerStats.retries,
        circuitBreakerTrips: asyncManagerStats.circuitBreakerTrips,
        circuitState: asyncManagerStats.circuitState,
        successRate: asyncManagerStats.successRate
      }
    };
  }
  
  /**
   * 清理所有数据
   */
  cleanup(): void {
    // 清理基础状态
    this.loadingConverses.clear();
    this.loadPromises.clear();
    this.activeConverseId = null;
    
    // 清理并发控制状态
    this.requestQueue.clear();
    
    // 清理所有锁和超时
    for (const timeoutId of this.lockTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.lockTimeouts.clear();
    this.pendingRequests.clear();
    this.deadlockDetection.clear();
    
    // 清理节流状态
    this.lastRequestTime.clear();
    this.converseToKeys.clear();
    
    console.log('[BotCommandManager] 已清理所有数据');
  }



  /**
   * 获取异步操作统计信息
   */
  getAsyncStats() {
    return this.asyncManager.getStats();
  }

  /**
   * 重置熔断器（用于恢复服务）
   */
  resetCircuitBreaker(): void {
    this.asyncManager.resetCircuitBreaker();
  }



  /**
   * 清除异步操作统计
   */
  clearAsyncStats(): void {
    this.asyncManager.clearStats();
  }
}

// 模块级别的单例实例（避免globalThis污染）
let managerInstance: BotCommandManager | null = null;

/**
 * 获取机器人命令管理器实例
 */
export function getBotCommandManager(): BotCommandManager {
  if (!managerInstance) {
    managerInstance = new BotCommandManager();
  }
  return managerInstance;
}

/**
 * 重置管理器实例（用于测试和清理）
 */
export function resetBotCommandManager(): void {
  if (managerInstance) {
    managerInstance.cleanup();
  }
  managerInstance = null;
}

/**
 * 为指定会话加载机器人命令（公共API）
 */
export async function loadBotCommandsForConverse(
  converseId: string, 
  groupId?: string, 
  botUserIds?: string[]
): Promise<void> {
  const manager = getBotCommandManager();
  await manager.loadCommandsForConverse(converseId, groupId, botUserIds);
}


/**
 * 初始化机器人命令系统
 */
export async function initializeBotCommands(): Promise<void> {
  
  
  // 🔧 修复：监听机器人命令更新事件
  const socket = getGlobalSocket();
  if (socket) {
    
    
    socket.on('openapi.command.updated', (data: {
      appId: string;
      eventType: string;
      data: {
        appId: string;
        appName: string;
        userId: string;
        commandCount: number;
        version: number;
      };
      timestamp: number;
      converseIds: string[];
    }) => {
      
      
      const { appId, data: updateData, converseIds } = data;
      const botUserId = updateData.userId;
      const newVersion = updateData.version;
      
      // 清理相关缓存
  const manager = getBotCommandManager();
      
      if (converseIds && converseIds.length > 0) {
        // 清理指定会话的缓存
        
        
        // 触发重新加载事件
        manager.emitCommandUpdateEvent({
          converseIds,
          reason: 'bot-updated',
          soft: false,
          global: false
        });
      } else {
        // 🔥 关键修复：全局更新需要清理所有相关缓存
        
        
        
        
        // 触发全局重新加载事件
        manager.emitCommandUpdateEvent({
          converseIds: [], // 空数组表示全局更新
          reason: 'bot-global-updated',
          soft: false,
          global: true
        });
      }
    });
  } else {
    dwarn('[BotCommandManager] Socket未就绪，无法注册命令更新事件监听器');
  }
}

/**
 * 清理机器人命令系统
 */
export function cleanupBotCommands(): void {
  const manager = getBotCommandManager();
  manager.cleanup();
  managerInstance = null;
  
}

/**
 * 获取调试信息
 */
export function getBotCommandManagerDebugInfo(): ReturnType<BotCommandManager['getDebugInfo']> {
  const manager = getBotCommandManager();
  return manager.getDebugInfo();
}

/**
 * 🆕 调试工具：获取机器人命令系统状态（包含版本缓存）
 */
export function debugBotCommandSystem() {
  const manager = getBotCommandManager();
  
  const info = {
    asyncStats: manager.getAsyncStats(),
    debugInfo: manager.getDebugInfo()
  };
  return info;
}


// 调试工具全局注册已移除