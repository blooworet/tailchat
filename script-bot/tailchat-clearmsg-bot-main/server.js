const Koa = require('koa');
const Router = require('koa-router');
const app = new Koa();
const router = new Router();
const { TailchatHTTPClient } = require('tailchat-client-sdk');

const bodyParser = require('koa-bodyparser');
const { clearmsg, clearUserMessages, getUserMessageStats, getUserMessageList } = require('./clear');
app.use(bodyParser());
const dotenv = require('dotenv');
dotenv.config();

// 存储用户会话状态
const userSessions = new Map();

const host = process.env.host;
const appId = process.env.appId;
const appSecret = process.env.appSecret;
const masters = process.env.master ? process.env.master.split('|') : [];
const listen_port = process.env.listen_port;

if(!host || !appId || !appSecret || !masters || masters.length === 0 || !listen_port){
    console.error('❌ 错误：请设置环境变量 host, appId, appSecret, master, listen_port');
    console.error('   - host: Tailchat服务器地址');
    console.error('   - appId: 应用ID');
    console.error('   - appSecret: 应用密钥');
    console.error('   - master: 管理员用户名（多个用"|"分隔）');
    console.error('   - listen_port: 本服务监听端口');
    process.exit(1);
}

console.log('📋 增强版清理机器人配置:');
console.log(`   - 服务器地址: ${host}`);
console.log(`   - 应用ID: ${appId}`);
console.log(`   - 监听端口: ${listen_port}`);
console.log(`   - 管理员数量: ${masters.length}`);
console.log('   - 新功能: 动态消息更新、分页显示、交互按钮');

// 使用 HTTP 客户端：只传 appSecret（保持 Header 模式，兼容当前服务端）
const client = new TailchatHTTPClient(host, appSecret);

// 兼容旧 WS 接口：提供几个空实现，避免后续代码报错
if (typeof client.onConnectionStateChange !== 'function') client.onConnectionStateChange = function () {};
if (typeof client.onConnected !== 'function') client.onConnected = function () {};
if (typeof client.onDisconnected !== 'function') client.onDisconnected = function () {};
if (typeof client.onConnectionFailed !== 'function') client.onConnectionFailed = function () {};
if (typeof client.isConnected !== 'function') client.isConnected = function () { return true; };
if (typeof client.canReconnect !== 'function') client.canReconnect = function () { return false; };
if (typeof client.connect !== 'function') client.connect = async function () {};
if (typeof client.disconnect !== 'function') client.disconnect = function () {};
if (typeof client.removeAllConnectionListeners !== 'function') client.removeAllConnectionListeners = function () {};

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ==================== 重连管理 ====================

// 重连配置
const RECONNECT_CONFIG = {
  maxRetries: 10,           // 最大重试次数
  initialDelay: 1000,       // 初始延迟1秒
  maxDelay: 30000,          // 最大延迟30秒
  backoffFactor: 2,         // 退避因子
  retryOnFailure: true      // 连接失败时是否重试
};

let reconnectAttempts = 0;
let reconnectTimer = null;
let isReconnecting = false;
let isShuttingDown = false;

// 会话管理参数
const EXPIRE_MS = 10 * 60 * 1000; // 10分钟过期
const MAX_SESSIONS = 5000; // 会话上限，防止极端情况下无限增长
let sessionCleanupTimer = null;

/**
 * 计算下次重连延迟时间（指数退避）
 */
function calculateReconnectDelay(attempt) {
  const delay = Math.min(
    RECONNECT_CONFIG.initialDelay * Math.pow(RECONNECT_CONFIG.backoffFactor, attempt - 1),
    RECONNECT_CONFIG.maxDelay
  );
  // 添加随机抖动避免所有客户端同时重连
  return delay + Math.random() * 1000;
}

/**
 * 执行重连
 */
async function attemptReconnect() {
  if (isShuttingDown) {
    console.log('🛑 应用正在关闭，跳过重连');
    return;
  }

  // 避免并发重连 & 清理遗留定时器
  if (isReconnecting) {
    return;
  }
  isReconnecting = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (reconnectAttempts >= RECONNECT_CONFIG.maxRetries) {
    console.error(`❌ 已达到最大重连次数 (${RECONNECT_CONFIG.maxRetries})，停止重连`);
    return;
  }

  // 已连接或不允许重连时直接跳过（避免连接中被旧定时器触发的二次重连）
  if (client.isConnected() || !client.canReconnect()) {
    console.log('⚠️ 当前不能重连，跳过');
    return;
  }

  reconnectAttempts++;
  console.log(`🔄 尝试重连 (${reconnectAttempts}/${RECONNECT_CONFIG.maxRetries})...`);

  try {
    await client.reconnect();
    console.log('✅ 重连成功！');
    reconnectAttempts = 0; // 重置重连计数
    isReconnecting = false;
    
    // 重新注册命令和设置事件监听
    await setupAfterConnection();
    
  } catch (error) {
    console.error(`❌ 重连失败:`, error.message);
    
    // 计算下次重连延迟
    const delay = calculateReconnectDelay(reconnectAttempts);
    console.log(`⏰ ${delay}ms 后进行下次重连...`);
    
    // 设置下次重连
    reconnectTimer = setTimeout(attemptReconnect, delay);
    isReconnecting = false;
  }
}

