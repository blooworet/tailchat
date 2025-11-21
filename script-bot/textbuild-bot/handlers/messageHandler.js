/**
 * 消息处理主模块
 */
const { handleBuildCommand, handleHelpCommand } = require('./commandHandlers');

/**
 * 创建消息处理器
 * @param {Object} client - Tailchat 客户端实例
 * @returns {Function} 消息处理函数
 */
function createMessageHandler(client) {
  // 防止重复处理的消息ID集合（简单的去重机制）
  const processedMessages = new Set();
  const MESSAGE_CACHE_TTL = 60000; // 1分钟后清理

  // 定期清理已处理消息记录
  setInterval(() => {
    processedMessages.clear();
  }, MESSAGE_CACHE_TTL);

  return async function handleMessage(message) {
    // 忽略机器人自己的消息
    if (message.author === client.userId) {
      return;
    }

    // 防止重复处理同一条消息
    if (processedMessages.has(message._id)) {
      console.log(`跳过重复消息: ${message._id}`);
      return;
    }
    processedMessages.add(message._id);

    const content = message.content.trim();
    console.log(`收到消息: ${content}`);

    try {
      // 处理 /build 命令
      if (content.startsWith('/build')) {
        await handleBuildCommand(client, message);
        return;
      }

      // 处理 /help 命令
      if (content === '/help') {
        await handleHelpCommand(client, message);
        return;
      }
    } catch (error) {
      console.error('处理消息时出错:', error);
      
      // 发送错误消息
      try {
        await client.sendMessage({
          converseId: message.converseId,
          groupId: message.groupId,
          content: `❌ 处理命令时发生错误: ${error.message}`,
        });
      } catch (sendError) {
        console.error('发送错误消息失败:', sendError);
      }
    }
  };
}

module.exports = {
  createMessageHandler,
};

