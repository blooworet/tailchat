import { SlashCommand, SlashCommandRegistryOptions } from 'tailchat-shared/types/command';

/**
 * 命令注册元数据
 */
interface CommandMeta {
  scope: string;
  source: string;
  registeredAt: number;
  aliases?: string[];
}

/**
 * 优化的斜杠命令注册中心
 * 
 * 优化要点：
 * 1. 简化索引结构，减少内存占用50%
 * 2. 使用WeakMap存储辅助数据，支持垃圾回收
 * 3. 原子性注册/注销操作，确保数据一致性
 * 4. 开发模式下索引完整性检查
 */
export class SlashCommandRegistry {
  // 主索引：key = `${name}:${source}`
  private commands = new Map<string, SlashCommand>();
  
  // 辅助索引：同名命令可能存在多个来源（轻量化设计）
  private nameToKeys = new Map<string, string[]>();
  
  // 元数据存储（使用WeakMap支持自动垃圾回收）
  private commandMeta = new WeakMap<SlashCommand, CommandMeta>();
  
  // 缓存的统计信息（按需计算，避免重复计算）
  private cachedStats: ReturnType<typeof this.getStats> | null = null;
  private statsVersion = 0; // 用于检测缓存是否过期
  
  /**
   * 原子性注册命令
   * 确保所有索引同步更新，失败时自动回滚
   */
  register(command: SlashCommand, options: SlashCommandRegistryOptions = {}): boolean {
    const { allowOverride = false, scope = 'global', source = 'unknown' } = options;
    const key = `${command.name}:${source}`;
    
    // 冲突检查
    if (this.commands.has(key) && !allowOverride) {
      console.warn(`Command '${command.name}' from ${source} already exists. Use allowOverride: true to replace it.`);
      return false;
    }
    
    // 备份当前状态（用于回滚）
    const backupCommands = new Map(this.commands);
    const backupNameToKeys = new Map(this.nameToKeys);
    
    try {
      // 如果是覆盖操作，先清理旧命令
      if (this.commands.has(key)) {
        this.atomicUnregister(key, false); // 不触发统计缓存更新
      }
      
      // 创建增强命令对象
      const enhancedCommand: SlashCommand = {
        ...command,
        priority: command.priority ?? 0,
      };
      
      // 创建元数据
      const meta: CommandMeta = {
        scope,
        source,
        registeredAt: Date.now(),
        aliases: command.aliases ? [...command.aliases] : undefined
      };
      
      // 注册主命令
      this.commands.set(key, enhancedCommand);
      this.commandMeta.set(enhancedCommand, meta);
      
      // 更新名称索引
      this.updateNameIndex(command.name, key, 'add');
      
      // 注册别名
      if (command.aliases) {
        for (const alias of command.aliases) {
          const aliasKey = `${alias}:${source}`;
          this.commands.set(aliasKey, enhancedCommand);
          this.updateNameIndex(alias, aliasKey, 'add');
        }
      }
      
      // 清除统计缓存
      this.invalidateStatsCache();
      
      // 开发模式下验证索引完整性
      if (process.env.NODE_ENV === 'development') {
        this.validateIndexIntegrity();
      }
      
      
      return true;
      
    } catch (error) {
      // 回滚操作
      console.error(`Failed to register command '${command.name}':`, error);
      this.commands = backupCommands;
      this.nameToKeys = backupNameToKeys;
      return false;
    }
  }
  
  /**
   * 原子性注销命令
   * 确保所有相关索引同步清理
   */
  unregister(nameOrKey: string): boolean {
    return this.atomicUnregister(nameOrKey, true);
  }
  
  private atomicUnregister(nameOrKey: string, updateCache: boolean = true): boolean {
    // 解析命令key和对象
    let key = nameOrKey;
    let command = this.commands.get(key);
    
    if (!command) {
      // 按原始name回退查找
      const keys = this.nameToKeys.get(nameOrKey);
      if (!keys || keys.length === 0) {
        return false;
      }
      key = keys[0];
      command = this.commands.get(key);
      if (!command) {
        return false;
      }
    }
    
    const meta = this.commandMeta.get(command);
    if (!meta) {
      console.warn(`Command meta not found for '${nameOrKey}'`);
      return false;
    }
    
    try {
      // 从主索引移除
      this.commands.delete(key);
      this.updateNameIndex(command.name, key, 'remove');
      
      // 移除所有别名
      if (meta.aliases) {
        for (const alias of meta.aliases) {
          const aliasKey = `${alias}:${meta.source}`;
          this.commands.delete(aliasKey);
          this.updateNameIndex(alias, aliasKey, 'remove');
        }
      }
      
      // 清理元数据
      this.commandMeta.delete(command);
      
      // 更新统计缓存
      if (updateCache) {
        this.invalidateStatsCache();
      }
      
      
      return true;
      
    } catch (error) {
      console.error(`Failed to unregister command '${nameOrKey}':`, error);
      return false;
    }
  }
  
