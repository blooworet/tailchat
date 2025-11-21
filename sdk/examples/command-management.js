/**
 * 机器人命令管理示例
 * 
 * 本示例展示如何使用 Tailchat SDK 管理机器人命令
 */

const { TailchatOpenApiClient } = require('../tailchat-client-sdk');

// 初始化客户端
const client = new TailchatOpenApiClient(
  'https://tailchat.msgbyte.com',  // Tailchat 服务器地址
  'your-app-secret'                // 你的应用密钥
);

async function main() {
  try {
    console.log('=== 机器人命令管理示例 ===\n');

    // 1. 注册基础命令
    console.log('1. 注册基础命令...');
    await client.registerCommands([
      {
        command: 'help',
        description: '显示帮助信息'
      },
      {
        command: 'start',
        description: '开始使用机器人'
      },
      {
        command: 'weather',
        description: '查询天气信息'
      }
    ]);
    console.log('✅ 基础命令注册成功\n');

    // 2. 查看当前注册的命令
    console.log('2. 查看当前注册的命令...');
    const commands = await client.getRegisteredCommands();
    console.log('当前注册的命令:', commands.map(cmd => `/${cmd.command}`).join(', '));
    console.log('命令详情:');
    commands.forEach(cmd => {
      console.log(`  /${cmd.command}: ${cmd.description}`);
    });
    console.log();

    // 3. 添加新命令
    console.log('3. 添加新命令...');
    await client.addCommand({
      command: 'remind',
      description: '设置提醒'
    });
    console.log('✅ 新命令 /remind 添加成功\n');

    // 4. 更新现有命令
    console.log('4. 更新现有命令...');
    await client.updateCommand('weather', {
      command: 'weather',
      description: '查询实时天气信息和预报'
    });
    console.log('✅ 命令 /weather 更新成功\n');

    // 5. 使用批量配置
    console.log('5. 使用批量配置设置完整命令...');
    await client.setCommandConfig({
      help: {
        description: '获取机器人帮助信息'
      },
      start: {
        description: '开始使用机器人，查看功能介绍'
      },
      settings: {
        description: '机器人个人设置'
      },
      custom: [
        {
          command: 'translate',
          description: '文本翻译'
        },
        {
          command: 'joke',
          description: '随机笑话'
        }
      ]
    });
    console.log('✅ 批量命令配置成功\n');

    // 6. 查看最终的命令列表
    console.log('6. 查看最终的命令列表...');
    const finalCommands = await client.getRegisteredCommands();
    console.log(`共注册了 ${finalCommands.length} 个命令:`);
    finalCommands.forEach((cmd, index) => {
      console.log(`${index + 1}. /${cmd.command} - ${cmd.description}`);
    });
    console.log();

    // 7. 删除单个命令（演示）
    console.log('7. 删除命令演示...');
    await client.removeCommand('joke');
    console.log('✅ 命令 /joke 删除成功\n');

    // 8. 查看删除后的命令列表
    const afterDeleteCommands = await client.getRegisteredCommands();
    console.log(`删除后剩余 ${afterDeleteCommands.length} 个命令:`);
    afterDeleteCommands.forEach(cmd => {
      console.log(`  /${cmd.command}`);
    });

    console.log('\n=== 命令管理示例完成 ===');

  } catch (error) {
    console.error('❌ 错误:', error.message);
    
    // 常见错误处理
    if (error.message.includes('命令名格式错误')) {
      console.log('\n💡 提示: 命令名只能包含小写字母、数字和下划线，最多32个字符');
    } else if (error.message.includes('命令名必须唯一')) {
      console.log('\n💡 提示: 不能注册重复的命令名');
    } else if (error.message.includes('最多只能注册50个命令')) {
      console.log('\n💡 提示: 单个机器人最多支持50个命令');
    } else if (error.message.includes('命令描述过长')) {
      console.log('\n💡 提示: 命令描述最多256个字符');
    }
  }
}

// 运行示例
if (require.main === module) {
  main();
}

module.exports = { main };
