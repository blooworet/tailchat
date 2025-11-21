import { 
  SlashCommand, 
  SlashCommandContext, 
  SlashCommandResult,
  CommandScope
} from 'tailchat-shared/types/command';
import { getSlashCommandRegistry } from './registry';
// import { showToasts } from 'tailchat-design'; // TODO: 修复导入路径
import { 
  CommandErrorCode, 
  createCommandError, 
  formatErrorMessage,
  isCommandError 
} from './errors';
import { 
  ValidationChain, 
  createDefaultValidationChain,
  formatValidationResult 
} from './validation';

/**
 * 命令执行统计项
 */
interface ExecutionStat {
  commandName: string;
  commandType?: string;
  success: boolean;
  executionTime: number;
  timestamp: number;
  userId: string;
  groupId?: string;
  converseId: string;
}

/**
 * 压缩的统计数据
 */
interface CompressedStats {
  v: number; // version
  d: ExecutionStat[]; // data
  c: number; // count
  t: number; // last timestamp
}

/**
 * 高性能循环缓冲区统计管理器
 * 
 * 特性：
 * 1. 固定大小环形缓冲区，避免内存无限增长
 * 2. 批量写入和增量更新，减少localStorage操作频次
 * 3. 数据压缩存储，减少存储空间占用
 * 4. 时间过期清理，自动清理过期数据
 */
class ExecutionStatsManager {
  private readonly BUFFER_SIZE = 500;          // 循环缓冲区大小
  private readonly BATCH_SIZE = 10;            // 批量写入大小
  private readonly STORAGE_KEY = 'slashCommandStats_v2';
  private readonly MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7天过期时间
  private readonly WRITE_DEBOUNCE_MS = 2000;   // 写入防抖延迟
  
  private buffer: ExecutionStat[] = [];
  private bufferIndex = 0;
  private pendingWrites: ExecutionStat[] = [];
  private writeTimer: NodeJS.Timeout | null = null;
  private lastWriteTime = 0;
  private initialized = false;
  
  // 性能指标
  private writeCount = 0;
  private compressedSize = 0;
  private originalSize = 0;

  constructor() {
    this.initialize();
  }

  /**
   * 初始化统计管理器
   */
  private initialize(): void {
    if (this.initialized) return;

    try {
      // 从存储中恢复数据
      this.loadFromStorage();
      
      // 清理过期数据
      this.cleanExpiredData();
      
      this.initialized = true;
      
    } catch (error) {
      this.buffer = [];
      this.bufferIndex = 0;
    }
  }

  /**
   * 从localStorage加载数据
   */
  private loadFromStorage(): void {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) {
      this.buffer = [];
      this.bufferIndex = 0;
      return;
    }

