/**
 * 配置管理模块
 */
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

module.exports = {
  // Tailchat 服务器地址
  HOST: process.env.HOST || 'http://localhost:11000',
  
  // 机器人密钥
  APP_SECRET: process.env.APP_SECRET,
  
  // 图片生成配置
  IMAGE_CONFIG: {
    width: 800,
    height: 400,
    fontSize: {
      default: 72,
      medium: 60,
      small: 48,
    },
    background: {
      gradient: {
        start: '#667eea',
        end: '#764ba2',
      },
    },
    text: {
      color: '#ffffff',
      shadowColor: 'rgba(0, 0, 0, 0.3)',
      shadowBlur: 10,
      shadowOffset: { x: 3, y: 3 },
    },
  },
  
  // 验证配置
  validate() {
    if (!this.APP_SECRET) {
      throw new Error('错误: 请设置环境变量 APP_SECRET');
    }
  },
};