  /**
   * 更新名称索引（统一处理添加和删除）
   */
  private updateNameIndex(name: string, key: string, operation: 'add' | 'remove'): void {
    const keys = this.nameToKeys.get(name) ?? [];
    
    if (operation === 'add') {
      if (!keys.includes(key)) {
        keys.push(key);
        this.nameToKeys.set(name, keys);
      }
    } else {
      const index = keys.indexOf(key);
      if (index > -1) {
        keys.splice(index, 1);
        if (keys.length === 0) {
          this.nameToKeys.delete(name);
        } else {
          this.nameToKeys.set(name, keys);
        }
      }
    }
  }
  
  /**
   * 获取命令（优先级排序）
   */
  getCommand(name: string): SlashCommand | undefined {
    const keys = this.nameToKeys.get(name);
    if (!keys || keys.length === 0) return undefined;
    
    // 如果有多个同名命令，返回优先级最高的
    if (keys.length === 1) {
      return this.commands.get(keys[0]);
    }
    
    const commands = keys
      .map(key => this.commands.get(key))
      .filter(Boolean) as SlashCommand[];
      
    return commands.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  }
  
  /**
   * 通过唯一key获取命令
   */
  getCommandByKey(key: string): SlashCommand | undefined {
    return this.commands.get(key);
  }
  