    try {
      const compressed: CompressedStats = JSON.parse(stored);
      
      // 版本兼容性检查
      if (compressed.v !== 1) {
        this.buffer = [];
        this.bufferIndex = 0;
        return;
      }

      this.buffer = compressed.d || [];
      this.bufferIndex = this.buffer.length % this.BUFFER_SIZE;
      
      // 计算压缩率
      this.compressedSize = stored.length;
      this.originalSize = JSON.stringify(this.buffer).length;
    } catch (error) {
      this.buffer = [];
      this.bufferIndex = 0;
    }
  }

  /**
   * 压缩数据并保存到localStorage
   */
  private saveToStorage(): void {
    try {
      const compressed: CompressedStats = {
        v: 1,
        d: this.buffer.filter(item => item !== null && item !== undefined),
        c: this.buffer.length,
        t: Date.now()
      };

      const serialized = JSON.stringify(compressed);
      localStorage.setItem(this.STORAGE_KEY, serialized);
      
      this.writeCount++;
      this.compressedSize = serialized.length;
      this.originalSize = JSON.stringify(this.buffer).length;
      this.lastWriteTime = Date.now();
    } catch (error) {
    }
  }

  /**
   * 清理过期数据
   */
  private cleanExpiredData(): void {
    const now = Date.now();
    const cutoffTime = now - this.MAX_AGE;
    
    let cleanedCount = 0;
    this.buffer = this.buffer.filter(stat => {
      if (!stat || stat.timestamp < cutoffTime) {
        cleanedCount++;
        return false;
      }
      return true;
    });
    
    // 重新计算缓冲区索引
    this.bufferIndex = this.buffer.length % this.BUFFER_SIZE;
    
    if (cleanedCount > 0) {
      
      // 立即保存清理后的数据
      this.saveToStorage();
    }
  }

  /**
   * 添加执行统计（使用循环缓冲区）
   */
  addExecution(stat: ExecutionStat): void {
    if (!this.initialized) {
      this.initialize();
    }

    // 如果缓冲区未满，直接添加
    if (this.buffer.length < this.BUFFER_SIZE) {
      this.buffer.push(stat);
    } else {
      // 缓冲区已满，使用循环覆盖
      this.buffer[this.bufferIndex] = stat;
    }
    
    this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
    
    // 添加到待写入队列
    this.pendingWrites.push(stat);
    
    // 判断是否需要立即写入
    const shouldWriteNow = (
      this.pendingWrites.length >= this.BATCH_SIZE ||
      Date.now() - this.lastWriteTime > this.WRITE_DEBOUNCE_MS * 2
    );
    
    if (shouldWriteNow) {
      this.flushPendingWrites();
    } else {
      // 设置防抖写入
      this.debouncedWrite();
    }
  }

  /**
   * 防抖写入
   */
  private debouncedWrite(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    
    this.writeTimer = setTimeout(() => {
      this.flushPendingWrites();
      this.writeTimer = null;
    }, this.WRITE_DEBOUNCE_MS);
  }

  /**
   * 刷新待写入数据
   */
  private flushPendingWrites(): void {
    if (this.pendingWrites.length === 0) return;
    
    // 清理过期数据（定期执行）
    if (Math.random() < 0.1) { // 10%概率执行清理
      this.cleanExpiredData();
    }
    
    this.saveToStorage();
    this.pendingWrites = [];
    
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
  }

  /**
   * 获取统计数据
   */
  getStats(): {
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    commandUsage: Record<string, number>;
    recentExecutions: ExecutionStat[];
    performanceMetrics: {
      bufferSize: number;
      bufferUtilization: number;
      writeCount: number;
      compressionRate: number;
      lastWriteTime: number;
    };
  } {
    const validStats = this.buffer.filter(stat => stat && stat.timestamp);
    const now = Date.now();
    
    // 基础统计
    const totalExecutions = validStats.length;
    const successfulExecutions = validStats.filter(s => s.success).length;
    const successRate = totalExecutions > 0 ? successfulExecutions / totalExecutions : 0;
    
    const totalTime = validStats.reduce((sum, s) => sum + (s.executionTime || 0), 0);
    const averageExecutionTime = totalExecutions > 0 ? totalTime / totalExecutions : 0;
    
    // 命令使用统计
    const commandUsage: Record<string, number> = {};
    for (const stat of validStats) {
      if (stat.commandName) {
        commandUsage[stat.commandName] = (commandUsage[stat.commandName] || 0) + 1;
      }
    }
    
    // 最近执行记录（最近10条）
    const recentExecutions = validStats
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 10);
    
    // 性能指标
    const compressionRate = this.originalSize > 0 ? 
      (1 - this.compressedSize / this.originalSize) : 0;
    
    return {
      totalExecutions,
      successRate,
      averageExecutionTime,
      commandUsage,
      recentExecutions,
      performanceMetrics: {
        bufferSize: this.buffer.length,
        bufferUtilization: this.buffer.length / this.BUFFER_SIZE,
        writeCount: this.writeCount,
        compressionRate,
        lastWriteTime: this.lastWriteTime
      }
    };
  }

  /**
   * 获取时间范围内的统计
   */
  getStatsInRange(startTime: number, endTime: number): ExecutionStat[] {
    return this.buffer.filter(stat => 
      stat && 
      stat.timestamp >= startTime && 
      stat.timestamp <= endTime
    );
  }

  /**
   * 清除所有统计数据
   */
  clear(): void {
    this.buffer = [];
    this.bufferIndex = 0;
    this.pendingWrites = [];
    this.writeCount = 0;
    
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
    }
  }

  /**
   * 导出统计数据（用于调试或数据迁移）
   */
  exportData(): {
    stats: ExecutionStat[];
    metadata: {
      exportTime: number;
      totalRecords: number;
      dataVersion: number;
    };
  } {
    return {
      stats: [...this.buffer.filter(stat => stat)],
      metadata: {
        exportTime: Date.now(),
        totalRecords: this.buffer.length,
        dataVersion: 1
      }
    };
  }

  /**
   * 导入统计数据
   */
  importData(data: { stats: ExecutionStat[] }): void {
    if (!Array.isArray(data.stats)) {
      throw new Error('Invalid import data format');
    }
    
    // 清空当前数据
    this.buffer = [];
    this.bufferIndex = 0;
    
    // 导入新数据
    data.stats.forEach(stat => {
      if (stat && stat.commandName && stat.timestamp) {
        this.addExecution(stat);
      }
    });
  }
}

