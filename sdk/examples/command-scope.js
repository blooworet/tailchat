const { TailchatHTTPClient } = require('../dist');

// 初始化客户端
const client = new TailchatHTTPClient(
  'https://tailchat.example.com',
  'your-app-secret-key'
);

async function demonstrateCommandScopes() {
  try {
    console.log('🚀 开始演示命令范围功能...\n');

    // 1. 注册不同范围的命令
    console.log('📝 注册不同范围的命令...');
    await client.registerCommands([
      // 全局命令（默认范围）
      {
        command: 'start',
        description: '开始使用机器人',
        scope: { type: 'default' }
      },
      {
        command: 'help',
        description: '获取帮助信息',
        scope: { type: 'default' }
      },
      
      // 私聊专用命令
      {
        command: 'profile',
        description: '查看个人资料',
        scope: { type: 'all_private_chats' }
      },
      {
        command: 'settings',
        description: '个人设置',
        scope: { type: 'all_private_chats' }
      },
      
      // 群组专用命令
      {
        command: 'rules',
        description: '查看群规',
        scope: { type: 'all_group_chats' }
      },
      {
        command: 'report',
        description: '举报消息',
        scope: { type: 'all_group_chats' }
      },
      
      // 特定聊天的命令
      {
        command: 'announce',
        description: '发布公告',
        scope: { 
          type: 'chat',
          chat_id: 'main_group_123'
        }
      },
      
      // 特定成员的命令
      {
        command: 'ban',
        description: '封禁用户',
        scope: {
          type: 'chat_member',
          chat_id: 'main_group_123',
          user_id: 'admin_456'
        }
      }
    ]);
    console.log('✅ 命令注册完成\n');

    // 2. 按范围查询命令
    console.log('🔍 按范围查询命令...');
    
    const allCommands = await client.getRegisteredCommands();
    console.log(`📋 所有命令 (${allCommands.length} 个):`, allCommands.map(cmd => cmd.command));
    
    const privateCommands = await client.getCommandsByScope('all_private_chats');
    console.log(`💬 私聊命令 (${privateCommands.length} 个):`, privateCommands.map(cmd => cmd.command));
    
    const groupCommands = await client.getCommandsByScope('all_group_chats');
    console.log(`👥 群组命令 (${groupCommands.length} 个):`, groupCommands.map(cmd => cmd.command));
    
    const chatCommands = await client.getCommandsByScope('chat', 'main_group_123');
    console.log(`🎯 特定聊天命令 (${chatCommands.length} 个):`, chatCommands.map(cmd => cmd.command));
    
    const memberCommands = await client.getCommandsByScope('chat_member', 'main_group_123', 'admin_456');
    console.log(`👤 特定成员命令 (${memberCommands.length} 个):`, memberCommands.map(cmd => cmd.command));
    console.log('');

    // 3. 使用便捷方法设置命令
    console.log('⚡ 使用便捷方法设置命令...');
    
    // 设置私聊命令（会替换现有的私聊命令）
    await client.setPrivateCommands([
      { command: 'profile', description: '查看个人资料' },
      { command: 'settings', description: '个人设置' },
      { command: 'history', description: '聊天历史' }
    ]);
    console.log('✅ 私聊命令设置完成');
    
    // 设置群组命令（会替换现有的群组命令）
    await client.setGroupCommands([
      { command: 'rules', description: '查看群规' },
      { command: 'report', description: '举报消息' },
      { command: 'poll', description: '创建投票' }
    ]);
    console.log('✅ 群组命令设置完成');
    
    // 设置默认命令（会替换现有的默认命令）
    await client.setDefaultCommands([
      { command: 'start', description: '开始使用机器人' },
      { command: 'help', description: '获取帮助信息' },
      { command: 'about', description: '关于机器人' }
    ]);
    console.log('✅ 默认命令设置完成\n');

    // 4. 单个命令范围管理
    console.log('🎛️ 单个命令范围管理...');
    
    // 添加一个新命令
    await client.addCommand({
      command: 'status',
      description: '查看机器人状态'
    });
    console.log('✅ 添加了新命令: /status');
    
    // 修改命令范围
    await client.setCommandScope('status', { type: 'all_private_chats' });
    console.log('✅ 将 /status 命令设置为仅私聊可见');
    
    // 再次修改范围
    await client.setCommandScope('status', { 
      type: 'chat_member',
      chat_id: 'admin_group_789',
      user_id: 'super_admin_123'
    });
    console.log('✅ 将 /status 命令设置为特定管理员可见\n');

    // 5. 清除特定范围的命令
    console.log('🧹 清除特定范围的命令...');
    
    // 清除所有群组命令
    await client.clearCommandsInScope('all_group_chats');
    console.log('✅ 清除了所有群组命令');
    
    // 清除特定聊天的命令
    await client.clearCommandsInScope('chat', 'main_group_123');
    console.log('✅ 清除了特定聊天的命令\n');

    // 6. 查看最终结果
    console.log('📊 最终命令列表:');
    const finalCommands = await client.getRegisteredCommands();
    finalCommands.forEach(cmd => {
      const scopeInfo = cmd.scope ? 
        `[${cmd.scope.type}${cmd.scope.chat_id ? `:${cmd.scope.chat_id}` : ''}${cmd.scope.user_id ? `:${cmd.scope.user_id}` : ''}]` : 
        '[default]';
      console.log(`  /${cmd.command} - ${cmd.description} ${scopeInfo}`);
    });

    console.log('\n🎉 命令范围演示完成！');

  } catch (error) {
    console.error('❌ 演示过程中出现错误:', error.message);
    
    // 显示详细的错误信息
    if (error.message.includes('范围类型')) {
      console.log('\n💡 提示: 请检查范围类型是否正确');
      console.log('支持的范围类型: default, all_private_chats, all_group_chats, chat, chat_member');
    }
    
    if (error.message.includes('chat_id') || error.message.includes('user_id')) {
      console.log('\n💡 提示: chat 和 chat_member 类型需要提供相应的 ID');
      console.log('- chat 类型需要: chat_id');
      console.log('- chat_member 类型需要: chat_id 和 user_id');
    }
  }
}

// 运行演示
if (require.main === module) {
  demonstrateCommandScopes();
}

module.exports = { demonstrateCommandScopes };
