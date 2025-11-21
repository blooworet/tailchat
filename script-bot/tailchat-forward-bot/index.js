const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { TailchatHTTPClient } = require('./tailchat-client-sdk');

// ==================== 加载环境变量 ====================
// 尝试加载 .env 文件
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

if (!fs.existsSync(envPath)) {
  console.error('❌ 错误：找不到 .env 配置文件！');
  process.exit(1);
}

// 加载环境变量
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ 错误：无法加载 .env 文件！', result.error.message);
  process.exit(1);
}

// ==================== 配置项 ====================
const CONFIG = {
  // Tailchat 配置
  tailchat: {
    host: process.env.TAILCHAT_HOST?.trim(),
    appSecret: process.env.TAILCHAT_APP_SECRET?.trim(),
    listenPort: parseInt(process.env.LISTEN_PORT) || 3000,
  },
  // Telegram 配置
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
    targetUserId: process.env.TELEGRAM_TARGET_USER_ID?.trim(), // 支持多个用户，用逗号分隔
  }
};

// ==================== 验证配置 ====================
function validateConfig() {
  const errors = [];
  const warnings = [];
  
  // 必需配置检查
  if (!CONFIG.tailchat.host) {
    errors.push({
      key: 'TAILCHAT_HOST',
      message: 'Tailchat 服务器地址',
      example: 'https://nightly.paw.msgbyte.com'
    });
  }
  
  if (!CONFIG.tailchat.appSecret) {
    errors.push({
      key: 'TAILCHAT_APP_SECRET',
      message: 'Tailchat 机器人密钥',
      example: 'sk_abc123def456...'
    });
  }
  
  if (!CONFIG.telegram.botToken) {
    errors.push({
      key: 'TELEGRAM_BOT_TOKEN',
      message: 'Telegram Bot Token',
      example: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
    });
  }
  
  if (!CONFIG.telegram.targetUserId) {
    errors.push({
      key: 'TELEGRAM_TARGET_USER_ID',
      message: 'Telegram 目标用户ID',
      example: '123456789'
    });
  }
  
  // 格式验证
  if (CONFIG.tailchat.host && !CONFIG.tailchat.host.startsWith('http')) {
    warnings.push('⚠️  TAILCHAT_HOST 应该以 http:// 或 https:// 开头');
  }
  
  if (CONFIG.telegram.botToken && !CONFIG.telegram.botToken.includes(':')) {
    warnings.push('⚠️  TELEGRAM_BOT_TOKEN 格式可能不正确（应包含冒号）');
  }
  
  if (CONFIG.telegram.targetUserId && !/^\d+(,\d+)*$/.test(CONFIG.telegram.targetUserId.replace(/\s/g, ''))) {
    warnings.push('⚠️  TELEGRAM_TARGET_USER_ID 格式可能不正确（应为纯数字或逗号分隔的数字）');
  }
  
  // 显示错误
  if (errors.length > 0) {
    console.error('❌ 配置错误：缺少必要的环境变量');
    errors.forEach((err) => {
      console.error(`   ${err.key}: ${err.message}`);
    });
    process.exit(1);
  }
}

validateConfig();

// ==================== Telegram API 封装 ====================
class TelegramBot {
  constructor(token) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  /**
   * 发送文本消息
   */
  async sendMessage(chatId, text, options = {}) {
    try {
      const response = await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || 'HTML',
        disable_web_page_preview: options.disable_preview || false,
        ...options
      });
      
      if (response.data.ok) {
        return response.data.result;
      } else {
        throw new Error(response.data.description || '发送失败');
      }
    } catch (error) {
      console.error('❌ Telegram 发送失败:', error.message);
      throw error;
    }
  }

  /**
   * 发送照片
   */
  async sendPhoto(chatId, photoUrl, caption = '') {
    try {
      const response = await axios.post(`${this.apiUrl}/sendPhoto`, {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption,
        parse_mode: 'HTML'
      });
      
      if (response.data.ok) {
        return response.data.result;
      }
    } catch (error) {
      return this.sendMessage(chatId, `📷 图片: ${photoUrl}\n${caption}`);
    }
  }

  /**
   * 发送文档
   */
  async sendDocument(chatId, documentUrl, caption = '') {
    try {
      const response = await axios.post(`${this.apiUrl}/sendDocument`, {
        chat_id: chatId,
        document: documentUrl,
        caption: caption,
        parse_mode: 'HTML'
      });
      
      if (response.data.ok) {
        return response.data.result;
      }
    } catch (error) {
      return this.sendMessage(chatId, `📎 文件: ${documentUrl}\n${caption}`);
    }
  }
}