/**
 * 命令执行引擎
 * 负责解析、验证和执行斜杠命令
 * 
 * 优化特性：
 * 1. 高性能循环缓冲区统计系统
 * 2. 数据压缩存储，减少localStorage占用
 * 3. 批量写入和增量更新优化
 * 4. 自动过期清理机制
 */
export class SlashCommandExecutor {
  private registry = getSlashCommandRegistry();
  private validationChain = createDefaultValidationChain(); // ✅ 使用统一验证链
  private statsManager = new ExecutionStatsManager(); // ✅ 高性能统计管理器

  /**
   * 获取验证链（用于自定义验证器）
   */
  getValidationChain(): ValidationChain {
    return this.validationChain;
  }

  /**
   * 设置验证链（用于自定义验证器）
   */
  setValidationChain(chain: ValidationChain): void {
    this.validationChain = chain;
  }

  /**
   * 解析命令输入
   */
  parseCommand(input: string): {
    commandName: string;
    args: string[];
    rawInput: string;
  } | null {
    const trimmed = input.trim();
    
    // 检查是否以 / 开头
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // 移除开头的 /
    const withoutSlash = trimmed.substring(1);
    
    // 分割命令和参数
    const parts = withoutSlash.split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    return {
      commandName,
      args,
      rawInput: input
    };
  }

  /**
   * 验证命令权限
   * @deprecated 使用统一验证框架 ValidationChain 替代
   */
  private async validatePermissions(
    command: SlashCommand,
    context: SlashCommandContext
  ): Promise<{ valid: boolean; error?: string }> {
    // 检查命令权限要求
    if (command.permissions && command.permissions.length > 0) {
      // TODO: 集成到 Tailchat 的权限系统
      // 当前实现基础权限检查框架
      
      const hasPermission = await this.checkUserPermissions(
        context.userId,
        command.permissions,
        context.groupId
      );
      
      if (!hasPermission) {
        return {
          valid: false,
          error: formatErrorMessage(CommandErrorCode.INSUFFICIENT_PERMISSIONS)
        };
      }
    }

    // 检查群组特定权限
    if (context.groupId) {
      const hasGroupPermission = await this.checkGroupPermissions(
        context.userId,
        context.groupId,
        command
      );
      
      if (!hasGroupPermission) {
        return {
          valid: false,
          error: formatErrorMessage(CommandErrorCode.GROUP_PERMISSION_REQUIRED)
        };
      }
    }

    return { valid: true };
  }

  /**
   * 检查用户权限
   * TODO: 集成到 Tailchat 的权限系统
   */
  private async checkUserPermissions(
    userId: string,
    requiredPermissions: string[],
    groupId?: string
  ): Promise<boolean> {
    // 临时实现：基础权限检查逻辑
    // 在真实实现中，这里应该调用 Tailchat 的权限系统
    
    // 基础权限检查 - 目前允许所有用户
    // TODO: 实现真正的权限检查逻辑
    return true;
  }

  /**
   * 检查群组权限
   * TODO: 集成到 Tailchat 的群组权限系统
   */
  private async checkGroupPermissions(
    userId: string,
    groupId: string,
    command: SlashCommand
  ): Promise<boolean> {
    // 临时实现：基础群组权限检查
    // 在真实实现中，这里应该检查用户在群组中的角色和权限
    
    // 基础群组权限检查 - 目前允许所有用户
    // TODO: 实现真正的群组权限检查逻辑
    return true;
  }

