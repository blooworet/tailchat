// @ts-nocheck
import axios, { AxiosInstance } from 'axios';
const crypto = require('crypto'); // Corrected import for crypto

// 交互按钮相关类型定义
export interface InlineActionItem {
  id: string;
  type: 'command' | 'url' | 'invoke' | 'modal' | 'deeplink';
  label?: string;
  params?: Record<string, unknown>;
}

export interface InlineActionRange {
  offset: number;
  length: number;
  style?: string;
  actionId: string;
}

export interface InlineKeyboardRow {
  actions: string[];
  label?: string;
}

export interface MessageMeta {
  mentions?: string[];
  reply?: {
    _id: string;
    author: string;
    content: string;
  };
  inlineActions?: {
    actions: InlineActionItem[];
    ranges?: InlineActionRange[];
    keyboard?: InlineKeyboardRow[];
    scopes?: string[];
    signature?: string;
    analytics?: {
      traceId?: string;
    };
  };
}

// 命令范围类型定义
export type CommandScopeType = 'default' | 'all_private_chats' | 'all_group_chats' | 'chat' | 'chat_member';

export interface CommandScope {
  type: CommandScopeType;
  chat_id?: string;  // 当 type 为 'chat' 或 'chat_member' 时使用
  user_id?: string;  // 当 type 为 'chat_member' 时使用
}

// 机器人命令相关类型定义
export interface BotCommand {
  command: string;      // 命令名，最多32个字符，仅[a-z0-9_]+
  description: string;  // 命令描述，最多256个字符
  scope?: CommandScope; // 命令可见范围，可选，默认为 'default'
}

export interface BotCommandsResponse {
  appId: string;
  appName: string;
  commands: BotCommand[];
}

export interface ButtonCallbackData {
  botUserId: string;
  fromUserId: string;
  actionId: string;
  type: string;
  params: Record<string, unknown>;
  traceId?: string;
  ts: number;
  // 新增：消息上下文信息
  originalMessageId?: string;
  converseId?: string;
  groupId?: string;
}

// 消息编辑相关类型定义
export interface EditMessagePayload {
  messageId: string;
  content?: string;
  meta?: MessageMeta;
}

export interface MessageEditOptions {
  /** 是否保留原有的交互按钮 */
  keepActions?: boolean;
  /** 是否更新按钮参数中的消息ID */
  updateButtonMessageId?: boolean;
}

export interface AnswerCallbackQueryParams {
  traceId: string;
  userId: string;
  text: string;
  show_alert?: boolean;
}

export class TailchatBaseClient {
  request: AxiosInstance;
  userId: string | null = null;
  loginP: Promise<void>;
  appId: string | null = null;
  private _transformOutgoingMessage?: (payload: {
    converseId: string;
    groupId?: string;
    content: string;
    plain?: string;
    meta?: MessageMeta;
  }) => Promise<any> | any;

  constructor(
    public url: string,
    appIdOrSecret: string,
    public appSecret?: string
  ) {
    if (!url || !appIdOrSecret) {
      throw new Error(
        '错误: 缺失必要参数。请提供服务器URL和机器人令牌。'
      );
    }
    
    // 验证URL格式
    try {
      new URL(url);
    } catch (e) {
      throw new Error('错误: 无效的服务器URL格式。请检查您的URL是否正确。');
    }
    
    // 仅支持两种入参形式（最新逻辑）：
    // 1) (url, 'appId:appSecret')
    // 2) (url, appId, appSecret)
    if (typeof appSecret === 'string' && appSecret.length > 0) {
      // (url, appId, appSecret)
      this.appId = appIdOrSecret;
      this.appSecret = appSecret;
    } else if (typeof appIdOrSecret === 'string' && appIdOrSecret.includes(':')) {
      // (url, 'appId:appSecret')
      const idx = appIdOrSecret.indexOf(':');
      this.appId = appIdOrSecret.slice(0, idx);
      this.appSecret = appIdOrSecret.slice(idx + 1);
    } else {
      // 不再支持旧版仅 secret 的模式
      throw new Error('Invalid appSecret format. Use "appId:secret" or (appId, secret).');
    }

    this.request = axios.create({
      baseURL: url,
    });
    this.request.interceptors.request.use(async (val) => {
      // HTTP-only 模式统一走 Header 鉴权（新格式: appId:secret）
      const hdrs: any = val.headers || {};
      if (!this.appId || !this.appSecret) {
        throw new Error('Missing app credentials: appId/appSecret required');
      }
      const token = `${this.appId}:${this.appSecret}`;
      if (typeof hdrs.set === 'function') {
        hdrs.set('X-App-Secret', token);
      } else {
        hdrs['X-App-Secret'] = token as any;
      }
      val.headers = hdrs;
      return val;
    });
    // appId 在构造阶段已可得，正常无需额外初始化
    this.loginP = Promise.resolve();
  }

