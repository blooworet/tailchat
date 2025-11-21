import React, { useMemo, useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { SlashCommand, SlashCommandSuggestion, CommandScope, ChatContext } from 'tailchat-shared/types/command';
import { getSlashCommandRegistry } from '@/plugin/common/slash-commands/registry';

/**
 * 结果缓存管理器
 */
class CommandSuggestionCache {
  private cache = new Map<string, {
    result: SlashCommandSuggestion[];
    timestamp: number;
    hitCount: number;
  }>();
  
  private readonly TTL = 30 * 1000; // 30秒缓存TTL
  private readonly MAX_SIZE = 50;   // 最大缓存条目数
  
  get(key: string): SlashCommandSuggestion[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // 检查是否过期
    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }
    
    // 更新命中次数
    entry.hitCount++;
    return entry.result;
  }
  
  set(key: string, result: SlashCommandSuggestion[]): void {
    // 如果缓存已满，清理最少使用的条目
    if (this.cache.size >= this.MAX_SIZE) {
      const entriesToDelete = Array.from(this.cache.entries())
        .sort((a, b) => a[1].hitCount - b[1].hitCount)
        .slice(0, Math.floor(this.MAX_SIZE * 0.2)); // 删除20%最少使用的条目
        
      entriesToDelete.forEach(([key]) => this.cache.delete(key));
    }
    
    this.cache.set(key, {
      result: [...result], // 深拷贝避免引用问题
      timestamp: Date.now(),
      hitCount: 0
    });
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  getStats(): {
    size: number;
    hitRate: number;
    totalEntries: number;
    totalHits: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hitCount, 0);
    const totalEntries = entries.length;
    
    return {
      size: this.cache.size,
      hitRate: totalEntries > 0 ? totalHits / (totalHits + totalEntries) : 0,
      totalEntries,
      totalHits
    };
  }
}

/**
 * 性能监控器
 */
class HookPerformanceMonitor {
  private metrics = new Map<string, {
    executionTimes: number[];
    totalExecutions: number;
    totalTime: number;
    maxTime: number;
    minTime: number;
  }>();
  
  startTiming(operationName: string): () => number {
    // 安全地获取开始时间
    const startTime = this.safePerformanceNow();
    
    return () => {
      const endTime = this.safePerformanceNow();
      const executionTime = endTime - startTime;
      
      this.recordExecution(operationName, executionTime);
      return executionTime;
    };
  }

  /**
   * 安全地调用 performance.now()，提供后备方案
   */
  private safePerformanceNow(): number {
    try {
      if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
      }
    } catch (error) {
      console.warn('Performance.now() failed:', error);
    }
    return Date.now();
  }
  
  private recordExecution(operationName: string, executionTime: number): void {
    let metric = this.metrics.get(operationName);
    
    if (!metric) {
      metric = {
        executionTimes: [],
        totalExecutions: 0,
        totalTime: 0,
        maxTime: 0,
        minTime: Infinity
      };
      this.metrics.set(operationName, metric);
    }
    
    metric.executionTimes.push(executionTime);
    metric.totalExecutions++;
    metric.totalTime += executionTime;
    metric.maxTime = Math.max(metric.maxTime, executionTime);
    metric.minTime = Math.min(metric.minTime, executionTime);
    
    // 保持最近100次执行记录
    if (metric.executionTimes.length > 100) {
      metric.executionTimes.shift();
    }
  }
  
  getMetrics(operationName: string) {
    const metric = this.metrics.get(operationName);
    if (!metric) return null;
    
    const avgTime = metric.totalExecutions > 0 ? metric.totalTime / metric.totalExecutions : 0;
    const recentAvg = metric.executionTimes.length > 0 
      ? metric.executionTimes.reduce((sum, time) => sum + time, 0) / metric.executionTimes.length
      : 0;
    
    return {
      totalExecutions: metric.totalExecutions,
      averageTime: avgTime,
      recentAverageTime: recentAvg,
      maxTime: metric.maxTime,
      minTime: metric.minTime === Infinity ? 0 : metric.minTime
    };
  }
  
  getAllMetrics() {
    const result: Record<string, ReturnType<HookPerformanceMonitor['getMetrics']>> = {};
    for (const [operationName] of this.metrics.entries()) {
      result[operationName] = this.getMetrics(operationName);
    }
    return result;
  }
  
  clear(): void {
    this.metrics.clear();
  }
}

/**
 * 命令更新事件管理器
 * 解决多个Hook实例重复注册事件监听器的内存泄漏问题
 */
class CommandUpdateManager {
  private static instance: CommandUpdateManager | null = null;
  private listeners = new Set<(detail: any) => void>();
  private isListening = false;
  