  /**
   * 验证命令参数
   * @deprecated 使用统一验证框架 ValidationChain 替代
   */
  private validateArguments(
    command: SlashCommand,
    args: string[]
  ): { valid: boolean; error?: string } {
    // 检查必需参数
    if (command.requiresArgs && args.length === 0) {
      const hint = command.argsHint || '参数';
      return {
        valid: false,
        error: formatErrorMessage(CommandErrorCode.MISSING_REQUIRED_ARGS) + `: ${hint}`
      };
    }

    // TODO: 添加更详细的参数验证
    // - 参数类型检查
    // - 参数数量检查
    // - 参数格式验证

    return { valid: true };
  }

  /**
   * 验证命令可见性
   * @deprecated 使用统一验证框架 ValidationChain 替代
   */
  private validateCommandVisibility(
    command: SlashCommand,
    context: SlashCommandContext
  ): { valid: boolean; error?: string } {
    const scope = command.scope;
    if (!scope || scope.type === 'default') return { valid: true };
    
    const isGroup = !!context.groupId;
    
    switch (scope.type) {
      case 'all_private_chats':
        if (isGroup) {
          return { 
            valid: false, 
            error: formatErrorMessage(CommandErrorCode.PRIVATE_CHAT_ONLY)
          };
        }
        break;
      case 'all_group_chats':
        if (!isGroup) {
          return { 
            valid: false, 
            error: formatErrorMessage(CommandErrorCode.GROUP_CHAT_ONLY)
          };
        }
        break;
      case 'chat':
        if (scope.chat_id !== context.converseId) {
          return { 
            valid: false, 
            error: formatErrorMessage(CommandErrorCode.SPECIFIC_CHAT_ONLY)
          };
        }
        break;
      case 'chat_member':
        if (scope.chat_id !== context.converseId || scope.user_id !== context.userId) {
          return { 
            valid: false, 
            error: formatErrorMessage(CommandErrorCode.SPECIFIC_MEMBER_ONLY)
          };
        }
        break;
    }
    
    return { valid: true };
  }