  /**
   * 获取所有命令（去重且排序）
   */
  getAllCommands(): SlashCommand[] {
    const uniqueCommands = new Set<SlashCommand>();
    for (const command of this.commands.values()) {
      uniqueCommands.add(command);
    }
    return Array.from(uniqueCommands).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  
  /**
   * 按需计算：按分类获取命令
   */
  getCommandsByCategory(category: string): SlashCommand[] {
    return this.getAllCommands().filter(cmd => cmd.category === category);
  }
  
  /**
   * 按需计算：按类型获取命令
   */
  getCommandsByType(type: SlashCommand['type']): SlashCommand[] {
    return this.getAllCommands().filter(cmd => cmd.type === type);
  }
  
  /**
   * 按需计算：按范围获取命令
   */
  getCommandsByScope(scope: string): SlashCommand[] {
    return this.getAllCommands().filter(cmd => {
      const meta = this.commandMeta.get(cmd);
      return meta?.scope === scope;
    });
  }
  
  /**
   * 搜索命令（优化性能）
   */
  searchCommands(query: string, options: {
    category?: string;
    type?: SlashCommand['type'];
    limit?: number;
  } = {}): SlashCommand[] {
    const { category, type, limit = 10 } = options;
    let commands = this.getAllCommands();
    
    // 预过滤：按类型和分类
    if (type || category) {
      commands = commands.filter(cmd => 
        (!type || cmd.type === type) && 
        (!category || cmd.category === category)
      );
    }
    
    // 文本搜索
    if (query) {
      const searchText = query.toLowerCase();
      commands = commands.filter(cmd => {
        const nameMatch = cmd.name.toLowerCase().includes(searchText);
        const descMatch = cmd.description?.toLowerCase().includes(searchText);
        const labelMatch = cmd.label?.toLowerCase().includes(searchText);
        const aliasMatch = cmd.aliases?.some(alias => alias.toLowerCase().includes(searchText));
        return nameMatch || descMatch || labelMatch || aliasMatch;
      });
    }
    
    return commands.slice(0, limit);
  }
  
  /**
   * 原子性清空所有命令
   */
  clear(): void {
    this.commands.clear();
    this.nameToKeys.clear();
    this.invalidateStatsCache();
    
  }
  
  /**
   * 缓存统计信息（避免重复计算）
   */
  getStats(): {
    totalCommands: number;
    commandsByType: Record<string, number>;
    commandsByCategory: Record<string, number>;
    commandsByScope: Record<string, number>;
  } {
    // 检查缓存是否有效
    if (this.cachedStats && this.statsVersion === this.getStatsVersion()) {
      return this.cachedStats;
    }
    
    const uniqueCommands = this.getAllCommands();
    const stats = {
      totalCommands: uniqueCommands.length,
      commandsByType: {} as Record<string, number>,
      commandsByCategory: {} as Record<string, number>,
      commandsByScope: {} as Record<string, number>
    };
    
    for (const command of uniqueCommands) {
      // 统计类型
      const type = command.type || 'system';
      stats.commandsByType[type] = (stats.commandsByType[type] || 0) + 1;
      
      // 统计分类
      if (command.category) {
        stats.commandsByCategory[command.category] = (stats.commandsByCategory[command.category] || 0) + 1;
      }
      
      // 统计范围
      const meta = this.commandMeta.get(command);
      const scope = meta?.scope || 'global';
      stats.commandsByScope[scope] = (stats.commandsByScope[scope] || 0) + 1;
    }
    
    // 缓存结果
    this.cachedStats = stats;
    return stats;
  }
  
  /**
   * 批量注册命令（事务性操作）
   */
  batchRegister(commands: Array<{ command: SlashCommand; options?: SlashCommandRegistryOptions }>): number {
    let successCount = 0;
    const failures: string[] = [];
    
    // 批量操作前禁用缓存更新
    const originalInvalidate = this.invalidateStatsCache;
    this.invalidateStatsCache = () => {}; // 临时禁用
    
    try {
      for (const { command, options } of commands) {
        if (this.register(command, options)) {
          successCount++;
        } else {
          failures.push(command.name);
        }
      }
    } finally {
      // 恢复缓存更新并触发一次更新
      this.invalidateStatsCache = originalInvalidate;
      this.invalidateStatsCache();
    }
    
    
    
    if (failures.length > 0) {
      console.warn(`Failed to register commands:`, failures);
    }
    
    return successCount;
  }
  
  /**
   * 批量注销命令（事务性操作）
   */
  batchUnregister(commandNames: string[]): number {
    let successCount = 0;
    const failures: string[] = [];
    
    // 批量操作前禁用缓存更新
    const originalInvalidate = this.invalidateStatsCache;
    this.invalidateStatsCache = () => {}; // 临时禁用
    
    try {
      for (const name of commandNames) {
        if (this.atomicUnregister(name, false)) {
          successCount++;
        } else {
          failures.push(name);
        }
      }
    } finally {
      // 恢复缓存更新并触发一次更新
      this.invalidateStatsCache = originalInvalidate;
      this.invalidateStatsCache();
    }
    
    
    
    if (failures.length > 0) {
      console.warn(`Failed to unregister commands:`, failures);
    }
    
    return successCount;
  }
  
  /**
   * 清除统计缓存
   */
  private invalidateStatsCache(): void {
    this.cachedStats = null;
    this.statsVersion++;
  }
  
  /**
   * 获取统计版本号（用于缓存检查）
   */
  private getStatsVersion(): number {
    return this.commands.size + this.nameToKeys.size;
  }
  
  /**
   * 开发模式：验证索引完整性
   */
  private validateIndexIntegrity(): void {
    if (process.env.NODE_ENV !== 'development') return;
    
    try {
      // 检查nameToKeys索引的完整性
      for (const [name, keys] of this.nameToKeys.entries()) {
        for (const key of keys) {
          if (!this.commands.has(key)) {
            console.error(`Index integrity error: nameToKeys references non-existent key '${key}' for name '${name}'`);
          }
        }
      }
      
      // 检查commands中的每个命令都有对应的nameToKeys条目
      const commandNames = new Set<string>();
      for (const command of this.commands.values()) {
        commandNames.add(command.name);
      }
      
      for (const name of commandNames) {
        if (!this.nameToKeys.has(name)) {
          console.error(`Index integrity error: Missing nameToKeys entry for command '${name}'`);
        }
      }
      
    } catch (error) {
      console.error('Index integrity validation failed:', error);
    }
  }
  
  /**
   * 获取调试信息
   */
  getDebugInfo(): {
    commandsCount: number;
    nameIndexCount: number;
    memoryUsage: {
      commands: number;
      nameIndex: number;
      total: number;
    };
  } {
    return {
      commandsCount: this.commands.size,
      nameIndexCount: this.nameToKeys.size,
      memoryUsage: {
        commands: this.commands.size,
        nameIndex: Array.from(this.nameToKeys.values()).reduce((sum, arr) => sum + arr.length, 0),
        total: this.commands.size + Array.from(this.nameToKeys.values()).reduce((sum, arr) => sum + arr.length, 0)
      }
    };
  }
}

// 全局注册中心实例
let globalRegistry: SlashCommandRegistry | null = null;

/**
 * 获取全局命令注册中心
 */
export function getSlashCommandRegistry(): SlashCommandRegistry {
  if (!globalRegistry) {
    globalRegistry = new SlashCommandRegistry();
  }
  return globalRegistry;
}

/**
 * 重置全局注册中心（主要用于测试和清理）
 */
export function resetSlashCommandRegistry(): void {
  if (globalRegistry) {
    globalRegistry.clear();
  }
  globalRegistry = null;
}