  // 无登录流程

  async waitingForLogin(): Promise<void> {
    await Promise.resolve(this.loginP);
  }

  private buildApiPath(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    // 服务器当前不支持路径令牌，统一走 Header 模式
    return `/api${p}`;
  }

  private async initAppInfo(): Promise<void> {
    // 已废弃：最新模式下构造入参即能确定 appId
    return;
  }

  async call(action: string, params = {}) {
    try {
      await this.waitingForLogin();
      
      const url = this.buildApiPath('/' + action.replace(/\./g, '/'));
      const { data } = await this.request.post(url, params);

      return data.data;
    } catch (err: any) {
      console.error('Service Call Failed:', err);
      const errorData = err?.response?.data;
      
      // 处理各种常见错误情况
      if (errorData) {
        // 权限错误
        if (errorData.code === 401 || errorData.message?.includes('JWT is expired')) {
          throw new Error(
            '错误: 认证已过期或无效。请重新创建客户端实例或检查您的凭证。'
          );
        }
        
        // 权限不足
        if (errorData.code === 403 || errorData.message?.includes('No permission')) {
          throw new Error(
            '错误: 权限不足。您没有足够的权限执行此操作。请检查您的机器人账号权限。'
          );
        }
        
        // 找不到资源
        if (errorData.code === 404 || errorData.message?.includes('Not found')) {
          throw new Error(
            `错误: 资源不存在。请检查您的请求参数。(${action})`
          );
        }
        
        // 服务端错误
        if (errorData.code >= 500) {
          throw new Error(
            `错误: 服务器内部错误。请稍后再试。(${errorData.message || '未知错误'})`
          );
        }
        
        // 其他错误
        throw new Error(
          `错误: ${errorData.message || JSON.stringify(errorData)}`
        );
      } else if ((err as any).code === 'ECONNREFUSED' || (err as any).code === 'ENOTFOUND') {
        // 网络连接问题
        throw new Error(
          '错误: 无法连接到Tailchat服务器。请检查您的网络连接和服务器地址。'
        );
      } else {
        throw err;
      }
    }
  }

  async whoami(): Promise<any> {
    // Bot whoami via AppSecret header (HTTP-only)
    const { data } = await this.request.get(this.buildApiPath('/openapi/bot/whoami'));
    return data?.data ?? data;
  }

  /**
   * 回答回调查询：仅对点击用户显示 Toast/弹窗
   */
  async answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<void> {
    if (!params || !params.traceId || !params.userId || !params.text) {
      throw new Error('answerCallbackQuery: 缺少必要参数(traceId/userId/text)');
    }
    if (params.text.length > 200) {
      throw new Error('answerCallbackQuery: 文本长度不能超过200字符');
    }
    const payload = {
      // 服务器当前要求 body 传入 appSecret，使用复合密钥
      appSecret: `${this.appId}:${this.appSecret}`,
      ...params,
    } as any;
    const { data } = await this.request.post(this.buildApiPath('/openapi/bot/answerCallbackQuery'), payload);
    if (data?.code && data.code !== 200) {
      throw new Error(data.message || 'answerCallbackQuery 调用失败');
    }
  }

  getBotToken() {
    // 只在旧版本模式下使用
    if (!this.appId || !this.appSecret) {
      return '';
    }
    
    return crypto
      .createHash('md5')
      .update(this.appId + this.appSecret)
      .digest('hex');
  }

  /**
   * Send normal message to tailchat
   */
  async sendMessage(payload: {
    converseId: string;
    groupId?: string;
    content: string;
    plain?: string;
    meta?: MessageMeta;
  }) {
    const next = this._transformOutgoingMessage
      ? await this._transformOutgoingMessage(payload)
      : payload;
    return this.call('openapi.bot.sendMessage', next);
  }

  /**
   * Reply message
   */
  async replyMessage(
    replyInfo: {
      messageId: string;
      author: string;
      content: string;
    },
    payload: {
      converseId: string;
      groupId?: string;
      content: string;
      plain?: string;
      meta?: MessageMeta;
    }
  ) {
    return this.sendMessage({
      ...payload,
      meta: {
        ...payload.meta,
        mentions: [replyInfo.author],
        reply: {
          _id: replyInfo.messageId,
          author: replyInfo.author,
          content: replyInfo.content,
        },
      },
      content: `[at=${replyInfo.author}][/at] ${payload.content}`,
    });
  }