/**
 * 连接建立后的设置
 */
async function setupAfterConnection() {
  try {
    // HTTP-only: 通过开放平台接口获取当前机器人身份
    const me = await client.call('openapi.bot.whoami');
    if (me && (me._id || me.userId)) {
      client.userId = String(me._id || me.userId);
    }
  } catch (e) {
    console.warn('获取自身信息失败:', e?.message || e);
  }

  console.log('🔍 登录后状态:');
  console.log('   - appId:', client.appId);
  console.log('   - userId:', client.userId);

  // 确保 appId 被设置（若未自动设置）
  if (!client.appId) {
    console.log('⚠️ SDK 未自动设置 appId，手动设置...');
    client.appId = appId;
  }

  await registerBotCommands();
}

// 已移除 WS 事件监听（HTTP-only 模式无需）

// 优雅关闭处理
process.on('SIGINT', async () => {
  console.log('\n🛑 接收到关闭信号，开始优雅关闭...');
  isShuttingDown = true;
  
  // 清除重连定时器
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // 清除会话清理定时器
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
  
  // 断开WebSocket连接
  if (client.isConnected()) {
    console.log('🔌 断开WebSocket连接...');
    client.disconnect();
  }
  
  // 清理事件监听器
  client.removeAllConnectionListeners();
  
  console.log('✅ 优雅关闭完成');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 接收到终止信号，开始优雅关闭...');
  isShuttingDown = true;
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
  
  if (client.isConnected()) {
    client.disconnect();
  }
  
  client.removeAllConnectionListeners();
  process.exit(0);
});

// 注册机器人命令（仅限私聊）
async function registerBotCommands() {
    try {
        console.log('🔧 正在注册机器人命令...');
        console.log('🔍 调试信息:');
        console.log('   - appId:', client.appId);
        console.log('   - userId:', client.userId);
        console.log('   - jwt存在:', !!client.jwt);
        
        // ✅ 使用 default scope，命令在所有场景（私聊和群聊）都可用
        const allCommands = [
            {
                command: 'start',
                description: '开始使用清理机器人 - 查看帮助信息',
                scope: { type: 'default' }
            },
            {
                command: 'help',
                description: '显示帮助信息和使用说明',
                scope: { type: 'default' }
            },
            {
                command: 'clear',
                description: '清理消息 - 管理员清理所有，用户清理自己的',
                scope: { type: 'default' }
            },
            {
                command: 'stats',
                description: '查看自己的消息统计信息',
                scope: { type: 'default' }
            },
            {
                command: 'list',
                description: '查看自己的消息列表（分页显示）',
                scope: { type: 'default' }
            }
        ];
        
        await client.registerCommands(allCommands);
        
        console.log('✅ 机器人命令注册成功！');
        console.log('📋 已注册的命令（全部范围 - 私聊和群聊）:');
        console.log('   /start - 开始使用清理机器人');
        console.log('   /help - 显示帮助信息');
        console.log('   /clear - 清理消息');
        console.log('   /stats - 查看消息统计');
        console.log('   /list - 查看消息列表');
        
    } catch (error) {
        console.error('❌ 注册机器人命令失败:', error.message);
        console.error('🔍 错误详情:', error.response?.data || error);
        
        // 如果是 422 错误，可能是机器人没有启用 bot 能力
        if (error.response?.status === 422) {
            console.error('💡 可能的解决方案:');
            console.error('   1. 确保机器人已启用 bot 能力');
            console.error('   2. 检查 appSecret 是否正确');
            console.error('   3. 确保服务器支持机器人命令功能');
        }
    }
}

// 设置内联按钮回调监听器
function setupEventListeners() {
  // // 监听内联按钮回调 (WS 事件)
  // client.on('bot.inline.invoke', async (data) => {
  //   try {
  //     console.log('\n' + '='.repeat(80));
  //     console.log('🔘 [WS] 收到 bot.inline.invoke');
  //     console.log(JSON.stringify(data, null, 2));
  //     const {
  //       fromUserId: messageAuthor,
  //       converseId,
  //       groupId,
  //       originalMessageId,
  //       traceId,
  //       params = {}
  //     } = data || {};

  //     const { action, username, page, sessionId } = params;
  //     if (!action) return;

  //     // 验证会话
  //     const session = userSessions.get(sessionId);
  //     if (!session) {
  //       await client.editMessage({
  //         messageId: originalMessageId,
  //         content: '❌ 会话已过期，请重新发起请求',
  //       });
  //       return;
  //     }

  //     // 权限校验：仅允许会话发起者操作
  //     if (session.username !== messageAuthor) {
  //       await client.answerCallbackQuery({
  //         traceId,
  //         userId: messageAuthor,
  //         text: '❌ 您只能操作自己的消息',
  //         show_alert: true,
  //       });
  //       return;
  //     }

  //     switch (action) {
  //       case 'prev_page':
  //       case 'next_page':
  //         await updateMessageListPage(sessionId, page);
  //         break;
  //       case 'confirm_delete': {
  //         await client.answerCallbackQuery({ traceId, userId: messageAuthor, text: '⏳ 开始删除，请稍候...', show_alert: false });
  //         await client.editMessage({ messageId: session.messageId, content: '⏳ 正在删除您的消息，请稍候...\n\n🔄 这可能需要几分钟时间' });
  //         const result = await clearUserMessages(username);
  //         await client.editMessage({
  //           messageId: session.messageId,
  //           content: `✅ 删除操作完成！\n\n📊 结果: ${result}`,
  //           meta: { inlineActions: null },
  //         });
  //         userSessions.delete(sessionId);
  //         break;
  //       }
  //       case 'cancel':
  //         await client.answerCallbackQuery({ traceId, userId: messageAuthor, text: '✅ 操作已取消', show_alert: false });
  //         await client.editMessage({
  //           messageId: session.messageId,
  //           content: '✅ 操作已取消\n\n💡 如需重新查看消息，请再次 @机器人',
  //           meta: { inlineActions: null },
  //         });
  //         userSessions.delete(sessionId);
  //         break;
  //       default:
  //         console.log(`❓ 未知动作: ${action}`);
  //     }
  //   } catch (err) {
  //     console.error('❌ 处理 inline.invoke 出错:', err);
  //   }
  // });
}

