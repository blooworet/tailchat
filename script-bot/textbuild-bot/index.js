/**
 * 文字制作机器人 - 主入口
 * 
 * 功能：生成带文字的精美图片
 * 命令：/build <文本>, /help
 */
const { TailchatWsClient, ConnectionState } = require('tailchat-client-sdk');
const config = require('./config');
const { createMessageHandler } = require('./handlers/messageHandler');
const { getAllCommands } = require('./commands');

// 验证配置
config.validate();

// 创建客户端（使用高级连接配置）
const client = new TailchatWsClient(
  config.HOST,
  config.APP_SECRET,
  undefined,  // appId（新版不需要）
  false,      // disableMsgpack
  {
    enableManualReconnect: true,  // 启用手动重连
    connectionTimeout: 15000,     // 连接超时15秒
    heartbeatInterval: 30000      // 心跳间隔30秒
  }
);

// ==================== 连接状态管理 ====================

// 重连配置
const RECONNECT_CONFIG = {
  maxRetries: 10,           // 最大重试次数
  initialDelay: 1000,       // 初始延迟1秒
  maxDelay: 30000,          // 最大延迟30秒
  backoffFactor: 2,         // 退避因子
};

let reconnectAttempts = 0;
let reconnectTimer = null;
let isShuttingDown = false;

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

  if (reconnectAttempts >= RECONNECT_CONFIG.maxRetries) {
    console.error(`❌ 已达到最大重连次数 (${RECONNECT_CONFIG.maxRetries})，停止重连`);
    return;
  }

  if (!client.canReconnect()) {
    console.log('⚠️ 当前不能重连，跳过');
    return;
  }

  reconnectAttempts++;
  console.log(`🔄 尝试重连 (${reconnectAttempts}/${RECONNECT_CONFIG.maxRetries})...`);

  try {
    await client.reconnect();
    console.log('✅ 重连成功！');
    reconnectAttempts = 0; // 重置重连计数
  } catch (error) {
    console.error(`❌ 重连失败 (尝试 ${reconnectAttempts}/${RECONNECT_CONFIG.maxRetries}):`, error.message);
    
    // 计算下次重连延迟
    const delay = calculateReconnectDelay(reconnectAttempts);
    console.log(`⏱️ ${Math.round(delay / 1000)}秒后重试...`);
    
    // 设置下次重连
    reconnectTimer = setTimeout(attemptReconnect, delay);
  }
}

/**
 * 清除重连定时器
 */
function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// 监听连接状态变化
client.onConnectionStateChange((info) => {
  console.log(`📡 连接状态变化: ${info.state}`);
  
  switch (info.state) {
    case ConnectionState.CONNECTED:
      reconnectAttempts = 0; // 重置重连计数
      clearReconnectTimer();
      break;
      
    case ConnectionState.DISCONNECTED:
      console.log(`🔌 连接已断开${info.disconnectReason ? `: ${info.disconnectReason}` : ''}`);
      // 启动重连
      if (!isShuttingDown) {
        const delay = calculateReconnectDelay(0);
        console.log(`⏱️ ${Math.round(delay / 1000)}秒后尝试重连...`);
        reconnectTimer = setTimeout(attemptReconnect, delay);
      }
      break;
      
    case ConnectionState.FAILED:
      console.error('❌ 连接失败:', info.error?.message || '未知错误');
      break;
  }
});

/**
 * 注册机器人命令
 */
async function registerBotCommands() {
  try {
    console.log('📝 正在注册机器人命令...');
    
    // 获取所有命令定义
    const commands = getAllCommands();
    
    // 注册命令到 Tailchat
    await client.registerCommands(commands);
    console.log('✅ 命令注册成功！');
    
    // 显示已注册的命令
    const registeredCommands = await client.getRegisteredCommands();
    console.log('已注册命令:');
    registeredCommands.forEach(cmd => {
      console.log(`  /${cmd.command} - ${cmd.description}`);
    });
    
  } catch (error) {
    console.error('⚠️ 命令注册失败:', error.message);
    console.log('机器人仍可正常工作，但命令不会显示在命令列表中');
  }
}

/**
 * 启动机器人
 */
async function startBot() {
  try {
    console.log('正在连接到 Tailchat 服务器...');
    console.log('服务器地址:', config.HOST);
    
    await client.connect();
    
    console.log('✅ 连接成功！');
    console.log('机器人已启动，开始监听消息...');
    console.log('-----------------------------------');

    // 注册机器人命令
    await registerBotCommands();
    
    console.log('支持的命令: /build <文本>, /help');
    console.log('-----------------------------------');

    // 创建并注册消息处理器
    const messageHandler = createMessageHandler(client);
    client.onMessage(messageHandler);

  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

/**
 * 优雅关闭
 */
function shutdown() {
  console.log('\n正在关闭机器人...');
  isShuttingDown = true;
  clearReconnectTimer();
  
  if (client.socket) {
    client.disconnect();
  }
  
  console.log('👋 机器人已安全关闭');
  process.exit(0);
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 错误:', error);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 启动机器人
startBot();