  /**
   * 发送带交互按钮的消息
   */
  async sendMessageWithActions(payload: {
    converseId: string;
    groupId?: string;
    content: string;
    actions: InlineActionItem[];
    keyboard?: InlineKeyboardRow[];
    ranges?: InlineActionRange[];
    plain?: string;
  }) {
    const meta: MessageMeta = {
      inlineActions: {
        actions: payload.actions,
        keyboard: payload.keyboard,
        ranges: payload.ranges,
        analytics: {
          traceId: this.generateTraceId(),
        },
      },
    };

    // 如果需要签名
    if (this.shouldSignActions()) {
      meta.inlineActions!.signature = this.signActions(payload.actions);
    }

    return this.sendMessage({
      converseId: payload.converseId,
      groupId: payload.groupId,
      content: payload.content,
      plain: payload.plain,
      meta,
    });
  }

  /**
   * 创建简单的键盘按钮
   */
  createKeyboardButtons(buttons: Array<{
    id: string;
    label: string;
    type: 'command' | 'url' | 'invoke' | 'modal' | 'deeplink';
    params?: Record<string, unknown>;
  }>): { actions: InlineActionItem[]; keyboard: InlineKeyboardRow[] } {
    const actions = buttons.map(btn => ({
      id: btn.id,
      type: btn.type,
      label: btn.label,
      params: { 
        ...btn.params, 
        botId: this.userId 
      },
    }));

    const keyboard = [{
      actions: buttons.map(btn => btn.id),
    }];

    return { actions, keyboard };
  }

  /**
   * 创建命令按钮（快速回复）
   */
  createCommandButton(id: string, label: string, command: string, mode: 'replace' | 'send' = 'replace'): InlineActionItem {
    return {
      id,
      type: 'command',
      label,
      params: {
        text: command,
        mode,
        botId: this.userId,
        traceId: this.generateTraceId(),
      },
    };
  }

  /**
   * 创建URL按钮
   */
  createUrlButton(id: string, label: string, url: string): InlineActionItem {
    return {
      id,
      type: 'url',
      label,
      params: {
        url,
        botId: this.userId,
      },
    };
  }

  /**
   * 创建调用按钮（机器人回调）
   */
  createInvokeButton(id: string, label: string, params: Record<string, unknown> = {}): InlineActionItem {
    return {
      id,
      type: 'invoke',
      label,
      params: {
        ...params,
        botId: this.userId,
        traceId: this.generateTraceId(),
      },
    };
  }

  /**
   * 创建模态确认按钮
   */
  createModalButton(id: string, label: string, title: string, content: string, params: Record<string, unknown> = {}): InlineActionItem {
    return {
      id,
      type: 'modal',
      label,
      params: {
        title,
        content,
        ...params,
        botId: this.userId,
        traceId: this.generateTraceId(),
      },
    };
  }

  /**
   * 发送带键盘的快速回复消息
   */
  async sendQuickReplyMessage(payload: {
    converseId: string;
    groupId?: string;
    content: string;
    buttons: Array<{
      id: string;
      label: string;
      type: 'command' | 'url' | 'invoke';
      params?: Record<string, unknown>;
    }>;
  }) {
    const { actions, keyboard } = this.createKeyboardButtons(payload.buttons);
    
    return this.sendMessageWithActions({
      converseId: payload.converseId,
      groupId: payload.groupId,
      content: payload.content,
      actions,
      keyboard,
    });
  }

  /**
   * 编辑消息
   */
  async editMessage(payload: EditMessagePayload) {
    return this.call('openapi.bot.editMessage', payload);
  }

  /**
   * 编辑带交互按钮的消息
   */
  async editMessageWithActions(payload: {
    messageId: string;
    content?: string;
    actions?: InlineActionItem[];
    keyboard?: InlineKeyboardRow[];
    ranges?: InlineActionRange[];
    options?: MessageEditOptions;
  }) {
    const { messageId, content, actions, keyboard, ranges, options = {} } = payload;
    
    let meta: MessageMeta | undefined;
    
    if (actions || keyboard || ranges) {
      meta = {
        inlineActions: {
          actions: actions || [],
          keyboard: keyboard,
          ranges: ranges,
          analytics: {
            traceId: this.generateTraceId(),
          },
        },
      };

      // 如果需要更新按钮参数中的消息ID
      if (options.updateButtonMessageId && actions) {
        meta.inlineActions!.actions = actions.map(action => ({
          ...action,
          params: {
            ...action.params,
            _messageId: messageId,
          },
        }));
      }

      // 如果需要签名
      if (this.shouldSignActions()) {
        meta.inlineActions!.signature = this.signActions(meta.inlineActions!.actions);
      }
    }

    return this.editMessage({
      messageId,
      content,
      meta,
    });
  }