// 启动应用
async function startApplication() {
  console.log('🚀 启动清理机器人应用...');
  
  // 设置事件监听器
  setupEventListeners();
  
  try {
    // HTTP-only：无需显式连接，直接进行初始化设置
    await setupAfterConnection();
  } catch (error) {
    console.error('❌ 初始化失败:', error?.message || error);
  }
}

// 启动应用
startApplication();

// 清理过期的用户会话（10分钟过期）
sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const expireTime = EXPIRE_MS; // 10分钟
  
  for (const [key, session] of userSessions.entries()) {
    if (now - session.timestamp > expireTime) {
      userSessions.delete(key);
    }
  }
}, 60 * 1000); // 每分钟清理一次

/**
 * 格式化消息列表显示
 */
function formatMessageList(messageData, page) {
    const { username, nickname, messages, pagination } = messageData;
    
    let content = `📋 **${nickname || username}** 的消息列表\n\n`;
    content += `📊 **统计信息**\n`;
    content += `• 总消息数: ${pagination.totalMessages}\n`;
    content += `• 当前页: ${pagination.currentPage}/${pagination.totalPages}\n`;
    content += `• 每页显示: ${pagination.pageSize} 条\n\n`;
    
    if (messages.length === 0) {
        content += `📭 第 ${page} 页没有消息\n`;
    } else {
        content += `📝 **第 ${page} 页消息** (${messages.length} 条):\n\n`;
        
        messages.forEach((msg, index) => {
            const msgNumber = (page - 1) * pagination.pageSize + index + 1;
            const date = new Date(msg.createdAt).toLocaleString('zh-CN');
            content += `${msgNumber}. ${msg.shortContent}\n`;
            content += `   🕒 ${date}\n\n`;
        });
    }
    
    return content;
}

/**
 * 创建分页按钮
 */
function createPaginationButtons(username, pagination, sessionId) {
    const buttons = [];
    
    // 上一页按钮
    if (pagination.hasPrevPage) {
        buttons.push(
            client.createInvokeButton(
                'prev_page', 
                '上一页', 
                { 
                    action: 'prev_page', 
                    username, 
                    page: pagination.currentPage - 1,
                    sessionId,
                    priority: 'secondary'
                }
            )
        );
    }
    
    // 下一页按钮
    if (pagination.hasNextPage) {
        buttons.push(
            client.createInvokeButton(
                'next_page', 
                '下一页', 
                { 
                    action: 'next_page', 
                    username, 
                    page: pagination.currentPage + 1,
                    sessionId,
                    priority: 'secondary'
                }
            )
        );
    }
    
    // 确认删除按钮
    buttons.push(
        client.createInvokeButton(
            'confirm_delete', 
            '确认删除全部', 
            { 
                action: 'confirm_delete', 
                username,
                sessionId,
                priority: 'danger'
            }
        )
    );
    
    // 取消按钮
    buttons.push(
        client.createInvokeButton(
            'cancel', 
            '取消', 
            { 
                action: 'cancel', 
                username,
                sessionId,
                priority: 'secondary'
            }
        )
    );
    
    return buttons;
}

/**
 * 显示用户消息列表（分页）
 */