// 初始化 Telegram Bot
const telegramBot = new TelegramBot(CONFIG.telegram.botToken);

// 获取目标用户ID列表
const targetUserIds = CONFIG.telegram.targetUserId.split(',').map(id => id.trim());

// ==================== Tailchat 客户端（用于发送消息）====================
const tailchatClient = new TailchatHTTPClient(
  CONFIG.tailchat.host,
  CONFIG.tailchat.appSecret
);

// ==================== 用户信息缓存 ====================
// 缓存用户 ID 到昵称的映射
const userInfoCache = new Map();
const USER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时过期

/**
 * 获取用户昵称
 */
async function getUserNickname(userId) {
  // 检查缓存
  if (userInfoCache.has(userId)) {
    const cached = userInfoCache.get(userId);
    if (Date.now() - cached.timestamp < USER_CACHE_TTL) {
      return cached.nickname;
    }
  }
  
  try {
    // 调用 API 获取用户信息
    const userInfo = await tailchatClient.call('user.getUserInfo', {
      userId: userId
    });
    
    const nickname = userInfo?.nickname || userInfo?.username || userId;
    
    // 缓存用户信息
    userInfoCache.set(userId, {
      nickname: nickname,
      timestamp: Date.now()
    });
    
    return nickname;
    
  } catch (error) {
    return userId;
  }
}

// ==================== 消息去重 ====================
// 存储已处理的消息 ID，防止重复转发
const processedMessages = new Set();
const MESSAGE_DEDUP_TTL = 60000; // 消息去重时间：60秒

/**
 * 检查消息是否已处理（防止重复转发）
 */
function isMessageProcessed(messageId) {
  if (processedMessages.has(messageId)) {
    return true;
  }
  
  // 添加到已处理集合
  processedMessages.add(messageId);
  
  // 定时清理（防止内存泄漏）
  setTimeout(() => {
    processedMessages.delete(messageId);
  }, MESSAGE_DEDUP_TTL);
  
  return false;
}

// ==================== 消息映射（用于双向转发）====================
// 存储 Telegram 消息 ID 到 Tailchat 会话信息的映射
const messageMapping = new Map();
const MAPPING_TTL = 24 * 60 * 60 * 1000; // 24小时过期

/**
 * 保存消息映射关系
 */
function saveMessageMapping(telegramMessageId, tailchatInfo) {
  messageMapping.set(telegramMessageId, {
    ...tailchatInfo,
    timestamp: Date.now()
  });
  
  // 定时清理过期映射
  setTimeout(() => {
    messageMapping.delete(telegramMessageId);
  }, MAPPING_TTL);
}

/**
 * 获取最近的会话信息（用于未回复特定消息的情况）
 */
function getLatestConverse() {
  let latest = null;
  let latestTime = 0;
  
  for (const [_, info] of messageMapping.entries()) {
    if (info.timestamp > latestTime) {
      latestTime = info.timestamp;
      latest = info;
    }
  }
  
  return latest;
}

// ==================== 消息处理逻辑 ====================

/**
 * 格式化 Tailchat 消息为 Telegram 格式
 */
