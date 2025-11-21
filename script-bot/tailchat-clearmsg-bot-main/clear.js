const dotenv = require('dotenv');
const TailchatAdminClient = require('./adminClient');

dotenv.config();

/**
 * 消息清理主函数 - 使用一键删除API
 */
const clearmsg = async () => {
    // 验证环境变量
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || !process.env.host) {
        return "❌ 配置错误: 请设置环境变量 ADMIN_USER, ADMIN_PASS, host";
    }

    try {
        // 初始化管理员客户端
        const adminClient = new TailchatAdminClient();
        await adminClient.init();
        
        // 使用批量删除API
        const result = await adminClient.deleteAllMessages();
        
        if (result.success) {
            return `✅ 删除成功: 共删除 ${result.deletedCount} 条消息`;
        } else {
            return `❌ 删除失败: ${result.message || '未知错误'}`;
        }
    } catch (error) {
        return `❌ 操作失败: ${error.message}`;
    }
};

/**
 * 删除指定用户的消息
 * @param {string} userIdOrUsername - 用户ID或用户名
 */
const clearUserMessages = async (userIdOrUsername) => {
    // 验证环境变量
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || !process.env.host) {
        return "❌ 配置错误: 请设置环境变量 ADMIN_USER, ADMIN_PASS, host";
    }

    if (!userIdOrUsername) {
        return "❌ 用户ID或用户名不能为空";
    }

    try {
        // 初始化管理员客户端
        const adminClient = new TailchatAdminClient();
        await adminClient.init();
        
        // 删除用户消息
        const result = await adminClient.deleteUserMessages(userIdOrUsername);
        
        if (result.success) {
            return `✅ 删除成功: 共删除用户 ${result.username} 的 ${result.deletedCount} 条消息`;
        } else {
            return `❌ 删除失败: ${result.message || '未知错误'}`;
        }
    } catch (error) {
        return `❌ 操作失败: ${error.message}`;
    }
};

/**
 * 获取用户消息统计信息
 * @param {string} userIdOrUsername - 用户ID或用户名
 */
const getUserMessageStats = async (userIdOrUsername) => {
    // 验证环境变量
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || !process.env.host) {
        return { success: false, message: "❌ 配置错误: 请设置环境变量 ADMIN_USER, ADMIN_PASS, host" };
    }

    if (!userIdOrUsername) {
        return { success: false, message: "❌ 用户ID或用户名不能为空" };
    }

    try {
        // 初始化管理员客户端
        const adminClient = new TailchatAdminClient();
        await adminClient.init();
        
        // 获取用户消息统计
        const result = await adminClient.getUserMessageStats(userIdOrUsername);
        
        if (result.success) {
            return {
                success: true,
                messageCount: result.messageCount,
                nickname: result.nickname,
                username: result.username
            };
        } else {
            return { success: false, message: `❌ 查询失败: ${result.message || '未知错误'}` };
        }
    } catch (error) {
        return { success: false, message: `❌ 操作失败: ${error.message}` };
    }
};

/**
 * 获取用户消息列表（分页）
 * @param {string} userIdOrUsername - 用户ID或用户名
 * @param {number} page - 页码（从1开始）
 * @param {number} pageSize - 每页消息数量
 */
const getUserMessageList = async (userIdOrUsername, page = 1, pageSize = 10) => {
    // 验证环境变量
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || !process.env.host) {
        return { success: false, message: "❌ 配置错误: 请设置环境变量 ADMIN_USER, ADMIN_PASS, host" };
    }

    if (!userIdOrUsername) {
        return { success: false, message: "❌ 用户ID或用户名不能为空" };
    }

    try {
        // 初始化管理员客户端
        const adminClient = new TailchatAdminClient();
        await adminClient.init();
        
        // 获取用户消息列表
        const result = await adminClient.getUserMessageList(userIdOrUsername, page, pageSize);
        
        if (result.success) {
            return result;
        } else {
            return { success: false, message: `❌ 查询失败: ${result.message || '未知错误'}` };
        }
    } catch (error) {
        return { success: false, message: `❌ 操作失败: ${error.message}` };
    }
};

module.exports = { clearmsg, clearUserMessages, getUserMessageStats, getUserMessageList };