async function showUserMessageList(messageAuthor, converseId, groupId, messageId, page = 1) {
    try {
        console.log(`📋 显示用户 ${messageAuthor} 的消息列表，第 ${page} 页`);
        
        // 获取用户消息列表
        const messageListResult = await getUserMessageList(messageAuthor, page, 5); // 每页5条
        
        if (!messageListResult.success) {
            await client.replyMessage({
                messageId,
                author: messageAuthor,
                content: ''
            }, {
                groupId,
                converseId,
                content: messageListResult.message,
            });
            return null;
        }
        
        // 创建会话ID
        const sessionId = `${messageAuthor}_${Date.now()}`;

        // 超限淘汰最旧会话，防止极端情况下无限增长
        if (userSessions.size >= MAX_SESSIONS) {
            let oldestKey = null;
            let oldestTs = Infinity;
            for (const [k, v] of userSessions.entries()) {
                if (v && typeof v.timestamp === 'number' && v.timestamp < oldestTs) {
                    oldestTs = v.timestamp;
                    oldestKey = k;
                }
            }
            if (oldestKey) userSessions.delete(oldestKey);
        }

        // 存储用户会话
        userSessions.set(sessionId, {
            username: messageAuthor,
            converseId,
            groupId,
            messageData: messageListResult,
            timestamp: Date.now()
        });
        
        // 格式化消息内容
        const content = formatMessageList(messageListResult, page);
        
        // 创建分页按钮
        const buttons = createPaginationButtons(messageAuthor, messageListResult.pagination, sessionId);
        
        // 创建键盘布局
        const keyboard = [];
        if (buttons.length > 0) {
            // 将按钮分行显示：导航按钮一行，操作按钮一行
            const navButtons = buttons.filter(btn => 
                btn.id === 'prev_page' || btn.id === 'next_page'
            );
            const actionButtons = buttons.filter(btn => 
                btn.id === 'confirm_delete' || btn.id === 'cancel'
            );
            
            if (navButtons.length > 0) {
                keyboard.push({ actions: navButtons.map(btn => btn.id) });
            }
            if (actionButtons.length > 0) {
                keyboard.push({ actions: actionButtons.map(btn => btn.id) });
            }
        }
        
        // 调试信息：打印按钮数据
        console.log('🔍 调试信息 - 发送的按钮数据:');
        console.log('   buttons:', JSON.stringify(buttons, null, 2));
        console.log('   keyboard:', JSON.stringify(keyboard, null, 2));
        console.log('   client.userId:', client.userId);
        
        // 发送带按钮的消息
        const sentMessage = await client.sendMessageWithActions({
            converseId,
            groupId,
            content,
            actions: buttons,
            keyboard: keyboard
        });
        
        console.log(`✅ 消息列表已发送，消息ID: ${sentMessage._id || sentMessage.id}, 会话ID: ${sessionId}`);
        console.log('🔍 调试信息 - 返回的消息对象:', JSON.stringify(sentMessage, null, 2));
        
        // 更新会话中的消息ID
        const session = userSessions.get(sessionId);
        if (session) {
            session.messageId = sentMessage._id || sentMessage.id;
            userSessions.set(sessionId, session);
        }
        
        return sentMessage._id || sentMessage.id;
        
    } catch (error) {
        console.error('❌ 显示消息列表失败:', error);
        await client.replyMessage({
            messageId,
            author: messageAuthor,
            content: ''
        }, {
            groupId,
            converseId,
            content: `❌ 获取消息列表失败: ${error.message}`,
        });
        return null;
    }
}

/**
 * 更新消息列表页面
 */
async function updateMessageListPage(sessionId, newPage) {
  const session = userSessions.get(sessionId);
  if (!session) {
    console.error(`❌ 会话 ${sessionId} 不存在或已过期`);
    return false;
  }
  // 二次校验过期
  if (Date.now() - session.timestamp > EXPIRE_MS) {
    console.error(`❌ 会话 ${sessionId} 已过期`);
    userSessions.delete(sessionId);
    return false;
  }
  try {
    console.log(`🔄 更新消息列表到第 ${newPage} 页，会话: ${sessionId}`);
    
    // 获取新页面的消息列表
    const messageListResult = await getUserMessageList(session.username, newPage, 5);
    
    if (!messageListResult.success) {
      console.error(`❌ 获取第 ${newPage} 页失败:`, messageListResult.message);
      return false;
    }
    
    // 更新会话数据
    session.messageData = messageListResult;
    session.timestamp = Date.now();
    userSessions.set(sessionId, session);
    
    // 格式化新的消息内容
    const content = formatMessageList(messageListResult, newPage);
    
    // 创建新的分页按钮
    const buttons = createPaginationButtons(session.username, messageListResult.pagination, sessionId);
    
    // 创建键盘布局
    const keyboard = [];
    if (buttons.length > 0) {
      // 将按钮分行显示：导航按钮一行，操作按钮一行
      const navButtons = buttons.filter(btn => 
        btn.id === 'prev_page' || btn.id === 'next_page'
      );
      const actionButtons = buttons.filter(btn => 
        btn.id === 'confirm_delete' || btn.id === 'cancel'
      );
      
      if (navButtons.length > 0) {
        keyboard.push({ actions: navButtons.map(btn => btn.id) });
      }
      if (actionButtons.length > 0) {
        keyboard.push({ actions: actionButtons.map(btn => btn.id) });
      }
    }
    
    // 使用 editMessageWithActions 更新消息
    await client.editMessageWithActions({
      messageId: session.messageId,
      content,
      actions: buttons,
      keyboard: keyboard
    });
    
    console.log(`✅ 消息列表已更新到第 ${newPage} 页`);
    return true;
  } catch (error) {
    console.error('❌ 更新消息列表失败:', error);
    return false;
  }
}

/**
 * 显示快捷回复键盘
 */