async function formatMessageForTelegram(message) {
  const { messageAuthor, messageSnippet, converseId, groupId, messageId } = message;
  
  // 获取用户昵称
  const nickname = await getUserNickname(messageAuthor);
  
  // 清理 AT 标记
  let content = messageSnippet || '';
  const atRegex = /\[at=[^\]]+\][^\[]*\[\/at\]\s*/g;
  content = content.replace(atRegex, '').trim();
  
  // 构建消息
  let formattedMessage = '';
  formattedMessage += `👤 <b>来自:</b> ${escapeHtml(nickname)}\n`;
  formattedMessage += `💬 <b>会话ID:</b> <code>${converseId}</code>\n`;
  if (groupId) {
    formattedMessage += `🏠 <b>群组ID:</b> <code>${groupId}</code>\n`;
  }
  formattedMessage += `🆔 <b>消息ID:</b> <code>${messageId}</code>\n`;
  formattedMessage += `\n━━━━━━━━━━━━━━━━━━\n`;
  formattedMessage += `📝 <b>消息内容:</b>\n${escapeHtml(content)}`;
  
  return formattedMessage;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 转发消息到 Telegram
 */
async function forwardToTelegram(message) {
  try {
    const messageId = message.messageId;
    
    // 检查消息是否已处理（防止重复转发）
    if (isMessageProcessed(messageId)) {
      return;
    }
    
    const formattedMessage = await formatMessageForTelegram(message);
    
    // 发送到所有目标用户
    for (const userId of targetUserIds) {
      try {
        const result = await telegramBot.sendMessage(userId, formattedMessage);
        
        // 保存消息映射关系（用于双向转发）
        if (result && result.message_id) {
          saveMessageMapping(result.message_id, {
            converseId: message.converseId,
            groupId: message.groupId,
            tailchatMessageId: message.messageId,
            tailchatAuthor: message.messageAuthor
          });
        }
      } catch (error) {
        console.error(`❌ 转发失败:`, error.message);
      }
    }
  } catch (error) {
    console.error('❌ 消息转发失败:', error);
  }
}

/**
 * 转发 Telegram 消息到 Tailchat
 */
async function forwardToTailchat(telegramMessage) {
  try {
    const { text, from, reply_to_message, message_id } = telegramMessage;
    
    if (!text) {
      return;
    }
    
    let converseInfo = null;
    
    // 如果是回复某条消息
    if (reply_to_message && reply_to_message.message_id) {
      converseInfo = messageMapping.get(reply_to_message.message_id);
    }
    
    // 如果没有回复或找不到映射，使用最近的会话
    if (!converseInfo) {
      converseInfo = getLatestConverse();
    }
    
    if (!converseInfo) {
      return;
    }
    
    // 直接转发消息内容，不添加任何标识
    await tailchatClient.sendMessage({
      converseId: converseInfo.converseId,
      groupId: converseInfo.groupId,
      content: text
    });
    
  } catch (error) {
    console.error('❌ 转发失败:', error.message);
  }
}

// ==================== Koa 服务器设置 ====================
const app = new Koa();
const router = new Router();

app.use(bodyParser());

// Webhook 路由
router.post('/bot/callback', async (ctx) => {
  const { type, payload } = ctx.request.body;
  
  // 处理消息类型
  if (type === 'message') {
    await forwardToTelegram(payload);
  }
  
  ctx.status = 200;
  ctx.body = 'OK';
});

// 健康检查
router.get('/health', (ctx) => {
  ctx.body = {
    status: 'ok',
    service: 'tailchat-telegram-forwarder',
    timestamp: new Date().toISOString()
  };
});

// 测试 Telegram 连接
router.get('/test-telegram', async (ctx) => {
  try {
    const results = [];
    for (const userId of targetUserIds) {
      try {
        await telegramBot.sendMessage(userId, '🤖 测试消息\n\nTailchat ↔ Telegram 转发机器人已连接！');
        results.push({ userId, status: 'success' });
      } catch (error) {
        results.push({ userId, status: 'failed', error: error.message });
      }
    }
    ctx.body = { status: 'ok', results };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { status: 'error', message: error.message };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

// ==================== Telegram Bot 消息接收 ====================

/**
 * 启动 Telegram Bot Long Polling
 */
async function startTelegramPolling() {
  let offset = 0;
  const pollInterval = 1000;
  
  async function poll() {
    try {
      const response = await axios.get(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/getUpdates`, {
        params: {
          offset: offset,
          timeout: 30,
          allowed_updates: ['message']
        }
      });
      
      if (response.data.ok && response.data.result.length > 0) {
        for (const update of response.data.result) {
          offset = update.update_id + 1;
          
          // 处理消息
          if (update.message && targetUserIds.includes(String(update.message.from.id))) {
            await forwardToTailchat(update.message);
          }
        }
      }
    } catch (error) {
      console.error('❌ Telegram 轮询错误:', error.message);
    }
    
    setTimeout(poll, pollInterval);
  }
  
  poll();
}

// ==================== 启动应用 ====================
async function startApplication() {
  app.listen(CONFIG.tailchat.listenPort, () => {
    console.log(`✅ 服务已启动 - 端口: ${CONFIG.tailchat.listenPort}`);
  });
  
  await startTelegramPolling();
}

// 优雅关闭
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// 启动应用
startApplication().catch(error => {
  console.error('❌ 应用启动失败:', error);
  process.exit(1);
});