  static getInstance(): CommandUpdateManager {
    if (!CommandUpdateManager.instance) {
      CommandUpdateManager.instance = new CommandUpdateManager();
    }
    return CommandUpdateManager.instance;
  }
  
  subscribe(callback: (detail: any) => void): () => void {
    this.listeners.add(callback);
    this.startListening();
    
    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0) {
        this.stopListening();
      }
    };
  }
  
  private startListening() {
    if (this.isListening || typeof window === 'undefined') return;
    
    this.isListening = true;
    window.addEventListener('slash-commands-updated', this.handleEvent);
  }
  
  private stopListening() {
    if (!this.isListening || typeof window === 'undefined') return;
    
    this.isListening = false;
    window.removeEventListener('slash-commands-updated', this.handleEvent);
  }
  
  private handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent;
    this.listeners.forEach(callback => {
      try {
        callback(customEvent.detail);
      } catch (error) {
        console.error('[CommandUpdateManager] 监听器执行出错:', error);
      }
    });
  };
  
  // 强制清理所有监听器（用于异常恢复）
  forceCleanup() {
    this.listeners.clear();
    this.stopListening();
  }
}

/**
 * 检查命令在当前环境下是否可见
 * 
 * 核心逻辑：
 * 1. 系统命令（type !== 'bot'）：按 scope 规则全局可见
 * 2. 机器人命令（type === 'bot'）：
 *    - 必须检查机器人是否在当前会话中
 *    - scope 用于进一步限制可见范围
 */
function isCommandVisibleInContext(
  command: SlashCommand, 
  context?: ChatContext
): boolean {
  const scope = command.scope;
  const isBotCommand = command.type === 'bot';
  
  // 如果没有上下文信息，只显示系统命令
  if (!context) {
    return !isBotCommand;
  }
  
  // ==================== 机器人命令特殊处理 ====================
  if (isBotCommand) {
    const botUserId = command.botUserId;
    // 如果命令没有 botUserId，无法判断，不显示
    if (!botUserId) {
      return false;
    }
    // 新架构：注册阶段已按会话成员过滤；这里仅根据 scope 决定可见性
    if (!scope || scope.type === 'default') {
      // default: 机器人所在的所有会话都可见
      return true;
    }
    
    switch (scope.type) {
      case 'all_private_chats':
        // 仅在私聊中可见
        return !context.isGroup;
      case 'all_group_chats':
        // 仅在群聊中可见
        return context.isGroup;
      case 'chat':
        // 仅在特定会话中可见
        return scope.chat_id === context.converseId;
      case 'chat_member':
        // 仅对特定会话的特定用户可见
        return scope.chat_id === context.converseId && scope.user_id === context.userId;
      default:
        return true;
    }
  }
  
  // ==================== 系统命令处理 ====================
  // 系统命令按原有逻辑：scope 决定可见性
  if (!scope || scope.type === 'default') {
    return true;
  }
  
  switch (scope.type) {
    case 'all_private_chats':
      return !context.isGroup;
    case 'all_group_chats':
      return context.isGroup;
    case 'chat':
      return scope.chat_id === context.converseId;
    case 'chat_member':
      return scope.chat_id === context.converseId && scope.user_id === context.userId;
    default:
      return true;
  }
}

/**
 * 斜杠命令 Hook
 * 提供命令搜索、过滤、执行等功能
 * 
 * 优化要点：
 * 1. 使用CommandUpdateManager避免事件监听器累积
 * 2. 稳定化chatContext引用避免无效重渲染
 * 3. 实现结果缓存提升性能
 * 4. 增强异常处理和清理逻辑
 */