function showQuickReplyKeyboard(converseId, groupId, messageAuthor) {
  const isAdmin = masters.includes(messageAuthor);
  
  // 管理员和普通用户的快捷回复按钮
  const keyboard = [
    [{ text: '📊 查看统计' }, { text: '📋 查看列表' }],
    [{ text: '🗑️ 清理消息' }]
  ];
  
  // 只有非管理员才显示"关闭菜单"按钮
  if (!isAdmin) {
    keyboard.push([{ text: '❌ 关闭菜单' }]);
  }
  
  const rk = {
    keyboard,
    resize: true,
    one_time: false,
    placeholder: '请选择操作…',
    // New behavior: default collapsed, show by toggle button
    trigger: 'button',
    toggleLabel: '键盘',
    toggleIcon: 'mdi:keyboard-outline'
  };
  console.log('🧪 [DEBUG] RK to send:', JSON.stringify(rk));
  return rk;
}

/**
 * 处理斜杠命令
 */
async function handleSlashCommand(command, messageAuthor, converseId, groupId, messageId) {
  console.log('\n' + '-'.repeat(60));
  console.log(`🔧 [handleSlashCommand] 开始处理斜杠命令`);
  console.log(`   📝 命令: ${command}`);
  console.log(`   👤 用户: ${messageAuthor}`);
  console.log(`   💭 会话ID: ${converseId}`);
  console.log(`   🏠 群聊ID: ${groupId || '(无 - 私聊)'}`);
  console.log(`   🆔 消息ID: ${messageId}`);
  console.log('-'.repeat(60));

  try {
    switch (command) {
      case '/start':
      case '/help': {
        console.log('📖 执行 /start 或 /help 命令...');
        const helpMessage = `🤖 **清理机器人使用说明**\n\n` +
          `📋 **可用命令:**\n` +
          `• \`/start\` - 显示此帮助信息\n` +
          `• \`/help\` - 显示此帮助信息\n` +
          `• \`/clear\` - 清理消息\n` +
          `• \`/stats\` - 查看消息统计\n` +
          `• \`/list\` - 查看消息列表\n\n` +
          `👑 **管理员功能:**\n` +
          `• 使用 \`/clear\` 可以清理所有用户的消息\n\n` +
          `👤 **普通用户功能:**\n` +
          `• 使用 \`/clear\` 或 \`/list\` 查看并清理自己的消息\n` +
          `• 支持分页浏览和交互式删除\n\n` +
          `💡 **使用提示:**\n` +
          `• 私聊：直接发送命令即可（如 \`/help\`）\n` +
          `• 群聊：需要 @机器人 或从命令列表选择\n\n` +
          `⌨️ **快捷回复:**\n` +
          `• 点击下方按钮快速执行操作`;
        const replyKeyboard = showQuickReplyKeyboard(converseId, groupId, messageAuthor);
        console.log('🧪 [DEBUG] About to send meta.replyKeyboard:', JSON.stringify(replyKeyboard));
        const sentMsg = await client.sendMessage({ 
          converseId, 
          groupId, 
          content: helpMessage,
          meta: {
            replyKeyboard
          }
        });
        console.log('✅ 帮助消息发送成功！消息ID:', sentMsg?._id || sentMsg?.id);
        try {
          console.log('🧪 [DEBUG] Server returned meta.replyKeyboard:', JSON.stringify(sentMsg?.meta?.replyKeyboard));
        } catch (e) {
          console.log('🧪 [DEBUG] sentMsg meta inspection error:', e?.message || e);
        }
        break;
      }

      case '/clear': {
        if (masters.includes(messageAuthor)) {
          await client.sendMessage({ converseId, groupId, content: '⏳ 管理员操作：开始清除所有消息，请稍候...' });
          const result = await clearmsg();
          await client.sendMessage({ converseId, groupId, content: `✅ 管理员操作完成：${result}` });
        } else {
          await showUserMessageList(messageAuthor, converseId, groupId, messageId);
        }
        break;
      }

      case '/stats': {
        try {
          const statsResult = await getUserMessageStats(messageAuthor);
          console.log('📊 统计结果:', JSON.stringify(statsResult, null, 2));
          if (statsResult.success) {
            const { messageCount, nickname, username } = statsResult;
            const statsMessage = `📊 **${nickname || username || messageAuthor} 的消息统计**\n\n` +
              `• 总消息数: ${messageCount || 0}\n` +
              `• 用户名: ${username || '未知'}\n` +
              `• 昵称: ${nickname || '未设置'}\n\n` +
              `💡 使用 \`/list\` 查看详细消息列表`;
            await client.sendMessage({ converseId, groupId, content: statsMessage });
          } else {
            await client.sendMessage({ converseId, groupId, content: `❌ 获取统计信息失败: ${statsResult.message}` });
          }
        } catch (error) {
          console.error('❌ 统计命令执行出错:', error);
          await client.sendMessage({ converseId, groupId, content: `❌ 获取统计信息失败: ${error.message}` });
        }
        break;
      }

      case '/list':
        await showUserMessageList(messageAuthor, converseId, groupId, messageId);
        break;

      default:
        console.log('❓ 未知命令:', command);
        await client.sendMessage({ converseId, groupId, content: `❓ 未知命令: ${command}\n\n使用 \`/help\` 查看可用命令` });
    }

    console.log('✅ [handleSlashCommand] 命令处理完成\n');
  } catch (error) {
    console.error('❌ [handleSlashCommand] 处理命令时出错:', error);
    console.error('   错误堆栈:', error.stack);
    throw error;
  }
}


