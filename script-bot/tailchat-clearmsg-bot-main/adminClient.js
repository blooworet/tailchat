/**
 * Tailchat管理后台API客户端
 * 封装管理员登录和一键删除消息API
 */
const axios = require('axios');

class TailchatAdminClient {
  constructor(options = {}) {
    this.host = options.host || process.env.admin;
    this.adminUser = options.adminUser || process.env.ADMIN_USER;
    this.adminPass = options.adminPass || process.env.ADMIN_PASS;
    this.token = null;
    this.axios = axios.create({
      baseURL: this.host,
      validateStatus: () => true, // 接受所有状态码
      timeout: 10000,
    });
  }

  /**
   * 初始化客户端并登录
   */
  async init() {
    if (!this.host || !this.adminUser || !this.adminPass) {
      throw new Error("缺少必要配置：host、adminUser或adminPass");
    }
    
    try {
      // 直接执行登录
      await this.login();
      return true;
    } catch (error) {
      console.error('初始化客户端失败:', error.message);
      throw error;
    }
  }

  /**
   * 执行管理员登录 - 直接调用API
   */
  async login() {
    const jsonData = {
      username: this.adminUser,
      password: this.adminPass,
    };
    
    try {
      const response = await this.axios.post('/admin/api/login', jsonData, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      if (response.status === 200 && response.data && response.data.token) {
        this.token = response.data.token;
        console.log('✓ 管理员登录成功');
      } else {
        const errorMsg = response.data?.error || response.data?.message || '登录失败';
        throw new Error(`登录失败: ${errorMsg}`);
      }
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const msg = error.response.data?.message || error.response.statusText;
        throw new Error(`登录API错误 (${status}): ${msg}`);
      } else if (error.message) {
        throw error;
      } else {
        throw new Error(`登录失败: ${String(error)}`);
      }
    }
  }