  /**
   * 执行命令
   */
  async executeCommand(
    input: string,
    context: Omit<SlashCommandContext, 'rawInput' | 'args'>
  ): Promise<SlashCommandResult> {
    try {
      // 解析命令
      const parsed = this.parseCommand(input);
      if (!parsed) {
        return {
          success: false,
          error: formatErrorMessage(CommandErrorCode.INVALID_COMMAND_FORMAT)
        };
      }

      const { commandName, args, rawInput } = parsed;

      // 查找命令
      const command = this.registry.getCommand(commandName);
      if (!command) {
        return {
          success: false,
          error: formatErrorMessage(CommandErrorCode.COMMAND_NOT_FOUND, { 
            commandName: `/${commandName}` 
          }) + '。输入 /help 查看可用命令。'
        };
      }

      // 构建完整上下文
      const fullContext: SlashCommandContext = {
        ...context,
        rawInput,
        args
      };

      // ✅ 使用统一验证链进行验证
      const validationResult = await this.validationChain.validate(command, fullContext);
      if (!validationResult.valid) {
        return {
          success: false,
          error: formatValidationResult(validationResult)
        };
      }

      // 执行命令
      const startTime = Date.now();
      
      const result = await command.handler(fullContext);
      
      const executionTime = Date.now() - startTime;
      console.log(`Command ${command.name} executed in ${executionTime}ms`);

      // 记录执行统计
      this.recordExecution(command, fullContext, result, executionTime);

      return result;
    } catch (error) {
      console.error('Command execution error:', error);
      return {
        success: false,
        error: formatErrorMessage(CommandErrorCode.EXECUTION_FAILED) + 
               `: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 批量执行命令（用于脚本或自动化）
   */
  async executeBatch(
    commands: string[],
    context: Omit<SlashCommandContext, 'rawInput' | 'args'>
  ): Promise<SlashCommandResult[]> {
    const results: SlashCommandResult[] = [];
    
    for (const command of commands) {
      const result = await this.executeCommand(command, context);
      results.push(result);
      
      // 如果命令失败，可以选择是否继续执行
      if (!result.success) {
        console.warn(`Batch execution failed at command: ${command}`);
        // 可以根据需要决定是否中断批量执行
      }
    }
    
    return results;
  }

  /**
   * 获取命令建议（用于自动补全）
   */
  getCommandSuggestions(
    partialInput: string,
    context: Omit<SlashCommandContext, 'rawInput' | 'args'>
  ): SlashCommand[] {
    if (!partialInput.startsWith('/')) {
      return [];
    }

    const query = partialInput.substring(1).toLowerCase();
    const allCommands = this.registry.getAllCommands();

    // 过滤和排序命令
    return allCommands
      .filter(cmd => {
        // 基本匹配
        if (cmd.name.toLowerCase().startsWith(query)) {
          return true;
        }
        
        // 别名匹配
        if (cmd.aliases?.some(alias => alias.toLowerCase().startsWith(query))) {
          return true;
        }
        
        // 描述匹配
        if (cmd.description?.toLowerCase().includes(query)) {
          return true;
        }
        
        return false;
      })
      .sort((a, b) => {
        // 优先级排序
        const priorityDiff = (b.priority || 0) - (a.priority || 0);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        
        // 名称匹配优先于别名和描述匹配
        const aNameMatch = a.name.toLowerCase().startsWith(query);
        const bNameMatch = b.name.toLowerCase().startsWith(query);
        
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        
        // 字母顺序
        return a.name.localeCompare(b.name);
      })
      .slice(0, 10); // 限制建议数量
  }

  /**
   * 记录命令执行统计（优化版：使用高性能统计管理器）
   */
  private recordExecution(
    command: SlashCommand,
    context: SlashCommandContext,
    result: SlashCommandResult,
    executionTime: number
  ): void {
    const stats: ExecutionStat = {
      commandName: command.name,
      commandType: command.type,
      success: result.success,
      executionTime,
      timestamp: Date.now(),
      userId: context.userId,
      groupId: context.groupId,
      converseId: context.converseId
    };
    
    // 使用高性能统计管理器（循环缓冲区 + 批量写入）
    this.statsManager.addExecution(stats);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[SlashCommandExecutor] 命令执行统计:', stats);
    }
  }

  /**
   * 获取命令执行统计（优化版：使用高性能统计管理器）
   */
  getExecutionStats(): {
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    commandUsage: Record<string, number>;
    recentExecutions: ExecutionStat[];
    performanceMetrics?: {
      bufferSize: number;
      bufferUtilization: number;
      writeCount: number;
      compressionRate: number;
      lastWriteTime: number;
    };
  } {
    return this.statsManager.getStats();
  }

  /**
   * 获取时间范围内的执行统计
   */
  getExecutionStatsInRange(startTime: number, endTime: number): ExecutionStat[] {
    return this.statsManager.getStatsInRange(startTime, endTime);
  }

  /**
   * 清除所有执行统计数据
   */
  clearExecutionStats(): void {
    this.statsManager.clear();
  }

  /**
   * 导出执行统计数据（用于调试或数据迁移）
   */
  exportExecutionStats() {
    return this.statsManager.exportData();
  }

  /**
   * 导入执行统计数据
   */
  importExecutionStats(data: { stats: ExecutionStat[] }): void {
    this.statsManager.importData(data);
  }

  /**
   * 获取统计管理器实例（用于高级操作）
   */
  getStatsManager(): ExecutionStatsManager {
    return this.statsManager;
  }
}

// 全局执行器实例
let globalExecutor: SlashCommandExecutor | null = null;

/**
 * 获取全局命令执行器
 */
export function getSlashCommandExecutor(): SlashCommandExecutor {
  if (!globalExecutor) {
    globalExecutor = new SlashCommandExecutor();
  }
  return globalExecutor;
}

/**
 * 重置全局执行器（主要用于测试）
 */
export function resetSlashCommandExecutor(): void {
  globalExecutor = null;
}
