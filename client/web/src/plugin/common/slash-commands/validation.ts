/**
 * 统一的命令验证框架
 * 提供可见性验证、权限验证、参数验证的统一接口
 */

import { SlashCommand, SlashCommandContext, ChatContext } from 'tailchat-shared/types/command';
import { CommandErrorCode, formatErrorMessage } from './errors';

/**
 * 验证结果接口
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  code?: CommandErrorCode;
  details?: any;
}

/**
 * 验证器接口
 */
export interface Validator {
  name: string;
  validate(command: SlashCommand, context: SlashCommandContext): Promise<ValidationResult> | ValidationResult;
}

/**
 * 可见性验证器
 */
export class VisibilityValidator implements Validator {
  name = 'visibility';

  validate(command: SlashCommand, context: SlashCommandContext): ValidationResult {
    const scope = command.scope;
    if (!scope || scope.type === 'default') return { valid: true };
    
    const isGroup = !!context.groupId;
    
    switch (scope.type) {
      case 'all_private_chats':
        if (isGroup) {
          return { 
            valid: false, 
            code: CommandErrorCode.PRIVATE_CHAT_ONLY,
            error: formatErrorMessage(CommandErrorCode.PRIVATE_CHAT_ONLY)
          };
        }
        break;
      case 'all_group_chats':
        if (!isGroup) {
          return { 
            valid: false, 
            code: CommandErrorCode.GROUP_CHAT_ONLY,
            error: formatErrorMessage(CommandErrorCode.GROUP_CHAT_ONLY)
          };
        }
        break;
      case 'chat':
        if (scope.chat_id !== context.converseId) {
          return { 
            valid: false, 
            code: CommandErrorCode.SPECIFIC_CHAT_ONLY,
            error: formatErrorMessage(CommandErrorCode.SPECIFIC_CHAT_ONLY)
          };
        }
        break;
      case 'chat_member':
        if (scope.chat_id !== context.converseId || scope.user_id !== context.userId) {
          return { 
            valid: false, 
            code: CommandErrorCode.SPECIFIC_MEMBER_ONLY,
            error: formatErrorMessage(CommandErrorCode.SPECIFIC_MEMBER_ONLY)
          };
        }
        break;
    }
    
    return { valid: true };
  }
}

/**
 * 权限验证器
 */
export class PermissionValidator implements Validator {
  name = 'permission';

  async validate(command: SlashCommand, context: SlashCommandContext): Promise<ValidationResult> {
    // 检查命令权限要求
    if (command.permissions && command.permissions.length > 0) {
      const hasPermission = await this.checkUserPermissions(
        context.userId,
        command.permissions,
        context.groupId
      );
      
      if (!hasPermission) {
        return {
          valid: false,
          code: CommandErrorCode.INSUFFICIENT_PERMISSIONS,
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
          code: CommandErrorCode.GROUP_PERMISSION_REQUIRED,
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
    console.log(`Checking permissions for user ${userId}:`, requiredPermissions);
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
    console.log(`Checking group permissions for user ${userId} in group ${groupId}`);
    // TODO: 实现真正的群组权限检查逻辑
    return true;
  }
}

/**
 * 参数验证器
 */
export class ArgumentValidator implements Validator {
  name = 'argument';

  validate(command: SlashCommand, context: SlashCommandContext): ValidationResult {
    const args = context.args;

    // 检查必需参数
    if (command.requiresArgs && args.length === 0) {
      const hint = command.argsHint || '参数';
      return {
        valid: false,
        code: CommandErrorCode.MISSING_REQUIRED_ARGS,
        error: formatErrorMessage(CommandErrorCode.MISSING_REQUIRED_ARGS) + `: ${hint}`
      };
    }

    // TODO: 添加更详细的参数验证
    // - 参数类型检查
    // - 参数数量检查
    // - 参数格式验证

    return { valid: true };
  }
}

/**
 * 验证链 - 支持多个验证器的组合
 */
export class ValidationChain {
  private validators: Validator[] = [];

  /**
   * 添加验证器
   */
  addValidator(validator: Validator): ValidationChain {
    this.validators.push(validator);
    return this;
  }

  /**
   * 移除验证器
   */
  removeValidator(name: string): ValidationChain {
    this.validators = this.validators.filter(v => v.name !== name);
    return this;
  }

  /**
   * 执行验证链
   */
  async validate(command: SlashCommand, context: SlashCommandContext): Promise<ValidationResult> {
    for (const validator of this.validators) {
      const result = await validator.validate(command, context);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  }

  /**
   * 获取验证器列表
   */
  getValidators(): string[] {
    return this.validators.map(v => v.name);
  }
}

/**
 * 默认验证链工厂
 */
export function createDefaultValidationChain(): ValidationChain {
  return new ValidationChain()
    .addValidator(new VisibilityValidator())
    .addValidator(new PermissionValidator())
    .addValidator(new ArgumentValidator());
}

/**
 * 验证结果格式化
 */
export function formatValidationResult(result: ValidationResult): string {
  if (result.valid) {
    return 'Validation passed';
  }
  
  return result.error || formatErrorMessage(CommandErrorCode.EXECUTION_FAILED);
}

/**
 * 检查是否为验证错误
 */
export function isValidationError(error: any): error is ValidationResult {
  return error && typeof error === 'object' && 'valid' in error && error.valid === false;
}