  /**
   * 删除所有消息(使用批量删除API)
   */
  async deleteAllMessages() {
    this._checkAuth();
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.token}`
    };
    
    try {
      const response = await this.axios.delete('/admin/api/messages/all/confirm', {
        headers,
      });
      
      if (response.status === 200 && response.data?.success) {
        const deletedCount = response.data.deletedCount !== undefined ? response.data.deletedCount : 0;
        return {
          success: true,
          deletedCount: deletedCount,
          message: response.data.message
        };
      } else {
        throw new Error(`API返回异常: ${response.status} - ${response.data?.message || '未知错误'}`);
      }
    } catch (error) {
      if (error.response) {
        throw new Error(`删除所有消息失败 (${error.response.status}): ${error.response.data?.message || error.response.statusText}`);
      } else {
        throw new Error(`删除所有消息失败: ${error.message}`);
      }
    }
  }

  /**
   * 删除指定用户的所有消息
   * @param {string} userIdOrUsername - 用户ID或用户名
   */
  async deleteUserMessages(userIdOrUsername) {
    this._checkAuth();
    
    if (!userIdOrUsername) {
      throw new Error('用户ID或用户名不能为空');
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.token}`
    };
    
    try {
      let userId, username;
      
      // 判断是用户ID还是用户名（用户ID通常是24位的hex字符串）
      if (userIdOrUsername.length === 24 && /^[0-9a-fA-F]{24}$/.test(userIdOrUsername)) {
        // 是用户ID，直接查询用户信息
        const userResponse = await this.axios.get(`/admin/api/users/${userIdOrUsername}`, {
          headers,
        });
        
        if (userResponse.status !== 200 || !userResponse.data) {
          throw new Error(`未找到用户ID: ${userIdOrUsername}`);
        }
        
        userId = userIdOrUsername;
        username = userResponse.data.username || userResponse.data.nickname || userIdOrUsername;
      } else {
        // 是用户名，先查询用户信息获取用户ID
        const userResponse = await this.axios.get(`/admin/api/users?filter=${encodeURIComponent(JSON.stringify({username: userIdOrUsername}))}`, {
          headers,
        });
        
        if (userResponse.status !== 200 || !userResponse.data?.data?.length) {
          throw new Error(`未找到用户: ${userIdOrUsername}`);
        }
        
        const user = userResponse.data.data[0];
        userId = user.id;
        username = userIdOrUsername;
      }
      
      // ✅ 安全检查已验证，开始正常删除模式
      console.log(`🗑️ 开始删除用户消息，目标用户ID: ${userId}, 用户名: ${username}`);
      
      // 循环查询并删除该用户的所有消息
      // 由于删除消息会改变总数，我们始终从第一页开始查询
      let deletedCount = 0;
      let pageNumber = 1;
      const pageSize = 100;
      
      while (true) {
        // 始终查询第一页，因为删除后消息会重新排序
        // 注意：不使用 filter 参数，因为 API 可能不支持或语法不同，改为客户端过滤
        const messagesResponse = await this.axios.get(`/admin/api/messages?_end=${pageSize}&_start=0&_sort=createdAt&_order=DESC`, {
          headers,
        });
        
        console.log(`📄 查询第 ${pageNumber} 轮消息，找到 ${Array.isArray(messagesResponse.data) ? messagesResponse.data.length : 0} 条`);
        
        if (messagesResponse.status !== 200) {
          throw new Error(`查询用户消息失败: ${messagesResponse.status}`);
        }
        
        if (!messagesResponse.data) {
          throw new Error(`查询用户消息失败: 响应数据为空`);
        }
        
        // raExpressMongoose 直接返回数组，不是包装在 data 字段中
        const messages = Array.isArray(messagesResponse.data) ? messagesResponse.data : [];
        
        // 如果没有找到任何消息，说明已经删除完毕
        if (messages.length === 0) {
          console.log(`✅ 所有消息已删除完毕`);
          break;
        }
        
        // 过滤出属于目标用户的消息
        // 调试：打印前3条消息的author字段
        if (messages.length > 0 && pageNumber === 1) {
          console.log(`🔍 调试信息 - 前3条消息的author字段:`);
          messages.slice(0, 3).forEach((msg, idx) => {
            console.log(`  [${idx+1}] author类型: ${typeof msg.author}, 值: ${JSON.stringify(msg.author)}, 目标userId: ${userId}`);
          });
        }
        
        // 比较时转换为字符串
        const targetUserMessages = messages.filter(msg => String(msg.author) === String(userId));
        const otherUserMessages = messages.length - targetUserMessages.length;
        
        console.log(`📊 目标用户消息: ${targetUserMessages.length} 条, 其他用户消息: ${otherUserMessages} 条`);
        
        // 如果没有目标用户的消息，说明已经删除完毕
        if (targetUserMessages.length === 0) {
          console.log(`✅ 目标用户的所有消息已删除完毕`);
          break;
        }
        
        // 逐个删除目标用户的消息
        let currentPageDeleted = 0;
        for (const message of targetUserMessages) {
          try {
            // 执行实际删除
            const deleteResponse = await this.axios.delete(`/admin/api/messages/${message.id}`, {
              headers,
            });
            
            if (deleteResponse.status === 200) {
              deletedCount++;
              currentPageDeleted++;
              // console.log(`✅ 成功删除消息 ${message.id}`);
            } else {
              console.warn(`❌ 删除消息 ${message.id} 失败，状态码: ${deleteResponse.status}`);
            }
          } catch (error) {
            console.warn(`删除消息 ${message.id} 失败:`, error.message);
            // 继续删除其他消息，不中断流程
          }
        }
        
        // 进度报告
        console.log(`🗑️ 第 ${pageNumber} 轮删除完成，本轮删除: ${currentPageDeleted} 条，累计删除: ${deletedCount} 条消息`);
        pageNumber++;
        
        // 防止无限循环，如果连续多轮都没有删除任何消息，则退出
        if (currentPageDeleted === 0) {
          console.log(`⚠️ 本轮未删除任何消息，可能存在问题，停止删除`);
          break;
        }
      }
      
      return {
        success: true,
        deletedCount: deletedCount,
        username: username,
        message: `成功删除用户 ${username} 的 ${deletedCount} 条消息`
      };
    } catch (error) {
      if (error.response) {
        throw new Error(`删除用户消息失败 (${error.response.status}): ${error.response.data?.message || error.response.statusText}`);
      } else {
        throw new Error(`删除用户消息失败: ${error.message}`);
      }
    }
  }

  /**
   * 获取用户的消息统计信息
   * @param {string} userIdOrUsername - 用户ID或用户名
   */
  async getUserMessageStats(userIdOrUsername) {
    this._checkAuth();
    
    if (!userIdOrUsername) {
      throw new Error('用户ID或用户名不能为空');
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.token}`
    };
    
    try {
      let userId, username, nickname;
      
      // 判断是用户ID还是用户名（用户ID通常是24位的hex字符串）
      if (userIdOrUsername.length === 24 && /^[0-9a-fA-F]{24}$/.test(userIdOrUsername)) {
        // 是用户ID，直接查询用户信息
        const userResponse = await this.axios.get(`/admin/api/users/${userIdOrUsername}`, {
          headers,
        });
        
        if (userResponse.status !== 200 || !userResponse.data) {
          throw new Error(`未找到用户ID: ${userIdOrUsername}`);
        }
        
        userId = userIdOrUsername;
        username = userResponse.data.username || userResponse.data.nickname || userIdOrUsername;
        nickname = userResponse.data.nickname || username;
      } else {
        // 是用户名，先查询用户信息获取用户ID
        const userResponse = await this.axios.get(`/admin/api/users?filter=${encodeURIComponent(JSON.stringify({username: userIdOrUsername}))}`, {
          headers,
        });
        
        if (userResponse.status !== 200 || !userResponse.data?.data?.length) {
          throw new Error(`未找到用户: ${userIdOrUsername}`);
        }
        
        const user = userResponse.data.data[0];
        userId = user.id;
        username = userIdOrUsername;
        nickname = user.nickname || username;
      }
      
      // 分页查询该用户的所有消息并统计数量
      let totalUserMessages = 0;
      let hasMore = true;
      let start = 0;
      const pageSize = 100;
      
      console.log(`🔍 开始统计用户 ${username} 的消息数量...`);
      
      while (hasMore) {
        // 注意：不使用 filter 参数，改为客户端过滤
        const messageResponse = await this.axios.get(`/admin/api/messages?_end=${start + pageSize}&_start=${start}&_sort=createdAt&_order=DESC`, {
          headers,
        });
        
        if (messageResponse.status !== 200) {
          throw new Error(`查询消息统计失败: ${messageResponse.status}`);
        }
        
        const messages = Array.isArray(messageResponse.data) ? messageResponse.data : [];
        
        if (messages.length === 0) {
          hasMore = false;
          break;
        }
        
        // 只统计真正属于该用户的消息（转换为字符串比较）
        const userMessages = messages.filter(msg => String(msg.author) === String(userId));
        totalUserMessages += userMessages.length;
        
        console.log(`📄 统计第 ${Math.floor(start/pageSize) + 1} 页: 找到 ${messages.length} 条消息，其中用户消息 ${userMessages.length} 条，累计 ${totalUserMessages} 条`);
        
        // 如果这一页的消息数量少于页面大小，说明已经是最后一页
        if (messages.length < pageSize) {
          hasMore = false;
        } else {
          start += pageSize;
        }
      }
      
      console.log(`✅ 用户 ${username} 的消息统计完成: 总数=${totalUserMessages}`);
      return {
        success: true,
        username: username,
        userId: userId,
        messageCount: totalUserMessages,
        nickname: nickname
      };
    } catch (error) {
      if (error.response) {
        throw new Error(`查询用户消息统计失败 (${error.response.status}): ${error.response.data?.message || error.response.statusText}`);
      } else {
        throw new Error(`查询用户消息统计失败: ${error.message}`);
      }
    }
  }

  /**
   * 获取用户消息列表（分页）
   * @param {string} userIdOrUsername - 用户ID或用户名
   * @param {number} page - 页码（从1开始）
   * @param {number} pageSize - 每页消息数量
   */
  async getUserMessageList(userIdOrUsername, page = 1, pageSize = 10) {
    this._checkAuth();
    
    if (!userIdOrUsername) {
      throw new Error('用户ID或用户名不能为空');
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.token}`
    };
    
    try {
      let userId, username, nickname;
      
      // 判断是用户ID还是用户名（用户ID通常是24位的hex字符串）
      if (userIdOrUsername.length === 24 && /^[0-9a-fA-F]{24}$/.test(userIdOrUsername)) {
        // 是用户ID，直接查询用户信息
        const userResponse = await this.axios.get(`/admin/api/users/${userIdOrUsername}`, {
          headers,
        });
        
        if (userResponse.status !== 200 || !userResponse.data) {
          throw new Error(`未找到用户ID: ${userIdOrUsername}`);
        }
        
        userId = userIdOrUsername;
        username = userResponse.data.username || userResponse.data.nickname || userIdOrUsername;
        nickname = userResponse.data.nickname || username;
      } else {
        // 是用户名，先查询用户信息获取用户ID
        const userResponse = await this.axios.get(`/admin/api/users?filter=${encodeURIComponent(JSON.stringify({username: userIdOrUsername}))}`, {
          headers,
        });
        
        if (userResponse.status !== 200 || !userResponse.data?.data?.length) {
          throw new Error(`未找到用户: ${userIdOrUsername}`);
        }
        
        const user = userResponse.data.data[0];
        userId = user.id;
        username = userIdOrUsername;
        nickname = user.nickname || username;
      }
      
      // 计算分页参数
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      
      // 查询用户消息列表（不使用 filter，改为客户端过滤）
      const messageResponse = await this.axios.get(`/admin/api/messages?_end=${end}&_start=${start}&_sort=createdAt&_order=DESC`, {
        headers,
      });
      
      if (messageResponse.status !== 200) {
        throw new Error(`查询用户消息失败: ${messageResponse.status}`);
      }
      
      const allMessages = Array.isArray(messageResponse.data) ? messageResponse.data : [];
      
      // 过滤出真正属于该用户的消息（转换为字符串比较）
      const userMessages = allMessages.filter(msg => String(msg.author) === String(userId));
      
      // 获取总消息数（用于计算总页数）
      const statsResult = await this.getUserMessageStats(userIdOrUsername);
      const totalMessages = statsResult.messageCount;
      const totalPages = Math.ceil(totalMessages / pageSize);
      
      // 格式化消息数据
      const formattedMessages = userMessages.map(msg => ({
        id: msg.id,
        content: msg.content || '[无内容]',
        createdAt: msg.createdAt,
        converseId: msg.converseId,
        // 截断过长的内容
        shortContent: msg.content ? 
          (msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content) :
          '[无内容]'
      }));
      
      return {
        success: true,
        username: username,
        nickname: nickname,
        userId: userId,
        messages: formattedMessages,
        pagination: {
          currentPage: page,
          pageSize: pageSize,
          totalMessages: totalMessages,
          totalPages: totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };
    } catch (error) {
      if (error.response) {
        throw new Error(`查询用户消息列表失败 (${error.response.status}): ${error.response.data?.message || error.response.statusText}`);
      } else {
        throw new Error(`查询用户消息列表失败: ${error.message}`);
      }
    }
  }

  /**
   * 检查认证状态
   */
  _checkAuth() {
    if (!this.token) {
      throw new Error('未登录，请先初始化客户端');
    }
  }
}

module.exports = TailchatAdminClient;
