// 加载.env文件中的环境变量
require('dotenv').config();

const { TailchatHTTPClient } = require('tailchat-client-sdk');
const http = require('http');

// 简单去重：避免对同一条消息重复响应
const processedMessageIds = new Set();
function markProcessed(id) {
  try {
    processedMessageIds.add(id);
    // 控制集合大小，避免无限增长
    if (processedMessageIds.size > 1000) {
      // 移除前 200 个（近似做法）
      const it = processedMessageIds.values();
      for (let i = 0; i < 200; i++) {
        const v = it.next();
        if (v.done) break;
        processedMessageIds.delete(v.value);
      }
    }
  } catch {}
}
function alreadyProcessed(id) {
  return processedMessageIds.has(id);
}

// 从环境变量获取配置
const HOST = process.env.HOST || 'http://localhost:11000';
const APP_SECRET = process.env.APP_SECRET;

if (!APP_SECRET) {
  console.error('错误: 缺少必要的环境变量 APP_SECRET');
  console.log('请设置环境变量:');
  console.log('  HOST=你的Tailchat服务器地址 (可选，默认为 http://localhost:11000)');
  console.log('  APP_SECRET=你的应用密钥 (从Tailchat管理面板获取)');
  console.log('');
  console.log('注意: 请确保在Tailchat管理面板中:');
  console.log('1. 应用已创建');
  console.log('2. 应用已启用bot能力');
  console.log('3. 使用正确的应用密钥(Secret)');
  process.exit(1);
}

console.log('正在启动机器人...');
console.log('服务器地址:', HOST);
console.log('应用密钥长度:', APP_SECRET.length);
console.log('应用密钥前10位:', APP_SECRET.substring(0, 10) + '...');

// 创建机器人客户端 (HTTP 模式，使用 X-App-Secret)
const client = new TailchatHTTPClient(HOST, APP_SECRET);

// 注册机器人命令（全部范围 - 私聊和群聊）
async function registerBotCommands() {
  try {
    console.log('🔧 正在注册机器人命令...');
    
    const commands = [
      {
        command: 'hello',
        description: '打个招呼 - 机器人会回复你好',
        scope: { type: 'default' }
      },
      {
        command: 'help',
        description: '显示帮助信息',
        scope: { type: 'default' }
      },
      {
        command: 'ping',
        description: '测试机器人响应速度',
        scope: { type: 'default' }
      },
      {
        command: 'about',
        description: '关于这个机器人',
        scope: { type: 'default' }
      }
    ];
    
    await client.registerCommands(commands);
    
    console.log('✅ 机器人命令注册成功！');
    console.log('📋 已注册的命令（全部范围 - 私聊和群聊）:');
    console.log('   /hello - 打个招呼');
    console.log('   /help - 显示帮助信息');
    console.log('   /ping - 测试响应速度');
    console.log('   /about - 关于机器人');
    
  } catch (error) {
    console.error('❌ 注册机器人命令失败:', error.message);
    console.error('🔍 错误详情:', error.response?.data || error);
  }
}

// HTTP 回调服务（Webhook）
const LISTEN_PORT = process.env.LISTEN_PORT || 3002;

async function initBotIdentity() {
  try {
    const me = await client.call('openapi.bot.whoami');
    if (me && (me._id || me.userId)) {
      client.userId = String(me._id || me.userId);
    }
  } catch (e) {
    console.warn('获取自身信息失败，将继续运行:', e?.message || e);
  }
  console.log('机器人用户ID:', client.userId);
}

async function ensureCommands() {
  await registerBotCommands();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/bot/callback') {
    try {
      const body = await readJson(req);
      const hdrType = String(req.headers['x-tc-payload-type'] || '').toLowerCase();
      const type = body?.type || hdrType; // 兼容 header 与 body 两种格式
      const payload = body?.payload || {};
      if (type === 'message' || type === 'inbox') {
        const messageId = String(payload.messageId || '');
        if (messageId && alreadyProcessed(messageId)) {
          res.writeHead(200); res.end('OK'); return;
        }
        if (messageId) markProcessed(messageId);

        // 区分“自己发的消息”和“别人发的消息”：
        // 服务端转发的 inbox payload 中包含 messageAuthor（用户ID）。
        // 当启用“接收群内全部消息”时，机器人的自发消息也会回调，需要忽略。
        try {
          const authorId = String(payload.messageAuthor || '');
          if (client.userId && authorId && String(client.userId) === authorId) {
            // 忽略机器人自己发送的消息，避免自我触发
            res.writeHead(200); res.end('OK'); return;
          }
        } catch {}

        // 提取纯文本
        let content = String(payload.messageSnippet || '');
        const atRegex = /\[at=[^\]]+\][^\[]*\[\/at\]\s*/g;
        content = content.replace(atRegex, '').trim();

        // 斜杠命令
        if (content.startsWith('/')) {
          const command = content.split(' ')[0].toLowerCase();
          switch (command) {
            case '/hello':
              await client.sendMessage({ converseId: payload.converseId, groupId: payload.groupId, content: '👋 你好！我是一个简单的回复机器人！\n\n使用 `/help` 查看更多命令。' });
              break;
            case '/help': {
              const helpMessage = `🤖 **回复机器人帮助**\n\n` +
                `📋 **可用命令:**\n` +
                `• \`/hello\` - 打个招呼\n` +
                `• \`/help\` - 显示此帮助信息\n` +
                `• \`/ping\` - 测试响应速度\n` +
                `• \`/about\` - 关于这个机器人`;
              await client.sendMessage({ converseId: payload.converseId, groupId: payload.groupId, content: helpMessage });
              break; }
            case '/ping': {
              const startTime = Date.now();
              await client.sendMessage({ converseId: payload.converseId, groupId: payload.groupId, content: `🏓 Pong! 响应时间: ${Date.now() - startTime}ms` });
              break; }
            case '/about': {
              const aboutMessage = `ℹ️ **关于回复机器人**\n\n` +
                `📝 **功能:**\n` +
                `• 自动回复"你好"\n` +
                `• 支持斜杠命令\n` +
                `• 私聊和群聊都可用\n\n` +
                `💬 使用 \`/help\` 查看所有命令`;
              await client.sendMessage({ converseId: payload.converseId, groupId: payload.groupId, content: aboutMessage });
              break; }
            default:
              // 非内置命令，按普通消息处理
              await client.sendMessage({ converseId: payload.converseId, groupId: payload.groupId, content: '你好' });
          }
        } else {
          // 普通消息回复
          await client.sendMessage({ converseId: payload.converseId, groupId: payload.groupId, content: '你好' });
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } catch (e) {
      console.error('回调处理失败:', e?.message || e);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('ERR');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

(async () => {
  console.log('正在以 HTTP 模式启动机器人 (Webhook)...');
  await initBotIdentity();
  await ensureCommands();
  server.listen(LISTEN_PORT, () => {
    console.log(`回调监听: http://localhost:${LISTEN_PORT}/bot/callback`);
  });
})();
