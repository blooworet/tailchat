/**
 * 机器人命令定义模块
 * 
 * 定义机器人支持的所有命令及其配置
 */

/**
 * 命令定义
 * @typedef {Object} BotCommand
 * @property {string} command - 命令名（仅小写字母、数字和下划线，最多32字符）
 * @property {string} description - 命令描述（最多256字符）
 * @property {Object} [scope] - 命令可见范围
 * @property {string} scope.type - 范围类型：default, all_private_chats, all_group_chats, chat, chat_member
 * @property {string} [scope.chat_id] - 特定聊天ID（当type为chat或chat_member时）
 * @property {string} [scope.user_id] - 特定用户ID（当type为chat_member时）
 */

/**
 * 机器人支持的命令列表
 */
const COMMANDS = [
  {
    command: 'build',
    description: '🎨 生成带文字的精美图片 - 用法: /build <文本>',
    scope: { type: 'default' }  // 所有会话可见
  },
  {
    command: 'help',
    description: '❓ 显示帮助信息',
    scope: { type: 'default' }
  }
];

/**
 * 获取所有命令定义
 * @returns {BotCommand[]}
 */
function getAllCommands() {
  return COMMANDS;
}

/**
 * 获取默认命令（全局可见）
 * @returns {BotCommand[]}
 */
function getDefaultCommands() {
  return COMMANDS.filter(cmd => !cmd.scope || cmd.scope.type === 'default');
}

/**
 * 获取私聊命令
 * @returns {BotCommand[]}
 */
function getPrivateCommands() {
  return COMMANDS.filter(cmd => 
    cmd.scope?.type === 'all_private_chats' || cmd.scope?.type === 'default'
  );
}

/**
 * 获取群组命令
 * @returns {BotCommand[]}
 */
function getGroupCommands() {
  return COMMANDS.filter(cmd => 
    cmd.scope?.type === 'all_group_chats' || cmd.scope?.type === 'default'
  );
}

/**
 * 根据命令名查找命令
 * @param {string} commandName - 命令名（不含 / 前缀）
 * @returns {BotCommand|undefined}
 */
function findCommand(commandName) {
  return COMMANDS.find(cmd => cmd.command === commandName);
}

/**
 * 验证命令格式
 * @param {BotCommand} command - 命令对象
 * @returns {boolean} 是否有效
 * @throws {Error} 格式错误时抛出异常
 */
function validateCommand(command) {
  // 检查必填字段
  if (!command.command || !command.description) {
    throw new Error('命令名和描述是必填项');
  }
  
  // 验证命令名格式
  if (!/^[a-z0-9_]+$/.test(command.command)) {
    throw new Error(`命令名格式错误: ${command.command}，只能包含小写字母、数字和下划线`);
  }
  
  // 验证命令名长度
  if (command.command.length > 32) {
    throw new Error(`命令名过长: ${command.command}，最多32个字符`);
  }
  
  // 验证描述长度
  if (command.description.length > 256) {
    throw new Error(`命令描述过长，最多256个字符`);
  }
  
  // 验证scope（如果存在）
  if (command.scope) {
    const validScopeTypes = ['default', 'all_private_chats', 'all_group_chats', 'chat', 'chat_member'];
    if (!validScopeTypes.includes(command.scope.type)) {
      throw new Error(`无效的范围类型: ${command.scope.type}`);
    }
    
    // 验证条件字段
    if (command.scope.type === 'chat' || command.scope.type === 'chat_member') {
      if (!command.scope.chat_id) {
        throw new Error(`范围类型 "${command.scope.type}" 需要提供 chat_id`);
      }
    }
    
    if (command.scope.type === 'chat_member' && !command.scope.user_id) {
      throw new Error(`范围类型 "chat_member" 需要提供 user_id`);
    }
  }
  
  return true;
}

module.exports = {
  COMMANDS,
  getAllCommands,
  getDefaultCommands,
  getPrivateCommands,
  getGroupCommands,
  findCommand,
  validateCommand,
};