router.post('/bot/callback', async (ctx) => {
    // ✅ 调试：打印完整的请求体
    console.log('\n' + '='.repeat(80));
    console.log('📨 收到回调请求');
    console.log('⏰ 时间:', new Date().toLocaleString('zh-CN'));
    console.log('📦 完整请求体:', JSON.stringify(ctx.request.body, null, 2));
    console.log('='.repeat(80) + '\n');
    
  const hdrType = String(ctx.request.headers['x-tc-payload-type'] || '').toLowerCase();
  const type = ctx.request.body.type || hdrType; // 兼容老格式与当前 header 格式
    console.log('🔍 回调类型:', type);
    
  // inbox 等同于 message（服务器通过 header 传递类型）
  if (type === 'message' || type === 'inbox') {
        const payload = ctx.request.body.payload;
        console.log('📋 消息 payload:', JSON.stringify(payload, null, 2));
        
        const { messageAuthor, messageSnippet, groupId, converseId, messageId } = payload;
        const actor = String(payload.username || payload.fromUsername || messageAuthor || '');
        
        console.log('👤 消息作者:', messageAuthor, '| 显示名/用户名用于权限判断:', actor);
        console.log('💬 消息内容:', messageSnippet);
        console.log('🏠 群聊ID:', groupId || '(无 - 私聊)');
        console.log('💭 会话ID:', converseId);
        console.log('🆔 消息ID:', messageId);
        
        // 提取消息中除了 at 标记之外的纯文本内容，并做轻量归一化
        let userInput = messageSnippet;
        const atRegex = /\[at=[^\]]+\][^\[]*\[\/at\]\s*/g;
        userInput = userInput.replace(atRegex, '').trim();
        // 归一化空白字符
        userInput = userInput.replace(/\s+/g, ' ');
        
        console.log('🔤 提取后的用户输入:', userInput);
        console.log('❓ 是否以/开头:', userInput.startsWith('/'));
        
        // 检查是否是斜杠命令
        if (userInput.startsWith('/')) {
            console.log('✅ 识别为斜杠命令，准备处理...');
            await handleSlashCommand(userInput, messageAuthor, converseId, groupId, messageId);
            console.log('✅ 斜杠命令处理完成');
            ctx.status = 200;
            ctx.body = 'OK';
            return;
        }
        
        console.log('⚠️ 不是斜杠命令，检查快捷回复按钮...');

        // Reply Keyboard 文本到命令的映射（便于复用原有 slash 逻辑）
        const rkTextToCmd = {
          '📊 查看统计': '/stats',
          '📋 查看列表': '/list',
          '🗑️ 清理消息': '/clear'
        };
        if (rkTextToCmd[userInput]) {
          console.log(`↪️ 将快捷回复文本映射为命令: ${userInput} -> ${rkTextToCmd[userInput]}`);
          await handleSlashCommand(rkTextToCmd[userInput], actor, converseId, groupId, messageId);
          ctx.status = 200;
          ctx.body = 'OK';
          return;
        }
        if (userInput === '❌ 关闭菜单') {
          console.log('🧹 处理快捷回复：关闭菜单');
          await client.sendMessage({ 
            converseId, 
            groupId, 
            content: '✅ 快捷菜单已关闭\n\n💡 使用 /start 或 /help 重新打开菜单',
            meta: { replyKeyboard: { remove: true } } 
          });
          ctx.status = 200;
          ctx.body = 'OK';
          return;
        }

        // 仍保留冗余的直接处理器，兼容未来文案变动
        const quickReplyActions = {
            '📊 查看统计': async () => {
                console.log('📊 用户点击了"查看统计"快捷回复');
                try {
                    const statsResult = await getUserMessageStats(actor);
                    if (statsResult.success) {
                        const { messageCount, nickname, username } = statsResult;
                        const statsMessage = `📊 **${nickname || username || messageAuthor} 的消息统计**\n\n` +
                            `• 总消息数: ${messageCount || 0}\n` +
                            `• 用户名: ${username || '未知'}\n` +
                            `• 昵称: ${nickname || '未设置'}\n\n` +
                            `💡 使用 \`/list\` 查看详细消息列表`;
                        await client.sendMessage({ converseId, groupId, content: statsMessage });
                    } else {
                        await client.sendMessage({ converseId, groupId, content: `❌ 获取统计信息失败: ${statsResult.message}` });
                    }
                } catch (error) {
                    console.error('❌ 统计命令执行出错:', error);
                    await client.sendMessage({ converseId, groupId, content: `❌ 获取统计信息失败: ${error.message}` });
                }
            },
            '📋 查看列表': async () => {
                console.log('📋 用户点击了"查看列表"快捷回复');
                await showUserMessageList(actor, converseId, groupId, messageId);
            },
            '🗑️ 清理消息': async () => {
                console.log('🗑️ 用户点击了"清理消息"快捷回复');
                if (masters.includes(actor)) {
                    await client.sendMessage({ converseId, groupId, content: '⏳ 管理员操作：开始清除所有消息，请稍候...' });
                    const result = await clearmsg();
                    await client.sendMessage({ converseId, groupId, content: `✅ 管理员操作完成：${result}` });
                } else {
                    await showUserMessageList(actor, converseId, groupId, messageId);
                }
            },
            '❌ 关闭菜单': async () => {
                console.log('❌ 用户点击了"关闭菜单"快捷回复');
                await client.sendMessage({ 
                    converseId, 
                    groupId, 
                    content: '✅ 快捷菜单已关闭\n\n💡 使用 /start 或 /help 重新打开菜单',
                    meta: { replyKeyboard: { remove: true } } 
                });
            }
        };
        
        // 检查是否是快捷回复按钮的文本
        if (quickReplyActions[userInput]) {
            console.log(`✅ 识别为快捷回复按钮: ${userInput}`);
            await quickReplyActions[userInput]();
            ctx.status = 200;
            ctx.body = 'OK';
            return;
        }
        
        // 如果用户输入了其他内容，不处理（避免误触发）
        if (userInput !== '') {
          ctx.status = 200;
          ctx.body = 'OK';
          return;
        }
        
        // 主要逻辑：管理员 vs 普通用户
        if (masters.includes(actor)) {
          // 管理员：直接清理所有消息
          try {
            console.log(`✓ 管理员 ${messageAuthor} 开始清理所有消息`);
            
            await client.replyMessage({
              messageId,
              author: messageAuthor,
              content: messageSnippet
            }, {
              groupId,
              converseId,
              content: `⏳ 开始清除所有消息，请稍候...`,
            });
            
            const result = await clearmsg();
            console.log(`✓ 清理完成: ${result}`);
            
            await client.replyMessage({
              messageId,
              author: messageAuthor,
              content: messageSnippet
            }, {
              groupId,
              converseId,
              content: `✅ 操作完成：${result}`,
            });
            
          } catch (err) {
            console.error('❌ 消息处理失败:', err);
            await client.replyMessage({
              messageId,
              author: messageAuthor,
              content: messageSnippet
            }, {
              groupId,
              converseId,
              content: `❌ 操作失败: ${err.message || String(err)}`,
            });
          }
        } else {
          // 普通用户：显示消息列表和分页按钮
          console.log(`✓ 用户 ${messageAuthor} 请求查看自己的消息`);
          await showUserMessageList(messageAuthor, converseId, groupId, messageId);
        }
    }

    // 处理 DM /start 深链事件（由服务器转发，X-TC-Payload-Type: dm.start）
    if (type === 'dm.start') {
        console.log('🚦 进入 dm.start 处理逻辑');
        const payload = ctx.request.body.payload || {};
        console.log('📦 dm.start payload:', JSON.stringify(payload, null, 2));

        const actor = String(payload.username || payload.fromUsername || payload.fromUserId || '');
        const converseId = String(payload.converseId || '');
        const groupId = payload.groupId ? String(payload.groupId) : undefined;

        // 显示帮助信息和快捷回复键盘
        const helpMessage = `🤖 **清理机器人使用说明**\n\n` +
          `📋 **可用命令:**\n` +
          `• \`/start\` - 显示此帮助信息\n` +
          `• \`/help\` - 显示此帮助信息\n` +
          `• \`/clear\` - 清理消息\n` +
          `• \`/stats\` - 查看消息统计\n` +
          `• \`/list\` - 查看消息列表\n\n` +
          `👑 **管理员功能:**\n` +
          `• 使用 \`/clear\` 可以清理所有用户的消息\n\n` +
          `👤 **普通用户功能:**\n` +
          `• 使用 \`/clear\` 或 \`/list\` 查看并清理自己的消息\n` +
          `• 支持分页浏览和交互式删除\n\n` +
          `💡 **使用提示:**\n` +
          `• 私聊：直接发送命令即可（如 \`/help\`）\n` +
          `• 群聊：需要 @机器人 或从命令列表选择\n\n` +
          `⌨️ **快捷回复:**\n` +
          `• 点击下方按钮快速执行操作`;
        
        const replyKeyboard = showQuickReplyKeyboard(converseId, groupId, actor);
        await client.sendMessage({
          converseId,
          groupId,
          content: helpMessage,
          meta: {
            replyKeyboard
          }
        });

        ctx.status = 200;
        ctx.body = 'OK';
        return;
    }
    
    // 处理按钮回调
    if (type === 'buttonCallback') {
        console.log('🔘 进入按钮回调处理逻辑');
        const payload = ctx.request.body.payload;
        console.log('📋 按钮回调 payload:', JSON.stringify(payload, null, 2));
        
        const { 
            messageAuthor, 
            converseId, 
            groupId, 
            messageId,
            originalMessageId,  // 这是我们新添加的功能！
            traceId,  // 提示框功能需要的追踪ID
            params 
        } = payload;
        
        console.log(`🔘 收到按钮回调:`);
        console.log(`   👤 用户: ${messageAuthor}`);
        console.log(`   🎯 动作: ${params?.action}`);
        console.log(`   📝 原消息ID: ${originalMessageId}`);
        console.log(`   🆔 消息ID: ${messageId}`);
        console.log(`   🔗 TraceId: ${traceId}`);
        
        const { action, username, page, sessionId } = params;
        
        // 验证会话
        const session = userSessions.get(sessionId);
        if (!session) {
            await client.replyMessage({
                messageId,
                author: messageAuthor,
                content: ''
            }, {
                groupId,
                converseId,
                content: '❌ 会话已过期，请重新发起请求',
            });
            return;
        }
        
        // 验证用户权限
        if (session.username !== messageAuthor) {
            // 使用新的提示框功能：仅对点击用户显示错误提示（弹窗模式）
            await client.answerCallbackQuery({
                traceId: traceId,  // 从 payload 中获取
                userId: messageAuthor,  // 点击用户就是 messageAuthor
                text: '❌ 您只能操作自己的消息',
                show_alert: true  // 弹窗模式，更醒目
            });
            return;
        }
        
        switch (action) {
            case 'prev_page':
                console.log(`📖 翻到上一页: ${page}`);
                await updateMessageListPage(sessionId, page);
                break;
                
            case 'next_page':
                console.log(`📖 翻到下一页: ${page}`);
                await updateMessageListPage(sessionId, page);
                break;
                
            case 'confirm_delete':
                console.log(`🗑️ 用户确认删除: ${username}`);
                
                // 显示开始处理的提示（Toast模式）
                await client.answerCallbackQuery({
                    traceId: traceId,
                    userId: messageAuthor,
                    text: '⏳ 开始删除，请稍候...',
                    show_alert: false  // Toast模式
                });
                
                // 更新消息为删除进度
                await client.editMessage({
                    messageId: session.messageId,
                    content: '⏳ 正在删除您的消息，请稍候...\n\n🔄 这可能需要几分钟时间'
                });
                
                // 执行删除
                const deleteResult = await clearUserMessages(username);
                
                // 更新最终结果并清除所有按钮
                await client.editMessage({
                    messageId: session.messageId,
                    content: `✅ 删除操作完成！\n\n📊 结果: ${deleteResult}`,
                    meta: {
                        // 清除所有内联按钮
                        inlineActions: null
                    }
                });
                
                // 注意：traceId 已在第一次 answerCallbackQuery 中使用，不能重复使用
                // 删除结果已在消息中显示，无需额外的 Toast 提示
                
                // 清理会话
                userSessions.delete(sessionId);
                break;
                
            case 'cancel':
                console.log(`❌ 用户取消操作: ${username}`);
                
                // 显示取消提示（Toast模式）
                await client.answerCallbackQuery({
                    traceId: traceId,
                    userId: messageAuthor,
                    text: '✅ 取消',
                    show_alert: false
                });
                
                // 更新消息为取消状态并清除所有按钮
                await client.editMessage({
                    messageId: session.messageId,
                    content: '✅ 操作已取消\n\n💡 如需重新查看消息，请再次 @机器人',
                    meta: {
                        // 清除所有内联按钮
                        inlineActions: null
                    }
                });
                
                // 清理会话
                userSessions.delete(sessionId);
                break;
                
            default:
                console.log(`❓ 未知动作: ${action}`);
        }
    }
    
    console.log('✅ 回调处理完成，返回 200 OK\n');
    ctx.status = 200;
    ctx.body = 'OK';
});

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(listen_port, () => {
  console.log(`\n🚀 增强版清理机器人已启动`);
  console.log(`   监听地址: http://localhost:${listen_port}`);
  console.log(`   POST /bot/callback - 接收回调消息\n`);
  console.log('🎉 功能特性:');
  console.log('   • 📋 分页显示用户消息列表');
  console.log('   • 🔄 动态消息更新 (editMessage/editMessageWithActions)');
  console.log('   • 🔘 交互式按钮 (上一页/下一页/确认/取消)');
  console.log('   • 📡 按钮回调包含 originalMessageId');
  console.log('   • ⚡ 实时进度更新');
  console.log('   • 👑 管理员保持原有直接删除功能');
  console.log('   • 🌐 HTTP统一回调 (类似Telegram Bot)');
  console.log('   • 🤖 斜杠命令支持 (全部范围 - 私聊和群聊)');
  console.log('   • 🔄 智能重连机制 (应用层主导，指数退避)\n');
  console.log('🔧 重连配置:');
  console.log('   • 最大重试次数: 10');
  console.log('   • 重连延迟: 1s -> 30s (指数退避)');
  console.log('   • 连接超时: 15秒');
  console.log('   • 心跳间隔: 30秒\n');
  console.log('💬 支持的斜杠命令:');
  console.log('   • /start, /help - 显示帮助信息和快捷回复菜单');
  console.log('   • /clear - 清理消息');
  console.log('   • /stats - 查看消息统计');
  console.log('   • /list - 查看消息列表');
  console.log('\n⌨️  快捷回复功能:');
  console.log('   • 📊 查看统计 - 快速查看消息统计');
  console.log('   • 📋 查看列表 - 快速查看消息列表');
  console.log('   • 🗑️ 清理消息 - 快速清理消息');
  console.log('   • ❌ 关闭菜单 - 关闭快捷回复键盘');
  console.log('\n⚠️  群聊使用提示:');
  console.log('   • 需要 @机器人 才能触发命令');
  console.log('   • 或从命令列表中选择命令（自动添加 @）\n');
  console.log('🔗 连接状态监控:');
  console.log('   • 实时连接状态显示');
  console.log('   • 自动检测网络问题并重连');
  console.log('   • 优雅关闭处理 (Ctrl+C)\n');
});