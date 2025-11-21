/**
 * 命令处理器模块
 */
const { generateTextImage } = require('../utils/imageGenerator');
const { uploadImage } = require('../utils/uploader');

/**
 * 处理 /build 命令
 * @param {Object} client - Tailchat 客户端
 * @param {Object} message - 消息对象
 */
async function handleBuildCommand(client, message) {
  const content = message.content.trim();
  
  // 解析命令：/build <文本>
  const buildMatch = content.match(/^\/build\s+(.+)$/i);
  if (!buildMatch) {
    // 如果没有提供文本，发送使用说明
    await client.sendMessage({
      converseId: message.converseId,
      groupId: message.groupId,
      content: '📝 使用方法：`/build <文本>`\n\n例如：`/build Hello World`',
    });
    return;
  }

  const text = buildMatch[1].trim();
  
  // 发送处理中提示
  await client.sendMessage({
    converseId: message.converseId,
    groupId: message.groupId,
    content: '⏳ 正在生成图片，请稍候...',
  });

  try {
    // 生成图片
    console.log(`生成图片，文字内容: "${text}"`);
    const imageBuffer = generateTextImage(text);
    
    // 上传图片
    console.log('上传图片中...');
    const uploadResult = await uploadImage(client, imageBuffer);
    console.log('上传成功:', uploadResult.url);

    // 发送图片消息（使用 BBCode 格式）
    await client.sendMessage({
      converseId: message.converseId,
      groupId: message.groupId,
      content: `✅ 图片已生成！\n[img]${uploadResult.url}[/img]`,
    });

    console.log('图片已发送到聊天');
  } catch (error) {
    console.error('处理失败:', error);
    await client.sendMessage({
      converseId: message.converseId,
      groupId: message.groupId,
      content: `❌ 生成失败: ${error.message}`,
    });
  }
}

/**
 * 处理 /help 命令
 * @param {Object} client - Tailchat 客户端
 * @param {Object} message - 消息对象
 */
async function handleHelpCommand(client, message) {
  const helpText = `
🤖 **文字制作机器人使用指南**

📝 **命令列表：**

\`/build <文本>\` - 生成带文字的图片
  例如：\`/build Hello World\`
  
\`/help\` - 显示此帮助信息

💡 **提示：**
- 支持中文和英文
- 文字会自动居中显示
- 文字过长会自动调整字体大小
  `.trim();

  await client.sendMessage({
    converseId: message.converseId,
    groupId: message.groupId,
    content: helpText,
  });
}

module.exports = {
  handleBuildCommand,
  handleHelpCommand,
};