  /**
   * 仅更新消息按钮（不修改文本内容）
   */
  async updateMessageButtons(payload: {
    messageId: string;
    actions: InlineActionItem[];
    keyboard?: InlineKeyboardRow[];
    ranges?: InlineActionRange[];
    options?: MessageEditOptions;
  }) {
    return this.editMessageWithActions({
      messageId: payload.messageId,
      actions: payload.actions,
      keyboard: payload.keyboard,
      ranges: payload.ranges,
      options: payload.options,
    });
  }

  /**
   * 处理按钮回调（需要配合 WebSocket 或 webhook）
   * 注意：这个方法需要在实际项目中根据具体的事件监听机制来实现
   */
  onButtonCallback(callback: (data: ButtonCallbackData) => void) {
    // TODO: 这里需要实现 WebSocket 监听或 webhook 处理
    // 监听 'bot.inline.invoke' 事件
    console.warn('onButtonCallback: 此方法需要配合 WebSocket 或 webhook 来实现事件监听');
    
    // 示例实现（需要根据实际情况调整):
    // this.socket?.on('bot.inline.invoke', callback);
  }

  /**
   * 生成追踪ID
   */
  private generateTraceId(): string {
    return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 判断是否需要签名
   */
  private shouldSignActions(): boolean {
    // 启用签名验证以符合后端要求
    return true;
  }

  /**
   * 对动作进行签名
   */
  private signActions(actions: InlineActionItem[]): string {
    if (!this.appSecret) {
      throw new Error('需要 appSecret 来生成签名');
    }
    
    const data = JSON.stringify(actions);
    return crypto.createHmac('sha256', this.appSecret).update(data).digest('hex');
  }

  // ==================== 命令管理 API ====================

  /**
   * 注册机器人命令列表
   * @param commands 要注册的命令列表
   */
  async registerCommands(commands: BotCommand[]): Promise<void> {
    await this.loginP;
    
    // 验证命令格式
    for (const command of commands) {
      if (!command.command || !command.description) {
        throw new Error(`命令格式错误: 命令名和描述是必填项`);
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
      
      // 验证scope字段（如果存在）
      if (command.scope) {
        const validScopeTypes: CommandScopeType[] = ['default', 'all_private_chats', 'all_group_chats', 'chat', 'chat_member'];
        if (!validScopeTypes.includes(command.scope.type)) {
          throw new Error(`无效的范围类型: ${command.scope.type}`);
        }
        
        // 验证条件字段
        if (command.scope.type === 'chat' || command.scope.type === 'chat_member') {
          if (!command.scope.chat_id) {
            throw new Error(`范围类型 "${command.scope.type}" 需要提供 chat_id`);
          }
        }
        
        if (command.scope.type === 'chat_member') {
          if (!command.scope.user_id) {
            throw new Error(`范围类型 "chat_member" 需要提供 user_id`);
          }
        }
      }
    }
    
    // 检查命令名唯一性
    const commandNames = commands.map(cmd => cmd.command);
    const uniqueNames = new Set(commandNames);
    if (commandNames.length !== uniqueNames.size) {
      throw new Error('命令名必须唯一');
    }
    
    // 限制命令数量
    if (commands.length > 50) {
      throw new Error('最多只能注册50个命令');
    }

    const requestPayload = {
      // 不再传递 appSecret 到 body，由 Header 处理鉴权
      fieldName: 'commands',
      fieldValue: commands,
    } as any;
    
    const { data } = await this.request.post(this.buildApiPath('/openapi/app/setAppBotInfo'), requestPayload);

    // 检查响应状态：Moleculer 返回 {code: 200} 表示成功
    // setAppBotInfo 返回 undefined，所以只检查 code
    if (data.code !== 200) {
      throw new Error(data.message || '注册命令失败');
    }
  }

  /**
   * 更新机器人命令列表
   * @param commands 要更新的命令列表
   */
  async updateCommands(commands: BotCommand[]): Promise<void> {
    // updateCommands 和 registerCommands 使用相同的逻辑
    return this.registerCommands(commands);
  }

  /**
   * 获取当前注册的命令列表
   * @returns 当前注册的命令列表
   */
  async getRegisteredCommands(): Promise<BotCommand[]> {
    await this.loginP;

    const { data } = await this.request.post(this.buildApiPath('/openapi/app/getBotCommands'), {
      appId: this.appId,
    });

    // 检查响应状态：Moleculer 返回 {code: 200, data: ...} 表示成功
    if (data.code !== 200) {
      throw new Error(data.message || '获取命令列表失败');
    }

    // getBotCommands 返回 { appId, appName, commands }
    return data.data?.commands || [];
  }

  /**
   * 清空所有注册的命令
   */
  async clearCommands(): Promise<void> {
    await this.registerCommands([]);
  }

  /**
   * 添加单个命令
   * @param command 要添加的命令
   */
  async addCommand(command: BotCommand): Promise<void> {
    const existingCommands = await this.getRegisteredCommands();
    
    // 检查命令是否已存在
    const existingCommand = existingCommands.find(cmd => cmd.command === command.command);
    if (existingCommand) {
      throw new Error(`命令 "${command.command}" 已存在，请使用 updateCommand 方法更新`);
    }
    
    const newCommands = [...existingCommands, command];
    await this.registerCommands(newCommands);
  }

  /**
   * 更新单个命令
   * @param commandName 要更新的命令名
   * @param command 新的命令配置
   */
  async updateCommand(commandName: string, command: BotCommand): Promise<void> {
    const existingCommands = await this.getRegisteredCommands();
    
    const commandIndex = existingCommands.findIndex(cmd => cmd.command === commandName);
    if (commandIndex === -1) {
      throw new Error(`命令 "${commandName}" 不存在，请使用 addCommand 方法添加`);
    }
    
    existingCommands[commandIndex] = command;
    await this.registerCommands(existingCommands);
  }

  /**
   * 删除单个命令
   * @param commandName 要删除的命令名
   */
  async removeCommand(commandName: string): Promise<void> {
    const existingCommands = await this.getRegisteredCommands();
    
    const filteredCommands = existingCommands.filter(cmd => cmd.command !== commandName);
    if (filteredCommands.length === existingCommands.length) {
      throw new Error(`命令 "${commandName}" 不存在`);
    }
    
    await this.registerCommands(filteredCommands);
  }

  /**
   * 批量操作：设置机器人的完整命令配置
   * @param config 命令配置对象，包含常用命令的快捷设置
   */
  async setCommandConfig(config: {
    help?: { description?: string };
    start?: { description?: string };
    settings?: { description?: string };
    custom?: BotCommand[];
  }): Promise<void> {
    const commands: BotCommand[] = [];
    
    // 添加标准命令
    if (config.help) {
      commands.push({
        command: 'help',
        description: config.help.description || '显示帮助信息'
      });
    }
    
    if (config.start) {
      commands.push({
        command: 'start',
        description: config.start.description || '开始使用机器人'
      });
    }
    
    if (config.settings) {
      commands.push({
        command: 'settings',
        description: config.settings.description || '机器人设置'
      });
    }
    
    // 添加自定义命令
    if (config.custom) {
      commands.push(...config.custom);
    }
    
    await this.registerCommands(commands);
  }

  /**
   * 按范围获取机器人命令列表
   * @param scopeType 范围类型
   * @param chatId 聊天ID（当scopeType为chat或chat_member时需要）
   * @param userId 用户ID（当scopeType为chat_member时需要）
   * @returns 指定范围的命令列表
   */
  async getCommandsByScope(scopeType: CommandScopeType, chatId?: string, userId?: string): Promise<BotCommand[]> {
    await this.loginP;

    const requestData: any = {
      appId: this.appId,
      scopeType
    };

    if (chatId) {
      requestData.chatId = chatId;
    }

    if (userId) {
      requestData.userId = userId;
    }

    const { data } = await this.request.post(this.buildApiPath('/openapi/app/getBotCommandsByScope'), requestData);

    // 检查响应状态：Moleculer 返回 {code: 200, data: ...} 表示成功
    if (data.code !== 200) {
      throw new Error(data.message || '获取范围命令列表失败');
    }

    // getBotCommandsByScope 返回 { appId, appName, scopeType, commands }
    return data.data?.commands || [];
  }

  /**
   * 设置单个命令的范围
   * @param commandName 要更新的命令名
   * @param scope 新的范围配置
   */
  async setCommandScope(commandName: string, scope: CommandScope): Promise<void> {
    const existingCommands = await this.getRegisteredCommands();
    
    const commandIndex = existingCommands.findIndex(cmd => cmd.command === commandName);
    if (commandIndex === -1) {
      throw new Error(`命令 "${commandName}" 不存在`);
    }
    
    existingCommands[commandIndex].scope = scope;
    await this.registerCommands(existingCommands);
  }

  /**
   * 清除指定范围的所有命令
   * @param scopeType 要清除的范围类型
   * @param chatId 聊天ID（当scopeType为chat或chat_member时需要）
   * @param userId 用户ID（当scopeType为chat_member时需要）
   */
  async clearCommandsInScope(scopeType: CommandScopeType, chatId?: string, userId?: string): Promise<void> {
    const existingCommands = await this.getRegisteredCommands();
    
    const filteredCommands = existingCommands.filter(cmd => {
      const cmdScope = cmd.scope?.type || 'default';
      
      if (cmdScope !== scopeType) {
        return true; // 保留不同范围的命令
      }
      
      // 对于特定聊天或成员的范围，需要匹配ID
      if (scopeType === 'chat' || scopeType === 'chat_member') {
        if (cmd.scope?.chat_id !== chatId) {
          return true; // 保留不同聊天的命令
        }
      }
      
      if (scopeType === 'chat_member') {
        if (cmd.scope?.user_id !== userId) {
          return true; // 保留不同用户的命令
        }
      }
      
      return false; // 移除匹配的命令
    });
    
    await this.registerCommands(filteredCommands);
  }

  /**
   * 便捷方法：设置私聊命令
   * @param commands 私聊命令列表
   */
  async setPrivateCommands(commands: Omit<BotCommand, 'scope'>[]): Promise<void> {
    const privateCommands: BotCommand[] = commands.map(cmd => ({
      ...cmd,
      scope: { type: 'all_private_chats' }
    }));
    
    // 获取现有命令，移除所有私聊命令，然后添加新的私聊命令
    const existingCommands = await this.getRegisteredCommands();
    const nonPrivateCommands = existingCommands.filter(cmd => 
      (cmd.scope?.type || 'default') !== 'all_private_chats'
    );
    
    const allCommands = [...nonPrivateCommands, ...privateCommands];
    await this.registerCommands(allCommands);
  }

  /**
   * 便捷方法：设置群组命令
   * @param commands 群组命令列表
   */
  async setGroupCommands(commands: Omit<BotCommand, 'scope'>[]): Promise<void> {
    const groupCommands: BotCommand[] = commands.map(cmd => ({
      ...cmd,
      scope: { type: 'all_group_chats' }
    }));
    
    // 获取现有命令，移除所有群组命令，然后添加新的群组命令
    const existingCommands = await this.getRegisteredCommands();
    const nonGroupCommands = existingCommands.filter(cmd => 
      (cmd.scope?.type || 'default') !== 'all_group_chats'
    );
    
    const allCommands = [...nonGroupCommands, ...groupCommands];
    await this.registerCommands(allCommands);
  }

  /**
   * 便捷方法：设置默认命令（全局可见）
   * @param commands 默认命令列表
   */
  async setDefaultCommands(commands: Omit<BotCommand, 'scope'>[]): Promise<void> {
    const defaultCommands: BotCommand[] = commands.map(cmd => ({
      ...cmd,
      scope: { type: 'default' }
    }));
    
    // 获取现有命令，移除所有默认命令，然后添加新的默认命令
    const existingCommands = await this.getRegisteredCommands();
    const nonDefaultCommands = existingCommands.filter(cmd => 
      (cmd.scope?.type || 'default') !== 'default'
    );
    
    const allCommands = [...nonDefaultCommands, ...defaultCommands];
    await this.registerCommands(allCommands);
  }
}

export interface TailchatMessageTransformer {
  (payload: {
    converseId: string;
    groupId?: string;
    content: string;
    plain?: string;
    meta?: MessageMeta;
  }): Promise<any> | any;
}

export interface TailchatBaseClient {
  /**
   * 设置消息发送前的可选转换器（例如加密）
   */
  setMessageTransformer(transformer?: TailchatMessageTransformer): void;
}

// 以声明合并方式为类注入实现
(TailchatBaseClient as any).prototype.setMessageTransformer = function (
  this: any,
  transformer?: (payload: any) => any
) {
  this._transformOutgoingMessage = transformer;
};