export function useSlashCommands(chatContext?: ChatContext) {
  const registry = getSlashCommandRegistry();
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const updateManager = useRef<CommandUpdateManager>();
  const cleanupRef = useRef<(() => void) | null>(null);
  
  // 性能优化：缓存和监控管理器（单例模式）
  const cacheManager = useRef<CommandSuggestionCache>();
  const performanceMonitor = useRef<HookPerformanceMonitor>();
  
  // 初始化管理器实例
  if (!cacheManager.current) {
    cacheManager.current = new CommandSuggestionCache();
  }
  if (!performanceMonitor.current) {
    performanceMonitor.current = new HookPerformanceMonitor();
  }
  
  // 稳定化chatContext引用，避免无效重渲染
  const stableChatContext = useMemo(() => {
    if (!chatContext) return null;
    return {
      userId: chatContext.userId,
      converseId: chatContext.converseId,
      isGroup: chatContext.isGroup,
      converseMemberIds: chatContext.converseMemberIds
    };
  }, [
    chatContext?.userId, 
    chatContext?.converseId, 
    chatContext?.isGroup, 
    // 使用非破坏性排序：对拷贝后的数组排序，避免对只读数组进行原地修改
    JSON.stringify([...(chatContext?.converseMemberIds || [])].sort())
  ]);
  
  // 初始化命令更新管理器
  if (!updateManager.current) {
    updateManager.current = CommandUpdateManager.getInstance();
  }
  
  // 版本号用于缓存失效
  const [commandsVersion, setCommandsVersion] = useState(0);
  
  // 加载命令
  useEffect(() => {
    const loadCommands = async () => {
      try {
        setLoading(true);
        const allCommands = registry.getAllCommands();
        setCommands(allCommands);
        
      } catch (error) {
        console.error('Failed to load slash commands:', error);
        setCommands([]);
      } finally {
        setLoading(false);
      }
    };

    loadCommands();
  }, [registry]);

  // 监听命令更新事件（使用管理器避免内存泄漏）
  useEffect(() => {
    const handleCommandsUpdated = (detail: any) => {
      
      const { converseIds, global, soft } = detail || {};
      
      // global: 全局更新，重新加载所有命令
      if (global) {
        try {
          const allCommands = registry.getAllCommands();
          setCommands(allCommands);
          setCommandsVersion(prev => prev + 1);
          cacheManager.current?.clear();
        } catch (error) {
          console.error('[useSlashCommands] 全局命令更新失败:', error);
        }
        return;
      }
      
      // 特定会话更新：仅当当前上下文匹配时才更新
      if (converseIds && Array.isArray(converseIds) && stableChatContext) {
        if (converseIds.includes(stableChatContext.converseId)) {
          try {
            const allCommands = registry.getAllCommands();
            setCommands(allCommands);
            setCommandsVersion(prev => prev + 1);
            cacheManager.current?.clear();
          } catch (error) {
            console.error('[useSlashCommands] 会话命令更新失败:', error);
          }
        }
      }
    };

    // 使用管理器订阅事件，自动管理监听器生命周期
    if (updateManager.current) {
      const unsubscribe = updateManager.current.subscribe(handleCommandsUpdated);
      cleanupRef.current = unsubscribe;
      
      return () => {
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
      };
    }
  }, [registry, stableChatContext?.converseId]);
  
  
  // 组件卸载时强制清理（异常恢复机制）
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch (error) {
          console.error('[useSlashCommands] 清理监听器时出错:', error);
          // 强制清理所有监听器
          updateManager.current?.forceCleanup();
        }
        cleanupRef.current = null;
      }
    };
  }, []);

  /**
   * 获取过滤后的命令建议（增强版：带结果缓存和性能监控）
   */
  const getCommandSuggestions = useCallback((query: string): SlashCommandSuggestion[] => {
    if (!query.startsWith('/')) {
      return [];
    }
    
    // 开始性能监控
    const endTiming = performanceMonitor.current?.startTiming('getCommandSuggestions');
    
    try {
      // 生成缓存键（包含查询、上下文和命令版本）
      const contextKey = stableChatContext ? 
        `${stableChatContext.converseId}_${stableChatContext.isGroup}_${stableChatContext.userId}` : 
        'no_context';
      const cacheKey = `${query.toLowerCase()}_${contextKey}_${commandsVersion}`;
      
      // 尝试从缓存获取结果
      const cachedResult = cacheManager.current?.get(cacheKey);
      if (cachedResult) {
        endTiming?.(); // 记录缓存命中的性能
        return cachedResult;
      }
      
      // 移除开头的斜杠
      const commandQuery = query.slice(1).toLowerCase();
      
      // 如果查询为空，返回所有可见命令
      if (!commandQuery) {
        const visibleCommands = commands.filter((cmd: SlashCommand) => 
          isCommandVisibleInContext(cmd, stableChatContext)
        );
        
        const results = visibleCommands.map((cmd: SlashCommand) => ({
          name: cmd.name,
          description: cmd.description,
          usage: `/${cmd.name}`,
          category: cmd.category || 'general',
          type: cmd.type || 'system',
          scope: cmd.scope,
          botId: cmd.botId,
          botName: cmd.botName,
          botUserId: cmd.botUserId,
        }));
        
        // 缓存结果
        cacheManager.current?.set(cacheKey, results);
        
        const executionTime = endTiming?.();
        
        // 性能警告（开发模式）
        if (process.env.NODE_ENV === 'development' && executionTime && executionTime > 50) {
          console.warn(`[useSlashCommands] 命令建议计算耗时过长: ${executionTime.toFixed(2)}ms`);
        }
        
        return results;
      }
      
      // 搜索匹配的命令（优化：使用更高效的搜索策略）
      const filteredCommands = commands.filter((cmd: SlashCommand) => {
        if (!isCommandVisibleInContext(cmd, stableChatContext)) {
          return false;
        }
        
        // 精确匹配优先
        if (cmd.name.toLowerCase() === commandQuery) {
          return true;
        }
        
        // 前缀匹配次之
        if (cmd.name.toLowerCase().startsWith(commandQuery)) {
          return true;
        }
        
        // 包含匹配最后
        const nameMatch = cmd.name.toLowerCase().includes(commandQuery);
        const descMatch = cmd.description?.toLowerCase().includes(commandQuery);
        return nameMatch || descMatch;
      });
      
      // 排序：精确匹配 > 前缀匹配 > 包含匹配
      filteredCommands.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        
        const aExact = aName === commandQuery ? 1 : 0;
        const bExact = bName === commandQuery ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        
        const aPrefix = aName.startsWith(commandQuery) ? 1 : 0;
        const bPrefix = bName.startsWith(commandQuery) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
        
        return aName.localeCompare(bName);
      });
      
      const results = filteredCommands.map((cmd: SlashCommand) => ({
        name: cmd.name,
        description: cmd.description,
        usage: `/${cmd.name}`,
        category: cmd.category || 'general',
        type: cmd.type || 'system',
        scope: cmd.scope,
        // 传递机器人信息
        botId: cmd.botId,
        botName: cmd.botName,
        botUserId: cmd.botUserId,
      }));
      
      // 缓存结果
      cacheManager.current?.set(cacheKey, results);
      
      const executionTime = endTiming?.();
      
      // 性能警告（开发模式）
      if (process.env.NODE_ENV === 'development' && executionTime && executionTime > 50) {
        console.warn(`[useSlashCommands] 命令搜索耗时过长: ${executionTime.toFixed(2)}ms`);
      }
      
      return results;
    } catch (error) {
      endTiming?.();
      console.error('Error getting command suggestions:', error);
      return [];
    }
  }, [commands, stableChatContext, commandsVersion]);

  /**
   * 执行命令
   */
  const executeCommand = useCallback((commandName: string, args: string[], context?: ChatContext) => {
    try {
      const command = registry.getCommand(commandName);
      if (!command) {
        console.error(`Command '${commandName}' not found`);
        return Promise.resolve({ success: false, message: `Command '${commandName}' not found` });
      }
      
      if (!command.handler) {
        console.error(`Command '${commandName}' has no handler`);
        return Promise.resolve({ success: false, message: `Command '${commandName}' has no handler` });
      }
      
      const commandContext = {
        args,
        userId: context?.userId || '',
        converseId: context?.converseId || '',
        rawInput: `/${commandName} ${args.join(' ')}`,
      };
      return command.handler(commandContext);
    } catch (error) {
      console.error(`Error executing command '${commandName}':`, error);
      return Promise.resolve({ success: false, message: `Error executing command: ${error}` });
    }
  }, [registry]);

  /**
   * 刷新命令列表
   */
  const refreshCommands = useCallback(() => {
    try {
      const allCommands = registry.getAllCommands();
      setCommands(allCommands);
    } catch (error) {
      console.error('Error refreshing commands:', error);
    }
  }, [registry]);

  // 计算统计信息（缓存结果）
  const stats = useMemo(() => {
    try {
      const visibleCommands = commands.filter((cmd: SlashCommand) => 
        isCommandVisibleInContext(cmd, stableChatContext)
      );
      
      const byType = visibleCommands.reduce((acc: Record<string, number>, cmd: SlashCommand) => {
        const type = cmd.type || 'system';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const byCategory = visibleCommands.reduce((acc: Record<string, number>, cmd: SlashCommand) => {
        const category = cmd.category || 'general';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        total: commands.length,
        visible: visibleCommands.length,
        byType,
        byCategory,
        loading,
      };
    } catch (error) {
      console.error('Error calculating stats:', error);
      return {
        total: 0,
        visible: 0,
        byType: {},
        byCategory: {},
        loading,
      };
    }
  }, [commands, stableChatContext, loading]);

  /**
   * 获取性能统计信息（调试用）
   */
  const getPerformanceStats = useCallback(() => {
    if (process.env.NODE_ENV !== 'development') {
      return null;
    }
    
    return {
      cache: cacheManager.current?.getStats(),
      performance: performanceMonitor.current?.getAllMetrics(),
      commandsCount: commands.length,
      commandsVersion
    };
  }, [commands.length, commandsVersion]);

  return {
    commands,
    loading,
    stats,
    getCommandSuggestions,
    executeCommand,
    refreshCommands,
    
    // 调试功能
    _registry: registry,
    _isCommandVisibleInContext: isCommandVisibleInContext,
    
    // 性能优化功能（开发模式）
    ...(process.env.NODE_ENV === 'development' && { 
      getPerformanceStats,
      clearCache: () => cacheManager.current?.clear(),
      clearPerformanceStats: () => performanceMonitor.current?.clear()
    })
  };
}